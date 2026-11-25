/* The Android launcher's write endpoint - the four things the phone can do,
   and nothing else:
     {action:"complete_task", id}                 tick a Todoist task
     {action:"archive_email", id}                 archive a Gmail thread (recoverable)
     {action:"book_training", start, end, kind}   add today's training hour
     {action:"move_event", id, start, end}        move a calendar event (the red-day "move to tomorrow")
   Authenticated by the same x-launcher-key as /api/launcher/summary, and
   bounded so a leaked key can't do much: no deletes, no sending, events
   at most 3 hours long and within the next two days. */
import { configured, envVar, getTokenForLauncher } from "../../lib/providers.js";
import { runTool } from "../../lib/tools.js";
import { sameToken } from "../../lib/session.js";

const ID_RX = /^[A-Za-z0-9_-]{3,128}$/;
const H = 3600e3;

function window_(start, end){
  const s = Date.parse(start), e = Date.parse(end), now = Date.now();
  if (!Number.isFinite(s) || !Number.isFinite(e)) return "start and end must be ISO times";
  if (e <= s || e - s > 3 * H) return "an event must be between 1 minute and 3 hours long";
  if (s < now - H || s > now + 48 * H) return "only times within the next two days";
  return null;
}

export default async function handler(req, res){
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: { code: "bad_request" } });
  const key = envVar("LAUNCHER_API_KEY");
  if (!key || !sameToken(req.headers["x-launcher-key"], key)) return res.status(401).json({ error: { code: "unauthorized" } });

  let body = req.body;
  if (typeof body === "string"){ try{ body = JSON.parse(body); }catch(_){ body = null; } }
  const action = String(body?.action || "");
  const bad = message => res.status(400).json({ error: { code: "bad_request", message } });
  const token = async p => configured(p) ? getTokenForLauncher(p).catch(() => null) : null;
  const notConnected = name => res.status(200).json({ error: { code: "server_not_connected", message: `${name} isn't connected` } });

  try{
    if (action === "complete_task"){
      if (!ID_RX.test(String(body.id || ""))) return bad("task id required");
      const t = await token("todoist"); if (!t) return notConnected("Todoist");
      await runTool("Todoist", "complete-tasks", { ids: [String(body.id)] }, t);
      return res.json({ ok: true, message: "Done." });
    }
    if (action === "archive_email"){
      if (!ID_RX.test(String(body.id || ""))) return bad("thread id required");
      const t = await token("google"); if (!t) return notConnected("Gmail");
      await runTool("Gmail", "unlabel_thread", { threadId: String(body.id), labelIds: ["INBOX"] }, t);
      return res.json({ ok: true, message: "Archived." });
    }
    if (action === "book_training"){
      const err = window_(body.start, body.end); if (err) return bad(err);
      const kind = body.kind === "hard" ? "hard" : "moderate";
      const t = await token("google"); if (!t) return notConnected("Google Calendar");
      const r = await runTool("Google Calendar", "create_event", { summary: `Training — ${kind} session`,
        description: "Booked from the Atlas launcher.", startTime: new Date(body.start).toISOString(),
        endTime: new Date(body.end).toISOString() }, t);
      return res.json({ ok: true, id: r.id || null, message: "Booked." });
    }
    if (action === "move_event"){
      if (!ID_RX.test(String(body.id || ""))) return bad("event id required");
      const err = window_(body.start, body.end); if (err) return bad(err);
      const t = await token("google"); if (!t) return notConnected("Google Calendar");
      await runTool("Google Calendar", "update_event", { eventId: String(body.id),
        startTime: new Date(body.start).toISOString(), endTime: new Date(body.end).toISOString() }, t);
      return res.json({ ok: true, message: "Moved." });
    }
    return bad("unknown action");
  }catch(e){
    return res.status(200).json({ error: { code: e.code || "upstream_error", message: String(e.message).slice(0, 200) } });
  }
}
