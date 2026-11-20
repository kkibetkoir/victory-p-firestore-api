# Q1 node + express api to read&writes to firebase firestore and do periodic job/cron job like checking for premium customers every day at 00:00 and 09:00 and making their subscription a free tier

# Node.js + Express + Firebase Firestore API with Cron Jobs

Here's a complete implementation with REST API endpoints, Firestore integration, and scheduled cron jobs.

## Project Structure

```
project/
├── src/
│   ├── config/
│   │   └── firebase.js
│   ├── routes/
│   │   └── customers.js
│   ├── services/
│   │   └── customerService.js
│   ├── jobs/
│   │   └── premiumDowngradeJob.js
│   ├── app.js
│   └── server.js
├── .env
├── package.json
└── serviceAccountKey.json
```

## 1. Install Dependencies

```bash
npm init -y
npm install express firebase-admin dotenv node-cron cors helmet morgan
npm install --save-dev nodemon
```

## 2. `package.json`

```json
{
  "name": "firestore-api",
  "version": "1.0.0",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js"
  }
}
```

## 3. `.env`

```env
PORT=3000
FIREBASE_PROJECT_ID=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json

# Cron schedule (min hour day month dayOfWeek)
CRON_PREMIUM_DOWNGRADE="0 0,9 * * *"
```

> **Note:** Get `serviceAccountKey.json` from Firebase Console → Project Settings → Service Accounts → Generate New Private Key. **Never commit this file.**

## 4. `src/config/firebase.js`

```javascript
const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config();

if (!admin.apps.length) {
  const serviceAccount = require(path.resolve(
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  ));

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

const db = admin.firestore();

module.exports = { admin, db };
```

## 5. `src/services/customerService.js`

```javascript
const { db, admin } = require('../config/firebase');

const COLLECTION = 'customers';

/**
 * Create a customer
 */
async function createCustomer(data) {
  const now = admin.firestore.Timestamp.now();
  const docRef = await db.collection(COLLECTION).add({
    ...data,
    tier: data.tier || 'free',
    createdAt: now,
    updatedAt: now,
  });
  const snapshot = await docRef.get();
  return { id: docRef.id, ...snapshot.data() };
}

/**
 * Get a single customer by ID
 */
async function getCustomerById(id) {
  const doc = await db.collection(COLLECTION).doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

/**
 * List customers (with optional filters)
 */
async function listCustomers({ tier, limit = 50 } = {}) {
  let query = db.collection(COLLECTION).limit(Number(limit));
  if (tier) query = query.where('tier', '==', tier);

  const snapshot = await query.get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

/**
 * Update a customer
 */
async function updateCustomer(id, updates) {
  const docRef = db.collection(COLLECTION).doc(id);
  const doc = await docRef.get();
  if (!doc.exists) return null;

  await docRef.update({
    ...updates,
    updatedAt: admin.firestore.Timestamp.now(),
  });

  const updated = await docRef.get();
  return { id: updated.id, ...updated.data() };
}

/**
 * Delete a customer
 */
async function deleteCustomer(id) {
  const docRef = db.collection(COLLECTION).doc(id);
  const doc = await docRef.get();
  if (!doc.exists) return false;

  await docRef.delete();
  return true;
}

/**
 * Downgrade all premium customers to free tier (batched)
 * Returns count of customers downgraded
 */
async function downgradeAllPremiumCustomers() {
  const snapshot = await db
    .collection(COLLECTION)
    .where('tier', '==', 'premium')
    .get();

  if (snapshot.empty) return { downgraded: 0 };

  // Firestore batch limit is 500 writes
  const BATCH_SIZE = 500;
  let batch = db.batch();
  let count = 0;
  let total = 0;
  const now = admin.firestore.Timestamp.now();

  for (const doc of snapshot.docs) {
    batch.update(doc.ref, {
      tier: 'free',
      downgradedAt: now,
      updatedAt: now,
    });
    count++;
    total++;

    if (count === BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) await batch.commit();

  return { downgraded: total };
}

module.exports = {
  createCustomer,
  getCustomerById,
  listCustomers,
  updateCustomer,
  deleteCustomer,
  downgradeAllPremiumCustomers,
};
```

## 6. `src/routes/customers.js`

```javascript
const express = require('express');
const router = express.Router();
const service = require('../services/customerService');

// Create
router.post('/', async (req, res, next) => {
  try {
    const customer = await service.createCustomer(req.body);
    res.status(201).json(customer);
  } catch (err) {
    next(err);
  }
});

// List
router.get('/', async (req, res, next) => {
  try {
    const customers = await service.listCustomers(req.query);
    res.json(customers);
  } catch (err) {
    next(err);
  }
});

// Get one
router.get('/:id', async (req, res, next) => {
  try {
    const customer = await service.getCustomerById(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Not found' });
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

// Update
router.patch('/:id', async (req, res, next) => {
  try {
    const updated = await service.updateCustomer(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Delete
router.delete('/:id', async (req, res, next) => {
  try {
    const ok = await service.deleteCustomer(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

## 7. `src/jobs/premiumDowngradeJob.js`

```javascript
const cron = require('node-cron');
const { downgradeAllPremiumCustomers } = require('../services/customerService');

