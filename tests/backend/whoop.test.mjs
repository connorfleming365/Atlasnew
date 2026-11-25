// Backend tests for the WHOOP integration against a fake WHOOP API.
process.env.SESSION_SECRET = "test-secret-for-unit-tests-only";
process.env.WHOOP_CLIENT_ID = "cid";
process.env.WHOOP_CLIENT_SECRET = "csecret";

const { runTool } = await import(new URL("../../lib/tools.js", import.meta.url).href);
const { getToken, authorizeUrl, configured, PROVIDERS, SERVER_PROVIDER } = await import(new URL("../../lib/providers.js", import.meta.url).href);
const { seal } = await import(new URL("../../lib/session.js", import.meta.url).href);

const fails = [];
const check = (name, ok, got) => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  got: " + JSON.stringify(got))); if (!ok) fails.push(name); };

// ---- fake WHOOP API ----
const calls = [];
const page = (records, next) => ({ records, next_token: next || null });
// 30 recoveries so /recovery needs two pages
const recs = Array.from({ length: 30 }, (_, i) => ({
  cycle_id: 1000 + i, sleep_id: `s-${i}`, score_state: "SCORED",
  score: { recovery_score: 40 + i, resting_heart_rate: 50 + (i % 5), hrv_rmssd_milli: 60.456 + i, spo2_percentage: 96.2, skin_temp_celsius: 33.1, user_calibrating: false },
}));
const sleeps = [
  // London winter (+00:00): woke 07:00 UTC on 24 Nov
  { id: "s-0", start: "2026-11-23T23:00:00.000Z", end: "2026-11-24T07:00:00.000Z", timezone_offset: "+00:00", nap: false,
    score: { sleep_performance_percentage: 88, sleep_efficiency_percentage: 91.234, sleep_consistency_percentage: 77,
             stage_summary: { total_in_bed_time_milli: 8 * 3600000, total_awake_time_milli: 30 * 60000 } } },
  // New York (-05:00): woke 03:30 UTC on 23 Nov = 22:30 local on 22 Nov
  { id: "s-1", start: "2026-11-22T20:00:00.000Z", end: "2026-11-23T03:30:00.000Z", timezone_offset: "-05:00", nap: false, score: {} },
];
const cycles = [
  { id: 1000, start: "2026-11-23T23:00:00.000Z", end: null, timezone_offset: "+00:00", score_state: "SCORED", score: { strain: 8.43, kilojoule: 6543.2, average_heart_rate: 66 } },
  { id: 999, start: "2026-11-23T00:30:00.000Z", end: "2026-11-23T23:00:00.000Z", timezone_offset: "+00:00", score_state: "SCORED", score: { strain: 14.06 } },
];
const workouts = [
  { id: "w-uuid-1", sport_name: "running", sport_id: 0, start: "2026-11-24T07:30:00.000Z", end: "2026-11-24T08:15:00.000Z", timezone_offset: "+00:00",
    score_state: "SCORED", score: { strain: 11.27, average_heart_rate: 150, max_heart_rate: 178, kilojoule: 2100.4, percent_recorded: 0.99999, distance_meter: 8000,
    zone_durations: { zone_zero_milli: 60000, zone_one_milli: 300000, zone_two_milli: 900000, zone_three_milli: 1200000, zone_four_milli: 240000, zone_five_milli: 0 } } },
  { id: "w-uuid-2", sport_id: 45, start: "2026-11-22T18:00:00.000Z", end: "2026-11-22T19:00:00.000Z", timezone_offset: "+01:00", score_state: "PENDING_SCORE" },
];

globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), opts });
  const u = new URL(url);
  const json = body => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body });
  if (u.pathname.endsWith("/oauth/oauth2/token")) return json({ access_token: "new-at", refresh_token: "new-rt", expires_in: 3600 });
  if (opts.headers?.authorization !== "Bearer tok") return { ok: false, status: 401, text: async () => "unauth" };
  if (u.pathname === "/developer/v2/recovery") return json(u.searchParams.get("nextToken") === "p2" ? page(recs.slice(25)) : page(recs.slice(0, 25), "p2"));
  if (u.pathname === "/developer/v2/activity/sleep") return json(page(sleeps));
  if (u.pathname === "/developer/v2/cycle") return json(page(cycles));
  if (u.pathname === "/developer/v2/activity/workout") return json(page(workouts));
  return { ok: false, status: 404, text: async () => "nope" };
};

