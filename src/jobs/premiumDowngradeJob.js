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
        //`[CRON] Finished: ${result.downgraded} customer(s) downgraded to free tier`
        `[CRON] Scanned ${result.scanned}, downgraded ${result.downgraded} expired subscription(s)`
      );
    } catch (err) {
      console.error('[CRON] Premium downgrade job failed:', err);
    }
  });

  console.log(`[CRON] Premium downgrade job scheduled: "${schedule}"`);
}

module.exports = { startPremiumDowngradeJob };
