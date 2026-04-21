const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-blink-features=AutomationControlled']
  });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });
  const page = await ctx.newPage();

  const apiCalls = [];
  page.on('request', req => {
    const url = req.url();
    const method = req.method();
    if ((url.includes('api') || url.includes('search') || url.includes('flight') || url.includes('award')) 
        && !url.includes('tiqcdn') && !url.includes('analytics') && !url.includes('akamai')
        && !url.includes('.js') && !url.includes('.css') && !url.includes('.png')) {
      apiCalls.push({ method, url, headers: req.headers(), postData: req.postData() });
    }
  });

  try {
    await page.goto('https://www.united.com/en/us/fsr/choose-flights?f=LAX&t=HND&d=2026-04-28&tt=1&at=1&sc=7&px=1&taxng=1&idx=1', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000);
  } catch(e) {
    console.log('Page load note:', e.message.split('\n')[0]);
  }

  console.log(`\nCaptured ${apiCalls.length} API calls:`);
  for (const c of apiCalls.slice(0, 20)) {
    console.log(`\n${c.method} ${c.url}`);
    if (c.postData) console.log('Body:', c.postData.slice(0, 200));
  }

  await browser.close();
})();
