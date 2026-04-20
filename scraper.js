const { chromium } = require('playwright');

const ROUTES = [
  { from: 'LAX', to: 'HND', flight: 'NH 175', suiteProduct: true },
  { from: 'LAX', to: 'NRT', flight: 'NH 106', suiteProduct: false },
  { from: 'SFO', to: 'HND', flight: 'NH 7', suiteProduct: true },
  { from: 'JFK', to: 'NRT', flight: 'NH 9', suiteProduct: true },
];

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

async function checkAvailability(page, route, travelDate) {
  const url = `https://www.united.com/en/us/fsr/choose-flights?f=${route.from}&t=${route.to}&d=${travelDate}&tt=1&at=1&sc=7&px=1&taxng=1&idx=1`;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    const pageContent = await page.content();

    // Look for ANA flight numbers (NH prefix) with first class availability
    const flightNum = route.flight.replace(' ', '');
    const hasANAFlight = pageContent.includes(flightNum) || pageContent.includes(route.flight);

    // Check for first/premium class indicators
    const hasFirstClass = /\b[FPO]\b/.test(pageContent) ||
      pageContent.includes('First') ||
      pageContent.includes('Global First');

    // Check for 777-300ER (The Suite aircraft)
    const has777 = pageContent.includes('777-300') || pageContent.includes('77W');

    const available = hasANAFlight && hasFirstClass;
    const isSuite = route.suiteProduct && has777;

    return {
      route: `${route.from}-${route.to}`,
      flight_number: route.flight,
      date_of_travel: travelDate,
      cabin_class: isSuite ? 'The Suite' : 'First Class',
      available: available ? 1 : 0,
      suite_product: isSuite ? 1 : 0,
    };
  } catch (err) {
    console.error(`Error checking ${route.from}-${route.to} on ${travelDate}:`, err.message);
    return {
      route: `${route.from}-${route.to}`,
      flight_number: route.flight,
      date_of_travel: travelDate,
      cabin_class: route.suiteProduct ? 'The Suite' : 'First Class',
      available: 0,
      suite_product: route.suiteProduct ? 1 : 0,
    };
  }
}

async function runScraper(db) {
  console.log('[scraper] Starting availability check...');
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    const dates = getDatesToCheck();
    const results = [];

    const insertStmt = db.prepare(`
      INSERT INTO availability (route, flight_number, date_of_travel, cabin_class, available, suite_product, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    for (const route of ROUTES) {
      for (const { date } of dates) {
        console.log(`[scraper] Checking ${route.from}-${route.to} on ${date}...`);
        const result = await checkAvailability(page, route, date);
        results.push(result);

        insertStmt.run(
          result.route,
          result.flight_number,
          result.date_of_travel,
          result.cabin_class,
          result.available,
          result.suite_product
        );

        // Rate limiting delay
        await page.waitForTimeout(3000);
      }
    }

    console.log(`[scraper] Done. Checked ${results.length} route/date combos.`);
    return results;
  } catch (err) {
    console.error('[scraper] Fatal error:', err.message);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { runScraper };

// Allow direct execution
if (require.main === module) {
  const Database = require('better-sqlite3');
  const path = require('path');
  const dbPath = path.join(__dirname, 'data', 'vendtech.db');
  const fs = require('fs');
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
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
