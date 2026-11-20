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
    date: String(input.date ?? '').trim(), // "M/D/YYYY"
    time: String(input.time ?? '').trim(), // "HH:MM"
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
  if (!/^\d{2}:\d{2}$/.test(tip.time)) errors.push('time must be HH:MM');
  if (!['won', 'pending', 'lost'].includes(tip.won))
    errors.push('won must be "won", "pending", or "lost"');
  if (!['finish', 'pending', 'live'].includes(tip.status))
    errors.push('status must be "finish", "pending", or "live"');
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
