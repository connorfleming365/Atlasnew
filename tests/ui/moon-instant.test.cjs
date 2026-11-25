// Meetings as moons: the next meeting rides further out the longer it is until
// it starts, glows in the last 10 minutes, docks beside the character while it
// runs; tap for details. Instant start: today's saved copy is drawn at once on
// the self-hosted site, never yesterday's, and a locked browser keeps none.
const { chromium, PAGE } = require('./_browser.cjs');
const fails = [];
const check = (name, ok, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got))); if (!ok) fails.push(name); };

async function open(browser, time){
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(time);
  await page.goto(PAGE); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.click('#wake'); await page.waitForTimeout(2500);
  await page.evaluate(() => {
    window.claude = { mcp: { callTool: async () => ({ payload: {} }), invalidate: async () => {} } };
    const t = (h, m) => new Date(2026, 10, 24, h, m).toISOString();
    S.data.cal = { events: [
      { id: 'e1', summary: 'Design review', location: 'Room 4, Floor 2', start: { dateTime: t(11, 30) }, end: { dateTime: t(12, 15) } },
      { id: 'e2', summary: 'Gym', start: { dateTime: t(18, 0) }, end: { dateTime: t(19, 0) } } ] };
    renderDeck();
  });
  await page.waitForTimeout(2500);
  return { page, errors };
}
const moonGeo = page => page.evaluate(() => {
  const m = document.querySelector('#orbit .moon'), st = $('#stage').getBoundingClientRect();
  if (!m || m.hidden) return null;
  const r = m.getBoundingClientRect();
  return { d: Math.hypot(r.left + r.width / 2 - st.left - st.width / 2, r.top + r.height / 2 - st.top - st.height / 2),
           cls: m.className, label: m.getAttribute('aria-label'), R: Math.min(st.width, st.height) * .2 };
});

(async () => {
  const browser = await chromium.launch();

  // 90 minutes before: visible, well out from the character
  let { page, errors } = await open(browser, new Date(2026, 10, 24, 10, 0));
  const far = await moonGeo(page);
  check('the next meeting appears as a moon', far && /Design review/.test(far.label) && /11:30|11.30/.test(far.label), far);
  await page.close();

  // 5 minutes before: closer in, glowing
  ({ page, errors } = await open(browser, new Date(2026, 10, 24, 11, 25)));
  const near = await moonGeo(page);
  check('5 minutes out: closer to the character than at 90 minutes', near && near.d < far.d, { far: far?.d, near: near?.d });
  check('last 10 minutes: the moon glows', near && /soon/.test(near.cls), near);
  await page.click('#orbit .moon', { force: true }); await page.waitForTimeout(200);
  const card = await page.innerText('.sat-card');
  check('tap shows title, time, location and OPEN TODAY', /Design review/.test(card) && /in 5m|in 5 m/.test(card) && /Room 4/.test(card) && /OPEN TODAY/.test(card), card);
  await page.click('.sat-card [data-sc="today"]'); await page.waitForTimeout(400);
  check('OPEN TODAY opens the Today view', await page.evaluate(() => S.view) === 'cal');
  check('no page errors (before)', !errors.length, errors);
  await page.close();

  // during the meeting: docked beside the character
  ({ page, errors } = await open(browser, new Date(2026, 10, 24, 11, 45)));
  const docked = await moonGeo(page);
  check('during the meeting: docked, right by the character', docked && /docked/.test(docked.cls) && docked.d < docked.R * 2.2 && /now/.test(docked.label), docked);
  await page.close();

  // after the last meeting: no moon
  ({ page, errors } = await open(browser, new Date(2026, 10, 24, 19, 30)));
  check('no meetings left today → no moon', (await moonGeo(page)) === null);
  check('no page errors (after)', !errors.length, errors);
  await page.close();

  // ---- instant start ----
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.clock.setFixedTime(new Date(2026, 10, 24, 9, 0));
  await page.goto(PAGE); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.click('#wake'); await page.waitForTimeout(2500);
  const r = await page.evaluate(() => {
    ATLAS.hosted = true;
    // the live fetch never answers in this test - only the saved copy can fill the tile
    window.claude = { mcp: { watchTool: () => () => {}, callTool: async () => ({ payload: {} }), invalidate: async () => {} } };
    store.set('snap.todo', { day: todayKey(), at: Date.now() - 3600e3, payload: { tasks: [{ id: 'x', content: 'Saved task', priority: 'p1', dueDate: todayKey() }] } });
    store.set('snap.gmail', { day: '2026-11-23', at: Date.now() - 86400e3, payload: { threads: [{ id: 't', messages: [{ subject: 'Yesterday', labelIds: ['UNREAD'] }] }] } });
    S.data.todo = null; S.data.gmail = null;
    watchSection('todo', 'find-tasks-by-date', {}, renderTodo);
    watchSection('gmail', 'search_threads', {}, renderGmail);
    return { todo: S.data.todo?.tasks?.[0]?.content, gmail: S.data.gmail, meta: S.meta.todo?.detail };
  });
  check("today's saved copy is drawn straight away", r.todo === 'Saved task' && /Saved task/.test(await page.innerText('#p-todo .body')), r);
  check("yesterday's copy is never used", r.gmail === null, r.gmail);
  check('it is marked as a saved copy (stale)', r.meta === 'saved copy', r.meta);
  // live data replaces and refreshes the saved copy
  const saved = await page.evaluate(() => {
    window.claude.mcp.watchTool = (s, t, i, cb) => { cb({ type: 'data', result: { payload: { tasks: [{ id: 'y', content: 'Live task', dueDate: todayKey() }] } } }); return () => {}; };
    S.data.todo = { tasks: [] };
    watchSection('todo', 'find-tasks-by-date', {}, renderTodo);
    return store.get('snap.todo', null)?.payload?.tasks?.[0]?.content;
  });
  check('live data replaces it and becomes the new saved copy', saved === 'Live task', saved);
  // a locked browser keeps nothing
  await page.evaluate(() => showLock('code'));
  check('the lock screen wipes saved copies', await page.evaluate(() => SNAP_KEYS.every(k => localStorage.getItem('atlas.snap.' + k) === null)));
  check('no page errors (instant start)', !errs.length, errs);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
