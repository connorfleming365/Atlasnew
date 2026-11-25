// Proactive nudges: meeting soon, important email, deadlines, red day with a
// hard session. Each once, as a card + spoken line; system notification when
// the tab is hidden; nothing when NUDGES is off.
const { chromium, PAGE } = require('./_browser.cjs');
const fails = [];
const check = (name, ok, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got))); if (!ok) fails.push(name); };

const cards = page => page.$$eval('#nudges .nudge', els => els.map(e => e.innerText.replace(/\s+/g, ' ')));
const said = page => page.evaluate(() => [...document.querySelectorAll('.msg.atlas')].pop()?.textContent || '');

async function fresh(browser, time){
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(time);
  await page.goto(PAGE); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.click('#wake'); await page.waitForTimeout(3500);
  await page.evaluate(() => {
    window.__calls = []; window.__notes = [];
    window.claude = { mcp: {
      callTool: async (server, tool, input) => { __calls.push({ tool, input }); return { payload: { id: 'x' } }; },
      invalidate: async () => {} } };
    window.Notification = function(title, opts){ __notes.push({ title, body: opts.body }); };
    window.Notification.permission = 'granted';
    S.data.cal = { events: [] }; S.data.gmail = { threads: [] }; S.data.todo = { tasks: [] };
    document.querySelectorAll('#nudges .nudge').forEach(n => n.remove());
  });
  return { page, errors };
}
const at = (h, m) => new Date(2026, 10, 24, h, m);

