// Accounts panel (hosted): opens from the top-bar pills or "accounts"; shows
// each provider's state here and on the phone; reconnect is a link to the
// OAuth start; disconnect needs a second tap.
const { chromium, PAGE } = require('./_browser.cjs');
const fails = [];
const check = (name, ok, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got))); if (!ok) fails.push(name); };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.click('#wake'); await page.waitForTimeout(3000);
  await page.evaluate(() => {
    ATLAS.hosted = true;
    const status = { hosted: true, providers: {
      google: { label: 'Google', servers: ['Gmail', 'Google Calendar'], configured: true, connected: true, phone: true },
      whoop: { label: 'WHOOP', servers: ['WHOOP'], configured: true, connected: true, phone: false },
      strava: { label: 'Strava', servers: ['Strava'], configured: true, connected: false, phone: false },
      todoist: { label: 'Todoist', servers: ['Todoist'], configured: false, connected: false, phone: null } } };
    window.__nav = null;
    const real = window.fetch;
    window.fetch = async (u, o) => String(u) === '/api/status' ? new Response(JSON.stringify(status)) : real(u, o);
  });
  await page.click('#pills'); await page.waitForTimeout(300);
  check('clicking the pills opens Accounts', await page.evaluate(() => $('#accounts').open));
  const rows = await page.$$eval('#ac-body .ac-row', els => els.map(e => e.innerText.replace(/\s+/g, ' ')));
  check('4 providers listed', rows.length === 4, rows);
  check('WHOOP: connected here, NOT linked to the phone, reconnect + disconnect', /WHOOP/.test(rows[1]) && /CONNECTED/.test(rows[1]) && /PHONE: NOT LINKED/.test(rows[1])
        && /RECONNECT/.test(rows[1]) && /DISCONNECT/.test(rows[1]), rows[1]);
  check('Strava not connected → CONNECT, no disconnect', /NOT CONNECTED/.test(rows[2]) && /CONNECT/.test(rows[2]) && !/DISCONNECT/.test(rows[2]), rows[2]);
  check('Todoist not set up → says it needs API keys', /NOT SET UP/.test(rows[3]) && /API keys/.test(rows[3]), rows[3]);
  check('reconnect links to the OAuth start', await page.$eval('#ac-body .ac-row:nth-child(2) a.actchip', a => a.getAttribute('href')) === '/api/auth/start?provider=whoop');
  await page.click('#ac-body [data-dc="whoop"]'); await page.waitForTimeout(150);
  check('first tap on DISCONNECT only asks to confirm', /TAP AGAIN/.test(await page.innerText('#ac-body [data-dc="whoop"]')) && page.url().startsWith('file:'));
  await page.click('#ac-close');
  await page.fill('#say', 'accounts'); await page.press('#say', 'Enter'); await page.waitForTimeout(300);
  check('"accounts" opens it too', await page.evaluate(() => $('#accounts').open));
  // temporary trouble vs needs reconnecting, and the last problem seen
  await page.click('#ac-close');
  await page.evaluate(() => {
    const real = window.fetch;
    const status = { hosted: true, providers: {
      whoop: { label: 'WHOOP', servers: ['WHOOP'], configured: true, connected: true, phone: true,
               trouble: 'whoop token exchange failed (503)', needsReauth: false, lastProblem: { at: Date.now() - 5 * 60000, message: 'x' } },
      todoist: { label: 'Todoist', servers: ['Todoist'], configured: true, connected: false, phone: false,
                 needsReauth: true, lastProblem: { at: Date.now() - 3 * 3600000, message: 'Rejected by Todoist: upstream 401' } } } };
    window.fetch = async (u, o) => String(u) === '/api/status' ? new Response(JSON.stringify(status)) : real(u, o);
  });
  await page.click('#pills'); await page.waitForTimeout(300);
  const rows2 = await page.$$eval('#ac-body .ac-row', els => els.map(e => e.innerText.replace(/\s+/g, ' ')));
  check('temporary trouble: RETRYING (amber), says nothing to do', /RETRYING/.test(rows2[0]) && /nothing to do/.test(rows2[0])
        && await page.$eval('#ac-body .ac-row:nth-child(1) .ac-state i', i => i.className === 'warn'), rows2[0]);
  check('rejected login: NEEDS RECONNECTING with the reason and when', /NEEDS RECONNECTING/.test(rows2[1]) && /3 h ago/.test(rows2[1]) && /upstream 401/.test(rows2[1]), rows2[1]);
  await page.click('#ac-close');
  // a transient error on a live watch: amber and "retrying", never the red reconnect state
  await page.evaluate(() => { setMeta('todo', { status: 'stale', code: 'server_unavailable', trouble: true, detail: 'upstream 503' }); });
  check('transient error: pill amber, summary says RETRYING',
    await page.$eval('#pill-todo', p => p.dataset.s) === 'stale' && await page.innerText('#pill-sum-t') === 'RETRYING',
    [await page.$eval('#pill-todo', p => p.dataset.s), await page.innerText('#pill-sum-t')]);
  await page.evaluate(() => { setMeta('todo', { status: 'err', code: 'needs_reauth', trouble: false }); });
  check('needs reconnecting: pill red and blinking',
    await page.$eval('#pill-todo i', i => getComputedStyle(i).animationName) === 'pillBlink' && await page.$eval('#pill-todo', p => p.dataset.s) === 'err');
  check('no page errors', !errors.length, errors);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
