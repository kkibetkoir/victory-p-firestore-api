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
/*async function downgradeAllPremiumCustomers() {
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
}*/

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

module.exports = {
  createCustomer,
  getCustomerById,
  listCustomers,
  updateCustomer,
  deleteCustomer,
  downgradeAllPremiumCustomers,
  isSubscriptionExpired, // export in case you want to use it elsewhere
};
