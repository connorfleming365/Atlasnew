// Behaviour tests for the master view: views, rail, focus, Escape, HUD toggle,
// voice/typed layout commands, persistence, Day Line, plus earlier regressions.
const { chromium, PAGE } = require('./_browser.cjs');
const URL = PAGE;
const fails = [];
const check = (name, ok, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got))); if (!ok) fails.push(name); };

async function seed(page){
  await page.evaluate(() => {
    const now = new Date(), at = (h, m) => { const d = new Date(now); d.setHours(h, m, 0, 0); return d.toISOString(); };
    const k = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
    S.data.cal = { events: [
      { summary: 'Daily stand-up', start: { dateTime: at(9, 30) }, end: { dateTime: at(10, 0) } },
      { summary: 'Client sync', start: { dateTime: at(14, 30) }, end: { dateTime: at(15, 0) } },
      { summary: '1:1 with Daniel', start: { dateTime: at(16, 0) }, end: { dateTime: at(16, 30) } } ] };
    S.data.todo = { tasks: [
      { id: '1', content: 'Send Q4 invoice', priority: 'p1', dueDate: k },
      { id: '2', content: 'Review copy', priority: 'p2', dueDate: k + 'T17:00:00' },
      { id: '4', content: 'Renew domain', priority: 'p3', dueDate: '2020-01-01' } ] };
    S.data.gmail = { threads: [
      { id: 'a', messages: [{ sender: 'Stephanie Lane <s@x.com>', subject: 'Re: onboarding', snippet: 'notes', labelIds: ['UNREAD','IMPORTANT'], date: now.toISOString() }] },
      { id: 'b', messages: [{ sender: 'Strava <no-reply@strava.com>', subject: 'Weekly summary', snippet: '', labelIds: [], date: now.toISOString() }] } ] };
    S.data.strava = { activities: [{ name: 'Easy run', start_local: at(7, 0), summary: { distance: 6000, moving_time: 1900, relative_effort: 30 } }] };
    renderCal(); renderTodo(); renderGmail(); renderStrava(); renderDeck();
  });
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(new Date(new Date().setHours(13, 50, 0, 0)));
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.click('#wake'); await page.waitForTimeout(300);
  await seed(page);

  // gauges + Day Line
  check('Next gauge shows the next event time', (await page.innerText('#gv-cal')).includes('2:30'), await page.innerText('#gv-cal'));
  check('Tasks gauge counts overdue + today', (await page.innerText('#gv-todo')) === '3', await page.innerText('#gv-todo'));
  check('Inbox gauge counts unread', (await page.innerText('#gv-gmail')).startsWith('1'), await page.innerText('#gv-gmail'));
  check('rail badge shows unread', (await page.innerText('#rb-gmail')) === '1' && !(await page.$eval('#rb-gmail', b => b.hidden)));
  check('rail button label includes count', (await page.getAttribute('#rail [data-view="gmail"]', 'aria-label')) === 'Inbox, 1 unread');
  check('Day Line draws 3 events + 1 workout', (await page.$$('#dl-track .dl-ev')).length === 4);
  const gapTitle = await page.getAttribute('#dl-block', 'title');
  check('first free gap is 15:00 (after client sync)', /0?3:00|15:00/.test(gapTitle || ''), gapTitle);
  check('Day Line shows a timed task pin', (await page.innerText('#dl-track')).includes('Review copy'));
  check('Day Line shows overdue pin', (await page.innerText('#dl-track')).includes('1 overdue'));
  check('NOW needle visible', !(await page.$eval('#dl-now', n => n.hidden)));

  // open a view from a gauge
  await page.click('.gauge[data-view="gmail"]'); await page.waitForTimeout(500);
  check('gauge opens the Inbox view', await page.evaluate(() => S.view === 'gmail' && !document.querySelector('#p-gmail').hidden && document.querySelector('#p-cal').hidden));
  check('#app is in viewing layout', await page.evaluate(() => document.getElementById('app').classList.contains('viewing')));
  check('focus moves to the view heading', await page.evaluate(() => document.activeElement.id === 'h-gmail'));
  check('rail marks Inbox current', (await page.getAttribute('#rail [data-view="gmail"]', 'aria-current')) === 'page');
  check('gauges hidden while viewing', !(await page.isVisible('#deck')));

  // Escape on the armed delete chip cancels delete only
  await page.click('#p-gmail .mail'); await page.focus('#p-gmail .mail .actchip.crit'); await page.keyboard.press('Enter');
  check('delete armed', (await page.innerText('#p-gmail .mail .actchip.crit')) === 'CONFIRM DELETE');
  await page.keyboard.press('Escape');
  check('Escape on armed delete keeps the view open', await page.evaluate(() => S.view === 'gmail'));
  check('...and disarms delete', (await page.innerText('#p-gmail .mail .actchip.crit')) === 'DELETE');

  // Escape closes the view and returns focus to the gauge
  await page.focus('#h-gmail'); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  check('Escape closes the view', await page.evaluate(() => S.view === 'deck' && document.querySelector('#p-gmail').hidden));
  check('focus returns to the Inbox gauge', await page.evaluate(() => document.activeElement.matches('.gauge[data-view="gmail"]')));

  // rail navigation between views, and close via rail
  await page.click('#rail [data-view="todo"]'); await page.waitForTimeout(300);
  check('rail opens Tasks', await page.evaluate(() => S.view === 'todo'));
  await page.click('#rail [data-view="strava"]'); await page.waitForTimeout(300);
  check('rail switches straight to Training', await page.evaluate(() => S.view === 'strava' && document.querySelector('#p-todo').hidden));
  await page.click('#p-strava .vclose'); await page.waitForTimeout(150);
  check('close button returns to the deck', await page.evaluate(() => S.view === 'deck'));
  check('focus returns to the rail button that opened it', await page.evaluate(() => document.activeElement.matches('#rail [data-view="strava"]')));

  // typed layout commands (same path as voice)
  const say = async t => { await page.fill('#say', t); await page.press('#say', 'Enter'); await page.waitForTimeout(150); };
  await say('show my inbox');
  check('"show my inbox" opens Inbox', await page.evaluate(() => S.view === 'gmail'));
  await say('close');
  check('"close" returns to the deck', await page.evaluate(() => S.view === 'deck'));
  await say('show me my day');
  check('"show me my day" opens Today', await page.evaluate(() => S.view === 'cal'));
  await say('heads-up mode');
  check('"heads-up mode" switches to HUD and closes the view', await page.evaluate(() => S.mode === 'hud' && S.view === 'deck' && document.getElementById('app').dataset.mode === 'hud'));
  check('HUD readouts filled', (await page.innerText('#ro-next')).toUpperCase().includes('CLIENT SYNC') && (await page.innerText('#ro-next')).includes('T−00:40'));
  const hudTasks = (await page.innerText('#ro-tasks')).toUpperCase();
  check('HUD tasks list only today\'s tasks', hudTasks.includes('2 DUE TODAY') && hudTasks.includes('SEND Q4 INVOICE')
    && hudTasks.includes('REVIEW COPY') && !hudTasks.includes('RENEW DOMAIN') && !hudTasks.includes('OVERDUE'), hudTasks);
  check('HUD shows the due time for timed tasks', /REVIEW COPY · 0?5:00|REVIEW COPY · 17:00/.test(hudTasks), hudTasks);
  check('HUD hides rail, Day Line and gauges', !(await page.isVisible('#rail')) && !(await page.isVisible('#dayline')) && !(await page.isVisible('#deck')));
  check('HUD toggle reflects state', (await page.getAttribute('#modes [data-mode="hud"]', 'aria-pressed')) === 'true');

  // mode persists across reload
  await page.reload({ waitUntil: 'load' });
  check('HUD mode persists after reload', await page.evaluate(() => S.mode === 'hud' && document.getElementById('app').dataset.mode === 'hud'));
  await page.click('#wake'); await page.waitForTimeout(300); await seed(page);
  await page.click('#rail [data-view="gmail"]').catch(() => {});   // hidden in HUD: should not be clickable
  await page.click('#modes [data-mode="deck"]');
  check('toggle back to deck', await page.evaluate(() => S.mode === 'deck' && getComputedStyle(document.getElementById('rail')).display !== 'none'));
  await say('open email');
  check('"open email" still means read the latest (no view opened)', await page.evaluate(() => S.view === 'deck'));

  // earlier regressions
  await page.evaluate(() => setLastAction({ type: 'archive', threadId: 'abc' }));
  await page.reload({ waitUntil: 'load' });
  check('undo survives reload', (await page.evaluate(() => lastAction?.threadId)) === 'abc');

  check('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
