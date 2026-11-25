/* Compact dashboard data for the Android launcher's home screen - the same
   picture the web dashboard's flight deck shows: today's events (with start
   and end, for the Day Line), today's tasks, inbox load, WHOOP readiness and
   the training week. Authenticated by a static shared secret
   (LAUNCHER_API_KEY) rather than the browser's cookie session: the
   launcher has no cookie jar, so it reads the server-side token copy
   lib/tokenStore.js keeps (see getTokenForLauncher in lib/providers.js)
   instead of the one sealed into the dashboard's own cookies.

   Every section is optional: a provider that isn't connected, or fails,
   leaves its section null and the launcher shows that tile as unavailable.
   The older fields (todayEvents[].time, todayTasks, overdueTaskCount) keep
   their shape, so an older launcher build keeps working. */
import { configured, envVar, getTokenForLauncher } from "../../lib/providers.js";
import { runTool } from "../../lib/tools.js";

const MAX_EVENTS = 12;
const MAX_TASKS = 8;
const MAX_MAIL = 5;

function authorized(req){
  const key = envVar("LAUNCHER_API_KEY");
  if (!key) return false;
  return req.headers["x-launcher-key"] === key;
}

// "Today" has to be the caller's local day, not the server's (Vercel
// functions run in UTC) - the Android client computes and sends its own
// device-local midnight-to-midnight bounds, and its local date. Falls back
// to the server's UTC day if a client ever omits them.
function dayBounds(query){
  const { dayStart, dayEnd, today } = query || {};
  // the local date is the one at the middle of the caller's day
  if (dayStart && dayEnd) return { start: dayStart, end: dayEnd,
    today: today || new Date((Date.parse(dayStart) + Date.parse(dayEnd)) / 2).toISOString().slice(0, 10) };
  const now = new Date();
  const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
  const end = new Date(now); end.setUTCHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString(), today: today || start.toISOString().slice(0, 10) };
}

// YYYY-MM-DD arithmetic on plain dates, independent of the server's zone
const addDays = (ymd, n) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = ymd => { const dow = (new Date(ymd + "T12:00:00Z").getUTCDay() + 6) % 7; return addDays(ymd, -dow); };
const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const band = s => s >= 67 ? "green" : s >= 34 ? "yellow" : "red";
const safe = async fn => { try{ return await fn(); }catch(_){ return null; } };

/* The whole response, from tokens to JSON - separated from the handler so
   tests can drive it with a fake runTool. */
