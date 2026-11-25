// The owner gate: every sensitive endpoint refuses a browser that hasn't
// unlocked with ATLAS_ACCESS_CODE; it fails closed when the code isn't set;
// the right code unlocks, a wrong one doesn't; changing the code signs out.
// Plus the install files (manifest, icons, service worker) are present and sane.
import { readFileSync, existsSync } from "node:fs";
process.env.SESSION_SECRET = "test-secret-for-unit-tests-only";
delete process.env.ATLAS_ACCESS_CODE;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.ANTHROPIC_API_KEY;
const imp = p => import(new URL(p, import.meta.url).href);
const owner = await imp("../../lib/owner.js");
const routes = {
  mcp: (await imp("../../api/mcp.js")).default,
  brain: (await imp("../../api/brain.js")).default,
  tts: (await imp("../../api/tts.js")).default,
  voices: (await imp("../../api/voices.js")).default,
  sync: (await imp("../../api/sync.js")).default,
  status: (await imp("../../api/status.js")).default,
  start: (await imp("../../api/auth/start.js")).default,
  callback: (await imp("../../api/auth/callback.js")).default,
  disconnect: (await imp("../../api/auth/disconnect.js")).default,
  unlock: (await imp("../../api/unlock.js")).default,
};

const fails = [];
const check = (name, ok, got) => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  got: " + JSON.stringify(got))); if (!ok) fails.push(name); };

const res = () => { const r = { headers: {}, code: 200, body: null };
  r.setHeader = (k, v) => r.headers[k.toLowerCase()] = v; r.getHeader = k => r.headers[k.toLowerCase()];
  r.status = c => (r.code = c, r); r.json = b => (r.body = b, r); r.send = b => (r.body = b, r);
  r.writeHead = (c, h) => { r.code = c; Object.assign(r.headers, h); return r; }; r.end = () => r; return r; };
const req = (over = {}) => ({ method: "POST", query: {}, body: {}, socket: { remoteAddress: "1.2.3.4" },
  headers: { "sec-fetch-site": "same-origin", ...(over.headers || {}) }, ...over, headers: { "sec-fetch-site": "same-origin", ...(over.headers || {}) } });
