// Readiness-aware planning: recovery band + today's calendar → one offer,
// shown in the Readiness panel and spoken on request; "yes" books or moves,
// "undo" reverses it.
const { chromium, PAGE } = require('./_browser.cjs');
const fails = [];
const check = (name, ok, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got))); if (!ok) fails.push(name); };

// score: today's recovery; events: [title, startHour, endHour]; trained: a workout today
function seed(page, { score, events = [], trained = false }){
  return page.evaluate(({ score, events, trained }) => {
    ATLAS.hosted = true;
    window.__calls = [];
    window.claude = { mcp: {
      callTool: async (server, tool, input) => { __calls.push({ server, tool, input }); return { payload: { id: 'new-1' } }; },
      invalidate: async () => {},
    } };
    const dk = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
    const recoveries = [];
    for (let i = 0; i < 10; i++) recoveries.push({ wake_date: dk(ago(i)), score_state: 'SCORED',
      recovery_score: i === 0 ? score : 60, hrv_ms: 60, resting_hr: 54 });
    const workouts = trained ? [{ id: 'w', sport: 'running', date: dk(new Date()), start_local: dk(new Date()) + 'T07:00:00',
                                  duration_min: 40, zone_min: [0, 10, 20, 10, 0, 0] }] : [];
    S.data.whoop = { days: 35, recoveries, cycles: [], workouts };
    const at = h => { const d = new Date(); d.setHours(Math.floor(h), (h % 1) * 60, 0, 0); return d.toISOString(); };
    S.data.cal = { events: events.map(([t, a, b], i) => ({ id: 'ev' + i, summary: t,
      start: { dateTime: at(a) }, end: { dateTime: at(b) } })) };
    setMeta('whoop', { status: 'ok', storedAt: Date.now() });
    whoopHtml = ''; renderWhoop(); renderDeck();
  }, { score, events, trained });
}
const said = page => page.evaluate(() => [...document.querySelectorAll('.msg.atlas')].pop()?.textContent || '');
const say = async (page, text) => { await page.fill('#say', text); await page.press('#say', 'Enter'); await page.waitForTimeout(500); };
const calls = page => page.evaluate(() => window.__calls);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(new Date(2026, 10, 24, 9, 10));   // Tue 24 Nov 2026, 09:10
  await page.goto(PAGE); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.click('#wake'); await page.waitForTimeout(3500);

  // GREEN: meetings 16:00–17:30, so the first after-4pm hour is 17:30
  await seed(page, { score: 80, events: [['Team sync', 10, 11], ['Planning', 16, 17.5]] });
  let p = await page.evaluate(() => trainingPlan());
  check('green: offers a hard session after 4pm, in a free hour', p.action?.kind === 'book' && /hard/.test(p.say)
        && new Date(p.action.start).getHours() === 17 && new Date(p.action.start).getMinutes() === 30, p);
  await page.click('.gauge[data-view="strava"]'); await page.waitForTimeout(400);
  const panel = await page.innerText('#p-whoop .body');
  check('panel shows the plan with a BOOK button', /Free .* for a hard session/.test(panel) && await page.isVisible('#plan-act'), panel);

  await say(page, 'should I train today');
  check('"should I train" speaks the offer', /good for a hard session/.test(await said(page)) && /book it/i.test(await said(page)), await said(page));
  await say(page, 'yes');
  let c = await calls(page);
  check('"yes" books it on the calendar', c.length === 1 && c[0].tool === 'create_event' && /hard session/.test(c[0].input.summary)
        && c[0].input.startTime === p.action.start, c);
  check('confirmation offers undo', /Booked .* Say undo/.test(await said(page)), await said(page));
  await say(page, 'undo');
  c = await calls(page);
  check('"undo" deletes the booked session', c[1]?.tool === 'delete_event' && c[1].input.eventId === 'new-1', c);

  // "no" drops the offer and books nothing
  await say(page, 'plan my training');
  await say(page, 'not now');
  check('"not now" leaves it', (await calls(page)).length === 2 && /leaving it/.test(await said(page)), await said(page));

  // the panel button books too
  await page.click('#plan-act'); await page.waitForTimeout(300);
  c = await calls(page);
  check('panel button books the session', c[2]?.tool === 'create_event', c);

  // YELLOW: moderate wording
  await seed(page, { score: 50 });
  p = await page.evaluate(() => trainingPlan());
  check('yellow: offers a moderate session', p.action?.kind === 'book' && /moderate/.test(p.say), p);

  // training already on the calendar → nothing to book
  await seed(page, { score: 80, events: [['Easy run', 18, 19]] });
  p = await page.evaluate(() => trainingPlan());
  check('training already booked: no extra offer', !p.action && /Easy run/.test(p.say), p);

  // RED with a hard session booked → offer to move it to tomorrow, undo moves it back
  await seed(page, { score: 25, events: [['Track intervals', 18, 19]] });
  p = await page.evaluate(() => trainingPlan());
  check('red + hard session: offers to move it', p.action?.kind === 'move' && p.action.eventId === 'ev0', p);
  await say(page, 'should I train');
  await say(page, 'yes please');
  c = await calls(page);
  const mv = c[c.length - 1];
  const tomorrow = new Date(2026, 10, 25, 18, 0).toISOString();
  check('"yes" moves it to the same time tomorrow', mv.tool === 'update_event' && mv.input.eventId === 'ev0' && mv.input.startTime === tomorrow, mv);
  await say(page, 'undo');
  c = await calls(page);
  const back = c[c.length - 1];
  check('"undo" moves it back', back.tool === 'update_event' && back.input.startTime === new Date(2026, 10, 24, 18, 0).toISOString(), back);

  // RED with nothing hard → easy day, no action
  await seed(page, { score: 25, events: [['Dentist', 15, 16]] });
  p = await page.evaluate(() => trainingPlan());
  check('red, nothing hard: suggests an easy day', !p.action && /easy/.test(p.say), p);

  // already trained today
  await seed(page, { score: 80, trained: true });
  p = await page.evaluate(() => trainingPlan());
  check('already trained: no extra session', !p.action && /already trained/.test(p.say), p);
  check('panel says trained, no button', /Trained today/.test(await page.innerText('#p-whoop .body')) && !(await page.$('#plan-act')));

  check('no page errors', !errors.length, errors);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
