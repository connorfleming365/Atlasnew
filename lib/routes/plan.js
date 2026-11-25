/* "Plan my day": Claude lays today's open tasks into today's free time and
   returns a draft. Nothing is written here - the dashboard shows the draft
   and only adds what you approve.

   The page sends what it already has on screen (tasks, free gaps, the
   training slot, the time now, as local "HH:MM"), so this needs no provider
   tokens of its own. Every block that comes back is checked: it must belong
   to a task that was sent, sit inside a free gap, and not overlap another
   block; anything else is dropped rather than trusted. */
import { denyCrossSite } from "../guard.js";
import { denyUnlessOwner } from "../owner.js";
import { structured, aiConfigured } from "../ai.js";

const SYSTEM = `You plan one person's working day. You get today's open tasks (with priority p1 \
highest to p4 lowest, overdue flags and any due time), the free gaps in their calendar from now \
on, any fixed training slot, and their recovery. Place tasks into the free gaps as focus blocks.

Rules:
- Only use the free gaps given. Never overlap two blocks. Times are local 24h "HH:MM".
- Estimate a sensible duration per task from its wording: 15-30 min for quick admin (reply, \
call, pay, book, send), 45-90 min for deep work (write, build, prepare, review, plan). Use a \
task's own duration when given.
- Overdue and p1 first, earlier in the day when energy is higher; tasks with a due time must end \
before it. Group small admin tasks together. Leave 10 minutes between blocks where you can.
- Keep a lunch gap around 12:30-13:30 free when the day allows. Don't plan past 21:00.
- On a red recovery day, plan lighter: fewer deep-work blocks, more breathing room.
- It's fine to leave tasks unscheduled when there isn't room; say why in a few words.
- "why" is at most 8 words. "summary" is one short spoken sentence.`;

const TOOL = {
  name: "propose_plan",
  description: "The proposed placement of tasks into today's free time.",
  input_schema: { type: "object", properties: {
    blocks: { type: "array", items: { type: "object", properties: {
      task_id: { type: "string" }, start: { type: "string", description: "HH:MM local" },
      minutes: { type: "integer", minimum: 10, maximum: 180 }, why: { type: "string" },
    }, required: ["task_id", "start", "minutes"] } },
    unscheduled: { type: "array", items: { type: "object", properties: {
      task_id: { type: "string" }, why: { type: "string" } }, required: ["task_id"] } },
    summary: { type: "string" },
  }, required: ["blocks", "summary"] },
};

const toMin = hm => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || "").trim());
  return m ? +m[1] * 60 + +m[2] : null; };
const toHM = n => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

/** Keep only blocks that fit the rules; exported for tests. */
export function validate(proposal, { tasks, gaps }){
  const ids = new Set(tasks.map(t => String(t.id)));
  const free = gaps.map(g => [toMin(g.start), toMin(g.end)]).filter(([a, b]) => a != null && b != null && b > a);
  const taken = [], blocks = [], seen = new Set();
  for (const b of (proposal.blocks || [])){
    const id = String(b.task_id), s = toMin(b.start), len = Math.round(Number(b.minutes));
    if (!ids.has(id) || seen.has(id) || s == null || !(len >= 10 && len <= 180)) continue;
    const e = s + len;
    if (!free.some(([a, z]) => s >= a && e <= z)) continue;          // outside free time
    if (taken.some(([a, z]) => s < z && e > a)) continue;             // overlaps another block
    taken.push([s, e]); seen.add(id);
    blocks.push({ task_id: id, start: toHM(s), end: toHM(e), why: String(b.why || "").slice(0, 80) });
  }
  blocks.sort((a, b) => toMin(a.start) - toMin(b.start));
  const unscheduled = tasks.filter(t => !seen.has(String(t.id))).map(t => ({ task_id: String(t.id),
    why: String((proposal.unscheduled || []).find(u => String(u.task_id) === String(t.id))?.why || "no room today").slice(0, 80) }));
  return { blocks, unscheduled, summary: String(proposal.summary || "").slice(0, 240) };
}

export default async function handler(req, res){
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: { code: "bad_request" } });
  if (denyCrossSite(req, res)) return;
  if (denyUnlessOwner(req, res)) return;
  if (!aiConfigured()) return res.status(200).json({ error: { code: "not_configured", message: "ANTHROPIC_API_KEY is not set" } });

  let body = req.body;
  if (typeof body === "string"){ try{ body = JSON.parse(body); }catch(_){ body = null; } }
  const tasks = (Array.isArray(body?.tasks) ? body.tasks : []).slice(0, 40).map(t => ({
    id: String(t.id), content: String(t.content || "").slice(0, 160), priority: String(t.priority || "p4"),
    overdue: Boolean(t.overdue), due: t.due ? String(t.due).slice(0, 5) : null,
    minutes: Number.isFinite(t.minutes) ? t.minutes : null }));
  const gaps = (Array.isArray(body?.gaps) ? body.gaps : []).slice(0, 20)
    .map(g => ({ start: String(g.start), end: String(g.end) }));
  if (!tasks.length || !gaps.length) return res.json({ blocks: [], unscheduled: [], summary: "" });

  const prompt = JSON.stringify({
    now: String(body.now || ""), weekday: String(body.weekday || ""),
    recovery: body.recovery ? String(body.recovery).slice(0, 40) : null,
    training: body.training ? { start: String(body.training.start), end: String(body.training.end) } : null,
    free_gaps: gaps, busy: (Array.isArray(body.events) ? body.events : []).slice(0, 30)
      .map(e => ({ title: String(e.title || "").slice(0, 80), start: String(e.start), end: String(e.end) })),
    tasks,
  });
  try{
    const out = await structured({ system: SYSTEM, prompt, tool: TOOL });
    res.json({ ...validate(out, { tasks, gaps }), source: "ai" });
  }catch(e){
    res.status(200).json({ error: { code: e.code || "upstream_error", message: String(e.message).slice(0, 300) } });
  }
}