export async function buildSummary({ tokens, start, end, today, run = runTool }){
  const out = { todayEvents: [], todayTasks: [], overdueTaskCount: 0,
                inbox: null, readiness: null, training: null, today };

  const jobs = [];

  if (tokens.google){
    jobs.push(safe(async () => {
      const { events } = await run("Google Calendar", "list_events",
        { startTime: start, endTime: end, pageSize: MAX_EVENTS }, tokens.google);
      out.todayEvents = (events || []).slice(0, MAX_EVENTS).map(e => ({
        id: e.id || null,
        title: e.summary || "(untitled)",
        time: e.start?.dateTime || e.start?.date || null,       // kept for older launchers
        start: e.start?.dateTime || e.start?.date || null,
        end: e.end?.dateTime || e.end?.date || null,
        allDay: !e.start?.dateTime,
        location: e.location || null,
        link: e.htmlLink || null,
      }));
    }));
    jobs.push(safe(async () => {
      const { threads } = await run("Gmail", "search_threads",
        { query: "in:inbox newer_than:2d", pageSize: 20 }, tokens.google);
      const items = (threads || []).map(t => {
        const m = t.messages?.[t.messages.length - 1] || {};
        const labels = m.labelIds || [];
        return { id: t.id, from: String(m.sender || "").replace(/<.*>/, "").replace(/"/g, "").trim() || "(unknown)",
                 subject: m.subject || "(no subject)", unread: labels.includes("UNREAD"),
                 important: labels.includes("IMPORTANT"), date: m.date ? new Date(m.date).toISOString() : null,
                 link: `https://mail.google.com/mail/u/0/#inbox/${t.id}` };
      });
      out.inbox = {
        total: items.length,
        unread: items.filter(i => i.unread).length,
        important: items.filter(i => i.unread && i.important).length,
        items: items.filter(i => i.unread).sort((a, b) => b.important - a.important).slice(0, MAX_MAIL),
      };
    }));
  }

  if (tokens.todoist){
    jobs.push(safe(async () => {
      const [due, overdue] = await Promise.all([
        run("Todoist", "find-tasks-by-date",
          { startDate: "today", overdueOption: "exclude-overdue", limit: MAX_TASKS }, tokens.todoist),
        run("Todoist", "find-tasks-by-date",
          { startDate: "today", overdueOption: "overdue-only", limit: 100 }, tokens.todoist),
      ]);
      out.todayTasks = (due.tasks || []).slice(0, MAX_TASKS).map(t => ({
        id: t.id, title: t.content, priority: t.priority || null, due: t.dueDate || null,
        link: `https://todoist.com/app/task/${t.id}`,
      }));
      out.overdueTaskCount = overdue.tasks?.length || 0;
    }));
  }

  const mon = mondayOf(today), lastMon = addDays(mon, -7), lastSame = addDays(today, -7);

  if (tokens.whoop){
    jobs.push(safe(async () => {
      const w = await run("WHOOP", "get_overview", { days: 21 }, tokens.whoop);
      const scored = (w.recoveries || []).filter(r => r.score_state === "SCORED" && r.recovery_score != null && r.wake_date);
      const latest = scored[0] || null, r = latest && latest.wake_date === today ? latest : null;
      const base = scored.slice(1, 31);
      const hrvBase = base.filter(x => x.hrv_ms != null).length >= 4 ? avg(base.map(x => x.hrv_ms).filter(x => x != null)) : null;
      out.readiness = r ? {
        score: r.recovery_score, band: band(r.recovery_score),
        hrv: r.hrv_ms != null ? Math.round(r.hrv_ms) : null,
        hrvDelta: r.hrv_ms != null && hrvBase != null ? Math.round(r.hrv_ms - hrvBase) : null,
        rhr: r.resting_hr ?? null, sleepHours: r.sleep?.asleep_h ?? null,
        trend: scored.slice(0, 7).reverse().map(x => ({ day: x.wake_date, score: x.recovery_score })),
      } : { score: null, lastScore: latest?.recovery_score ?? null, lastDay: latest?.wake_date ?? null, trend: [] };
      const span = (a, b) => (w.workouts || []).filter(x => x.date && x.date >= a && x.date <= b);
      const tw = span(mon, today), lw = span(lastMon, lastSame);
      const mins = xs => xs.reduce((t, x) => t + (x.duration_min || 0), 0);
      out.training = { source: "WHOOP", sessions: tw.length, minutes: mins(tw), lastSessions: lw.length, lastMinutes: mins(lw),
                       trainedToday: tw.some(x => x.date === today && (x.duration_min || 0) >= 20) };
    }));
  }
  if (tokens.strava){
    jobs.push(safe(async () => {
      const { activities } = await run("Strava", "list_activities", { first: 30 }, tokens.strava);
      if (out.training) return;                      // WHOOP already answered
      const day = a => String(a.start_local || "").slice(0, 10);
      const span = (a, b) => (activities || []).filter(x => day(x) >= a && day(x) <= b);
      const tw = span(mon, today), lw = span(lastMon, lastSame);
      const mins = xs => Math.round(xs.reduce((t, x) => t + (x.summary?.moving_time || 0), 0) / 60);
      out.training = { source: "Strava", sessions: tw.length, minutes: mins(tw), lastSessions: lw.length, lastMinutes: mins(lw),
                       km: Math.round(tw.reduce((t, x) => t + (x.summary?.distance || 0), 0) / 100) / 10,
                       trainedToday: tw.some(x => day(x) === today && (x.summary?.moving_time || 0) >= 1200) };
    }));
  }

  await Promise.all(jobs);
  return out;
}

export default async function handler(req, res){
  res.setHeader("cache-control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: { code: "bad_request" } });
  if (!authorized(req)) return res.status(401).json({ error: { code: "unauthorized" } });

  const { start, end, today } = dayBounds(req.query);
  const tok = p => configured(p) ? getTokenForLauncher(p).catch(() => null) : null;
  const [google, todoist, whoop, strava] = await Promise.all(["google", "todoist", "whoop", "strava"].map(tok));
  res.json(await buildSummary({ tokens: { google, todoist, whoop, strava }, start, end, today }));
}
