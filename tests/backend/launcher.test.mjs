// The Android launcher's summary: every section from a fake runTool, the old
// fields kept for older builds, and a failing provider leaving only its own
// section empty.
process.env.SESSION_SECRET = "test-secret-for-unit-tests-only";
process.env.LAUNCHER_API_KEY = "launch-key";
const mod = await import(new URL("../../api/launcher/summary.js", import.meta.url).href);
const { buildSummary } = mod;

const fails = [];
const check = (name, ok, got) => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  got: " + JSON.stringify(got))); if (!ok) fails.push(name); };

const today = "2026-11-26";   // a Thursday
const fake = (overrides = {}) => async (server, tool, input) => {
  const k = `${server}/${tool}`;
  if (overrides[k]) return overrides[k](input);
  if (k === "Google Calendar/list_events") return { events: [
    { id: "e1", summary: "Standup", start: { dateTime: "2026-11-26T09:30:00Z" }, end: { dateTime: "2026-11-26T09:45:00Z" }, location: "Room 4", htmlLink: "https://cal/e1" },
    { id: "e2", summary: "Holiday", start: { date: "2026-11-26" }, end: { date: "2026-11-27" } } ] };
  if (k === "Gmail/search_threads") return { threads: [
    { id: "t1", messages: [{ sender: '"Sam Lee" <sam@x.com>', subject: "Contract", labelIds: ["UNREAD"], date: "Thu, 26 Nov 2026 08:00:00 +0000" }] },
    { id: "t2", messages: [{ sender: "Boss <b@x.com>", subject: "Urgent", labelIds: ["UNREAD", "IMPORTANT"] }] },
    { id: "t3", messages: [{ sender: "News <n@x.com>", subject: "Digest", labelIds: [] }] } ] };
  if (k === "Todoist/find-tasks-by-date") return input.overdueOption === "overdue-only"
    ? { tasks: [{ id: "o1" }, { id: "o2" }] }
    : { tasks: [{ id: "a", content: "Send invoice", priority: "p1", dueDate: "2026-11-26T15:00:00" }] };
  if (k === "WHOOP/get_overview") return {
    recoveries: [
      { wake_date: "2026-11-26", score_state: "SCORED", recovery_score: 28, hrv_ms: 41.6, resting_hr: 61, sleep: { asleep_h: 5.9 } },
      ...[25, 24, 23, 22, 21].map(d => ({ wake_date: `2026-11-${d}`, score_state: "SCORED", recovery_score: 70, hrv_ms: 60 })) ],
    workouts: [
      { date: "2026-11-23", duration_min: 60 }, { date: "2026-11-25", duration_min: 30 },   // this week (Mon 23 →)
      { date: "2026-11-17", duration_min: 45 }, { date: "2026-11-21", duration_min: 90 } ] }; // last week: Tue counts, Sat is after "same point"
  if (k === "Strava/list_activities") return { activities: [{ start_local: "2026-11-24T07:00:00", summary: { moving_time: 3600, distance: 10000 } }] };
  throw new Error("unexpected " + k);
};
const tokens = { google: "g", todoist: "t", whoop: "w", strava: "s" };
const args = { start: "2026-11-26T00:00:00Z", end: "2026-11-27T00:00:00Z", today };

let s = await buildSummary({ tokens, ...args, run: fake() });
check("events keep the old time field and add start/end/allDay", s.todayEvents[0].time === "2026-11-26T09:30:00Z"
      && s.todayEvents[0].end === "2026-11-26T09:45:00Z" && !s.todayEvents[0].allDay && s.todayEvents[1].allDay
      && s.todayEvents[0].location === "Room 4", s.todayEvents);
check("tasks and overdue count unchanged in shape", s.todayTasks[0].title === "Send invoice" && s.todayTasks[0].priority === "p1"
      && s.todayTasks[0].due === "2026-11-26T15:00:00" && s.overdueTaskCount === 2, s);
check("inbox: 3 threads, 2 unread, 1 important; important first, sender cleaned",
      s.inbox.total === 3 && s.inbox.unread === 2 && s.inbox.important === 1 && s.inbox.items[0].subject === "Urgent"
      && s.inbox.items[1].from === "Sam Lee" && s.inbox.items.length === 2, s.inbox);
check("readiness: 28% red, HRV 42 (−18 vs base), RHR, sleep", s.readiness.score === 28 && s.readiness.band === "red"
      && s.readiness.hrv === 42 && s.readiness.hrvDelta === -18 && s.readiness.rhr === 61 && s.readiness.sleepHours === 5.9, s.readiness);
check("readiness trend oldest → newest", s.readiness.trend.length === 6 && s.readiness.trend.at(-1).score === 28, s.readiness.trend);
check("training from WHOOP (preferred over Strava): 2 sessions / 90 min vs 1 / 45",
      s.training.source === "WHOOP" && s.training.sessions === 2 && s.training.minutes === 90
      && s.training.lastSessions === 1 && s.training.lastMinutes === 45 && !s.training.trainedToday, s.training);

// no WHOOP → Strava fills training; no score today → lastScore
s = await buildSummary({ tokens: { ...tokens, whoop: null }, ...args, run: fake() });
check("no WHOOP: training from Strava", s.training.source === "Strava" && s.training.sessions === 1 && s.training.minutes === 60 && s.training.km === 10, s.training);
check("no WHOOP: readiness null", s.readiness === null, s.readiness);
s = await buildSummary({ tokens, ...args, today: "2026-11-27", run: fake() });
check("no score today: score null, last score kept", s.readiness.score === null && s.readiness.lastScore === 28 && s.readiness.lastDay === "2026-11-26", s.readiness);

// one provider failing leaves the rest
s = await buildSummary({ tokens, ...args, run: fake({ "Gmail/search_threads": () => { throw new Error("boom"); } }) });
check("Gmail failing → inbox null, everything else present", s.inbox === null && s.todayEvents.length === 2 && s.readiness.score === 28, s);
s = await buildSummary({ tokens: {}, ...args, run: fake() });
check("nothing connected → empty, never throws", s.todayEvents.length === 0 && s.inbox === null && s.training === null, s);

// handler: auth and day bounds
const res = () => { const r = { headers: {}, code: 200, body: null };
  r.setHeader = (k, v) => r.headers[k] = v; r.status = c => (r.code = c, r); r.json = b => (r.body = b, r); return r; };
let r = res(); await mod.default({ method: "GET", headers: {}, query: {} }, r);
check("no key → 401", r.code === 401, r.code);
r = res(); await mod.default({ method: "GET", headers: { "x-launcher-key": "launch-key" },
  query: { dayStart: "2026-11-25T23:00:00Z", dayEnd: "2026-11-26T23:00:00Z" } }, r);
check("right key → 200, today derived from the middle of the caller's day", r.code === 200 && r.body.today === "2026-11-26", r.body);

console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
