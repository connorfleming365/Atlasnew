// Plan my day: a draft only - nothing reaches the calendar until approval;
// blocks can be dropped; approve adds just the kept ones; undo removes them.
// Inbox triage: one unread at a time, important first, concise summary,
// archive / reply-as-draft / delete / next, by button or voice.
const { chromium, PAGE } = require('./_browser.cjs');
const fails = [];
const check = (name, ok, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got))); if (!ok) fails.push(name); };
const said = page => page.evaluate(() => [...document.querySelectorAll('.msg.atlas')].pop()?.textContent || '');
const say = async (page, t) => { await page.fill('#say', t); await page.press('#say', 'Enter'); await page.waitForTimeout(450); };
const calls = page => page.evaluate(() => __calls);

async function setup(page, { ai }){
  await page.evaluate(({ ai }) => {
    window.__calls = []; window.__api = [];
    window.claude = { mcp: {
      callTool: async (server, tool, input) => { __calls.push({ tool, input }); return { payload: { id: 'ev-' + __calls.length } }; },
      invalidate: async () => {} } };
    if (ai){
      ATLAS.hosted = true; ATLAS.status = { brain: { configured: true } };
      const real = window.fetch;
      window.fetch = async (url, opts) => {
        if (String(url) === '/api/ai/plan'){
          const b = JSON.parse(opts.body); __api.push({ url, body: b });
          return new Response(JSON.stringify({ source: 'ai', summary: 'Two focus blocks this morning, admin after lunch.',
            blocks: [{ task_id: 'b', start: '10:00', end: '11:00', why: 'deep work early' },
                     { task_id: 'a', start: '14:00', end: '14:20', why: 'quick admin' }],
            unscheduled: [{ task_id: 'c', why: 'no room today' }] }));
        }
        if (String(url) === '/api/ai/triage'){
          const b = JSON.parse(opts.body); __api.push({ url, body: b });
          return new Response(JSON.stringify(b.instruction ? { drafted: true, body: 'Thanks - Thursday works.' }
            : { summary: 'Asks you to confirm Thursday kickoff time.', action: 'reply', reason: 'needs your answer' }));
        }
        return real(url, opts);
      };
    }
    const t = (h, m) => new Date(2026, 10, 24, h, m).toISOString();
    S.data.cal = { events: [{ id: 'x', summary: 'Team sync', start: { dateTime: t(11, 30) }, end: { dateTime: t(12, 30) } }] };
    S.data.todo = { tasks: [
      { id: 'a', content: 'Pay the VAT bill', priority: 'p2', dueDate: '2026-11-24' },
      { id: 'b', content: 'Write the board report', priority: 'p1', dueDate: '2026-11-24' },
      { id: 'c', content: 'Renew passport', priority: 'p4', dueDate: '2026-11-20' } ] };
    const msg = (id, from, subject, labels, snippet) => ({ id, messages: [{ sender: from, subject, snippet, labelIds: labels, date: new Date().toUTCString() }] });
    S.data.gmail = { threads: [
      msg('t1aaaaaa', 'News <n@x.com>', 'Weekly digest', ['UNREAD'], 'This week in…'),
      msg('t2aaaaaa', 'Sam Lee <s@x.com>', 'Kickoff Thursday?', ['UNREAD', 'IMPORTANT'], 'Can we confirm the time for Thursday'),
      msg('t3aaaaaa', 'Ana <a@x.com>', 'Lunch', ['UNREAD'], 'Fancy lunch next week?'),
      msg('t4aaaaaa', 'Old <o@x.com>', 'Read already', [], 'nothing') ] };
    renderDeck();
  }, { ai });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(new Date(2026, 10, 24, 9, 20));   // Tue 24 Nov 2026, 09:20
  await page.goto(PAGE); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.click('#wake'); await page.waitForTimeout(3500);

  // ---- rules (no AI) ----
  await setup(page, { ai: false });
  await say(page, 'plan my day');
  let P = await page.evaluate(() => S.proposal && S.proposal.blocks.map(b => ({ id: b.taskId, s: b.start.getHours() * 60 + b.start.getMinutes(), e: b.end.getHours() * 60 + b.end.getMinutes(), kind: b.kind })));
  check('rules draft: all three tasks placed, p1/overdue first', P && P.length === 3 && P[0].id === 'c' || P?.[0]?.id === 'b', P);
  check('rules draft: nothing overlaps the 11:30 meeting', P && P.every(b => b.e <= 11 * 60 + 30 || b.s >= 12 * 60 + 30), P);
  check('rules draft: deep task gets an hour, admin 20 min', P && P.find(b => b.id === 'b').e - P.find(b => b.id === 'b').s === 60
        && P.find(b => b.id === 'a').e - P.find(b => b.id === 'a').s === 20, P);
  check('draft writes NOTHING to the calendar', (await calls(page)).length === 0, await calls(page));
  check('draft panel open, says nothing added yet', await page.evaluate(() => $('#plan').open) && /nothing added yet/.test(await page.innerText('#pl-src')));
  check('Day Line shows draft blocks', (await page.$$('.dl-prop')).length === 3);
  check('spoken: draft + approval needed', /Nothing's on your calendar yet/.test(await said(page)), await said(page));
  await page.click('#pl-close');
  await say(page, 'discard');
  check('discard: draft gone, nothing written', await page.evaluate(() => S.proposal === null) && (await calls(page)).length === 0 && (await page.$$('.dl-prop')).length === 0);

  // ---- AI draft ----
  await setup(page, { ai: true });
  await page.click('#dl-plan'); await page.waitForTimeout(500);
  const api = await page.evaluate(() => __api.find(a => a.url === '/api/ai/plan'));
  check('AI: sends tasks, free gaps (HH:MM), busy events', api && api.body.tasks.length === 3 && api.body.gaps[0].start === '09:30'
        && api.body.events[0].title === 'Team sync', api?.body);
  const rows = await page.$$eval('#pl-body .pl-row', els => els.map(e => e.innerText.replace(/\s+/g, ' ')));
  check('AI draft listed with reasons, unscheduled shown', rows.length === 2 && /Write the board report/.test(rows[0]) && /deep work early/.test(rows[0])
        && /Renew passport/.test(await page.innerText('#pl-body')) && /Drafted by Claude/.test(await page.innerText('#pl-src')), rows);
  check('AI summary spoken', /Two focus blocks/.test(await said(page)), await said(page));
  // untick by voice, approve
  await page.click('#pl-close');
  await say(page, 'remove the VAT one');
  check('"remove the VAT one" unticks that block', await page.evaluate(() => S.proposal.blocks.find(b => b.taskId === 'a').keep === false), null);
  await say(page, 'approve'); await page.waitForTimeout(300);
  let c = await calls(page);
  check('approve: only the kept block is added', c.length === 1 && c[0].tool === 'create_event' && c[0].input.summary === 'Focus: Write the board report'
        && new Date(c[0].input.startTime).getHours() === 10, c);
  check('approve: draft cleared, undo offered', await page.evaluate(() => S.proposal === null) && /Say undo/.test(await said(page)), await said(page));
  await say(page, 'undo'); await page.waitForTimeout(300);
  c = await calls(page);
  check('undo removes what the plan added', c[1]?.tool === 'delete_event' && c[1].input.eventId === 'ev-1', c);

  // ---- triage ----
  await page.evaluate(() => { __calls.length = 0; });
  await say(page, 'triage my inbox'); await page.waitForTimeout(400);
  check('triage opens on the important unread first', await page.evaluate(() => $('#triage').open) && /Kickoff Thursday/.test(await page.innerText('#tr-subj'))
        && /1 of 3/.test(await page.innerText('#tr-count')));
  check('concise AI summary + suggestion', /confirm Thursday kickoff/.test(await page.innerText('#tr-sum')) && /SUGGEST: REPLY/.test(await page.innerText('#tr-sug')));
  await say(page, 'reply saying Thursday at 10 works'); await page.waitForTimeout(300);
  const dr = await page.evaluate(() => __api.filter(a => a.url === '/api/ai/triage' && a.body.instruction));
  check('reply by voice → draft via Claude, never sent', dr.length === 1 && dr[0].body.instruction === 'thursday at 10 works' && dr[0].body.threadId === 't2aaaaaa', dr);
  check('moves to the next one', /2 of 3/.test(await page.innerText('#tr-count')), await page.innerText('#tr-count'));
  await page.click('#triage [data-act="archive"]'); await page.waitForTimeout(300);
  c = await calls(page);
  check('ARCHIVE button archives that thread', c.some(k => k.tool === 'unlabel_thread' && k.input.labelIds[0] === 'INBOX'), c);
  await say(page, 'delete'); await page.waitForTimeout(300);
  c = await calls(page);
  check('"delete" trashes the last one, triage ends', c.some(k => k.tool === 'apply_sensitive_thread_label') && !(await page.evaluate(() => $('#triage').open))
        && /That's the lot/.test(await said(page)), await said(page));

  // phone width: both dialogs fit
  await page.setViewportSize({ width: 360, height: 740 });
  await page.evaluate(() => { S.proposal = { blocks: [{ kind: 'task', title: 'A really quite long task name that has to wrap somewhere sensible', start: new Date(), end: new Date(Date.now() + 3600e3), why: 'x', keep: true }], unscheduled: [], summary: '', source: 'rules' }; openPlanPanel(); });
  await page.waitForTimeout(200);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const fit = await page.evaluate(() => { const r = $('#plan').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
  check('360px: plan dialog fits', over === 0 && fit, { over, fit });

  check('no page errors', !errors.length, errors);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
