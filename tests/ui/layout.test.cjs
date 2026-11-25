// Layout: the page never scrolls sideways, in any state, at any width from a
// small phone to a wide monitor — with and without WHOOP data on screen.
const { chromium, PAGE } = require('./_browser.cjs');
const fails = [];
const check = (name, ok, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got))); if (!ok) fails.push(name); };

const WIDTHS = [360, 390, 430, 660, 661, 768, 1024, 1080, 1081, 1280, 1600, 1920];
const STATES = ['deck', 'view', 'hud', 'whoop-view'];

(async () => {
  const browser = await chromium.launch();
  for (const w of WIDTHS) for (const st of STATES){
    const page = await browser.newPage({ viewport: { width: w, height: 844 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(PAGE); await page.evaluate(() => localStorage.clear()); await page.reload();
    await page.click('#wake'); await page.waitForTimeout(150);
    if (st === 'whoop-view'){
      await page.evaluate(() => {
        ATLAS.hosted = true;
        S.data.whoop = { recoveries: [{ wake_date: todayKey(), score_state: 'SCORED', recovery_score: 40, hrv_ms: 50, resting_hr: 58,
                                        sleep: { performance: 70, asleep_h: 6.1 } }],
                         cycles: [], workouts: [{ id: 'x', sport: 'a-very-long-sport-name-from-the-whoop-api', date: todayKey(),
                         start_local: todayKey() + 'T07:00:00', duration_min: 75, strain: 14.2, zone_min: [0, 10, 20, 30, 10, 5] }] };
        renderWhoop(); renderDeck();
      });
    }
    if (st === 'view' || st === 'whoop-view') await page.click(`.gauge[data-view="${st === 'view' ? 'gmail' : 'strava'}"]`);
    if (st === 'hud') await page.click('#modes [data-mode="hud"]');
    await page.waitForTimeout(150);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${w}px ${st}: no sideways scroll, no errors`, over === 0 && !errors.length, { over, errors });
    await page.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
