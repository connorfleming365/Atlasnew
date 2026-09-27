/* Compact dashboard data for the Android launcher's home-screen card - next
   calendar event, top task, overdue count. Authenticated by a static shared
   secret (LAUNCHER_API_KEY) rather than the browser's cookie session: the
   launcher has no cookie jar, so it reads the server-side token copy
   lib/tokenStore.js keeps (see getTokenForLauncher in lib/providers.js)
   instead of the one sealed into the dashboard's own cookies. */
import { configured, envVar, getTokenForLauncher } from "../../lib/providers.js";
import { runTool } from "../../lib/tools.js";

function authorized(req){
  const key = envVar("LAUNCHER_API_KEY");
  if (!key) return false;
  return req.headers["x-launcher-key"] === key;
}

export default async function handler(req, res){
  res.setHeader("cache-control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: { code: "bad_request" } });
  if (!authorized(req)) return res.status(401).json({ error: { code: "unauthorized" } });

  const [calendarToken, taskToken] = await Promise.all([
    configured("google") ? getTokenForLauncher("google") : null,
    configured("todoist") ? getTokenForLauncher("todoist") : null,
  ]);

  let nextEventTitle = null, nextEventTime = null, nextEventLink = null;
  if (calendarToken){
    try{
      const now = new Date();
      const dayAhead = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const { events } = await runTool("Google Calendar", "list_events", {
        startTime: now.toISOString(),
        endTime: dayAhead.toISOString(),
        pageSize: 1,
      }, calendarToken);
      const next = events?.[0];
      if (next){
        nextEventTitle = next.summary || null;
        nextEventTime = next.start?.dateTime || next.start?.date || null;
        nextEventLink = next.htmlLink || null;
      }
    }catch(_){ /* leave nulls - the launcher shows "no data" rather than erroring */ }
  }

  let topTaskTitle = null, overdueTaskCount = 0;
  if (taskToken){
    try{
      const [today, overdue] = await Promise.all([
        runTool("Todoist", "find-tasks-by-date",
          { startDate: "today", overdueOption: "exclude-overdue", limit: 1 }, taskToken),
        runTool("Todoist", "find-tasks-by-date",
          { startDate: "today", overdueOption: "overdue-only", limit: 100 }, taskToken),
      ]);
      topTaskTitle = today.tasks?.[0]?.content || null;
      overdueTaskCount = overdue.tasks?.length || 0;
    }catch(_){ /* same - degrade to no data instead of a broken home screen */ }
  }

  res.json({ nextEventTitle, nextEventTime, nextEventLink, topTaskTitle, overdueTaskCount });
}
