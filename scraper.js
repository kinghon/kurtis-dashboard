const fs = require('fs');
const path = require('path');

const ROUTES = [
  { from: 'LAX', to: 'HND', flight: 'NH 175', suiteProduct: true },
  { from: 'LAX', to: 'NRT', flight: 'NH 106', suiteProduct: false },
  { from: 'SFO', to: 'HND', flight: 'NH 7', suiteProduct: true },
  { from: 'JFK', to: 'NRT', flight: 'NH 9', suiteProduct: true },
];

const DATA_DIR = path.join(__dirname, 'data');
const JSON_FILE = path.join(DATA_DIR, 'availability.json');

// ── Date helpers ────────────────────────────────────────────────────

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getDatesToCheck() {
  const today = new Date();
  const dates = [];

  // Primary: today + 355 days
  const primary = new Date(today);
  primary.setDate(primary.getDate() + 355);
  dates.push({ date: formatDate(primary), window: '355day' });

  // Secondary: today + 7 through today + 14
  for (let i = 7; i <= 14; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push({ date: formatDate(d), window: '14day' });
  }

  return dates;
}

// ── seats.aero Partner API ──────────────────────────────────────────

async function fetchSeatsAero(origin, destination, date) {
  const apiKey = process.env.SEATS_AERO_KEY;
  if (!apiKey) return null;

  const url = `https://seats.aero/partnerapi/availability?source=NH&origin=${origin}&destination=${destination}&cabin=first&date=${date}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Partner-Authorization': apiKey,
    },
  });

  if (res.status === 401) {
    console.error('[scraper] seats.aero: invalid API key');
    return null;
  }
  if (res.status === 429) {
    console.warn('[scraper] seats.aero: rate limited, backing off');
    await new Promise(r => setTimeout(r, 5000));
    return null;
  }
  if (!res.ok) {
    const body = await res.text();
    console.warn(`[scraper] seats.aero: ${res.status} — ${body.substring(0, 200)}`);
    return null;
  }

  return res.json();
}

// ── ANA API (api.ana.co.jp) — requires auth, used as secondary source ──

async function fetchANAAPI(origin, destination, date) {
  // ANA has a JSON API at api.ana.co.jp that returns 401 without auth.
  // This is a placeholder for when ANA API credentials are available.
  // Set ANA_API_KEY env var to enable.
  const apiKey = process.env.ANA_API_KEY;
  if (!apiKey) return null;

  const url = `https://api.ana.co.jp/v1/awards/availability?origin=${origin}&destination=${destination}&date=${date}&cabin=F`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  if (!res.ok) return null;
  return res.json();
}

// ── Check a single route+date ───────────────────────────────────────

async function checkAvailability(route, date) {
  // Try seats.aero first, then ANA API
  let available = false;
  let source = 'none';

  // 1. seats.aero
  try {
    const data = await fetchSeatsAero(route.from, route.to, date);
    if (data !== null) {
      source = 'seats.aero';
      // seats.aero returns availability data — check if first class is available
      if (Array.isArray(data)) {
        available = data.some(r =>
          r.available === true ||
          r.seats > 0 ||
          (r.cabin === 'first' && r.status === 'available')
        );
      } else if (data.available !== undefined) {
        available = !!data.available;
      } else if (data.data && Array.isArray(data.data)) {
        available = data.data.some(r => r.available || r.seats > 0);
      }
    }
  } catch (err) {
    console.warn(`[scraper] seats.aero error for ${route.from}-${route.to} ${date}: ${err.message}`);
  }

  // 2. ANA API fallback
  if (source === 'none') {
    try {
      const data = await fetchANAAPI(route.from, route.to, date);
      if (data !== null) {
        source = 'ana-api';
        available = !!data.available;
      }
    } catch (err) {
      console.warn(`[scraper] ANA API error: ${err.message}`);
    }
  }

  if (source === 'none') {
    console.log(`[scraper] No API source available for ${route.from}-${route.to} ${date} — marking unavailable`);
  }

  return {
    route: `${route.from}-${route.to}`,
    flight_number: route.flight,
    date_of_travel: date,
    cabin_class: route.suiteProduct ? 'The Suite' : 'First Class',
    available: available ? 1 : 0,
    suite_product: route.suiteProduct ? 1 : 0,
    checked_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
    source,
  };
}

// ── Main Scraper ────────────────────────────────────────────────────

async function runScraper(db) {
  console.log('[scraper] Starting ANA First Class availability check...');

  const hasSeatsKey = !!process.env.SEATS_AERO_KEY;
  const hasANAKey = !!process.env.ANA_API_KEY;
  console.log(`[scraper] Data sources: seats.aero=${hasSeatsKey ? 'YES' : 'NO'}, ANA API=${hasANAKey ? 'YES' : 'NO'}`);

  if (!hasSeatsKey && !hasANAKey) {
    console.warn('[scraper] ⚠ No API keys configured. Set SEATS_AERO_KEY (from seats.aero) to get real availability data.');
    console.warn('[scraper] Results will show "unavailable" until an API key is provided.');
  }

  const dates = getDatesToCheck();
  const results = [];

  const insertStmt = db.prepare(`
    INSERT INTO availability (route, flight_number, date_of_travel, cabin_class, available, suite_product, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  for (const route of ROUTES) {
    for (const { date } of dates) {
      const result = await checkAvailability(route, date);
      results.push(result);

      insertStmt.run(
        result.route,
        result.flight_number,
        result.date_of_travel,
        result.cabin_class,
        result.available,
        result.suite_product
      );

      const tag = result.available ? 'AVAILABLE' : 'unavailable';
      console.log(`[scraper] ${result.route} ${result.flight_number} ${date}: ${tag} (${result.source})`);

      // Rate limit between checks
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Persist to JSON for Railway ephemeral-DB recovery
  saveResultsJSON(results);

  console.log(`[scraper] Done. ${results.length} route/date combos checked.`);
  return results;
}

// ── JSON Persistence (Railway ephemeral DB fix) ─────────────────────

function saveResultsJSON(results) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(JSON_FILE, JSON.stringify({
      updated_at: new Date().toISOString(),
      results,
    }, null, 2));
    console.log(`[scraper] Saved ${results.length} results to availability.json`);
  } catch (err) {
    console.error(`[scraper] JSON save error: ${err.message}`);
  }
}

function loadResultsJSON() {
  try {
    if (!fs.existsSync(JSON_FILE)) return null;
    return JSON.parse(fs.readFileSync(JSON_FILE, 'utf-8'));
  } catch (err) {
    console.error(`[scraper] JSON load error: ${err.message}`);
    return null;
  }
}

module.exports = { runScraper, loadResultsJSON };

// ── Direct execution ────────────────────────────────────────────────

if (require.main === module) {
  const Database = require('better-sqlite3');
  const dbPath = path.join(DATA_DIR, 'vendtech.db');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(dbPath);
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
  runScraper(db).then(() => {
    db.close();
    process.exit(0);
  });
}
