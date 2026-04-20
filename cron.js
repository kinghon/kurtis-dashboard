const cron = require('node-cron');
const { runScraper, loadResultsJSON } = require('./scraper');

function restoreFromJSON(db) {
  const count = db.prepare('SELECT COUNT(*) as n FROM availability').get().n;
  if (count > 0) {
    console.log(`[cron] DB has ${count} rows — skipping JSON restore.`);
    return;
  }

  console.log('[cron] DB is empty — restoring from availability.json...');
  const data = loadResultsJSON();
  if (!data || !data.results || data.results.length === 0) {
    console.log('[cron] No JSON cache found — will populate from fresh scrape.');
    return;
  }

  const stmt = db.prepare(`
    INSERT INTO availability (route, flight_number, date_of_travel, cabin_class, available, suite_product, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((rows) => {
    for (const r of rows) {
      stmt.run(r.route, r.flight_number, r.date_of_travel, r.cabin_class, r.available, r.suite_product, r.checked_at);
    }
  });

  tx(data.results);
  console.log(`[cron] Restored ${data.results.length} rows from JSON (updated ${data.updated_at}).`);
}

function setupCron(db) {
  // Restore cached data into empty DB (Railway ephemeral filesystem fix)
  restoreFromJSON(db);

  // Run every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    console.log('[cron] Running scheduled scrape...');
    try {
      await runScraper(db);
    } catch (err) {
      console.error('[cron] Scheduled scrape failed:', err.message);
    }
  });
  console.log('[cron] Scheduled scrape every 6 hours.');

  // Run startup scrape if stale or empty
  const row = db.prepare(
    'SELECT checked_at FROM availability ORDER BY checked_at DESC LIMIT 1'
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
