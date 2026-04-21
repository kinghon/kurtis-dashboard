const fs = require('fs');
const path = require('path');

const ROUTES = [
  { from: 'LAX', to: 'HND', flight: 'NH175', suiteProduct: true },
  { from: 'LAX', to: 'NRT', flight: 'NH106', suiteProduct: false },
  { from: 'SFO', to: 'HND', flight: 'NH7', suiteProduct: true },
  { from: 'JFK', to: 'NRT', flight: 'NH9', suiteProduct: true },
];

const DATA_DIR = path.join(__dirname, 'data');
const JSON_FILE = path.join(DATA_DIR, 'availability.json');

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getDatesToCheck() {
  const today = new Date();
  const dates = [];
  // Primary: today + 355 days (peak booking window)
  const primary = new Date(today);
  primary.setDate(primary.getDate() + 355);
  dates.push({ date: formatDate(primary), window: '355day' });
  // Secondary: today + 7 through +14
  for (let i = 7; i <= 14; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push({ date: formatDate(d), window: '14day' });
  }
  return dates;
}

async function checkUnitedAward(page, route, travelDate) {
  // United.com award search: sc=7=first, at=1=award travel
  const url = `https://www.united.com/en/us/fsr/choose-flights?f=${route.from}&t=${route.to}&d=${travelDate}&tt=1&at=1&sc=7&px=1&taxng=1&idx=1`;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Wait for flight results or no-results message
    await Promise.race([
      page.waitForSelector('[class*="FlightCard"], [class*="flight-card"], [data-test*="flight"]', { timeout: 20000 }),
      page.waitForSelector('[class*="no-flight"], [class*="noFlight"], [class*="zero-result"]', { timeout: 20000 }),
      page.waitForTimeout(20000),
    ]).catch(() => {});

    const content = await page.content();

    // Check for ANA flight number in rendered content
    const flightNum = route.flight; // e.g. "NH175"
    const flightNumSpace = route.flight.replace(/([A-Z]+)(\d)/, '$1 $2'); // "NH 175"
    const hasANA = content.includes(flightNum) || content.includes(flightNumSpace) ||
                   content.includes('ANA') || content.includes('All Nippon');

    // Check for first class availability indicators
    const hasFirst = content.includes('First') || content.includes('GlobalFirst') ||
                     /\bF\b/.test(content) || content.includes('Saver');

    // Check for award availability (not sold out)
    const soldOut = content.includes('Sold out') || content.includes('sold out') ||
                    content.includes('Not available');
    const noFlights = content.includes('No flights') || content.includes('no flights available') ||
                      content.includes("couldn't find");

    const available = hasANA && hasFirst && !soldOut && !noFlights;

    // Check for 777 (The Suite aircraft)
    const has777 = content.includes('777') || content.includes('77W');

    return {
      route: `${route.from}-${route.to}`,
      flight_number: route.flight,
      date_of_travel: travelDate,
      cabin_class: (route.suiteProduct && has777) ? 'The Suite' : 'First Class',
      available: available ? 1 : 0,
      suite_product: (route.suiteProduct && has777) ? 1 : 0,
      source: 'united',
      checked_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`[scraper] Error checking ${route.from}-${route.to} on ${travelDate}: ${err.message}`);
    return {
      route: `${route.from}-${route.to}`,
      flight_number: route.flight,
      date_of_travel: travelDate,
      cabin_class: route.suiteProduct ? 'The Suite' : 'First Class',
      available: 0,
      suite_product: 0,
      source: 'error',
      checked_at: new Date().toISOString(),
    };
  }
}

async function runScraper() {
  console.log('[scraper] Starting ANA first class availability check...');
  fs.mkdirSync(DATA_DIR, { recursive: true });

  let chromium;
  try {
    chromium = require('playwright').chromium;
  } catch (e) {
    console.error('[scraper] Playwright not available:', e.message);
    return [];
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();
  const dates = getDatesToCheck();
  const results = [];

  for (const route of ROUTES) {
    for (const { date } of dates) {
      console.log(`[scraper] Checking ${route.from}-${route.to} on ${date}...`);
      const result = await checkUnitedAward(page, route, date);
      results.push(result);
      if (result.available) {
        console.log(`[scraper] *** AVAILABLE: ${result.route} ${result.date_of_travel} ${result.cabin_class} ***`);
      }
      await page.waitForTimeout(2000); // rate limit
    }
  }

  await browser.close();

  // Save to persistent JSON file
  const payload = {
    lastChecked: new Date().toISOString(),
    totalChecked: results.length,
    available: results.filter(r => r.available),
    all: results,
  };
  fs.writeFileSync(JSON_FILE, JSON.stringify(payload, null, 2));
  console.log(`[scraper] Done. Checked ${results.length} combos. Available: ${payload.available.length}`);
  return results;
}

module.exports = { runScraper };

if (require.main === module) {
  runScraper().catch(console.error);
}
