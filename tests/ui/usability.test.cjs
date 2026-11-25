// Usability pass: on a phone the talk bar is always on screen, the header is
// one row and the Day Line shows the whole day; returning to the tab fetches
// fresh data; the greeting names what isn't linked and a dead gauge leads to
// Accounts; plain dock names; the speech warning can be dismissed for good;
// weekly review lives in the rail; no text under 11px.
const { chromium, PAGE } = require('./_browser.cjs');
const fails = [];
const check = (name, ok, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got))); if (!ok) fails.push(name); };

async function open(browser, viewport){
  const page = await browser.newPage({ viewport });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(new Date(2026, 10, 24, 10, 20));
  await page.goto(PAGE); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.click('#wake'); await page.waitForTimeout(2500);
  await page.evaluate(() => {
    window.claude = { mcp: { callTool: async () => ({ payload: {} }), invalidate: async () => {} } };
    const t = (h, m) => new Date(2026, 10, 24, h, m).toISOString();
    S.data.cal = { events: [{ id: 'a', summary: 'Standup', start: { dateTime: t(9, 0) }, end: { dateTime: t(9, 30) } },
                            { id: 'b', summary: 'Gym', start: { dateTime: t(20, 0) }, end: { dateTime: t(21, 0) } }] };
    for (const k of ['cal', 'gmail', 'todo', 'strava']) setMeta(k, { status: 'ok' });
    renderDeck();
  });
  await page.waitForTimeout(300);
  return { page, errors };
}

