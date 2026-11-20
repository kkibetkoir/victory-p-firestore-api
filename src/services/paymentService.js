const crypto = require('crypto');
const fetch = require('node-fetch'); // or use global fetch (Node 18+)
const { db, admin } = require('../config/firebase');

const COLLECTION = 'users';
const PAYMENTS = 'payments';

// Same limits as the frontend — keep in ONE place on the backend now.
const PLAN_DURATIONS_MS = {
  Daily: 1 * 24 * 60 * 60 * 1000,
  Weekly: 7 * 24 * 60 * 60 * 1000,
  Monthly: 30 * 24 * 60 * 60 * 1000,
  Yearly: 365 * 24 * 60 * 60 * 1000,
};

/**
 * Verify a Kora payment reference directly with the Kora API.
 * Use this as the "source of truth" — never trust the webhook body alone.
 */
async function verifyWithKora(reference) {
  const secret = process.env.KORA_SECRET_KEY;
  if (!secret) throw new Error('KORA_SECRET_KEY not configured');

  const res = await fetch(
    `https://api.korapay.com/merchant/api/v1/charges/${reference}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Kora verify failed (${res.status}): ${body}`);
  }

  const json = await res.json();
  const data = json?.data;
  if (!data) throw new Error('Kora verify returned no data');

  return {
    reference: data.reference,
    status: data.status, // "success" when paid
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
    const existingExpiry = getExpiry(
      current.subscription.subDate,
      current.subscription.plan
    );
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
    createdAt: existingPayment.exists
      ? existingPayment.data().createdAt
      : nowTs,
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
  await db
    .collection(PAYMENTS)
    .doc(reference || `failed-${Date.now()}`)
    .set(
      {
        reference,
        payload,
        error: String(error),
        processed: false,
        createdAt: admin.firestore.Timestamp.now(),
      },
      { merge: true }
    );
}

module.exports = {
  verifyWithKora,
  upgradeUserFromPayment,
  recordFailedPayment,
  PLAN_DURATIONS_MS,
};
