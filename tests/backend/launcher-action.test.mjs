// The launcher's write endpoint: key required, four bounded actions, no
// deletes or sends, and events limited to 3 hours within the next 2 days.
process.env.SESSION_SECRET = "test-secret-for-unit-tests-only";
process.env.LAUNCHER_API_KEY = "launch-key";
process.env.UPSTASH_REDIS_REST_URL = "https://upstash.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "u";
process.env.GOOGLE_CLIENT_ID = "g"; process.env.GOOGLE_CLIENT_SECRET = "g";
process.env.TODOIST_CLIENT_ID = "t"; process.env.TODOIST_CLIENT_SECRET = "t";
const { seal } = await import(new URL("../../lib/session.js", import.meta.url).href);
const handler = (await import(new URL("../../lib/routes/launcher-action.js", import.meta.url).href)).default;

const fails = [];
const check = (name, ok, got) => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  got: " + JSON.stringify(got))); if (!ok) fails.push(name); };

const writes = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const json = b => ({ ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) });
  if (u.startsWith("https://upstash.test/get/")) return json({ result: seal({ access_token: "tok", expires_at: Date.now() + 3600e3 }) });
  writes.push({ u, method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : null });
  return json({ id: "new-ev" });
};
const res = () => { const r = { headers: {}, code: 200, body: null }; r.setHeader = (k, v) => r.headers[k] = v;
  r.status = c => (r.code = c, r); r.json = b => (r.body = b, r); return r; };
const call = async (body, key = "launch-key") => { const r = res();
  await handler({ method: "POST", headers: { "x-launcher-key": key }, body }, r); return r; };
const iso = h => new Date(Date.now() + h * 3600e3).toISOString();

let r = await call({ action: "complete_task", id: "123" }, "wrong");
check("wrong key → 401, nothing written", r.code === 401 && writes.length === 0, r.code);
r = await call({ action: "complete_task", id: "123" });
check("complete_task closes that Todoist task", r.body.ok && writes.at(-1).u.endsWith("/tasks/123/close") && writes.at(-1).method === "POST", writes.at(-1));
r = await call({ action: "archive_email", id: "thr_abc" });
check("archive_email removes INBOX only (recoverable)", r.body.ok && /threads\/thr_abc\/modify$/.test(writes.at(-1).u)
  && writes.at(-1).body.removeLabelIds[0] === "INBOX" && !writes.at(-1).body.addLabelIds, writes.at(-1));
r = await call({ action: "book_training", start: iso(2), end: iso(3), kind: "hard" });
check("book_training creates a fixed-title event", r.body.ok && writes.at(-1).method === "POST"
  && writes.at(-1).body.summary === "Training — hard session", writes.at(-1).body);
r = await call({ action: "move_event", id: "ev1", start: iso(24), end: iso(25) });
check("move_event patches that event's time", r.body.ok && writes.at(-1).method === "PATCH" && /events\/ev1/.test(writes.at(-1).u), writes.at(-1));

const before = writes.length;
r = await call({ action: "book_training", start: iso(2), end: iso(7) });
check("refuses events longer than 3 hours", r.code === 400, r.body);
r = await call({ action: "move_event", id: "ev1", start: iso(24 * 10), end: iso(24 * 10 + 1) });
check("refuses times beyond two days", r.code === 400, r.body);
r = await call({ action: "archive_email", id: "../../x" });
check("refuses odd ids", r.code === 400, r.body);
r = await call({ action: "delete_event", id: "ev1" });
check("no other actions (e.g. delete)", r.code === 400 && /unknown action/.test(r.body.error.message), r.body);
check("none of the refusals wrote anything", writes.length === before, writes.slice(before));

console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