(async () => {
  const browser = await chromium.launch();

  // ---- phone ----
  let { page, errors } = await open(browser, { width: 390, height: 844 });
  const ph = await page.evaluate(() => {
    const say = $('#say').getBoundingClientRect(), sc = document.querySelector('.dl-scroll'), tr = $('#dl-track').getBoundingClientRect();
    const hrs = [...document.querySelectorAll('.dl-hr')].map(h => ({ t: h.textContent, r: h.getBoundingClientRect() }));
    return { sayBottom: say.bottom, vh: innerHeight, top: $('#topbar').getBoundingClientRect().height,
             dlScrolls: sc.scrollWidth > sc.clientWidth + 1, first: hrs[0]?.t, last: hrs.at(-1)?.t,
             hoursInside: hrs.every(h => h.r.left >= tr.left - 12 && h.r.right <= tr.right + 12), hscroll: document.documentElement.scrollWidth > innerWidth };
  });
  check('phone: the talk bar is on screen without scrolling', ph.sayBottom <= ph.vh, ph);
  check('phone: header is one row', ph.top < 70, ph.top);
  check('phone: the Day Line shows the whole day, no sideways scrolling', !ph.dlScrolls && ph.first === '08' && Number(ph.last) >= 21 && ph.hoursInside, ph);
  check('phone: no sideways page scroll', !ph.hscroll);
  await page.mouse.wheel(0, 400); await page.waitForTimeout(200);
  check('phone: the talk bar stays on screen after scrolling', await page.evaluate(() => $('#say').getBoundingClientRect().bottom <= innerHeight));
  check('phone: one account light says LINKED', await page.isVisible('#pill-sum') && (await page.innerText('#pill-sum')).trim() === 'LINKED' && !(await page.isVisible('#pill-cal')));
  await page.evaluate(() => setMeta('gmail', { status: 'err', code: 'needs_reauth' }));
  check('phone: …or names the one that dropped', (await page.innerText('#pill-sum')).trim() === 'GMAIL');
  check('no page errors (phone)', !errors.length, errors);
  await page.close();

  // ---- desktop ----
  ({ page, errors } = await open(browser, { width: 1400, height: 900 }));

  // refresh on return
  const refreshed = await page.evaluate(() => {
    let n = 0; window.startWatches = () => { n++; S.unsubs.push(() => {}); };
    S.unsubs.push(() => {});
    const setHidden = v => Object.defineProperty(document, 'hidden', { value: v, configurable: true });
    setHidden(true); document.dispatchEvent(new Event('visibilitychange'));
    setHidden(false); document.dispatchEvent(new Event('visibilitychange'));
    const quick = n;                                   // back within a minute: nothing extra
    setHidden(true); document.dispatchEvent(new Event('visibilitychange'));
    hiddenAt = Date.now() - 5 * 60000;
    setHidden(false); document.dispatchEvent(new Event('visibilitychange'));
    return { quick, after: n };
  });
  check('coming back after a while fetches fresh data at once', refreshed.quick === 0 && refreshed.after === 1, refreshed);

  // honest greeting
  const lines = await page.evaluate(() => {
    for (const k of ['cal', 'gmail', 'todo', 'strava']) S.meta[k].status = 'ok';
    const ok = linkLine();
    S.meta.gmail.status = 'err'; S.meta.gmail.code = 'needs_reauth';
    const one = linkLine();
    S.meta.strava.status = 'err';
    return { ok, one, two: linkLine() };
  });
  check('greeting: all linked → no warning', lines.ok === '', lines);
  check("greeting: names what isn't linked", /^Gmail isn't linked/.test(lines.one) && /Strava aren't linked|Gmail and Strava aren't/.test(lines.two), lines);

  // a gauge with nothing to show because the account dropped → Accounts
  await page.evaluate(() => { ATLAS.hosted = true; S.data.gmail = null; setMeta('gmail', { status: 'err', code: 'needs_reauth' }); renderDeck(); });
  check('the gauge says how to fix it', /tap to fix/.test(await page.innerText('#gs-gmail')), await page.innerText('#gs-gmail'));
  await page.click('.gauge[data-view="gmail"]'); await page.waitForTimeout(300);
  check('…and tapping it opens Accounts, not an empty view', await page.evaluate(() => $('#accounts').open && S.view === 'deck'));
  await page.evaluate(() => $('#accounts').close());
  await page.evaluate(() => { S.data.cal = null; setMeta('cal', { status: 'err', code: 'needs_reauth' }); renderDeck(); });
  check('Day Line offers RECONNECT CALENDAR', await page.isVisible('.dl-fix'));
  await page.evaluate(() => { ATLAS.hosted = false; });

  // plain dock names, "alerts" by voice
  const dock = await page.innerText('#dock');
  check('dock uses plain names', /READ ALOUD/.test(dock) && /HANDS-FREE/.test(dock) && /ALERTS/.test(dock) && /MEMORY/.test(dock) && !/\bFLOW\b|\bNUDGES\b/.test(dock), dock);
  await page.fill('#say', 'turn off alerts'); await page.press('#say', 'Enter'); await page.waitForTimeout(300);
  check('"turn off alerts" switches them off', await page.evaluate(() => !S.nudgesOn));

  // the speech warning can be dismissed for good
  await page.evaluate(() => { ttsReported = false; ttsFailed('test'); });
  check('speech warning shows with a dismiss button', await page.isVisible('#micnote .mn-x'));
  await page.click('#micnote .mn-x');
  check('dismissed: hidden and remembered', !(await page.isVisible('#micnote')) && await page.evaluate(() => store.get('ttsNoteDismissed')));
  await page.evaluate(() => { ttsReported = false; ttsFailed('again'); });
  check('…and not shown again', !(await page.isVisible('#micnote')));

  // weekly review from the rail; bigger targets; readable text
  check('weekly review button lives in the rail', await page.evaluate(() => !!document.querySelector('#rail #weekbtn') && !document.querySelector('#topbar #weekbtn')));
  const small = await page.evaluate(() => [...document.querySelectorAll('#modes button, .actchip, #micnote button')]
    .filter(e => e.offsetParent).map(e => ({ t: e.textContent.trim(), h: e.getBoundingClientRect().height })).filter(x => x.h < 30));
  check('small buttons are at least 30px tall', !small.length, small);
  const tiny = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.offsetParent && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
    && parseFloat(getComputedStyle(e).fontSize) < 10.5).map(e => e.className || e.id).slice(0, 10));
  check('no visible text under 10.5px', !tiny.length, tiny);
  check('no page errors (desktop)', !errors.length, errors);

  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