/**
 * Runs every day at 00:00 and 09:00.
 * Downgrades all premium customers to free tier.
 */
function startPremiumDowngradeJob() {
  const schedule = process.env.CRON_PREMIUM_DOWNGRADE || '0 0,9 * * *';

  cron.schedule(schedule, async () => {
    const startedAt = new Date().toISOString();
    console.log(`[CRON] Premium downgrade job started at ${startedAt}`);

    try {
      const result = await downgradeAllPremiumCustomers();
      console.log(
        `[CRON] Finished: ${result.downgraded} customer(s) downgraded to free tier`
      );
    } catch (err) {
      console.error('[CRON] Premium downgrade job failed:', err);
    }
  });

  console.log(`[CRON] Premium downgrade job scheduled: "${schedule}"`);
}

module.exports = { startPremiumDowngradeJob };
```

## 8. `src/app.js`

```javascript
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const customersRouter = require('./routes/customers');

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/customers', customersRouter);

// 404
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

module.exports = app;
```

## 9. `src/server.js`

```javascript
require('dotenv').config();
const app = require('./app');
const { startPremiumDowngradeJob } = require('./jobs/premiumDowngradeJob');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);

  // Start scheduled jobs
  startPremiumDowngradeJob();
});
```

## 10. Manual Test Endpoint (optional but useful)

Add to `src/routes/customers.js`:

```javascript
// Manually trigger the downgrade (protect in production!)
router.post('/admin/downgrade-premium', async (req, res, next) => {
  try {
    const result = await require('../services/customerService')
      .downgradeAllPremiumCustomers();
    res.json(result);
  } catch (err) {
    next(err);
  }
});
```

> ⚠️ Protect this route with authentication in production (e.g., check a secret header).

## 11. Example cURL Usage

```bash
# Create premium customer
curl -X POST http://localhost:3000/api/customers \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com","tier":"premium"}'

# List all
curl http://localhost:3000/api/customers

# List premium only
curl "http://localhost:3000/api/customers?tier=premium"

# Update
curl -X PATCH http://localhost:3000/api/customers/<ID> \
  -H "Content-Type: application/json" \
  -d '{"tier":"premium"}'

# Delete
curl -X DELETE http://localhost:3000/api/customers/<ID>

# Manually run downgrade job
curl -X POST http://localhost:3000/api/customers/admin/downgrade-premium
```

---

## Cron Expression Explained

`0 0,9 * * *`

| Field        | Value | Meaning            |
| ------------ | ----- | ------------------ |
| minute       | `0`   | At minute 0        |
| hour         | `0,9` | At 00:00 and 09:00 |
| day of month | `*`   | Every day          |
| month        | `*`   | Every month        |
| day of week  | `*`   | Every day of week  |

## Production Considerations

1. **Single instance only** — `node-cron` runs inside the Node process. If you deploy multiple instances (e.g., Kubernetes pods), the job runs on **each** pod, causing duplicate downgrades. Solutions:

   - Run the job in a separate dedicated worker service.
   - Use **Cloud Scheduler + Cloud Functions** (native GCP, recommended).
   - Use a distributed lock (e.g., Firestore transaction with a `jobLocks` collection).

2. **Batch writes** — Firestore limits batches to **500 operations**; the service handles this by chunking.

3. **Auth** — Add Firebase Auth middleware on routes in production.

4. **Logging** — Replace `console.log` with a structured logger (pino, winston).

5. **Idempotency** — The downgrade job is idempotent: premium customers get set to `free` and `downgradedAt` timestamp is written. Re-running it is safe.

6. **Time zone** — `node-cron` uses the server's time zone. To force one, pass options:

   ```javascript
   cron.schedule(schedule, handler, { timezone: 'Asia/Kolkata' });
   ```

7. **Cloud Functions alternative** (if using GCP): replace `node-cron` with **Cloud Scheduler** hitting a Cloud Function/HTTP endpoint — more reliable and doesn't rely on a running server.

# Q2 see how my frontend checks its logic; ... and tell me small change to make in the code you provided so that i can update user by checking their subscription expiration date like in the frontend

# Aligning Backend Job with Frontend Subscription Logic

Your frontend uses a **"calculate expiration from `subDate` + plan"** approach, not a simple `isPremium` flag. Your backend cron job needs to do the same. Here's the small change.

## The Key Insight

Frontend logic:

- `isPremium = true` + `subscription.subDate` + `subscription.plan`
- Expiration = `parseSubDate(subDate) + timeLimits[plan]`
- When expired → set `isPremium = false`, `subscription = null`

So the backend should **query for users with `isPremium === true`**, compute the expiration date in Node, and downgrade only those whose time has passed. **Not** blanket downgrade all premium users.

## Change Only `downgradeAllPremiumCustomers` in `src/services/customerService.js`

Replace the function with:

```javascript
const TIME_LIMITS = {
  Daily:   1  * 24 * 60 * 60 * 1000,
  Weekly:  7  * 24 * 60 * 60 * 1000,
  Monthly: 30 * 24 * 60 * 60 * 1000,
  Yearly:  365 * 24 * 60 * 60 * 1000,
};

