const fs = require('fs');
const path = require('path');
const https = require('https');

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || 'fc-8bd23f79078d4911b435bb9a41b0ab78';
const ANA_MEMBER = process.env.ANA_MEMBER_NUMBER || '4144401646';
const ANA_PASSWORD = process.env.ANA_PASSWORD || 'Airplane123';

const DATA_DIR = path.join(__dirname, 'data');
const JSON_FILE = path.join(DATA_DIR, 'availability.json');

// Routes to check (for labeling results)
const ROUTES = [
  { from: 'LAX', to: 'HND', flight: 'NH175', suiteProduct: true },
  { from: 'LAX', to: 'NRT', flight: 'NH106', suiteProduct: false },
  { from: 'SFO', to: 'HND', flight: 'NH7', suiteProduct: true },
  { from: 'JFK', to: 'NRT', flight: 'NH9', suiteProduct: true },
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
  // Primary: 355 days out
  const primary = new Date(today);
  primary.setDate(primary.getDate() + 355);
  dates.push({ date: formatDate(primary), window: '355day' });
  // Secondary: next 7-14 days
  for (let i = 7; i <= 14; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push({ date: formatDate(d), window: '14day' });
  }
  return dates;
}

function firecrawlRequest(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: 'api.firecrawl.dev',
      path: '/v1/scrape',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message} — raw: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Firecrawl request timed out')); });
    req.write(body);
    req.end();
  });
}

function parseAvailability(markdown, checkDate) {
  if (!markdown) return false;
  const lower = markdown.toLowerCase();
  // ANA calendar uses these terms for available dates
  if (lower.includes('wide open') || lower.includes('open')) {
    // Check if the date appears near an availability indicator
    const dateStr = checkDate; // e.g. "2027-04-11"
    const parts = dateStr.split('-');
    const day = String(parseInt(parts[2])); // "11"
    const lines = markdown.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if ((line.includes('wide open') || line.includes('Open')) && !line.includes('Not available') && !line.includes('no data')) {
        // Look for the date nearby in surrounding lines
        const context = lines.slice(Math.max(0, i-3), i+3).join(' ');
        if (context.includes(day)) return true;
      }
    }
    // Fallback: if ANY availability found in the calendar, mark as available
    if (lower.includes('wide open')) return true;
  }
  return false;
}

async function runScraper() {
  console.log('[scraper] Starting ANA First Class availability check via Firecrawl...');
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const dates = getDatesToCheck();
  const results = [];

  try {
    // Single Firecrawl request: login + select Zone 6 (North America) + First class + submit
    console.log('[scraper] Logging into ANA and fetching award calendar...');
    const response = await firecrawlRequest({
      url: 'https://cam.ana.co.jp/psz/tokutencal/form_e.jsp?CONNECTION_KIND=LAX&LANG=en',
      formats: ['markdown'],
      timeout: 90000,
      actions: [
        { type: 'wait', milliseconds: 4000 },
        { type: 'click', selector: '#w2cusnum' },
        { type: 'write', text: ANA_MEMBER },
        { type: 'click', selector: '#w2logpass' },
        { type: 'write', text: ANA_PASSWORD },
        { type: 'click', selector: 'input[name=login]' },
        { type: 'wait', milliseconds: 8000 },
        { type: 'executeJavascript', script: 'var s=document.querySelector("select#zoneSelect");if(s){s.value="6";s.dispatchEvent(new Event("change",{bubbles:true}));}' },
        { type: 'wait', milliseconds: 1500 },
        { type: 'executeJavascript', script: 'var links=document.querySelectorAll("a");for(var l of links){if(l.textContent&&l.textContent.trim()==="First"){l.click();break;}}' },
        { type: 'wait', milliseconds: 1500 },
        { type: 'executeJavascript', script: 'var btn=document.querySelector("input[type=submit],button[type=submit]");if(btn)btn.click();' },
        { type: 'wait', milliseconds: 10000 },
      ],
    });

    const markdown = response.data && response.data.markdown ? response.data.markdown : '';
    const isBlocked = markdown.toLowerCase().includes('heavy traffic') || markdown.toLowerCase().includes('server maintenance');

    if (!response.success || isBlocked) {
      console.error('[scraper] ANA login/calendar blocked or failed:', response.error || 'rate limited');
      // Save error state so we know it ran (avoids repeat alerts)
      const payload = {
        lastChecked: new Date().toISOString(),
        totalChecked: 0,
        available: [],
        all: [],
        error: isBlocked ? 'ANA rate limited' : (response.error || 'unknown'),
      };
      fs.writeFileSync(JSON_FILE, JSON.stringify(payload, null, 2));
      return [];
    }

    console.log('[scraper] Calendar fetched, parsing availability...');
    const hasData = markdown.includes('ANA International Award Calendar') || markdown.includes('Wide open') || markdown.includes('Open') || markdown.includes('Not available');

    if (!hasData) {
      console.log('[scraper] Warning: calendar page loaded but no availability data found');
    }

    const now = new Date().toISOString();

    // For each route and date, determine availability from the calendar
    for (const route of ROUTES) {
      for (const { date, window } of dates) {
        const available = parseAvailability(markdown, date) ? 1 : 0;
        if (available) {
          console.log(`[scraper] *** AVAILABLE: ${route.from}-${route.to} ${date} First Class ***`);
        }
        results.push({
          route: `${route.from}-${route.to}`,
          flight_number: route.flight,
          date_of_travel: date,
          cabin_class: route.suiteProduct ? 'The Suite / First' : 'First Class',
          available,
          suite_product: route.suiteProduct ? 1 : 0,
          source: 'ana-calendar',
          checked_at: now,
          window,
        });
      }
    }

    const payload = {
      lastChecked: now,
      totalChecked: results.length,
      available: results.filter(r => r.available),
      all: results,
      calendarMarkdown: markdown.slice(0, 5000), // Store snippet for debugging
    };
    fs.writeFileSync(JSON_FILE, JSON.stringify(payload, null, 2));
    console.log(`[scraper] Done. Checked ${results.length} combos. Available: ${payload.available.length}`);
    return results;

  } catch (err) {
    console.error('[scraper] Fatal error:', err.message);
    // Still write a timestamp so watchdog knows it ran
    const payload = {
      lastChecked: new Date().toISOString(),
      totalChecked: 0,
      available: [],
      all: [],
      error: err.message,
    };
    fs.writeFileSync(JSON_FILE, JSON.stringify(payload, null, 2));
    return [];
  }
}

module.exports = { runScraper };

if (require.main === module) {
  runScraper().catch(console.error);
}
