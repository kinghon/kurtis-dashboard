const express = require('express');
const path = require('path');
const fs = require('fs');
const { setupCron } = require('./cron');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'kande2026';
const JSON_FILE = path.join(__dirname, 'data', 'availability.json');

// Ensure data directory exists
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

// On startup, run scraper immediately if no data exists
if (!fs.existsSync(JSON_FILE) || (() => { try { const d = JSON.parse(fs.readFileSync(JSON_FILE,'utf8')); return !d.lastChecked; } catch(e) { return true; } })()) {
  console.log('[startup] No data found — running scraper immediately');
  const { runScraper } = require('./scraper');
  setTimeout(() => runScraper().catch(err => console.error('[startup scraper error]', err.message)), 2000);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readAvailability() {
  try {
    if (!fs.existsSync(JSON_FILE)) return { lastChecked: null, available: [], all: [] };
    return JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
  } catch (e) {
    return { lastChecked: null, available: [], all: [] };
  }
}

// GET /api/availability — all records
app.get('/api/availability', (req, res) => {
  const data = readAvailability();
  res.json({ ok: true, data: data.all || [] });
});

// GET /api/availability/:route — filter by route
app.get('/api/availability/:route', (req, res) => {
  const route = req.params.route.toUpperCase();
  const data = readAvailability();
  const rows = (data.all || []).filter(r => r.route === route);
  res.json({ ok: true, data: rows });
});

// POST /api/check — trigger manual scrape
app.post('/api/check', async (req, res) => {
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) {
    return res.status(401).json({ ok: false, error: 'Invalid API key' });
  }
  res.json({ ok: true, message: 'Scrape started' });
  const { runScraper } = require('./scraper');
  runScraper().catch(err => console.error('Manual scrape failed:', err.message));
});

// GET /api/last-check — when was the last scrape
app.get('/api/last-check', (req, res) => {
  const data = readAvailability();
  res.json({ ok: true, last_check: data.lastChecked || null });
});

// Start server
app.listen(PORT, () => {
  console.log(`ANA First Class Tracker running on port ${PORT}`);
  setupCron();
});
