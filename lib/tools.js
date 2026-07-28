/* Provider REST calls mapped back into the payload shapes the claude.ai
   connectors return. The dashboard is written against those shapes, so
   matching them here is what lets one index.html serve both modes with
   no forked front-end. */

class ToolError extends Error {
  constructor(code, message){ super(message); this.code = code; }
}
const bad = (code, msg) => { throw new ToolError(code, msg); };

async function call(url, token, opts = {}){
  const r = await fetch(url, {
    ...opts,
    headers: {
      authorization: `Bearer ${token}`,
      ...(opts.body ? { "content-type": "application/json" } : {}),
      ...(opts.headers || {}),
    },
  });
  if (r.status === 401 || r.status === 403) bad("needs_reauth", `upstream ${r.status}`);
  if (r.status === 429) bad("server_unavailable", "rate limited upstream");
  if (r.status >= 500) bad("server_unavailable", `upstream ${r.status}`);
  if (!r.ok) bad("tool_error", `${r.status}: ${(await r.text()).slice(0, 300)}`);
  if (r.status === 204) return {};
  const text = await r.text();
  return text ? JSON.parse(text) : {};
}

/* ---------------- Gmail ---------------- */
const G = "https://gmail.googleapis.com/gmail/v1/users/me";
const header = (m, name) =>
  (m.payload?.headers || []).find(h => h.name.toLowerCase() === name)?.value || "";

function walkParts(part, out = { text: "", html: "" }){
  if (!part) return out;
  const data = part.body?.data;
  if (data){
    const decoded = Buffer.from(data, "base64url").toString("utf8");
    if (part.mimeType === "text/plain") out.text += decoded;
    else if (part.mimeType === "text/html") out.html += decoded;
  }
  for (const p of part.parts || []) walkParts(p, out);
  return out;
}