const cookieFrom = r => [].concat(r.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ");
async function hit(name, over){ const r = res(); await routes[name](req(over), r); return r; }

// ---- no code set: everything locked, nothing unlocks ----
for (const name of ["mcp", "brain", "tts", "voices", "sync"]){
  const r = await hit(name, { body: { server: "Gmail", tool: "search_threads", message: "hi", text: "hi" } });
  check(`no code set: /api/${name} refuses (401 locked)`, r.code === 401 && r.body?.error?.code === "locked", r.body);
}
let r = await hit("status", { method: "GET" });
check("no code set: status says locked/unset and nothing else", r.body.locked === true && r.body.gate === "unset" && !r.body.providers, r.body);
r = await hit("unlock", { body: { code: "" } });
check("no code set: unlock refuses (fails closed)", r.code === 503 && !r.headers["set-cookie"], r.body);
r = await hit("start", { method: "GET", query: { provider: "google" } });
check("locked: can't start connecting an account", r.code === 401, r.code);
r = await hit("callback", { method: "GET", query: { code: "x", state: "y" } });
check("locked: OAuth callback refuses", r.code === 401, r.code);
r = await hit("disconnect", { method: "GET", query: {} });
check("locked: can't disconnect", r.code === 401, r.code);

// ---- with a code ----
process.env.ATLAS_ACCESS_CODE = "correct horse battery staple";
r = await hit("status", { method: "GET" });
check("code set, not unlocked: status says locked/code", r.body.locked === true && r.body.gate === "code", r.body);
const t0 = Date.now();
r = await hit("unlock", { body: { code: "wrong" } });
check("wrong code: 401, no cookie, slowed down", r.code === 401 && !r.headers["set-cookie"] && Date.now() - t0 >= 500, { code: r.code, ms: Date.now() - t0 });
r = await hit("unlock", { body: { code: "  correct horse battery staple " } });
const cookie = cookieFrom(r);
check("right code: ok + HttpOnly/Secure/SameSite owner cookie",
  r.body?.ok && /atlas_owner=/.test(cookie) && /HttpOnly/.test(r.headers["set-cookie"]) && /Secure/.test(r.headers["set-cookie"]) && /SameSite=Lax/.test(r.headers["set-cookie"]), r.headers["set-cookie"]);

r = await hit("status", { method: "GET", headers: { cookie } });
check("unlocked: status gives the full picture", !r.body.locked && r.body.providers && r.body.hosted, r.body);
r = await hit("sync", { method: "GET", headers: { cookie } });
check("unlocked: sync answers", r.code === 200 && r.body.configured === false, r.body);
r = await hit("mcp", { headers: { cookie }, body: { server: "Gmail", tool: "search_threads" } });
check("unlocked: mcp passes the gate (then needs the provider)", r.code === 200 && r.body?.error?.code === "server_not_connected", r.body);

// cross-site is still refused even with the cookie
r = await hit("mcp", { headers: { cookie, "sec-fetch-site": "cross-site" }, body: { server: "Gmail", tool: "x" } });
check("cross-site request refused even when unlocked", r.code === 403, r.code);

// forged / tampered cookie
r = await hit("sync", { method: "GET", headers: { cookie: "atlas_owner=abc.def.ghi" } });
check("forged owner cookie refused", r.code === 401, r.code);

// changing the code signs every device out
process.env.ATLAS_ACCESS_CODE = "a new passphrase";
r = await hit("sync", { method: "GET", headers: { cookie } });
check("changing the code signs old devices out", r.code === 401, r.code);
process.env.ATLAS_ACCESS_CODE = "correct horse battery staple";

// lock
r = await hit("unlock", { headers: { cookie }, body: { lock: true } });
check("lock clears the cookie", /atlas_owner=;/.test([].concat(r.headers["set-cookie"])[0]) && /Max-Age=0/.test([].concat(r.headers["set-cookie"])[0]), r.headers["set-cookie"]);

// brute force: limited per address (in-memory when Upstash isn't set)
let last;
for (let i = 0; i < 11; i++) last = await hit("unlock", { socket: { remoteAddress: "9.9.9.9" }, body: { code: "nope" + i } });
check("11th wrong try from one address → 429", last.code === 429, last.code);

// ---- install files ----
const root = new URL("../../", import.meta.url);
const man = JSON.parse(readFileSync(new URL("manifest.webmanifest", root), "utf8"));
check("manifest: standalone app with start_url /", man.display === "standalone" && man.start_url === "/" && man.name === "Atlas", man);
check("manifest: every icon file exists, incl. 192, 512 and maskable",
  man.icons.every(i => existsSync(new URL("." + i.src, root))) && man.icons.some(i => i.sizes === "192x192")
  && man.icons.some(i => i.sizes === "512x512") && man.icons.some(i => i.purpose === "maskable"), man.icons);
const sw = readFileSync(new URL("sw.js", root), "utf8");
check("service worker never touches /api/", /startsWith\("\/api\/"\)\) return;/.test(sw), null);
const html = readFileSync(new URL("index.html", root), "utf8");
check("page links the manifest and registers the worker on https only",
  html.includes('rel="manifest" href="/manifest.webmanifest"') && /location\.protocol === "https:"/.test(html));
const vj = JSON.parse(readFileSync(new URL("vercel.json", root), "utf8"));
const hdrs = vj.headers.find(h => h.source === "/(.*)").headers.map(h => h.key);
check("security headers: no framing, nosniff, HSTS", ["Content-Security-Policy", "X-Frame-Options", "X-Content-Type-Options", "Strict-Transport-Security"].every(k => hdrs.includes(k)), hdrs);

console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
