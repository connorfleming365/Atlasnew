/* The real replacement for the regex command-matcher: every utterance
   goes to Claude with tool access to this deployment's own connector
   actions, plus a fresh snapshot of the day as context. The previous
   rule-based brain is preserved as-is on the `checkpoint/regex-brain-v1`
   branch and still runs automatically wherever there's no backend to
   call Claude from (the claude.ai artifact, or a plain file). */
import { envVar, SERVER_PROVIDER, configured as providerConfigured, getToken } from "./providers.js";
import { runTool } from "./tools.js";

const MODEL = envVar("ANTHROPIC_MODEL") || "claude-haiku-4-5-20251001";
export const brainConfigured = () => Boolean(envVar("ANTHROPIC_API_KEY"));

const SYSTEM = `You are Atlas, a personal daily-operations agent. Your one user talks to you by \
voice or text, and you have live tool access to their Gmail, Google Calendar, Todoist and Strava. \
A snapshot of their current day is included below the tools — read it before asking them anything \
you could answer from it yourself.

Reply the way you'd actually talk out loud: a sentence or two, direct and warm, never a bulleted \
report. Never invent a fact, an id, or a data point about their tasks, email, calendar or training \
that you weren't given or a tool didn't return — say plainly that you don't have it instead. That \
rule is about their personal data specifically. For anything else — a general question, something \
conversational, a topic that has nothing to do with their day — just answer it normally like you \
otherwise would, then move on; you don't need to redirect back to tasks/email/calendar unless it's \
actually relevant.

Before archiving or deleting an email, or deleting a calendar event, say what you're about to do \
in one short sentence and wait for their next reply — unless they've already clearly confirmed it \
earlier in this conversation. Every other action — adding a task, rescheduling one, creating a \
focus block, reading an email aloud — you can just do without asking first.`;

const TOOLS = [
  { name:"add_task", description:"Create a new Todoist task.",
    input_schema:{ type:"object", properties:{
      content:{ type:"string" },
      due:{ type:"string", description:"Natural-language due date such as 'today', 'tomorrow', 'friday'. Defaults to today when omitted, so it shows up on the day's task list." },
    }, required:["content"] } },
  { name:"complete_task", description:"Mark an existing task done by its id.",
    input_schema:{ type:"object", properties:{ task_id:{type:"string"} }, required:["task_id"] } },
  { name:"reschedule_task", description:"Move an existing task to a new date.",
    input_schema:{ type:"object", properties:{
      task_id:{type:"string"}, date:{type:"string", description:"YYYY-MM-DD"},
    }, required:["task_id","date"] } },
  { name:"read_email", description:"Fetch the full body of an email thread, to summarise or read aloud.",
    input_schema:{ type:"object", properties:{ thread_id:{type:"string"} }, required:["thread_id"] } },
  { name:"archive_email", description:"Archive an email thread — removes it from the inbox, fully recoverable.",
    input_schema:{ type:"object", properties:{ thread_id:{type:"string"} }, required:["thread_id"] } },
  { name:"delete_email", description:"Move an email thread to Trash, recoverable there for 30 days.",
    input_schema:{ type:"object", properties:{ thread_id:{type:"string"} }, required:["thread_id"] } },
  { name:"create_calendar_event", description:"Create a calendar event — e.g. a focus block for a task.",
    input_schema:{ type:"object", properties:{
      summary:{type:"string"}, start_iso:{type:"string"}, end_iso:{type:"string"},
    }, required:["summary","start_iso","end_iso"] } },
  { name:"delete_calendar_event", description:"Delete a calendar event by id — e.g. to undo a focus block.",
    input_schema:{ type:"object", properties:{ event_id:{type:"string"} }, required:["event_id"] } },
];

async function callProvider(server, tool, input, req, res){
  const provider = SERVER_PROVIDER[server];
  if (!providerConfigured(provider)) throw new Error(`${server} isn't configured on this deployment`);
  const token = await getToken(provider, req, res);
  if (!token) throw new Error(`${server} isn't connected yet`);
  return runTool(server, tool, input, token);
}

/* Read-only, best-effort: one connector being down shouldn't blank the
   whole snapshot, so each read fails into its own line instead of
   throwing — the same per-section containment the dashboard itself uses. */
