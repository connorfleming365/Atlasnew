// The brain's memory tools: remember_note / forget_note edit the notes, refuse
// secrets, and the reply carries the new list back to the dashboard.
process.env.SESSION_SECRET = "test-secret-for-unit-tests-only";
process.env.ANTHROPIC_API_KEY = "sk-test";
const { converse } = await import(new URL("../../lib/brain.js", import.meta.url).href);
const fails = [];
const check = (name, ok, got) => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  got: " + JSON.stringify(got))); if (!ok) fails.push(name); };

// a fake Claude that calls one tool, then answers
let script = [];
const sent = [];
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body); sent.push(body);
  const next = script.shift();
  return { ok: true, status: 200, json: async () => next };
};
const toolTurn = (name, input) => ({ content: [{ type: "tool_use", id: "t1", name, input }] });
const textTurn = t => ({ content: [{ type: "text", text: t }] });

let req = { headers: {} };
script = [toolTurn("remember_note", { note: "No meetings before 9am" }), textTurn("Noted.")];
let out = await converse({ message: "I never take meetings before 9", history: [], notes: ["Prefers runs after work"] }, req, null);
check("remember_note adds to the notes and returns them", out.reply === "Noted." && JSON.stringify(out.memory) === JSON.stringify(["Prefers runs after work", "No meetings before 9am"]), out);
check("the system prompt tells the brain when to remember", /remember_note/.test(sent[0].system) && sent[0].tools.some(t => t.name === "remember_note"), null);

req = { headers: {} };
script = [toolTurn("remember_note", { note: "My PIN is 1234" }), textTurn("I won't save that.")];
out = await converse({ message: "remember my pin is 1234", history: [], notes: [] }, req, null);
check("secrets are refused, memory unchanged", !out.memory, out);

req = { headers: {} };
script = [toolTurn("forget_note", { match: "meetings before 9" }), textTurn("Forgotten.")];
out = await converse({ message: "forget the meetings thing", history: [], notes: ["Prefers runs after work", "No meetings before 9am"] }, req, null);
check("forget_note removes the matching note", JSON.stringify(out.memory) === JSON.stringify(["Prefers runs after work"]), out.memory);

req = { headers: {} };
script = [textTurn("You're free at 2.")];
out = await converse({ message: "when am I free", history: [], notes: ["x"] }, req, null);
check("an ordinary reply carries no memory field", out.memory === undefined, out);

// actions report what they changed, so the dashboard/phone refresh that part at once
req = { headers: {} };
script = [toolTurn("add_task", { tasks: [{ content: "Call the bank" }] }), textTurn("Added.")];
out = await converse({ message: "add a task to call the bank", history: [], notes: [] }, req, null);
check("creating a task reports changed: todo", JSON.stringify(out.changed) === JSON.stringify(["todo"]), out.changed);
req = { headers: {} };
script = [toolTurn("create_calendar_event", { title: "Gym", start: "2026-11-26T18:00:00Z", end: "2026-11-26T19:00:00Z" }), textTurn("Booked.")];
out = await converse({ message: "book the gym at 6", history: [], notes: [] }, req, null);
check("a calendar change reports changed: cal", JSON.stringify(out.changed) === JSON.stringify(["cal"]), out.changed);
req = { headers: {} };
script = [textTurn("You're free at 2.")];
out = await converse({ message: "when am I free", history: [], notes: [] }, req, null);
check("a plain answer reports no changes", out.changed === undefined, out.changed);

console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
