const cron = require('node-cron');
const { runScraper } = require('./scraper');

function setupCron(db) {
  // Run every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    console.log('[cron] Running scheduled scrape...');
    try {
      await runScraper(db);
    } catch (err) {
      console.error('[cron] Scheduled scrape failed:', err.message);
    }
  });

  console.log('[cron] Scheduled scrape every 6 hours');

  // Run on startup if last check was > 23 hours ago
  const row = db.prepare(
    "SELECT checked_at FROM availability ORDER BY checked_at DESC LIMIT 1"
  ).get();

  let shouldRun = true;
  if (row) {
    const lastCheck = new Date(row.checked_at + 'Z');
    const hoursAgo = (Date.now() - lastCheck.getTime()) / (1000 * 60 * 60);
    if (hoursAgo < 6) {
      console.log(`[cron] Last check was ${hoursAgo.toFixed(1)}h ago — skipping startup scrape.`);
      shouldRun = false;
    }
  }

  if (shouldRun) {
    console.log('[cron] Running startup scrape...');
    runScraper(db).catch(err => {
      console.error('[cron] Startup scrape failed:', err.message);
    });
  }
}

module.exports = { setupCron };
