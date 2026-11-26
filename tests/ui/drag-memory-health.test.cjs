// Drag a task planet onto the character (done) or the Day Line (focus block
// at that time); memory notes saved by the brain or by "remember …"; and
// connection-health nudges for an account that dropped or isn't on the phone.
const { chromium, PAGE } = require('./_browser.cjs');
const fails = [];
const check = (name, ok, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got))); if (!ok) fails.push(name); };
const said = page => page.evaluate(() => [...document.querySelectorAll('.msg.atlas')].pop()?.textContent || '');
const say = async (page, t) => { await page.fill('#say', t); await page.press('#say', 'Enter'); await page.waitForTimeout(450); };

// the ring pauses while the pointer is over a planet - hover first, then grab where it stopped
async function dragTo(page, sel, tx, ty){
  const at = () => page.$eval(sel, e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  let b = await at();
  for (let i = 0; i < 5; i++){ await page.mouse.move(b.x, b.y); await page.waitForTimeout(80); const n = await at(); if (Math.hypot(n.x - b.x, n.y - b.y) < 2) break; b = n; }
  await page.mouse.down();
  for (let i = 1; i <= 12; i++){ await page.mouse.move(b.x + (tx - b.x) * i / 12, b.y + (ty - b.y) * i / 12); await page.waitForTimeout(16); }
  return b;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(new Date(2026, 10, 24, 10, 0));
  await page.goto(PAGE); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.click('#wake'); await page.waitForTimeout(3000);
  await page.evaluate(() => {
    window.__calls = [];
    window.claude = { mcp: { callTool: async (s, tool, input) => { __calls.push({ tool, input }); return { payload: { id: 'ev-new' } }; }, invalidate: async () => {} } };
    S.data.cal = { events: [] }; renderDeck();
    S.data.todo = { tasks: [{ id: 'a', content: 'Write the board report', priority: 'p1', dueDate: '2026-11-24' }] };
    renderTodo();
  });
  await page.waitForTimeout(1500);

  // ---- drag onto the Day Line: a focus block at that time ----
  const track = await page.$eval('#dl-track', e => { const r = e.getBoundingClientRect(); return { l: r.left, w: r.width, y: r.top + 28 }; });
  const scale = await page.evaluate(() => ({ base: +dlScale.base, span: dlScale.span }));
  const at14 = track.l + (new Date(2026, 10, 24, 14, 0) - scale.base) / scale.span * track.w;
  await dragTo(page, '#orbit .sat.p1', at14, track.y);
  check('dragging shows the drop targets and a time ghost', await page.isVisible('.drop-core') && await page.evaluate(() => !document.querySelector('.dl-ghost').hidden)
        && /14:00|02:00/.test(await page.innerText('.dl-ghost')), await page.innerText('.dl-ghost').catch(() => ''));
  await page.mouse.up(); await page.waitForTimeout(300);
  let c = await page.evaluate(() => __calls);
  check('drop on the Day Line → focus block at 14:00, 60 min for deep work', c.length === 1 && c[0].tool === 'create_event'
        && c[0].input.summary === 'Focus: Write the board report' && new Date(c[0].input.startTime).getHours() === 14
        && (new Date(c[0].input.endTime) - new Date(c[0].input.startTime)) === 3600e3, c);
  check('targets cleared, no card opened by the drag', !(await page.$('.drop-core')) && !(await page.$('.sat-card')));
  check('undo offered', /Say undo/.test(await said(page)), await said(page));
  await page.waitForTimeout(1500);

  // ---- drag onto the character: done ----
  const st = await page.$eval('#stage', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await dragTo(page, '#orbit .sat.p1', st.x, st.y);
  check('over the character the drop ring lights up', await page.$eval('.drop-core', e => e.classList.contains('hot')));
  await page.mouse.up(); await page.waitForTimeout(300);
  c = await page.evaluate(() => __calls);
  check('drop on the character completes the task', c.some(k => k.tool === 'complete-tasks' && k.input.ids[0] === 'a'), c);

  // ---- memory ----
  await say(page, "Remember I don't take meetings before 9");
  check('"remember …" saves a note', (await page.evaluate(() => store.get('memory', []))).includes("I don't take meetings before 9")
        && /Noted/.test(await said(page)), await page.evaluate(() => store.get('memory', [])));
  await say(page, 'remember my bank password is hunter2');
  check('secrets are refused', !(await page.evaluate(() => store.get('memory', []))).some(n => /hunter2/.test(n)) && /won't save/.test(await said(page)));
  await say(page, 'forget the meetings note');
  check('"forget …" removes it', (await page.evaluate(() => store.get('memory', []))).length === 0, await page.evaluate(() => store.get('memory', [])));
  // the brain saving a note updates local memory
  await page.evaluate(() => {
    ATLAS.hosted = true; ATLAS.status = { brain: { configured: true }, providers: {} };
    const real = window.fetch;
    window.fetch = async (u, o) => String(u) === '/api/brain'
      ? new Response(JSON.stringify({ reply: "Noted — no meetings before 9.", history: [], memory: ["No meetings before 9am"] }))
      : real(u, o);
  });
  await say(page, "just so you know I never take meetings before 9"); await page.waitForTimeout(200);
  check('a note saved by the brain lands in MEMORY', (await page.evaluate(() => store.get('memory', []))).includes('No meetings before 9am'));

  // the brain added a task: the task list is fetched again straight away, so it joins the orbit
  await page.evaluate(() => {
    window.__inv = [];
    const real = window.fetch;
    window.claude.mcp.invalidate = async (server, tool) => { __inv.push(server + '/' + tool); };
    window.fetch = async (u, o) => String(u) === '/api/brain'
      ? new Response(JSON.stringify({ reply: "Added — call the bank, due today.", history: [], changed: ["todo"] }))
      : real(u, o);
  });
  await say(page, "add a task to call the bank"); await page.waitForTimeout(200);
  check('a task made by Atlas refreshes the task list at once', (await page.evaluate(() => __inv)).includes('Todoist/find-tasks-by-date'), await page.evaluate(() => __inv));

  // ---- connection health ----
  await page.evaluate(() => {
    document.querySelectorAll('#nudges .nudge').forEach(n => n.remove());
    store.set('seenConnected', ['whoop']);
    ATLAS.status = { brain: { configured: true }, providers: {
      whoop: { label: 'WHOOP', configured: true, connected: false, phone: false },
      strava: { label: 'Strava', configured: true, connected: true, phone: false },
      todoist: { label: 'Todoist', configured: false, connected: false, phone: null } } };
    checkNudges();
  });
  const cards = await page.$$eval('#nudges .nudge', els => els.map(e => e.innerText.replace(/\s+/g, ' ')));
  check('an account that was working and dropped → reconnect nudge', cards.some(x => /CONNECTION/.test(x) && /WHOOP has disconnected/.test(x) && /RECONNECT/.test(x)), cards);
  check('connected here but not on the phone → nudge', cards.some(x => /Strava isn't reaching your phone/.test(x)), cards);
  check('never-configured accounts don\'t nag', !cards.some(x => /Todoist/.test(x)), cards);

  check('no page errors', !errors.length, errors);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