(async () => {
  const browser = await chromium.launch();

  // ---- meeting, mail, timed task (09:50) ----
  let { page, errors } = await fresh(browser, at(9, 50));
  await page.evaluate(() => {
    const t = (h, m) => new Date(2026, 10, 24, h, m).toISOString();
    S.data.cal = { events: [
      { id: 'a', summary: 'Standup', location: 'Room 4, Floor 2', start: { dateTime: t(9, 58) }, end: { dateTime: t(10, 15) } },
      { id: 'b', summary: 'Lunch', start: { dateTime: t(12, 0) }, end: { dateTime: t(13, 0) } } ] };
    const msg = (id, from, subject, mins, labels) => ({ id, messages: [{ sender: from, subject, snippet: '',
      labelIds: labels, date: new Date(Date.now() - mins * 60000).toUTCString() }] });
    S.data.gmail = { threads: [
      msg('m1', 'Sam Lee <sam@x.com>', 'Contract signed', 2, ['UNREAD', 'IMPORTANT', 'INBOX']),
      msg('m2', 'Old Boss <b@x.com>', 'Yesterday thing', 300, ['UNREAD', 'IMPORTANT', 'INBOX']),
      msg('m3', 'Newsletter <n@x.com>', 'Weekly digest', 1, ['UNREAD', 'INBOX']) ] };
    S.data.todo = { tasks: [
      { id: 't1', content: 'Send invoice', priority: 'p2', dueDate: '2026-11-24T10:00:00' },
      { id: 't2', content: 'Book flights', priority: 'p1', dueDate: '2026-11-24' } ] };
    checkNudges();
  });
  let c = await cards(page);
  check('meeting in 8 min → card', c.some(x => /MEETING/.test(x) && /Standup in 8 minutes, Room 4/.test(x)), c);
  check('new important email → card', c.some(x => /IMPORTANT EMAIL/.test(x) && /Sam Lee: Contract signed/.test(x)), c);
  check('old important email and newsletter → no card', !c.some(x => /Yesterday thing|Weekly digest/.test(x)), c);
  check('task due in 10 min → card', c.some(x => /DEADLINE/.test(x) && /Send invoice.*10 minutes/.test(x)), c);
  check('P1 reminder waits until 3pm', !c.some(x => /Book flights/.test(x)), c);
  check('at most three cards on screen', c.length === 3, c.length);
  check('nudge is spoken', /Standup in 8 minutes|Important email from Sam Lee|Send invoice/.test(await said(page)), await said(page));
  await page.evaluate(() => { document.querySelectorAll('#nudges .nudge').forEach(n => n.remove()); checkNudges(); });
  check('each nudge only once', (await cards(page)).length === 0, await cards(page));

  // action button
  await page.evaluate(() => { nudgeSeen.ids = nudgeSeen.ids.filter(i => !i.startsWith('ev:')); checkNudges(); });
  await page.click('#nudges .nudge .actchip'); await page.waitForTimeout(300);
  check('OPEN TODAY opens the Today view', await page.evaluate(() => S.view) === 'cal', await page.evaluate(() => S.view));
  check('no page errors (morning)', !errors.length, errors);
  await page.close();

  // ---- 15:30: P1, red day + hard session, yes moves it ----
  ({ page, errors } = await fresh(browser, at(15, 30)));
  await page.evaluate(() => {
    const t = (h, m) => new Date(2026, 10, 24, h, m).toISOString();
    const dk = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    S.data.whoop = { recoveries: [{ wake_date: dk(new Date()), score_state: 'SCORED', recovery_score: 22, hrv_ms: 40, resting_hr: 60 }],
                     cycles: [], workouts: [] };
    S.data.cal = { events: [{ id: 'h', summary: 'Tempo run', start: { dateTime: t(18, 0) }, end: { dateTime: t(19, 0) } }] };
    S.data.todo = { tasks: [{ id: 't2', content: 'Book flights', priority: 'p1', dueDate: '2026-11-24' }] };
    checkNudges();
  });
  c = await cards(page);
  check('3pm: P1 still open → card', c.some(x => /Top priority still open: “Book flights”/.test(x)), c);
  check('red + hard session → recovery card with MOVE', c.some(x => /RECOVERY/.test(x) && /Tempo run/.test(x) && /MOVE TO TOMORROW/.test(x)), c);
  await page.fill('#say', 'yes'); await page.press('#say', 'Enter'); await page.waitForTimeout(500);
  const calls = await page.evaluate(() => __calls);
  check('"yes" after the recovery nudge moves the session', calls.some(k => k.tool === 'update_event' && k.input.eventId === 'h'), calls);
  check('no page errors (afternoon)', !errors.length, errors);
  await page.close();

  // ---- hidden tab → system notification, not speech ----
  ({ page, errors } = await fresh(browser, at(9, 50)));
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    const t = (h, m) => new Date(2026, 10, 24, h, m).toISOString();
    S.data.cal = { events: [{ id: 'a', summary: 'Standup', start: { dateTime: t(9, 55) }, end: { dateTime: t(10, 0) } }] };
    window.__before = document.querySelectorAll('.msg.atlas').length;
    checkNudges();
  });
  const notes = await page.evaluate(() => __notes);
  check('hidden tab → system notification', notes.length === 1 && /Standup in 5 minutes/.test(notes[0].body), notes);
  check('hidden tab → not spoken', await page.evaluate(() => document.querySelectorAll('.msg.atlas').length === __before));
  await page.close();

  // ---- NUDGES off → nothing; typed "nudges on" turns them back on ----
  ({ page, errors } = await fresh(browser, at(9, 50)));
  await page.click('#nudgebtn'); await page.waitForTimeout(200);
  await page.evaluate(() => {
    const t = (h, m) => new Date(2026, 10, 24, h, m).toISOString();
    S.data.cal = { events: [{ id: 'a', summary: 'Standup', start: { dateTime: t(9, 55) }, end: { dateTime: t(10, 0) } }] };
    checkNudges();
  });
  check('NUDGES off → no cards', (await cards(page)).length === 0 && !(await page.$eval('#nudgebtn', b => b.classList.contains('on'))));
  check('off state persists', await page.evaluate(() => localStorage.getItem('atlas.nudges')) === 'false');
  await page.fill('#say', 'turn on nudges'); await page.press('#say', 'Enter'); await page.waitForTimeout(300);
  await page.evaluate(() => checkNudges());
  check('"turn on nudges" → back on and nudging', (await cards(page)).length === 1, await cards(page));
  check('no page errors (toggle)', !errors.length, errors);

  // phone width: cards fit, no sideways scroll
  await page.setViewportSize({ width: 360, height: 740 }); await page.waitForTimeout(150);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('360px: nudge card fits, no sideways scroll', over === 0, over);
  await page.close();

  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
