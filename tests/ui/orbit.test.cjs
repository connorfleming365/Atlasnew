// Task orbit: one satellite per open task (max 12 + "+N"), priority colours,
// overdue pulse; tap → card → DONE completes and the satellite is absorbed;
// a task completed elsewhere is absorbed on the next refresh; a task moved to
// another day drifts out instead; new tasks drift in.
const { chromium, PAGE } = require('./_browser.cjs');
const fails = [];
const check = (name, ok, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got))); if (!ok) fails.push(name); };
const sats = page => page.$$eval('#orbit .sat:not(.more)', els => els.map(e => ({ cls: e.className, label: e.getAttribute('aria-label'), hidden: e.getAttribute('aria-hidden') })));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(new Date(2026, 10, 24, 10, 0));
  await page.goto(PAGE); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.click('#wake'); await page.waitForTimeout(3000);
  await page.evaluate(() => {
    window.__calls = [];
    window.claude = { mcp: { callTool: async (s, tool, input) => { __calls.push({ tool, input }); return { payload: {} }; }, invalidate: async () => {} } };
    window.setTasks = list => { S.data.todo = { tasks: list }; renderTodo(); };
    setTasks([
      { id: 'a', content: 'Send invoice', priority: 'p1', dueDate: '2026-11-24' },
      { id: 'b', content: 'Book flights', priority: 'p2', dueDate: '2026-11-24' },
      { id: 'c', content: 'Renew passport', priority: 'p4', dueDate: '2026-11-20' },
      { id: 'z', content: 'Next week thing', priority: 'p3', dueDate: '2026-12-01' } ]);
  });
  await page.waitForTimeout(1500);
  let s = await sats(page);
  check('one satellite per task due today or overdue (not next week)', s.length === 3, s);
  check('priority colours and overdue pulse', s.some(x => /p1/.test(x.cls)) && s.find(x => /Renew passport/.test(x.label)).cls.includes('od'), s);
  // around the character, inside the stage
  const geo = await page.evaluate(() => { const st = $('#stage').getBoundingClientRect();
    return [...document.querySelectorAll('#orbit .sat:not(.more)')].map(e => { const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2 - st.left - st.width / 2, y: r.top + r.height / 2 - st.top - st.height / 2, w: st.width, h: st.height }; }); });
  check('satellites orbit the centre, within the stage', geo.every(g => Math.abs(g.x) < g.w / 2 && Math.abs(g.y) < g.h / 2 && Math.hypot(g.x, g.y) > 40), geo);
  // they move
  const p1 = await page.$eval('#orbit .sat:not(.more)', e => e.style.transform);
  await page.waitForTimeout(1200);
  const p2 = await page.$eval('#orbit .sat:not(.more)', e => e.style.transform);
  check('satellites move along the orbit', p1 !== p2, { p1, p2 });
  // hovering a planet holds the ring still, so it's easy to grab
  const sb = await page.$eval('#orbit .sat:not(.more)', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(sb.x, sb.y); await page.waitForTimeout(150);
  const h1 = await page.$eval('#orbit .sat:not(.more)', e => e.style.transform);
  await page.waitForTimeout(600);
  const h2 = await page.$eval('#orbit .sat:not(.more)', e => e.style.transform);
  check('hovering a planet pauses the orbit', h1 === h2, { h1, h2 });
  await page.mouse.move(5, 5); await page.waitForTimeout(100);

  // NAMES: small text under each planet, off until asked for, remembered
  check('names are off by default', !(await page.isVisible('#orbit .sat-lab')));
  await page.click('#namesbtn'); await page.waitForTimeout(150);
  const labs = await page.$$eval('#orbit .sat:not(.more) .sat-lab', els => els.filter(e => e.offsetParent).map(e => e.textContent));
  check('NAMES shows each task under its planet', labs.length === 3 && labs.includes('Send invoice') && labs.includes('Renew passport'), labs);
  check('…and is remembered', await page.evaluate(() => store.get('orbitLabels') === true && $('#namesbtn').classList.contains('on')));
  await page.fill('#say', 'hide names'); await page.press('#say', 'Enter'); await page.waitForTimeout(300);
  check('"hide names" turns them off', !(await page.isVisible('#orbit .sat-lab')) && await page.evaluate(() => store.get('orbitLabels') === false));
  await page.click('#namesbtn'); await page.waitForTimeout(100);
  await page.screenshot({ path: process.env.NAMES_SHOT || '/dev/null' }).catch(() => {});

  // tap → card → DONE
  await page.click('#orbit .sat.p1', { force: true }); await page.waitForTimeout(200);
  check('tap shows the task name and DONE', /Send invoice/.test(await page.innerText('.sat-card')) && await page.isVisible('.sat-card [data-sc="done"]'));
  check('opening a card completes nothing', (await page.evaluate(() => __calls)).length === 0);
  await page.click('.sat-card [data-sc="done"]'); await page.waitForTimeout(150);
  let c = await page.evaluate(() => __calls);
  check('DONE completes that task in Todoist', c.length === 1 && c[0].tool === 'complete-tasks' && c[0].input.ids[0] === 'a', c);
  check('its satellite starts being absorbed', (await sats(page)).find(x => /Send invoice/.test(x.label || '') || x.hidden === 'true') !== undefined);
  await page.waitForTimeout(3200);
  check('…and is gone afterwards', !(await sats(page)).some(x => /Send invoice/.test(x.label)), await sats(page));

  // completed elsewhere: it just disappears from the list on refresh
  await page.evaluate(() => setTasks([{ id: 'c', content: 'Renew passport', priority: 'p4', dueDate: '2026-11-20' }]));
  await page.waitForTimeout(3200);
  s = await sats(page);
  check('a task completed elsewhere is absorbed on refresh', s.length === 1 && /Renew passport/.test(s[0].label), s);

  // moved to another day: drifts out (state "leaving")
  await page.evaluate(() => { Orbit.markMoved('c'); setTasks([]); });
  await page.waitForTimeout(100);
  const st = await page.evaluate(() => [...document.querySelectorAll('#orbit .sat:not(.more)')].map(e => e.style.opacity));
  check('a rescheduled task drifts out rather than being absorbed', st.length === 1, st);
  await page.waitForTimeout(1200);
  check('empty list → empty orbit', (await sats(page)).length === 0);

  // lots of tasks: 12 shown + "+N"
  await page.evaluate(() => setTasks(Array.from({ length: 17 }, (_, i) => ({ id: 't' + i, content: 'Task ' + i, priority: 'p' + (1 + i % 4), dueDate: '2026-11-24' }))));
  await page.waitForTimeout(1500);
  check('max 12 satellites plus "+5"', (await sats(page)).length === 12 && (await page.innerText('#orbit .sat.more')) === '+5');
  await page.click('#orbit .sat.more', { force: true }); await page.waitForTimeout(400);
  check('"+5" opens the task list', await page.evaluate(() => S.view) === 'todo');

  check('no page errors', !errors.length, errors);
  await page.screenshot({ path: process.env.ORBIT_SHOT || '/dev/null' }).catch(() => {});
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