/**
 * Parse a subDate string like "2024-05-01" or "2024-05-01T14:30"
 * into a JS Date (local time — matches the frontend behavior).
 */
function parseSubDate(str) {
  const [datePart, timePart = '00:00'] = str.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0, 0);
}

/**
 * Returns true if the customer's subscription has expired
 * based on subDate + plan, using the same rules as the frontend.
 */
function isSubscriptionExpired(customer, now = Date.now()) {
  const sub = customer.subscription;
  if (!sub || !sub.subDate) return true; // no sub data → treat as expired

  const plan = sub.plan || sub.billing;
  const limit = TIME_LIMITS[plan];
  if (limit === undefined) {
    console.warn(`[CRON] Unknown plan "${plan}" for customer ${customer.id}`);
    return false; // don't downgrade on unknown plan — safer
  }

  const startTime = parseSubDate(sub.subDate).getTime();
  return now - startTime >= limit;
}

/**
 * Downgrade only customers whose subscription has actually expired.
 */
async function downgradeAllPremiumCustomers() {
  const snapshot = await db
    .collection(COLLECTION)
    .where('isPremium', '==', true)
    .get();

  if (snapshot.empty) return { downgraded: 0, scanned: 0 };

  const now = Date.now();
  const nowTs = admin.firestore.Timestamp.now();
  const BATCH_SIZE = 500;
  let batch = db.batch();
  let pending = 0;
  let downgraded = 0;

  for (const doc of snapshot.docs) {
    const customer = { id: doc.id, ...doc.data() };

    if (!isSubscriptionExpired(customer, now)) continue;

    batch.update(doc.ref, {
      isPremium: false,
      subscription: null,
      downgradedAt: nowTs,
      updatedAt: nowTs,
    });

    pending++;
    downgraded++;

    if (pending === BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (pending > 0) await batch.commit();

  return { downgraded, scanned: snapshot.size };
}
```

Update the export list at the bottom of the file:

```javascript
module.exports = {
  createCustomer,
  getCustomerById,
  listCustomers,
  updateCustomer,
  deleteCustomer,
  downgradeAllPremiumCustomers,
  isSubscriptionExpired, // export in case you want to use it elsewhere
};
```

And update the log in `src/jobs/premiumDowngradeJob.js`:

```javascript
const result = await downgradeAllPremiumCustomers();
console.log(
  `[CRON] Scanned ${result.scanned}, downgraded ${result.downgraded} expired subscription(s)`
);
```

---

## What Changed (TL;DR)

| Before                             | After                                                             |
| ---------------------------------- | ----------------------------------------------------------------- |
| Query `tier === 'premium'`         | Query `isPremium === true` (matches your frontend schema)         |
| Blanket downgrade all premium      | Compute `subDate + plan` limit, downgrade **only expired**        |
| Set `tier: 'free'`                 | Set `isPremium: false, subscription: null` (matches `updateUser`) |
| Any unknown plan → still downgrade | Unknown plan → skip (log warning), safer                          |

---

## ⚠️ Important Compatibility Notes

1. **Field names must match your Firestore schema.** Your frontend uses:

   - `isPremium` (boolean)
   - `subscription.subDate` (string like `"2024-05-01"` or `"2024-05-01T14:30"`)
   - `subscription.plan` or `subscription.billing`

   The **admin/CRUD routes** in the earlier code still assume a `tier` field. If your real collection is `users` and uses `isPremium`, change the `COLLECTION` constant:

   ```javascript
   const COLLECTION = 'users'; // was 'customers'
   ```

   And adjust the `createCustomer` / `updateCustomer` payloads accordingly (or drop those routes if not needed).

2. **`subscription: null` vs deletion.** `updateDoc(..., { subscription: null })` writes `null`. Your frontend's `updateUser(user.email, false, null, ...)` does exactly this, so we're consistent. ✅

3. **Document ID vs email.** Your frontend calls `updateUser(user.email, ...)` — meaning **the doc ID in `users` is the email**. The backend uses `doc.id` from the query snapshot, so it works regardless. ✅

4. **Timezone.** `parseSubDate` uses `new Date(y, m-1, d, ...)` which is **local time on the server**. If your server runs UTC but your users/frontend are in e.g. Africa/Lagos, expiration may trigger up to `UTC offset` hours late/early. To match the frontend exactly, either:

   - Run the cron on a server in the same TZ, or
   - Pass `{ timezone: 'Africa/Lagos' }` to `cron.schedule(...)`, and
   - Parse `subDate` explicitly in that TZ using `luxon` or `date-fns-tz`.

5. **Double-write overlap with frontend.** If the frontend already handles expiry on load, the cron is a safety net for users who never open the app. That's fine — the operation is idempotent (`isPremium` already `false` → skipped next run).

6. **Performance.** Scanning all premium users every run is fine for thousands. At 100k+, add a computed `subscriptionExpiresAt` timestamp at purchase time and query `where('subscriptionExpiresAt', '<=', now)` — much cheaper. But that requires changing the write path in `updateUser` on the frontend too.

# Q3 see the code and write tipsService.js

# `tipsService.js` — Firestore Service for Tips

Based on your `AddTip` / `EditTip` components, the tip document shape is:

```js
{
  home: string,
  away: string,
  date: string,        // "M/D/YYYY"  (Intl en-US)
  time: string,        // "HH:MM"     (24h)
  odd: string,
  pick: string,
  status: string,      // "Finish" | "Pending" | "Live"
  won: string,         // "won" | "pending" | "lost"
  premium: boolean,
  results: string,
}
```

Here's the matching backend service, plus routes.

---

## `src/services/tipsService.js`

```javascript
const { db, admin } = require('../config/firebase');

const COLLECTION = 'tips';

/**
 * Normalize a raw tip payload coming from the client.
 * Mirrors the shape produced by AddTip/EditTip so Firestore
 * always stores the same fields in the same format.
 */
function normalizeTip(input = {}) {
  return {
    home: String(input.home ?? '').trim(),
    away: String(input.away ?? '').trim(),
    date: String(input.date ?? '').trim(),          // "M/D/YYYY"
    time: String(input.time ?? '').trim(),          // "HH:MM"
    odd: String(input.odd ?? '').trim(),
    pick: String(input.pick ?? '').trim(),
    status: String(input.status ?? '').trim(),
    won: String(input.won ?? '').trim(),
    premium: Boolean(input.premium),
    results: String(input.results ?? '').trim(),
  };
}

/** Very small validator — returns array of error strings (empty = valid). */
function validateTip(tip) {
  const errors = [];
  if (!tip.home) errors.push('home is required');
  if (!tip.away) errors.push('away is required');
  if (!tip.odd) errors.push('odd is required');
  if (!tip.pick) errors.push('pick is required');
  if (!tip.status) errors.push('status is required');
  if (!tip.won) errors.push('won is required');
  if (!tip.date) errors.push('date is required (M/D/YYYY)');
  if (!tip.time) errors.push('time is required (HH:MM)');
  if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(tip.date))
    errors.push('date must be M/D/YYYY');
  if (!/^\d{2}:\d{2}$/.test(tip.time))
    errors.push('time must be HH:MM');
  if (!['won', 'pending', 'lost'].includes(tip.won))
    errors.push('won must be "won", "pending", or "lost"');
  if (!['Finish', 'Pending', 'Live'].includes(tip.status))
    errors.push('status must be "Finish", "Pending", or "Live"');
  return errors;
}

/**
 * Convert stored "M/D/YYYY" + "HH:MM" into a real Date object
 * (useful for sorting / expiry checks on the backend).
 */
function toDateObject(tip) {
  if (!tip?.date || !tip?.time) return null;
  const [m, d, y] = tip.date.split('/').map(Number);
  const [hh, mm] = tip.time.split(':').map(Number);
  if ([m, d, y, hh, mm].some((n) => Number.isNaN(n))) return null;
  return new Date(y, m - 1, d, hh, mm, 0);
}

/**
 * Create a new tip.
 */
async function createTip(input) {
  const tip = normalizeTip(input);
  const errors = validateTip(tip);
  if (errors.length) {
    const err = new Error(`Invalid tip: ${errors.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const now = admin.firestore.Timestamp.now();
  const docRef = await db.collection(COLLECTION).add({
    ...tip,
    createdAt: now,
    updatedAt: now,
  });

  const snap = await docRef.get();
  return { id: docRef.id, ...snap.data() };
}

/**
 * Get a tip by id.
 */
async function getTipById(id) {
  const doc = await db.collection(COLLECTION).doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

/**
 * List tips.
 * Options:
 *   - premium: boolean  (filter by premium flag)
 *   - status:  string   (filter by status)
 *   - won:     string   (filter by won)
 *   - limit:   number   (default 50, max 200)
 *   - orderBy: 'createdAt' | 'date' (default 'createdAt')
 *   - order:   'asc' | 'desc'       (default 'desc')
 */
async function listTips({
  premium,
  status,
  won,
  limit = 50,
  orderBy = 'createdAt',
  order = 'desc',
} = {}) {
  let q = db.collection(COLLECTION);

  if (typeof premium === 'boolean') q = q.where('premium', '==', premium);
  if (status) q = q.where('status', '==', status);
  if (won) q = q.where('won', '==', won);

  q = q.orderBy(orderBy, order === 'asc' ? 'asc' : 'desc');
  q = q.limit(Math.min(Number(limit) || 50, 200));

  const snap = await q.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Update a tip (partial). Mirrors EditTip's updateTip().
 */
async function updateTip(id, updates) {
  const docRef = db.collection(COLLECTION).doc(id);
  const doc = await docRef.get();
  if (!doc.exists) return null;

  // Normalize only the fields actually being sent
  const partial = {};
  for (const key of [
    'home',
    'away',
    'date',
    'time',
    'odd',
    'pick',
    'status',
    'won',
    'premium',
    'results',
  ]) {
    if (updates[key] !== undefined) {
      partial[key] =
        key === 'premium' ? Boolean(updates[key]) : String(updates[key]).trim();
    }
  }

  // Validate merged doc against validator
  const merged = { ...doc.data(), ...partial };
  const errors = validateTip(merged);
  if (errors.length) {
    const err = new Error(`Invalid tip: ${errors.join(', ')}`);
    err.status = 400;
    throw err;
  }

  await docRef.update({
    ...partial,
    updatedAt: admin.firestore.Timestamp.now(),
  });

  const updated = await docRef.get();
  return { id: updated.id, ...updated.data() };
}

/**
 * Delete a tip.
 */
async function deleteTip(id) {
  const docRef = db.collection(COLLECTION).doc(id);
  const doc = await docRef.get();
  if (!doc.exists) return false;
  await docRef.delete();
  return true;
}

/**
 * Paginated list — for infinite scroll / "load more".
 * Cursor is the last document's `createdAt` (or an id-based cursor).
 */
async function listTipsPaginated({
  premium,
  limit = 20,
  startAfterDate = null, // Firestore Timestamp or ISO string
} = {}) {
  let q = db.collection(COLLECTION);
  if (typeof premium === 'boolean') q = q.where('premium', '==', premium);

  q = q.orderBy('createdAt', 'desc').limit(Math.min(Number(limit) || 20, 100));

  if (startAfterDate) {
    const ts =
      typeof startAfterDate === 'string'
        ? admin.firestore.Timestamp.fromDate(new Date(startAfterDate))
        : startAfterDate;
    q = q.startAfter(ts);
  }

  const snap = await q.get();
  const tips = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const last = snap.docs[snap.docs.length - 1];
  return {
    tips,
    cursor: last ? last.get('createdAt') : null,
    hasMore: snap.size === Number(limit),
  };
}

module.exports = {
  normalizeTip,
  validateTip,
  toDateObject,
  createTip,
  getTipById,
  listTips,
  updateTip,
  deleteTip,
  listTipsPaginated,
};
```

---

## `src/routes/tips.js`

```javascript
const express = require('express');
const router = express.Router();
const tips = require('../services/tipsService');

// Create
router.post('/', async (req, res, next) => {
  try {
    const tip = await tips.createTip(req.body);
    res.status(201).json(tip);
  } catch (err) {
    next(err);
  }
});

// List (with filters)
router.get('/', async (req, res, next) => {
  try {
    const { premium, status, won, limit, orderBy, order } = req.query;
    const list = await tips.listTips({
      premium: premium === undefined ? undefined : premium === 'true',
      status,
      won,
      limit,
      orderBy,
      order,
    });
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// Paginated
router.get('/paginated', async (req, res, next) => {
  try {
    const { premium, limit, cursor } = req.query;
    const result = await tips.listTipsPaginated({
      premium: premium === undefined ? undefined : premium === 'true',
      limit,
      startAfterDate: cursor || null,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Get one
router.get('/:id', async (req, res, next) => {
  try {
    const tip = await tips.getTipById(req.params.id);
    if (!tip) return res.status(404).json({ error: 'Not found' });
    res.json(tip);
  } catch (err) {
    next(err);
  }
});

// Update
router.patch('/:id', async (req, res, next) => {
  try {
    const updated = await tips.updateTip(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Delete
router.delete('/:id', async (req, res, next) => {
  try {
    const ok = await tips.deleteTip(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

## Wire it in `src/app.js`

```javascript
const tipsRouter = require('./routes/tips');

// ...after customers route
app.use('/api/tips', tipsRouter);
```

---

## Notes / Design Choices

1. **Same field names & formats as your frontend.** The `date` field is stored as `"M/D/YYYY"` and `time` as `"HH:MM"` — exactly what `AddTip`/`EditTip` produce. This keeps DB records consistent whether written from the browser SDK or the backend API.

2. **`normalizeTip` coerces types.** Frontend `premium` is a checkbox → boolean; strings are trimmed. Prevents `"false"` (string) sneaking into Firestore.

3. **`validateTip` matches the frontend's `required` attributes** — `home`, `away`, `odd`, `pick`, `status`, `time`, `won` required; `results` optional. It also enforces enum values (`won` in `won|pending|lost`, `status` in `Finish|Pending|Live`) since the frontend uses a free-text input, which is error-prone.

4. **`toDateObject` helper** — useful if you ever need to query by actual date, or build a cron that auto-marks tips as `Finish` after match time. Firestore's string format `"M/D/YYYY"` isn't sortable/filterable by date, so this helper converts on the fly. For scale, consider storing an extra `matchDateTime: Timestamp` field computed at write time.

5. **`listTipsPaginated`** — cursor-based, uses `createdAt` as the cursor. If you need a "newest match first" feed, switch the order to `date` — but since `date` is a string, you'd need the computed Timestamp field mentioned above.

6. **Indexes.** If you filter by `premium` + `status` + order by `createdAt`, Firestore will ask you to create a composite index — click the link in the error. Same for any multi-field filter.

7. **Add a `matchDateTime` field (recommended):** if you want to sort/filter tips by their actual match date (e.g., "give me tips happening in the next 24h"), add this to `createTip`/`updateTip`:
   ```javascript
   matchDateTime: admin.firestore.Timestamp.fromDate(toDateObject(tip))
   ```
   That makes future cron jobs / "live tips" queries much easier.

# Q4 is it possible to have webhooks/endpoints that trigger to check when user actually pay so that users are always upgraded;  ... i want so that users won't complain about making payment but sometimes not upgraded

# Yes — and you **absolutely should** add webhooks. Here's the full picture.

Your current flow relies entirely on the **client-side `onSuccess` callback**. That is fragile:

- User closes tab / loses network between payment and redirect → **paid, never upgraded**
- Browser crashes / script blocked → **paid, never upgraded**
- User refreshes before `updateUser` resolves → **paid, never upgraded**
- Malicious user could even fake `window.Korapay.initialize` success → **upgraded without paying**

**Webhooks fix all of this.** Kora's server will POST to your backend the moment payment succeeds — regardless of what the browser does.

---

## Architecture Overview

```
┌──────────┐  pay   ┌──────────┐  webhook   ┌────────────┐  update   ┌───────────┐
│ Frontend │──────▶│  Korapay │───────────▶│  Backend   │─────────▶│ Firestore │
└──────────┘        └──────────┘            └────────────┘           └───────────┘
     │                                            ▲
     └─────── optional "verify" call ────────────┘
              (belt-and-suspenders)
```

**Two independent paths** upgrade the user:
1. **Frontend** `onSuccess` → calls `handleUpgrade` (fast UX, existing flow — keep it, but change it to call backend, not write directly to Firestore)
2. **Webhook** from Kora → backend verifies signature → upgrades user (source of truth)

Both are **idempotent** (see below), so it doesn't matter if both fire.

---

## Critical Change First: Pass `email` + `plan` to Kora

Kora's webhook only tells you `reference`, `amount`, `status`. **It does not know which user or plan** unless you tell it. So pass them as `metadata` when initializing:

### Update `KoraPayments.js` — `handlePayment`

```js
window.Korapay.initialize({
  key: import.meta.env.VITE_KORA_PK_KEY,
  reference: `${user.email.split('@')[0]}-${Date.now()}`, // human-readable
  amount,
  currency: payCurrency,
  customer: { name: customerEmail, email: customerEmail },
  metadata: {                          // ← ADD THIS
    email: user.email,                 //   who is paying
    plan: subscription.plan,           //   "Daily" | "Weekly" | "Monthly"
    billing: subscription.billing,     //   "Day" | "Week" | "Month"
    planId: subscription.id,           //   "1" | "2" | "3"
  },
  onSuccess: () => handleUpgrade(),
  onFailed: (err) => { /* … */ },
  onClose: () => {},
});
```

### Update `handleUpgrade` to verify via backend

Instead of writing straight to Firestore, ask the backend to confirm the payment:

```js
const handleUpgrade = async () => {
  try {
    await fetch(`${import.meta.env.VITE_API_URL}/api/payments/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference: /* you need to save it */ }),
    });
    await getUser(user.email, setUser);
    navigate('/', { replace: true });
  } catch (err) {
    setNotification({
      isVisible: true,
      type: 'error',
      message: 'Payment received — account will update shortly.',
    });
  }
};
```

> **Store the `reference` in a `useRef`** before `initialize` so `onSuccess` can send it. Example:
> ```js
> const referenceRef = useRef(null);
> // in handlePayment:
> const reference = `${user.email.split('@')[0]}-${Date.now()}`;
> referenceRef.current = reference;
> window.Korapay.initialize({ reference, /* … */ });
> // in handleUpgrade:
> body: JSON.stringify({ reference: referenceRef.current })
> ```

Even if the frontend verify call fails (user closed tab), the **webhook will still run** and upgrade them. That's the whole point.

---

## Backend: Payment Service

### `src/services/paymentService.js`

```javascript
const crypto = require('crypto');
const fetch = require('node-fetch'); // or use global fetch (Node 18+)
const { db, admin } = require('../config/firebase');

const COLLECTION = 'users';
const PAYMENTS = 'payments';

// Same limits as the frontend — keep in ONE place on the backend now.
const PLAN_DURATIONS_MS = {
  Daily:   1  * 24 * 60 * 60 * 1000,
  Weekly:  7  * 24 * 60 * 60 * 1000,
  Monthly: 30 * 24 * 60 * 60 * 1000,
  Yearly:  365 * 24 * 60 * 60 * 1000,
};

/**
 * Verify a Kora payment reference directly with the Kora API.
 * Use this as the "source of truth" — never trust the webhook body alone.
 */
async function verifyWithKora(reference) {
  const secret = process.env.KORA_SECRET_KEY;
  if (!secret) throw new Error('KORA_SECRET_KEY not configured');

  const res = await fetch(`https://api.korapay.com/merchant/api/v1/charges/${reference}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Kora verify failed (${res.status}): ${body}`);
  }

  const json = await res.json();
  const data = json?.data;
  if (!data) throw new Error('Kora verify returned no data');

  return {
    reference: data.reference,
    status: data.status,                 // "success" when paid
    amount: data.amount,
    currency: data.currency,
    metadata: data.metadata || {},
    customerEmail: data.customer?.email,
  };
}

/**
 * Upgrade a user to premium based on a verified payment.
 * Idempotent: if a payment doc for this reference already exists
 * AND the user already has a newer subDate, do nothing.
 */
async function upgradeUserFromPayment(payment) {
  const { reference, status, metadata } = payment;

  if (status !== 'success') {
    return { upgraded: false, reason: `Payment status is "${status}"` };
  }

  const email = metadata?.email || payment.customerEmail;
  const plan = metadata?.plan;
  const billing = metadata?.billing;

  if (!email) throw new Error('Payment has no email in metadata');
  if (!plan || !PLAN_DURATIONS_MS[plan]) {
    throw new Error(`Unknown plan in metadata: ${plan}`);
  }

  // ---- Idempotency check (most important part) ----
  // If this reference was already processed, skip.
  const paymentRef = db.collection(PAYMENTS).doc(reference);
  const existingPayment = await paymentRef.get();
  if (existingPayment.exists && existingPayment.data().processed) {
    return { upgraded: false, reason: 'Already processed', reference };
  }

  const userRef = db.collection(COLLECTION).doc(email);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    // Payment came in for an email not in our users collection.
    // Record it anyway so admin can reconcile.
    await paymentRef.set({
      reference,
      email,
      plan,
      amount: payment.amount,
      currency: payment.currency,
      status,
      processed: false,
      error: 'user-not-found',
      createdAt: admin.firestore.Timestamp.now(),
    });
    throw new Error(`No user found for email ${email}`);
  }

  // ---- Verify amount matches plan price (optional but recommended) ----
  // Look up expected price server-side; never trust amount alone.
  // Skipping here — see "Reconcile amounts" note below.

  const now = new Date();
  const nowTs = admin.firestore.Timestamp.fromDate(now);

  // Extend from existing subDate if still active, otherwise start fresh.
  const current = userSnap.data();
  let startFrom = now;
  if (current?.isPremium && current?.subscription?.subDate) {
    const existingExpiry = getExpiry(current.subscription.subDate, current.subscription.plan);
    if (existingExpiry && existingExpiry > now) startFrom = existingExpiry;
  }

  const newSubDate = startFrom.toISOString();
  const expiresAt = new Date(startFrom.getTime() + PLAN_DURATIONS_MS[plan]);

  await userRef.update({
    isPremium: true,
    subscription: {
      subDate: newSubDate,
      plan,
      billing,
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt), // NEW: helps cron
      lastReference: reference,
    },
    updatedAt: nowTs,
  });

  await paymentRef.set({
    reference,
    email,
    plan,
    amount: payment.amount,
    currency: payment.currency,
    status,
    processed: true,
    processedAt: nowTs,
    createdAt: existingPayment.exists ? existingPayment.data().createdAt : nowTs,
  });

  return { upgraded: true, email, plan, subDate: newSubDate, expiresAt };
}

function getExpiry(subDate, plan) {
  const limits = PLAN_DURATIONS_MS;
  if (!limits[plan] || !subDate) return null;
  const d = new Date(subDate);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + limits[plan]);
}

/** Record a payment attempt that failed verification (for audit / retries). */
async function recordFailedPayment(reference, payload, error) {
  await db.collection(PAYMENTS).doc(reference || `failed-${Date.now()}`).set({
    reference,
    payload,
    error: String(error),
    processed: false,
    createdAt: admin.firestore.Timestamp.now(),
  }, { merge: true });
}

module.exports = {
  verifyWithKora,
  upgradeUserFromPayment,
  recordFailedPayment,
  PLAN_DURATIONS_MS,
};
```

---

## Backend: Webhook Route

### `src/routes/payments.js`

```javascript
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const paymentService = require('../services/paymentService');

/**
 * Kora webhook endpoint.
 * Configure this URL in Korapay Dashboard → Settings → Webhooks:
 *   https://your-api.com/api/payments/webhook/kora
 *
 * Kora signs the raw body with HMAC-SHA256 using your secret key,
 * header: x-korapay-signature
 */
router.post(
  '/webhook/kora',
  express.raw({ type: 'application/json' }), // raw body needed for signature
  async (req, res) => {
    const signature = req.headers['x-korapay-signature'];
    const secret = process.env.KORA_SECRET_KEY;

    // 1. Verify the signature
    if (!signature || !secret) {
      console.warn('[KORA WEBHOOK] Missing signature or secret');
      return res.status(400).json({ error: 'Missing signature' });
    }

    const computed = crypto
      .createHmac('sha256', secret)
      .update(req.body) // req.body is a Buffer here because of express.raw
      .digest('hex');

    if (computed !== signature) {
      console.warn('[KORA WEBHOOK] Invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // 2. Parse and act
    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch (err) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const { event, data } = payload;
    console.log('[KORA WEBHOOK]', event, data?.reference);

    // Respond to Kora FAST (they retry on timeout). Do the work async.
    res.status(200).json({ received: true });

    if (event === 'charge.success' && data?.reference) {
      try {
        // Belt-and-suspenders: don't trust webhook body — verify with API.
        const verified = await paymentService.verifyWithKora(data.reference);
        const result = await paymentService.upgradeUserFromPayment(verified);
        console.log('[KORA WEBHOOK] Upgrade result:', result);
      } catch (err) {
        console.error('[KORA WEBHOOK] Upgrade failed:', err);
        await paymentService
          .recordFailedPayment(data.reference, payload, err)
          .catch(() => {});
      }
    }
  }
);

/**
 * Manual verify endpoint — frontend calls this from onSuccess.
 * The user shouldn't have to wait for webhook propagation.
 */
router.post('/verify', async (req, res, next) => {
  try {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ error: 'reference required' });

    const verified = await paymentService.verifyWithKora(reference);
    const result = await paymentService.upgradeUserFromPayment(verified);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

### Wire in `src/app.js`

⚠️ **Order matters.** The webhook needs the *raw* body to verify the signature, but `express.json()` normally consumes it. Mount the webhook route **before** `express.json()`:

```javascript
const paymentsRouter = require('./routes/payments');

// Webhook FIRST — needs raw body, and takes its own express.raw()
app.use('/api/payments', paymentsRouter);

// Then the JSON parser for everything else
app.use(express.json());

// Other routes after
app.use('/api/customers', customersRouter);
app.use('/api/tips', tipsRouter);
```

> If you find your webhook fails signature verification, it's almost always because `express.json()` ran first and consumed the body. Mount the raw route first.

---

## Kora Webhook Configuration (Dashboard)

1. Go to **Korapay Dashboard → Settings → Webhooks**
2. **Webhook URL**: `https://your-api.com/api/payments/webhook/kora`
3. **Secret**: use the same value you put in `KORA_SECRET_KEY` (they sign with the **secret key**, not the public key)
4. Enable events: `charge.success` (and optionally `charge.failed` for logging)

Korapay retries failed webhooks for a while, but **respond 200 immediately** and process async — the code above does that.

---

## Fix Your Cron Job to Use the New Field

Since `upgradeUserFromPayment` now writes `subscription.expiresAt` (a real Firestore Timestamp), your cron from earlier becomes **much faster and more reliable** — no date-parsing needed:

```javascript
async function downgradeAllPremiumCustomers() {
  const nowTs = admin.firestore.Timestamp.now();

  const snapshot = await db
    .collection('users')
    .where('isPremium', '==', true)
    .where('subscription.expiresAt', '<=', nowTs)   // ← direct query!
    .get();

  if (snapshot.empty) return { downgraded: 0, scanned: 0 };

  const batch = db.batch();
  const update = {
    isPremium: false,
    subscription: null,
    downgradedAt: nowTs,
    updatedAt: nowTs,
  };

  snapshot.docs.forEach((doc) => batch.update(doc.ref, update));
  await batch.commit();

  return { downgraded: snapshot.size, scanned: snapshot.size };
}
```

> This needs a **composite index** on `users` for `isPremium ASC, subscription.expiresAt ASC`. Firestore will give you a one-click link to create it the first time you run the query.

**Backfill for existing users** — since older records only have `subDate`, write a one-off script (or lazy fallback in the cron) to compute `expiresAt` from `subDate + plan` and save it. After that, this faster path works for everyone.

---

## Recommended `payments` Collection Shape

Your backend writes this, so admins can reconcile "user paid but is free" complaints:

```js
payments/{reference} = {
  reference: "john-1716...",
  email: "john@example.com",
  plan: "Weekly",
  amount: 850,
  currency: "NGN",
  status: "success",
  processed: true,
  processedAt: Timestamp,
  createdAt: Timestamp,
  // on failure:
  error: "No user found for email…",
  payload: { /* raw webhook body */ },
}
```

Give your admin panel a query:
```js
db.collection('payments')
  .where('processed', '==', false)
  .get()
```
Any doc here = someone paid but didn't get upgraded. That's your "no more complaints" safety net — you can see it and fix it in seconds.

---

## What to Tell Users During the Gap

Even with webhooks, there's a ~2–10 s window between payment success and webhook arrival. Handle it in the frontend:

- **onSuccess**: show "Payment received ✓ — activating your account…" and poll `getUser(user.email, setUser)` every 2 s for up to 30 s, or call `/api/payments/verify` directly (fastest).
- If 30 s elapse with no upgrade: show "Your payment is being processed. You'll get VIP access within a few minutes — no action needed. Reference: `xxxx`."
- Log the reference in `localStorage` so you can query it if they complain.

That single UX change eliminates almost every "I paid but I'm not premium" complaint, because the user *sees* it's in progress rather than staring at a still-locked site.

---

## Summary of Changes to Make

| Where | Change |
|-------|--------|
| `KoraPayments.js` | Add `metadata: { email, plan, billing, planId }` to `initialize()` |
| `KoraPayments.js` | Save `reference` in a `useRef`; `onSuccess` → call `POST /api/payments/verify` |
| `KoraPayments.js` | Show "activating…" state, poll `getUser` until `isPremium` true |
| Backend `app.js` | Mount `/api/payments` router **before** `express.json()` |
| Backend | Add `paymentService.js` + `payments.js` routes (above) |
| Backend | Store `subscription.expiresAt` as Timestamp on upgrade |
| Korapay dashboard | Set webhook URL, enable `charge.success` |
| Cron | Simplify to `where('subscription.expiresAt','<=',now)` |
| Firestore | Add `payments` collection for audit/reconciliation |
| Firestore | Composite index: `users(isPremium ASC, subscription.expiresAt ASC)` |

**Never trust the client-only upgrade path** — that's the root cause of "sometimes not upgraded." The webhook is the fix; the verify endpoint makes it feel instant; the `payments` collection makes you *see* every failure instead of hearing about it from angry users.
