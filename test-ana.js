const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

async function humanDelay(min=500, max=1500) {
  await new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 }, locale: 'en-US',
  });
  const page = await ctx.newPage();

  try {
    await page.goto('https://cam.ana.co.jp/psz/tokutencal/form_e.jsp?CONNECTION_KIND=LAX&LANG=en', { waitUntil: 'domcontentloaded', timeout: 20000 });
    
    // Simulate human browsing: move mouse around, scroll
    await humanDelay(1000, 2000);
    await page.mouse.move(400, 300, { steps: 20 });
    await humanDelay(300, 700);
    await page.mouse.move(600, 200, { steps: 15 });
    await humanDelay(500, 1000);
    await page.evaluate(() => window.scrollBy(0, 100));
    await humanDelay(500, 1000);
    await page.evaluate(() => window.scrollBy(0, -50));
    await humanDelay(800, 1500);

    // Click and type member number with human-like delays
    await page.click('#w2cusnum');
    await humanDelay(300, 600);
    await page.type('#w2cusnum', '4144401646', { delay: 80 + Math.random() * 60 });
    await humanDelay(500, 1000);

    await page.click('#w2logpass');
    await humanDelay(300, 500);
    await page.type('#w2logpass', 'Airplane123', { delay: 80 + Math.random() * 60 });
    await humanDelay(800, 1500);

    // Move mouse to button before clicking
    const loginBtn = await page.$('[name="login"]');
    const box = await loginBtn.boundingBox();
    await page.mouse.move(box.x + box.width/2, box.y + box.height/2, { steps: 25 });
    await humanDelay(300, 600);
    await loginBtn.click();

    console.log('Submitted. Waiting...');
    await humanDelay(5000, 6000);

    console.log('Post-login URL:', page.url());
    console.log('Post-login title:', await page.title());
    const text = await page.innerText('body').catch(() => '');
    const isBlocked = text.includes('heavy traffic') || text.includes('server maintenance');
    console.log('Still blocked:', isBlocked);
    console.log('Body (first 600):', text.slice(0, 600));

  } catch(e) {
    console.error('Error:', e.message.split('\n')[0]);
  }

  await browser.close();
})();
