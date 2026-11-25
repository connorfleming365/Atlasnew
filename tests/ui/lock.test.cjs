// The lock screen on the hosted site: a locked deployment shows only the
// code prompt (nothing behind it is reachable), a wrong code says so, the
// right one reloads into the dashboard, and an unset code explains the fix.
// Served from a fake https origin with the API mocked.
const fs = require('fs');
const path = require('path');
const { chromium } = require('./_browser.cjs');
const fails = [];
const check = (name, ok, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got))); if (!ok) fails.push(name); };
const HTML = fs.readFileSync(path.resolve(__dirname, '..', '..', 'index.html'), 'utf8');
const ORIGIN = 'https://atlas.test';

async function open(browser, { gate = 'code' } = {}){
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const state = { unlocked: false, tries: [] };
  await page.route(ORIGIN + '/**', async route => {
    const u = new URL(route.request().url());
    const json = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/' ) return route.fulfill({ status: 200, contentType: 'text/html', body: HTML });
    if (u.pathname === '/api/status')
      return json(state.unlocked ? { hosted: true, providers: {}, servers: {}, brain: { configured: false },
                                     tts: { configured: false, pinned: null }, sync: { configured: false } }
                                 : { hosted: true, locked: true, gate });
    if (u.pathname === '/api/unlock'){
      const body = JSON.parse(route.request().postData() || '{}'); state.tries.push(body);
      if (body.code === 'open sesame'){ state.unlocked = true; return json({ ok: true }); }
      return route.fulfill({ status: 401, contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'wrong_code', message: "That code isn't right." } }) });
    }
    if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":{"code":"locked"}}' });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(ORIGIN + '/'); await page.waitForTimeout(600);
  return { page, errors, state };
}

(async () => {
  const browser = await chromium.launch();

  let { page, errors, state } = await open(browser);
  check('locked: lock screen shown, code field focused', await page.isVisible('#lock #lock-code')
        && await page.evaluate(() => document.activeElement?.id === 'lock-code'));
  check('locked: everything behind it is inert', await page.evaluate(() =>
        [...document.querySelectorAll('body > :not(#lock)')].every(n => n.inert)));
  check('locked: the dashboard never treated itself as hosted', await page.evaluate(() => ATLAS.hosted === false));
  await page.fill('#lock-code', 'guess'); await page.press('#lock-code', 'Enter'); await page.waitForTimeout(300);
  check('wrong code: message, still locked', /isn't right/.test(await page.innerText('#lock-msg')) && await page.isVisible('#lock'), await page.innerText('#lock-msg'));
  await page.fill('#lock-code', 'open sesame'); await page.press('#lock-code', 'Enter');
  await page.waitForLoadState('load'); await page.waitForTimeout(800);
  check('right code: reloads unlocked into the dashboard', !(await page.$('#lock')) && await page.evaluate(() => ATLAS.hosted === true)
        && await page.isVisible('#wake'), state.tries);
  check('no page errors', !errors.length, errors);
  await page.close();

  ({ page, errors } = await open(browser, { gate: 'unset' }));
  const txt = await page.innerText('#lock');
  check('code not set: explains to add ATLAS_ACCESS_CODE, no input', /ATLAS_ACCESS_CODE/.test(txt) && !(await page.$('#lock-code')), txt);
  await page.setViewportSize({ width: 360, height: 740 }); await page.waitForTimeout(100);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('360px: lock screen fits', over === 0, over);
  await page.close();

  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
