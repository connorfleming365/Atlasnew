// Front-end tests for WHOOP readiness: panel, gauge, HUD, voice, week maths, fallbacks.
const { chromium, PAGE } = require('./_browser.cjs');
const URL = PAGE;
const fails = [];
const check = (name, ok, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got))); if (!ok) fails.push(name); };

// Sample payload in the exact shape lib/tools.js get_overview returns.
function seedWhoop(page, { scoredToday = true } = {}){
  return page.evaluate(({ scoredToday }) => {
    ATLAS.hosted = true;                                   // simulate the self-hosted site
    const dk = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
    const recoveries = [];
    for (let i = scoredToday ? 0 : 1; i < 20; i++){
      recoveries.push({ wake_date: dk(ago(i)), score_state: 'SCORED',
        recovery_score: i === 0 ? 72 : [55, 81, 40, 66, 90, 28, 61][i % 7],
        hrv_ms: i === 0 ? 68 : 62, resting_hr: i === 0 ? 52 : 54, calibrating: false,
        sleep: { performance: 88, asleep_h: 7.4, in_bed_h: 8 } });
    }
    const cycles = [];
    for (let i = 0; i < 16; i++) cycles.push({ day: dk(ago(i)), ongoing: i === 0, strain: i === 0 ? 8.4 : 10 + (i % 5) });
    // week maths: today is Tuesday in the test clock, so this week = Mon + Tue
    const now = new Date(), dow = (now.getDay() + 6) % 7;
    const mon = new Date(now); mon.setDate(now.getDate() - dow);
    const at = (base, addDays, h) => { const d = new Date(base); d.setDate(d.getDate() + addDays); d.setHours(h, 0, 0, 0); return d; };
    const wk = (d, sport, min, strain, zones) => ({ id: sport + d.getTime(), sport, date: dk(d),
      start_local: `${dk(d)}T${String(d.getHours()).padStart(2,'0')}:00:00`, duration_min: min, score_state: 'SCORED',
      strain, avg_hr: 148, zone_min: zones });
    const workouts = [
      wk(at(mon, dow, 7), 'running', 45, 11.3, [1, 5, 15, 20, 4, 0]),          // today
      wk(at(mon, 0, 18), 'functional-fitness', 60, 9.8, [5, 20, 25, 8, 2, 0]),  // Monday
      wk(at(mon, -7, 7), 'running', 50, 12.0, [0, 10, 20, 15, 5, 0]),          // last Monday (counted)
      wk(at(mon, -3, 9), 'cycling', 90, 13.1, [0, 30, 40, 20, 0, 0]),          // last Friday (not "by now")
    ];
    S.data.whoop = { days: 35, recoveries, cycles, workouts };
    setMeta('whoop', { status: 'ok', storedAt: Date.now() });
    renderWhoop(); renderDeck();
  }, { scoredToday });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(new Date(2026, 10, 24, 13, 50));   // Tue 24 Nov 2026, 13:50
  await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.click('#wake'); await page.waitForTimeout(250);

  // before any WHOOP data: gauge is Training (Strava)
  check('without WHOOP the fourth gauge stays "Training"', (await page.innerText('.gauge[data-view="strava"] .gl')).toUpperCase() === 'TRAINING');

  await seedWhoop(page);
  check('gauge becomes Readiness', (await page.innerText('.gauge[data-view="strava"] .gl')).toUpperCase() === 'READINESS');
  check('gauge shows 72% Green', (await page.innerText('#gv-strava')).replace(/\s+/g, ' ').includes('72% Green'), await page.innerText('#gv-strava'));
  const gs = await page.innerText('#gs-strava');
  check('gauge HRV delta vs baseline (+6) and RHR', gs.includes('HRV 68 (+6)') && gs.includes('RHR 52'), gs);
  check('gauge mini bars coloured by band', (await page.$$('#gb-strava i[class^="band-"]')).length === 7);

  // open Training: two panels, readiness first, focus on its heading
  await page.click('.gauge[data-view="strava"]'); await page.waitForTimeout(500);
  check('Training view shows WHOOP + Strava panels', await page.evaluate(() =>
    !document.getElementById('p-whoop').hidden && !document.getElementById('p-strava').hidden && document.getElementById('p-cal').hidden));
  check('focus lands on READINESS heading', await page.evaluate(() => document.activeElement.id === 'h-whoop'));
  const wb = await page.innerText('#p-whoop .body');
  check('panel: recovery ring 72% Green', wb.includes('72%') && /GREEN/i.test(wb));
  check('panel: HRV +6 vs 30-day avg', wb.includes('+6 vs 30-day avg'), wb.slice(0, 300));
  check('panel: resting HR −2 vs avg (lower is good)', wb.includes('−2 vs avg'), wb.slice(0, 300));
  check('panel: sleep 88% and 7.4 h asleep', wb.includes('88%') && wb.includes('7.4 h asleep'));
  check('panel: strain today so far', wb.includes('8.4') && /so far/i.test(wb));
  check('panel: plain-language verdict', /ready for a hard session/i.test(wb));
  check('panel: this week 2 sessions vs 1 by now last week', /\b2\s*SESSIONS/i.test(wb.replace(/\n/g, ' ')) && wb.includes('1 by now last week'), wb);
  check('panel: training time 1.8 h this week (45+60 min)', wb.includes('1.8'), wb);
  check('panel: avg day strain uses finished days only (Mon = 11.0)', wb.includes('11.0'), wb);
  check('panel: zone legend sums both workouts (Z1 25m, Z2 40m, Z3 28m, Z4 6m)', ['Z1 25m','Z2 40m','Z3 28m','Z4 6m'].every(s => wb.includes(s)), wb);
  check('panel: sports split (running, functional fitness)', /running/i.test(wb) && /functional fitness/i.test(wb));

  // HUD readout
  await page.keyboard.press('Escape');
  await page.click('#modes [data-mode="hud"]'); await page.waitForTimeout(300);
  const hud = (await page.innerText('#ro-load')).toUpperCase();
  check('HUD corner shows RECOVERY 72% GREEN', hud.includes('RECOVERY') && hud.includes('72% GREEN') && hud.includes('HRV 68 (+6)'), hud);
  await page.click('#modes [data-mode="deck"]');

  // voice/typed: readiness uses WHOOP
  await page.fill('#say', 'am I ready to train'); await page.press('#say', 'Enter'); await page.waitForTimeout(600);
  const said = await page.evaluate(() => [...document.querySelectorAll('.msg.atlas')].pop().textContent);
  check('"am I ready to train" answers from WHOOP', /Recovery is 72 percent, green/.test(said) && /6 above your average/.test(said) && /2 sessions/.test(said), said);
  await page.fill('#say', "how's my hrv"); await page.press('#say', 'Enter'); await page.waitForTimeout(600);
  const said2 = await page.evaluate(() => [...document.querySelectorAll('.msg.atlas')].pop().textContent);
  check('"how\'s my hrv" also answers from WHOOP', /Recovery is 72 percent/.test(said2), said2);

  // no score yet this morning
  await seedWhoop(page, { scoredToday: false });
  check('no score today: gauge says so with last score', (await page.innerText('#gs-strava')).startsWith('No recovery yet · last 81%'), await page.innerText('#gs-strava'));
  check('no score today: panel prompts to sync', /No recovery scored yet this morning/.test(await page.innerText('#p-whoop .body')));
  await page.fill('#say', 'am I ready to train'); await page.press('#say', 'Enter'); await page.waitForTimeout(600);
  const said3 = await page.evaluate(() => [...document.querySelectorAll('.msg.atlas')].pop().textContent);
  check('no score today: voice falls back to Strava/no-data line, never yesterday\'s score', !/Recovery is/.test(said3), said3);

  // unconfigured on the deployment → clear setup message
  const copy = await page.evaluate(() => { ATLAS.status = { providers: { whoop: { label: 'WHOOP', servers: ['WHOOP'], configured: false } } };
    return errCopy('server_not_connected', 'WHOOP'); });
  check('unconfigured WHOOP explains setup', copy.includes("isn't set up on this deployment") && copy.includes('SELF-HOSTING.md'), copy);

  check('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
