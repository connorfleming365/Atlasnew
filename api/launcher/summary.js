/* Compact dashboard data for the Android launcher's home-screen card -
   today's calendar events and today's tasks, as small lists rather than
   just a single "next" item. Authenticated by a static shared secret
   (LAUNCHER_API_KEY) rather than the browser's cookie session: the
   launcher has no cookie jar, so it reads the server-side token copy
   lib/tokenStore.js keeps (see getTokenForLauncher in lib/providers.js)
   instead of the one sealed into the dashboard's own cookies. */
import { configured, envVar, getTokenForLauncher } from "../../lib/providers.js";
import { runTool } from "../../lib/tools.js";

const MAX_EVENTS = 6;
const MAX_TASKS = 8;

function authorized(req){
  const key = envVar("LAUNCHER_API_KEY");
  if (!key) return false;
  return req.headers["x-launcher-key"] === key;
}

// "Today" has to be the caller's local day, not the server's (Vercel
// functions run in UTC) - the Android client computes and sends its own
// device-local midnight-to-midnight bounds. Falls back to the server's UTC
// day if a client ever omits them (defensive, not the expected path).
function dayBounds(req){
  const { dayStart, dayEnd } = req.query;
  if (dayStart && dayEnd) return { start: dayStart, end: dayEnd };
  const now = new Date();
  const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
  const end = new Date(now); end.setUTCHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

export default async function handler(req, res){
  res.setHeader("cache-control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: { code: "bad_request" } });
  if (!authorized(req)) return res.status(401).json({ error: { code: "unauthorized" } });

  const { start, end } = dayBounds(req);

  const [calendarToken, taskToken] = await Promise.all([
    configured("google") ? getTokenForLauncher("google") : null,
    configured("todoist") ? getTokenForLauncher("todoist") : null,
  ]);

  let todayEvents = [];
  if (calendarToken){
    try{
      const { events } = await runTool("Google Calendar", "list_events", {
        startTime: start,
        endTime: end,
        pageSize: MAX_EVENTS,
      }, calendarToken);
      todayEvents = (events || []).slice(0, MAX_EVENTS).map(e => ({
        title: e.summary || "(untitled)",
        time: e.start?.dateTime || e.start?.date || null,
        link: e.htmlLink || null,
      }));
    }catch(_){ /* leave empty - the launcher shows "no data" rather than erroring */ }
  }

  let todayTasks = [], overdueTaskCount = 0;
  if (taskToken){
    try{
      const [today, overdue] = await Promise.all([
        runTool("Todoist", "find-tasks-by-date",
          { startDate: "today", overdueOption: "exclude-overdue", limit: MAX_TASKS }, taskToken),
        runTool("Todoist", "find-tasks-by-date",
          { startDate: "today", overdueOption: "overdue-only", limit: 100 }, taskToken),
      ]);
      todayTasks = (today.tasks || []).slice(0, MAX_TASKS).map(t => ({
        id: t.id,
        title: t.content,
        priority: t.priority || null,
        link: `https://todoist.com/app/task/${t.id}`,
      }));
      overdueTaskCount = overdue.tasks?.length || 0;
    }catch(_){ /* same - degrade to no data instead of a broken home screen */ }
  }

  res.json({ todayEvents, todayTasks, overdueTaskCount });
}