async function safeRead(server, tool, input, req, res){
  try{ return { ok:true, payload: await callProvider(server, tool, input, req, res) }; }
  catch(e){ return { ok:false, reason: e.message || "unavailable" }; }
}

// No per-user timezone is known server-side, so "today" is the server's
// own UTC date — the same pragmatic choice already made for voice-added
// tasks defaulting to "today" elsewhere in this app.
const todayKey = () => new Date().toISOString().slice(0,10);

async function buildContext(req, res){
  const now = new Date();
  const d0 = new Date(now); d0.setUTCHours(0,0,0,0);
  const d1 = new Date(d0); d1.setUTCDate(d1.getUTCDate()+2);
  const [cal, tasks, mail, acts] = await Promise.all([
    safeRead("Google Calendar","list_events",
      {startTime:d0.toISOString(), endTime:d1.toISOString(), orderBy:"startTime", pageSize:50}, req, res),
    safeRead("Todoist","find-tasks-by-date", {startDate:"today", limit:50}, req, res),
    safeRead("Gmail","search_threads", {query:"in:inbox newer_than:2d", pageSize:20}, req, res),
    safeRead("Strava","list_activities", {first:10}, req, res),
  ]);

  const lines = [`Current UTC date/time: ${now.toISOString()}`];

  if (cal.ok){
    const evs = (cal.payload.events||[]).map(e=>
      `- [event_id ${e.id}] ${e.summary||"(untitled)"}: ${e.start?.dateTime||e.start?.date} to ${
        e.end?.dateTime||e.end?.date}${e.location?` at ${e.location}`:""}`);
    lines.push(`\nCALENDAR (today & tomorrow):\n${evs.length ? evs.join("\n") : "Nothing scheduled."}`);
  } else lines.push(`\nCALENDAR: unavailable (${cal.reason}).`);

  if (tasks.ok){
    const tk = todayKey();
    const open = (tasks.payload.tasks||[]).filter(t=>!t.checked).map(t=>{
      const due = (t.dueDate||t.deadlineDate||"").slice(0,10);
      const tag = due && due < tk ? "OVERDUE" : due===tk ? "DUE TODAY" : due ? `due ${due}` : "no date";
      return `- [task_id ${t.id}] (${tag}${t.priority && t.priority!=="p4" ? ", "+t.priority.toUpperCase() : ""}) ${t.content}`;
    });
    lines.push(`\nTASKS:\n${open.length ? open.join("\n") : "Nothing open."}`);
  } else lines.push(`\nTASKS: unavailable (${tasks.reason}).`);

  if (mail.ok){
    const items = (mail.payload.threads||[]).map(t=>{
      const m = (t.messages||[]).slice(-1)[0] || {};
      const unread = (m.labelIds||[]).includes("UNREAD");
      return `- [thread_id ${t.id}]${unread?" UNREAD":""} "${m.subject||"(no subject)"}" from ${
        (m.sender||"").replace(/<.*>/,"").trim()}: ${(m.snippet||"").slice(0,140)}`;
    });
    lines.push(`\nINBOX (last 48h):\n${items.length ? items.join("\n") : "Empty."}`);
  } else lines.push(`\nINBOX: unavailable (${mail.reason}).`);

  if (acts.ok){
    const a = (acts.payload.activities||[])[0];
    lines.push(`\nTRAINING: ${acts.payload.activities?.length||0} recent activities.` +
      (a ? ` Last: ${a.name} (${a.sport_type}) on ${a.start_local}${
        a.summary?.distance ? `, ${(a.summary.distance/1000).toFixed(1)}km` : ""}.` : ""));
  } else lines.push(`\nTRAINING: unavailable (${acts.reason}).`);

  return lines.join("\n");
}

