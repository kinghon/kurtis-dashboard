const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { runScraper } = require('./scraper');

const JSON_FILE = path.join(__dirname, 'data', 'availability.json');

function getLastChecked() {
  try {
    if (!fs.existsSync(JSON_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
    return data.lastChecked ? new Date(data.lastChecked) : null;
  } catch (e) { return null; }
}

function setupCron() {
  // Run every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    console.log('[cron] Running scheduled scrape...');
    try {
      await runScraper();
    } catch (err) {
      console.error('[cron] Scheduled scrape failed:', err.message);
    }
  });
  console.log('[cron] Scheduled scrape every 6 hours.');

  // Run startup scrape if stale or missing
  const lastCheck = getLastChecked();
  let shouldRun = true;
  if (lastCheck) {
    const hoursAgo = (Date.now() - lastCheck.getTime()) / (1000 * 60 * 60);
    if (hoursAgo < 6) {
      console.log(`[cron] Last check was ${hoursAgo.toFixed(1)}h ago — skipping startup scrape.`);
      shouldRun = false;
    }
  }

  if (shouldRun) {
    console.log('[cron] Running startup scrape...');
    runScraper().catch(err => console.error('[cron] Startup scrape failed:', err.message));
  }
}

module.exports = { setupCron };
