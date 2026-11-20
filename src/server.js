require('dotenv').config();
const app = require('./app');
const { startPremiumDowngradeJob } = require('./jobs/premiumDowngradeJob');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);

  // Start scheduled jobs
  startPremiumDowngradeJob();
});
