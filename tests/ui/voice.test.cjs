// Front-end tests for the pinned voice: picker hidden, pinned voice always used,
// one retry on a blip, no retry on a 4xx, fallback announced once.
const { chromium, PAGE } = require('./_browser.cjs');
const fails = [];
const check = (name, ok, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got))); if (!ok) fails.push(name); };

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE);
  await page.evaluate(() => localStorage.setItem('atlas.voiceName', JSON.stringify('cloud:SomeOtherVoice')));  // a stale per-browser pick
  await page.reload();
  await page.click('#wake'); await page.waitForTimeout(3500);   // let the wake greeting (and its headless no-voice notice) finish

  // simulate the self-hosted site with ATLAS_VOICE resolved to Charlotte, and a fake /api/tts
  await page.evaluate(() => {
    ATLAS.hosted = true;
    ATLAS.status = { hosted: true, tts: { configured: true, pinned: { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte' } } };
    applyPinnedVoice();
    // 0.1 s of silent 8 kHz mono WAV, so the Audio element really plays
    const n = 800, buf = new ArrayBuffer(44 + n), v = new DataView(buf), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    window.__wav = new Blob([buf], { type: 'audio/wav' });
    window.__tts = []; window.__plan = [];
    const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (String(url) !== '/api/tts') return realFetch(url, opts);
      window.__tts.push(JSON.parse(opts.body));
      const code = window.__plan.shift() ?? 200;
      return code === 200 ? new Response(window.__wav, { status: 200 }) : new Response('{}', { status: code });
    };
  });

  check('picker hidden when a voice is pinned', !(await page.isVisible('#voicesel')));
  check('VOICE button names the pinned voice', (await page.getAttribute('#voicebtn', 'title')).includes('Charlotte'));
  check('pinned voice beats the stale per-browser pick', await page.evaluate(() => selectedCloudVoiceId() === 'XB0fDUnXU5powFXDhCwa'));

  // a blip: 502 then OK → one retry, cloud voice used, no fallback note
  await page.evaluate(() => { document.getElementById('micnote').classList.remove('show'); window.__tts = []; window.__plan = [502, 200]; speak('Testing one.'); });
  await page.waitForTimeout(1500);
  let calls = await page.evaluate(() => window.__tts);
  check('5xx blip is retried once', calls.length === 2, calls.length);
  check('both attempts ask for the pinned voice', calls.every(c => c.voiceId === 'XB0fDUnXU5powFXDhCwa'), calls);
  check('no fallback note after a successful retry', !(await page.isVisible('#micnote')));

  // setup problem: 400 → no retry, falls back, says so once
  await page.evaluate(() => { document.getElementById('micnote').classList.remove('show'); window.__tts = []; window.__plan = [400]; speak('Testing two.'); });
  await page.waitForTimeout(2500);
  calls = await page.evaluate(() => window.__tts);
  check('4xx is not retried', calls.length === 1, calls.length);
  const note = await page.evaluate(() => document.getElementById('micnote').textContent);
  check('fallback announced on screen', /Cloud voice didn't answer/.test(note), note);
  check('reply still appears once in the transcript', await page.evaluate(() =>
    [...document.querySelectorAll('.msg.atlas')].filter(m => m.textContent.includes('Testing two.')).length === 1));

  // next reply goes back to the cloud voice
  await page.evaluate(() => { window.__tts = []; window.__plan = [200]; speak('Testing three.'); });
  await page.waitForTimeout(1500);
  calls = await page.evaluate(() => window.__tts);
  check('next reply uses the cloud voice again', calls.length === 1 && calls[0].voiceId === 'XB0fDUnXU5powFXDhCwa', calls);

  // a pin that matches nothing is reported, picker stays
  await page.evaluate(() => { ATLAS.status.tts.pinned = { error: 'ATLAS_VOICE "Morgan" doesn\'t match any voice in this ElevenLabs account' };
    document.getElementById('voicesel').hidden = false; applyPinnedVoice(); });
  check('unmatched pin is explained on screen', /Site voice not found/.test(await page.evaluate(() => document.getElementById('micnote').textContent)));
  check('unmatched pin leaves the picker available', await page.isVisible('#voicesel'));

  check('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