const gmail = {
  async search_threads(token, input){
    const q = new URLSearchParams({
      q: input?.query || "in:inbox",
      maxResults: String(Math.min(input?.pageSize || 20, 50)),
    });
    const list = await call(`${G}/threads?${q}`, token);
    const threads = await Promise.all((list.threads || []).map(async t => {
      const full = await call(
        `${G}/threads/${t.id}?format=metadata` +
        `&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, token);
      return {
        id: t.id,
        messages: (full.messages || []).map(m => ({
          id: m.id,
          sender: header(m, "from"),
          subject: header(m, "subject"),
          snippet: m.snippet || "",
          date: header(m, "date"),
          labelIds: m.labelIds || [],
        })),
      };
    }));
    return { threads, resultCountEstimate: String(threads.length) };
  },

  async get_thread(token, input){
    if (!input?.threadId) bad("bad_request", "threadId is required");
    const full = await call(`${G}/threads/${input.threadId}?format=full`, token);
    return {
      id: full.id,
      messages: (full.messages || []).map(m => {
        const b = walkParts(m.payload);
        return {
          id: m.id,
          sender: header(m, "from"),
          subject: header(m, "subject"),
          date: header(m, "date"),
          snippet: m.snippet || "",
          labelIds: m.labelIds || [],
          plaintextBody: b.text,
          htmlBody: b.html,
        };
      }),
    };
  },

  label_thread: (token, i) =>
    call(`${G}/threads/${i.threadId}/modify`, token,
         { method: "POST", body: JSON.stringify({ addLabelIds: i.labelIds || [] }) }).then(() => ({})),

  unlabel_thread: (token, i) =>
    call(`${G}/threads/${i.threadId}/modify`, token,
         { method: "POST", body: JSON.stringify({ removeLabelIds: i.labelIds || [] }) }).then(() => ({})),

  apply_sensitive_thread_label: (token, i) => {
    const verb = i.labelOption === "SPAM" ? "modify" : "trash";
    return verb === "trash"
      ? call(`${G}/threads/${i.threadId}/trash`, token, { method: "POST" }).then(() => ({}))
      : call(`${G}/threads/${i.threadId}/modify`, token,
             { method: "POST", body: JSON.stringify({ addLabelIds: ["SPAM"] }) }).then(() => ({}));
  },
};

/* ---------------- Google Calendar ---------------- */
const C = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const calendar = {
  async list_events(token, input){
    const q = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: String(input?.pageSize || 50),
    });
    if (input?.startTime) q.set("timeMin", input.startTime);
    if (input?.endTime)   q.set("timeMax", input.endTime);
    const j = await call(`${C}?${q}`, token);
    return {
      timeZone: j.timeZone,
      events: (j.items || []).map(e => ({
        id: e.id, summary: e.summary, location: e.location,
        start: e.start, end: e.end, attendees: e.attendees, htmlLink: e.htmlLink,
      })),
    };
  },
  async create_event(token, input){
    const body = {
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.startTime },
      end:   { dateTime: input.endTime },
      ...(input.eventType ? { eventType: input.eventType } : {}),
    };
    const j = await call(`${C}?sendUpdates=none`, token,
                         { method: "POST", body: JSON.stringify(body) });
    return { id: j.id, status: j.status, htmlLink: j.htmlLink };
  },
  delete_event: (token, i) =>
    call(`${C}/${encodeURIComponent(i.eventId)}?sendUpdates=none`, token,
         { method: "DELETE" }).then(() => ({ success: true })),
};

/* ---------------- Todoist ----------------
   REST priority is inverted against the connector's p1..p4 labels:
   API 4 is urgent (p1) and API 1 is lowest (p4). */
const T = "https://api.todoist.com/rest/v2";
const toP = n => `p${5 - (n || 1)}`;
const fromP = s => 5 - Number(String(s || "p4").replace("p", ""));
const shapeTask = t => ({
  id: t.id,
  content: t.content,
  description: t.description || "",
  dueDate: t.due?.datetime || t.due?.date || undefined,
  deadlineDate: t.deadline?.date || undefined,
  recurring: t.due?.is_recurring ? (t.due.string || true) : false,
  priority: toP(t.priority),
  projectId: t.project_id,
  sectionId: t.section_id || undefined,
  labels: t.labels || [],
  checked: false,
});

const todoist = {
  async ["find-tasks-by-date"](token, input){
    const start = input?.startDate === "today" || !input?.startDate ? "today" : input.startDate;
    const mode = input?.overdueOption;
    const filter = mode === "overdue-only" ? "overdue"
                 : mode === "exclude-overdue" ? start
                 : `overdue | ${start}`;
    const j = await call(`${T}/tasks?filter=${encodeURIComponent(filter)}`, token);
    const tasks = j.map(shapeTask).slice(0, input?.limit || 100);
    return { tasks, totalCount: tasks.length, hasMore: false };
  },

  async ["add-tasks"](token, input){
    const made = [];
    for (const t of input?.tasks || []){
      const body = {
        content: t.content,
        ...(t.description ? { description: t.description } : {}),
        ...(t.dueString ? { due_string: t.dueString } : {}),
        ...(t.priority ? { priority: fromP(t.priority) } : {}),
        ...(t.projectId && t.projectId !== "inbox" ? { project_id: t.projectId } : {}),
      };
      made.push(shapeTask(await call(`${T}/tasks`, token,
        { method: "POST", body: JSON.stringify(body) })));
    }
    return { tasks: made, successCount: made.length, failureCount: 0, failures: [] };
  },

  async ["complete-tasks"](token, input){
    for (const id of input?.ids || [])
      await call(`${T}/tasks/${id}/close`, token, { method: "POST" });
    return { completed: input?.ids || [], successCount: (input?.ids || []).length, failures: [] };
  },

  async ["reschedule-tasks"](token, input){
    const out = [];
    for (const t of input?.tasks || []){
      const date = String(t.date || "");
      const body = date.includes("T") ? { due_datetime: date } : { due_date: date };
      out.push(shapeTask(await call(`${T}/tasks/${t.id}`, token,
        { method: "POST", body: JSON.stringify(body) })));
    }
    return { tasks: out, rescheduledTaskIds: out.map(t => t.id) };
  },

  async ["find-completed-tasks"](token, input){
    const q = new URLSearchParams({ limit: "200" });
    if (input?.since) q.set("since", `${input.since}T00:00:00`);
    if (input?.until) q.set("until", `${input.until}T23:59:59`);
    const j = await call(`https://api.todoist.com/sync/v9/completed/get_all?${q}`, token);
    return {
      tasks: (j.items || []).map(i => ({
        id: i.task_id, content: i.content, completedAt: i.completed_at, checked: true,
      })),
    };
  },

  delete_object: (token, i) =>
    call(`${T}/tasks/${i.id}`, token, { method: "DELETE" }).then(() => ({ success: true })),
};

/* ---------------- Strava ---------------- */
const S = "https://www.strava.com/api/v3";
const strava = {
  async list_activities(token, input){
    const j = await call(`${S}/athlete/activities?per_page=${Math.min(input?.first || 30, 100)}`, token);
    return {
      activities: j.map(a => ({
        id: String(a.id),
        name: a.name,
        description: a.description || undefined,
        sport_type: a.sport_type || a.type,
        // the connector reports wall-clock local time; Strava suffixes a Z
        start_local: String(a.start_date_local || "").replace("Z", ""),
        summary: {
          distance: a.distance,
          moving_time: a.moving_time,
          elapsed_time: a.elapsed_time,
          elevation_gain: a.total_elevation_gain,
          avg_speed: a.average_speed,
          max_speed: a.max_speed,
          relative_effort: a.suffer_score ?? null,
          total_calories: a.calories ?? (a.kilojoules ? Math.round(a.kilojoules) : null),
          avg_cadence: a.average_cadence,
          kudos_count: a.kudos_count,
          achievement_count: a.achievement_count,
          pr_count: a.pr_count,
        },
      })),
    };
  },
  async get_athlete_profile(token){
    const a = await call(`${S}/athlete`, token);
    return {
      first_name: a.firstname, last_name: a.lastname,
      city: a.city, country: a.country, sex: a.sex, weight: a.weight,
      measurement_preference: a.measurement_preference,
    };
  },
  get_athlete_zones: token => call(`${S}/athlete/zones`, token),
};

const REGISTRY = {
  "Gmail": gmail,
  "Google Calendar": calendar,
  "Todoist": todoist,
  "Strava": strava,
};

export async function runTool(server, tool, input, token){
  const bank = REGISTRY[server];
  if (!bank) bad("not_in_manifest", `unknown server ${server}`);
  const fn = bank[tool];
  if (typeof fn !== "function") bad("not_in_manifest", `unknown tool ${server}/${tool}`);
  return fn(token, input || {});
}

export { ToolError };
