// Horizon: Atlas is a small black hole in a ring of light. A finished task's
// planet spirals in (stretched, reddening, with a trail) and the ring flares
// where it crosses; when a meeting ends its moon falls in and the next
// meeting's moon drifts in from deep space.
const { chromium, PAGE } = require('./_browser.cjs');
const fails = [];
const check = (name, ok, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got))); if (!ok) fails.push(name); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({ time: new Date(2026, 10, 24, 11, 40) });
  await page.goto(PAGE); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.click('#wake'); await page.clock.runFor(2500);
  await page.evaluate(() => {
    window.__calls = []; window.__flares = [];
    const real = Entity.flare; Entity.flare = a => { __flares.push(a); real(a); };
    window.claude = { mcp: { callTool: async (s, tool, input) => { __calls.push({ tool, input }); return { payload: {} }; }, invalidate: async () => {} } };
    const t = (h, m) => new Date(2026, 10, 24, h, m).toISOString();
    S.data.cal = { events: [
      { id: 'e1', summary: 'Design review', start: { dateTime: t(11, 30) }, end: { dateTime: t(12, 15) } },
      { id: 'e2', summary: 'Client call', start: { dateTime: t(15, 0) }, end: { dateTime: t(15, 45) } }] };
    S.data.todo = { tasks: [{ id: 'a', content: 'Send invoice', priority: 'p1', dueDate: '2026-11-24' },
                            { id: 'b', content: 'Book flights', priority: 'p2', dueDate: '2026-11-24' }] };
    renderTodo(); renderDeck();
  });
  await page.clock.runFor(2000);

  // the character: a black hole with a warm ring
  const px = await page.evaluate(() => {
    const cv = $('#orb'), g = cv.getContext('2d'), W = cv.width, H = cv.height, R = Math.min(W, H) * .2;
    const at = (x, y) => [...g.getImageData(Math.round(x), Math.round(y), 1, 1).data];
    const ring = [0, 1, 2, 3, 4, 5].map(i => at(W / 2 + Math.cos(i) * R * 1.12, H / 2 + Math.sin(i) * R * 1.12));
    return { centreAlpha: at(W / 2, H / 2 + R * .5)[3], centre: at(W / 2, H / 2 + R * .5), ring };
  });
  check('the centre is the black hole', px.centre[0] < 20 && px.centre[1] < 20 && px.centre[2] < 20 && px.centreAlpha > 200, px.centre);
  check('a warm ring of light surrounds it', px.ring.every(p => p[3] > 20 && p[0] >= p[2]), px.ring);
  const geo = await page.evaluate(() => { const st = $('#stage').getBoundingClientRect(), R = Math.min(st.width, st.height) * .2;
    return [...document.querySelectorAll('#orbit .sat:not(.more)')].map(e => { const r = e.getBoundingClientRect();
      return Math.hypot(r.left + r.width / 2 - st.left - st.width / 2, r.top + r.height / 2 - st.top - st.height / 2) / R; }); });
  check('planets orbit clear of the horizon glow', geo.length === 2 && geo.every(d => d > 1.5), geo);

  // complete a task: its planet falls in
  await page.click('#orbit .sat.p1', { force: true }); await page.clock.runFor(200);
  await page.click('.sat-card [data-sc="done"]');
  check('DONE completes it in Todoist', (await page.evaluate(() => __calls)).some(c => c.tool === 'complete-tasks' && c.input.ids[0] === 'a'));
  await page.clock.runFor(1500);
  const mid = await page.evaluate(() => { const el = [...document.querySelectorAll('#orbit .sat')].find(e => e.title === 'Send invoice');
    const fx = document.querySelector('#orbit .orbit-fx'), d = fx.getContext('2d').getImageData(0, 0, fx.width, fx.height).data;
    let lit = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) lit++;
    return el ? { tr: el.style.transform, filter: el.style.filter, lit } : { gone: true, lit }; });
  check('mid-fall: stretched towards the hole and reddening', /rotate\(/.test(mid.tr || '') && /scale\([\d.]+, ?[\d.]+\)/.test(mid.tr || '') && /sepia/.test(mid.filter || ''), mid);
  check('mid-fall: it leaves a trail', mid.lit > 20, mid.lit);
  await page.clock.runFor(2500);
  check('it crossed: planet gone, the ring flared', !(await page.$$eval('#orbit .sat', els => els.some(e => e.title === 'Send invoice'))) && (await page.evaluate(() => __flares.length)) >= 1);
  check('the other planet is still in orbit', await page.$$eval('#orbit .sat', els => els.some(e => e.title === 'Book flights')));

  // the meeting ends: its moon falls in, the next arrives
  check('the moon stands for the meeting on now', /Design review/.test(await page.getAttribute('#orbit .moon:not(.falling)', 'aria-label')));
  const before = await page.evaluate(() => __flares.length);
  await page.clock.setSystemTime(new Date(2026, 10, 24, 12, 16));
  let fell = false;
  for (let i = 0; i < 16 && !fell; i++){ await page.clock.runFor(200); fell = !!(await page.$('#orbit .moon.falling')); }
  check('meeting over: its moon falls in', fell);
  check('…and the next meeting takes over', /Client call/.test(await page.getAttribute('#orbit .moon:not(.falling)', 'aria-label')));
  await page.clock.runFor(4000);
  check('the old moon crossed the horizon', !(await page.$('#orbit .moon.falling')) && (await page.evaluate(() => __flares.length)) > before);
  const op = await page.$eval('#orbit .moon:not(.falling)', e => +e.style.opacity);
  check('the new moon has drifted in', op > .5, op);

  // moods don't break it
  for (const m of ['thinking', 'listening', 'speaking', 'asleep', 'idle']){ await page.evaluate(m => { Entity.mood = m; }, m); await page.clock.runFor(300); }
  check('no page errors', !errors.length, errors);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
