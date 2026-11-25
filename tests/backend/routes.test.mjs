// Deployment shape: Vercel Hobby allows 12 functions per deployment (a 13th
// fails the deploy), so grouped routes share entry points. Also the phone's
// talk endpoints: key required, brain reads the server-side token copy,
// replies in the pinned voice or 204 for the phone's own voice.
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
process.env.SESSION_SECRET = "test-secret-for-unit-tests-only";
process.env.LAUNCHER_API_KEY = "launch-key";
process.env.ATLAS_ACCESS_CODE = "code";
const fails = [];
const check = (name, ok, got) => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  got: " + JSON.stringify(got))); if (!ok) fails.push(name); };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const walk = d => readdirSync(d).flatMap(f => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const fns = walk(path.join(root, "api")).filter(f => /\.(m?js|ts)$/.test(f));
check(`at most 12 serverless functions (has ${fns.length})`, fns.length <= 12, fns.map(f => path.relative(root, f)));

const res = () => { const r = { headers: {}, code: 200, body: null, ended: false };
  r.setHeader = (k, v) => r.headers[k] = v; r.getHeader = k => r.headers[k];
  r.status = c => (r.code = c, r); r.json = b => (r.body = b, r); r.send = b => (r.body = b, r);
  r.writeHead = (c, h) => { r.code = c; Object.assign(r.headers, h || {}); return r; }; r.end = b => { r.ended = true; r.raw = b; return r; }; return r; };
const imp = p => import(new URL(p, import.meta.url).href);
const launcher = (await imp("../../api/launcher/[op].js")).default;
const auth = (await imp("../../api/auth/[op].js")).default;
const ai = (await imp("../../api/ai/[op].js")).default;

// dispatch by the path segment Vercel puts in req.query.op
let r = res(); await launcher({ method: "GET", query: { op: "summary" }, headers: {} }, r);
check("/api/launcher/summary still answers (401 without key)", r.code === 401, r.code);
r = res(); await launcher({ method: "GET", query: { op: "nope" }, headers: {} }, r);
check("unknown launcher route → 404", r.code === 404, r.code);
r = res(); await auth({ method: "GET", query: { op: "start", provider: "google" }, headers: {} }, r);
check("/api/auth/start still answers (locked → 401)", r.code === 401, r.code);
r = res(); await ai({ method: "POST", query: { op: "plan" }, headers: { "sec-fetch-site": "same-origin" }, body: {} }, r);
check("/api/ai/plan still answers (locked → 401)", r.code === 401, r.code);

// ---- talk from the phone ----
r = res(); await launcher({ method: "POST", query: { op: "ask" }, headers: { "x-launcher-key": "bad" }, body: { message: "hi" } }, r);
check("ask: wrong key → 401", r.code === 401, r.code);
r = res(); await launcher({ method: "POST", query: { op: "ask" }, headers: { "x-launcher-key": "launch-key" }, body: { message: "hi" } }, r);
check("ask: no AI key → clear not_configured", r.body?.error?.code === "not_configured", r.body);
r = res(); await launcher({ method: "POST", query: { op: "speak" }, headers: { "x-launcher-key": "launch-key" }, body: { text: "hello" } }, r);
check("speak: no pinned voice → 204 (phone uses its own voice)", r.code === 204, r.code);

// with a fake Claude: the brain uses the launcher's token getter, not cookies
process.env.ANTHROPIC_API_KEY = "sk";
const seen = [];
globalThis.fetch = async (url, opts = {}) => {
  seen.push(String(url));
  return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "You're free until 2." }] }), text: async () => "" };
};
const ask = (await imp("../../lib/routes/launcher-ask.js")).default;
r = res(); await ask({ method: "POST", headers: { "x-launcher-key": "launch-key" }, body: { message: "when am I free?", history: [] } }, r);
check("ask: returns the reply and the history to send back", r.body?.reply === "You're free until 2." && Array.isArray(r.body.history) && r.body.history.length === 2, r.body);
const brainCall = seen.find(u => u.includes("anthropic"));
check("ask: went to Claude", Boolean(brainCall), seen);

console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