async function execTool(name, input, req, res){
  try{
    switch(name){
      case "add_task": {
        const r = await callProvider("Todoist","add-tasks",
          { tasks:[{ content:input.content, projectId:"inbox", dueString: input.due || "today" }] }, req, res);
        return `Created task ${r.tasks?.[0]?.id || ""} "${input.content}", due ${input.due || "today"}.`;
      }
      case "complete_task":
        await callProvider("Todoist","complete-tasks", { ids:[input.task_id] }, req, res);
        return `Task ${input.task_id} marked complete.`;
      case "reschedule_task":
        await callProvider("Todoist","reschedule-tasks",
          { tasks:[{ id:input.task_id, date:input.date }] }, req, res);
        return `Task ${input.task_id} moved to ${input.date}.`;
      case "read_email": {
        const r = await callProvider("Gmail","get_thread",
          { threadId:input.thread_id, messageFormat:"FULL_CONTENT" }, req, res);
        const msg = (r.messages||[]).slice(-1)[0] || {};
        let text = msg.plaintextBody || "";
        if (!text && msg.htmlBody) text = msg.htmlBody.replace(/<[^>]+>/g," ");
        text = text.replace(/\s+/g," ").trim().slice(0, 1200);
        return `From ${msg.sender}. Subject: ${msg.subject}. Body: ${text || msg.snippet || "(empty)"}`;
      }
      case "archive_email":
        await callProvider("Gmail","unlabel_thread", { threadId:input.thread_id, labelIds:["INBOX"] }, req, res);
        return `Archived thread ${input.thread_id}.`;
      case "delete_email":
        await callProvider("Gmail","apply_sensitive_thread_label",
          { threadId:input.thread_id, labelOption:"TRASH" }, req, res);
        return `Moved thread ${input.thread_id} to Trash — recoverable there for 30 days.`;
      case "create_calendar_event": {
        const r = await callProvider("Google Calendar","create_event",
          { summary:input.summary, startTime:input.start_iso, endTime:input.end_iso, notificationLevel:"NONE" }, req, res);
        return `Created event ${r.id || ""} "${input.summary}", ${input.start_iso} to ${input.end_iso}.`;
      }
      case "delete_calendar_event":
        await callProvider("Google Calendar","delete_event",
          { eventId:input.event_id, notificationLevel:"NONE" }, req, res);
        return `Deleted event ${input.event_id}.`;
      default:
        return `No such tool: ${name}.`;
    }
  }catch(e){
    // Handed back to Claude as the tool's own result, not thrown — let it
    // explain the failure conversationally instead of a static error string.
    return `Tool failed: ${e.message || "unknown error"}. Explain this to the user in one plain sentence.`;
  }
}

/**
 * `history` is the full prior Anthropic `messages` array (including any
 * tool_use/tool_result turns), verbatim, as this function last returned
 * it — the client stores and resends it unmodified. There is no server-
 * side session store; conversational memory lives entirely in that
 * round-trip, which is why it's capped and periodically reset below
 * rather than trimmed mid-sequence (trimming risks breaking the strict
 * user/assistant alternation the API requires).
 */
export async function converse({ message, history }, req, res){
  if (!brainConfigured())
    return { error:{ code:"not_configured", message:"ANTHROPIC_API_KEY is not set on this deployment." } };

  const context = await buildContext(req, res);
  const messages = Array.isArray(history) && history.length <= 40 ? history.slice() : [];
  messages.push({ role:"user", content: message });

  let guard = 0;
  while (guard++ < 5){
    let r;
    try{
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{
          "content-type":"application/json",
          "x-api-key": envVar("ANTHROPIC_API_KEY"),
          "anthropic-version":"2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL, max_tokens: 600,
          system: `${SYSTEM}\n\nCurrent snapshot of the user's day:\n${context}`,
          tools: TOOLS, messages,
        }),
      });
    }catch(_){
      return { error:{ code:"server_unavailable", message:"couldn't reach the Anthropic API", retryable:true } };
    }
    const j = await r.json().catch(()=>null);
    if (!r.ok || !j || j.type === "error")
      return { error:{ code: r.status===401 ? "needs_reauth" : r.status===429 ? "server_unavailable" : "upstream_error",
        message: j?.error?.message || `HTTP ${r.status}`, retryable: r.status===429 } };

    messages.push({ role:"assistant", content: j.content });
    const toolUses = (j.content||[]).filter(b => b.type === "tool_use");
    if (!toolUses.length){
      const text = (j.content||[]).filter(b => b.type === "text").map(b => b.text).join(" ").trim();
      return { reply: text || "…", history: messages };
    }
    const results = [];
    for (const tu of toolUses)
      results.push({ type:"tool_result", tool_use_id: tu.id,
        content: String(await execTool(tu.name, tu.input || {}, req, res)).slice(0, 2000) });
    messages.push({ role:"user", content: results });
  }
  return { reply:"That took more steps than I'm allowed to chain together — try asking more simply.",
    history: messages };
}
