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
