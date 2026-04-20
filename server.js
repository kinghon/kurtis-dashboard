const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { setupCron } = require('./cron');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'kande2026';

// Ensure data directory exists
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

// Database setup
const db = new Database(path.join(__dirname, 'data', 'vendtech.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS availability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route TEXT NOT NULL,
    flight_number TEXT NOT NULL,
    date_of_travel TEXT NOT NULL,
    cabin_class TEXT NOT NULL,
    available INTEGER NOT NULL DEFAULT 0,
    suite_product INTEGER NOT NULL DEFAULT 0,
    checked_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_availability_route ON availability(route);
`);
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_availability_checked ON availability(checked_at);
`);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// GET /api/availability — all records from last 30 days
app.get('/api/availability', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT * FROM availability
      WHERE checked_at >= datetime('now', '-30 days')
      ORDER BY checked_at DESC
    `).all();
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('Error fetching availability:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/availability/:route — filter by route
app.get('/api/availability/:route', (req, res) => {
  try {
    const route = req.params.route.toUpperCase();
    const rows = db.prepare(`
      SELECT * FROM availability
      WHERE route = ? AND checked_at >= datetime('now', '-30 days')
      ORDER BY checked_at DESC
    `).all(route);
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('Error fetching availability for route:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/check — trigger manual scrape (requires API key)
app.post('/api/check', async (req, res) => {
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) {
    return res.status(401).json({ ok: false, error: 'Invalid API key' });
  }

  try {
    const { runScraper } = require('./scraper');
    res.json({ ok: true, message: 'Scrape started' });
    // Run in background
    runScraper(db).catch(err => {
      console.error('Manual scrape failed:', err.message);
    });
  } catch (err) {
    console.error('Error triggering scrape:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/last-check — when was the last scrape
app.get('/api/last-check', (req, res) => {
  try {
    const row = db.prepare(
      "SELECT checked_at FROM availability ORDER BY checked_at DESC LIMIT 1"
    ).get();
    res.json({ ok: true, last_check: row ? row.checked_at : null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`ANA First Class Tracker running on port ${PORT}`);
  setupCron(db);
});