// ---- get_overview ----
const out = await runTool("WHOOP", "get_overview", { days: 35 }, "tok");
const recCalls = calls.filter(c => c.url.includes("/v2/recovery"));
check("recovery collection paged twice via nextToken", recCalls.length === 2 && recCalls[1].url.includes("nextToken=p2"), recCalls.map(c => c.url));
check("collections ask for 25 per page with a start bound", recCalls[0].url.includes("limit=25") && /start=2026|start=20\d\d/.test(recCalls[0].url), recCalls[0].url);
check("all 30 recoveries returned", out.recoveries.length === 30, out.recoveries.length);
const r0 = out.recoveries.find(r => r.sleep_id === "s-0");
check("recovery joined to its sleep → wake_date 2026-11-24", r0.wake_date === "2026-11-24", r0.wake_date);
check("HRV rounded to 0.1 ms", r0.hrv_ms === 60.5, r0.hrv_ms);
check("sleep performance + hours asleep", r0.sleep.performance === 88 && r0.sleep.asleep_h === 7.5 && r0.sleep.in_bed_h === 8, r0.sleep);
const r1 = out.recoveries.find(r => r.sleep_id === "s-1");
check("wake date respects the record's own timezone (NY 22:30 → 22 Nov)", r1.wake_date === "2026-11-22", r1.wake_date);
check("recoveries newest first", out.recoveries[0].wake_date === "2026-11-24", out.recoveries[0].wake_date);
check("undated recoveries sort last, never first", out.recoveries.slice(2).every(r => r.wake_date == null) && out.recoveries[1].wake_date === "2026-11-22", out.recoveries.slice(0,3).map(r => r.wake_date));
const c0 = out.cycles.find(c => c.id === 1000);
check("current cycle (started 23:00) belongs to the day you wake into", c0.day === "2026-11-24" && c0.ongoing === true && c0.strain === 8.4, c0);
check("cycle that started 00:30 belongs to that same day", out.cycles.find(c => c.id === 999).day === "2026-11-23");
const w1 = out.workouts.find(w => w.id === "w-uuid-1");
check("workout: sport name, local start, duration, strain", w1.sport === "running" && w1.start_local === "2026-11-24T07:30:00" && w1.duration_min === 45 && w1.strain === 11.3, w1);
check("workout: zone minutes Z0–Z5", JSON.stringify(w1.zone_min) === "[1,5,15,20,4,0]", w1.zone_min);
check("workout: HR coverage fraction → percent", w1.hr_coverage === 100, w1.hr_coverage);
const w2 = out.workouts.find(w => w.id === "w-uuid-2");
check("unscored workout without sport_name still shaped", w2.sport === "Sport 45" && w2.strain === null && w2.date === "2026-11-22" && w2.start_local === "2026-11-22T19:00:00", w2);

// ---- 401 maps to needs_reauth ----
try { await runTool("WHOOP", "get_overview", {}, "bad"); check("401 → needs_reauth", false, "no throw"); }
catch (e) { check("401 → needs_reauth", e.code === "needs_reauth", e.code); }

// ---- provider config ----
check("WHOOP server maps to whoop provider", SERVER_PROVIDER["WHOOP"] === "whoop" && configured("whoop"));
const au = new URL(authorizeUrl("whoop", { headers: { host: "atlasnew-ten.vercel.app" } }, "state-123456789"));
check("authorize URL + scopes include offline", au.origin + au.pathname === "https://api.prod.whoop.com/oauth/oauth2/auth"
  && au.searchParams.get("scope").split(" ").includes("offline") && au.searchParams.get("scope").includes("read:recovery")
  && au.searchParams.get("redirect_uri") === "https://atlasnew-ten.vercel.app/api/auth/callback", au.toString());

// ---- refresh sends scope=offline (WHOOP) and not for others ----
calls.length = 0;
const expired = seal({ access_token: "old", refresh_token: "rt-1", expires_at: Date.now() - 1000 });
const cookies = [];
const res = { getHeader: () => cookies, setHeader: (k, v) => cookies.push(v) };
const at = await getToken("whoop", { headers: { cookie: `atlas_whoop=${encodeURIComponent(expired)}` } }, res);
const tokCall = calls.find(c => c.url.endsWith("/oauth/oauth2/token"));
const body = new URLSearchParams(tokCall?.opts?.body);
check("expired WHOOP token refreshed", at === "new-at", at);
check("refresh body: grant, refresh_token, client creds, scope=offline",
  body.get("grant_type") === "refresh_token" && body.get("refresh_token") === "rt-1" && body.get("client_id") === "cid"
  && body.get("client_secret") === "csecret" && body.get("scope") === "offline", Object.fromEntries(body));
check("other providers' refresh unchanged (no scope added)", !PROVIDERS.strava.refreshExtra && !PROVIDERS.google.refreshExtra);

console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
