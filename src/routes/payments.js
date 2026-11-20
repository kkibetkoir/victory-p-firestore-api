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
    if (!reference)
      return res.status(400).json({ error: 'reference required' });

    const verified = await paymentService.verifyWithKora(reference);
    const result = await paymentService.upgradeUserFromPayment(verified);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
