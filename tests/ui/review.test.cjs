// Weekly review: tasks closed, training vs last week, recovery trend, inbox
// load and the week ahead — fetched on demand, shown in a dialog and spoken.
const { chromium, PAGE } = require('./_browser.cjs');
const fails = [];
const check = (name, ok, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got))); if (!ok) fails.push(name); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(new Date(2026, 10, 27, 16, 30));   // Fri 27 Nov 2026, 16:30
  await page.goto(PAGE); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.click('#wake'); await page.waitForTimeout(3500);

  await page.evaluate(() => {
    const d = (day, h = 12) => new Date(2026, 10, day, h, 0);
    const dk = x => `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
    window.__calls = [];
    window.claude = { mcp: {
      invalidate: async () => {},
      callTool: async (server, tool, input) => {
        __calls.push({ tool, input });
        if (tool === 'find-completed-tasks') return { payload: { tasks: [
          { content: 'Ship deck', completedAt: d(23).toISOString() },     // this week (Mon 23)
          { content: 'Pay VAT', completedAt: d(25).toISOString() },
          { content: 'Call bank', completedAt: d(27, 9).toISOString() },
          { content: 'Old thing', completedAt: d(17).toISOString() },     // last week (Tue 17)
          { content: 'Late last week', completedAt: d(21).toISOString() }, // last Sat: after "same point"
        ] } };
        if (tool === 'search_threads') return { payload: { threads: [
          { id: 1, messages: [{ labelIds: ['UNREAD', 'IMPORTANT'] }] },
          { id: 2, messages: [{ labelIds: ['UNREAD'] }] },
          { id: 3, messages: [{ labelIds: [] }] } ] } };
        if (tool === 'list_events') return { payload: { events: [
          { summary: 'Kickoff', start: { dateTime: d(30, 9).toISOString() }, end: { dateTime: d(30, 10).toISOString() } },
          { summary: 'Review', start: { dateTime: d(30, 14).toISOString() }, end: { dateTime: d(30, 15).toISOString() } },
          { summary: '1:1', start: { dateTime: new Date(2026, 11, 2, 11).toISOString() }, end: { dateTime: new Date(2026, 11, 2, 11, 30).toISOString() } },
          { summary: 'Holiday', start: { date: '2026-12-04' }, end: { date: '2026-12-05' } } ] } };
        return { payload: {} };
      } } };
    S.data.todo = { tasks: [{ id: 'o', content: 'Overdue one', dueDate: '2026-11-20' }] };
    const rec = (day, score) => ({ wake_date: dk(d(day)), score_state: 'SCORED', recovery_score: score, hrv_ms: 60, resting_hr: 55 });
    S.data.whoop = {
      recoveries: [rec(27, 80), rec(26, 70), rec(25, 30), rec(24, 60), rec(23, 70), rec(22, 50), rec(21, 50), rec(20, 50), rec(19, 50), rec(18, 50), rec(17, 50), rec(16, 50)],
      cycles: [],
      workouts: [
        { id: 'a', sport: 'running', date: dk(d(24)), start_local: dk(d(24)) + 'T07:00:00', duration_min: 60, zone_min: [] },
        { id: 'b', sport: 'cycling', date: dk(d(26)), start_local: dk(d(26)) + 'T07:00:00', duration_min: 90, zone_min: [] },
        { id: 'c', sport: 'running', date: dk(d(17)), start_local: dk(d(17)) + 'T07:00:00', duration_min: 45, zone_min: [] } ] };
  });

  await page.fill('#say', 'weekly review'); await page.press('#say', 'Enter'); await page.waitForTimeout(800);
  check('"weekly review" opens the dialog', await page.evaluate(() => document.getElementById('review').open));
  const body = await page.$$eval('#wr-body > *', els => els.map(e => [...e.children].map(c => c.innerText).join(' ')).join(' | ').replace(/\s+/g, ' '));
  check('tasks: 3 closed, +2 vs last week, top names, 1 overdue', /TASKS CLOSED 3/.test(body) && /\+2 vs last wk/.test(body)
        && /Ship deck/.test(body) && /1 overdue/.test(body), body);
  check('training: 2 sessions, 2h 30m, vs 45m last week', /TRAINING 2 sessions/.test(body) && /2h 30m/.test(body) && /last week by now: 1 · 45m/.test(body), body);
  check('recovery: avg 62% this week vs 50 last, 3 green-ish counts', /RECOVERY 62% avg/.test(body) && /\+12 vs last wk/.test(body) && /3 green · 1 red/.test(body), body);
  check('recovery trend bars, one per morning', (await page.$$('.wr-trend i')).length === 5);
  check('inbox: 3 threads, 2 unread, 1 important', /INBOX · 7 DAYS 3 threads/.test(body) && /2 unread · 1 important/.test(body), body);
  check('Friday → NEXT WEEK: 3 timed events, 2.5h, busiest Mon', /NEXT WEEK 3 events/.test(body) && /2.5 h booked/.test(body) && /busiest Mon/.test(body) && /First: Kickoff/.test(body), body);
  const ev = (await page.evaluate(() => __calls)).find(c => c.tool === 'list_events');
  check('next week = Mon 30 Nov → Mon 7 Dec', new Date(ev.input.startTime).getDate() === 30 && new Date(ev.input.endTime).getDate() === 7, ev.input);
  const said = await page.evaluate(() => [...document.querySelectorAll('.msg.atlas')].pop().textContent);
  check('spoken summary covers all five', /closed 3 tasks/.test(said) && /2 sessions, 2.5 hours/.test(said) && /averaged 62 percent/.test(said)
        && /3 threads/.test(said) && /Next week: 3 events/.test(said), said);

  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  check('Escape closes it', !(await page.evaluate(() => document.getElementById('review').open)));

  // WEEK button + Friday-afternoon nudge
  await page.click('#weekbtn'); await page.waitForTimeout(500);
  check('WEEK button opens it', await page.evaluate(() => document.getElementById('review').open));
  await page.click('#wr-close');
  await page.evaluate(() => { nudgeSeen.ids = []; checkNudges(); });
  const cards = await page.$$eval('#nudges .nudge', els => els.map(e => e.innerText));
  check('Friday 4pm+ nudge offers the review', cards.some(c => /WEEKLY REVIEW/.test(c) && /OPEN REVIEW/.test(c)), cards);

  await page.click('#nudges .nudge .actchip'); await page.waitForTimeout(400);
  check('nudge button opens the review and clears the card', await page.evaluate(() => document.getElementById('review').open)
        && !(await page.$('#nudges .nudge')));
  await page.click('#wr-close');

  // phone: dialog fits
  await page.setViewportSize({ width: 360, height: 740 });
  await page.click('#weekbtn'); await page.waitForTimeout(500);
  const fit = await page.evaluate(() => { const r = $('#review').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('360px: dialog fits, no sideways scroll', fit && over === 0, { fit, over });

  check('no page errors', !errors.length, errors);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
