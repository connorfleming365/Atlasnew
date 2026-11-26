// The shared login: one copy per provider in the store, one refresh at a time,
// wiped only when the provider really rejects it. Fake Upstash + a fake WHOOP
// token endpoint that rotates refresh tokens the way WHOOP does.
process.env.SESSION_SECRET = "test-secret-for-unit-tests-only";
process.env.WHOOP_CLIENT_ID = "cid";
process.env.WHOOP_CLIENT_SECRET = "csecret";
process.env.TODOIST_CLIENT_ID = "tid";
process.env.TODOIST_CLIENT_SECRET = "tsecret";
process.env.UPSTASH_REDIS_REST_URL = "https://fake-upstash.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "upstash-token";

const lib = p => new URL(`../../lib/${p}`, import.meta.url).href;
const { tokenState, getToken, getTokenForLauncher } = await import(lib("providers.js"));
const { seal, unseal } = await import(lib("session.js"));
const { lastProblem } = await import(lib("tokenStore.js"));
const { buildSummary } = await import(lib("routes/launcher-summary.js"));

const fails = [];
const check = (name, ok, got) => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  got: " + JSON.stringify(got))); if (!ok) fails.push(name); };

// ---- fakes ----
const kv = new Map();
let storeDown = false;
let whoop = { live: "rt-1", n: 1, mode: "ok", refreshes: 0 };   // the one refresh token WHOOP currently accepts
const sleep = ms => new Promise(r => setTimeout(r, ms));

globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const json = (obj, status = 200) => ({ ok: status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) });
  if (u.host === "fake-upstash.test"){
    if (storeDown) throw new Error("ECONNRESET");
    const [cmd, key, val, nx] = u.pathname.slice(1).split("/").map(decodeURIComponent);
    if (cmd === "get") return json({ result: kv.has(key) ? kv.get(key) : null });
    if (cmd === "del"){ kv.delete(key); return json({ result: 1 }); }
    if (cmd === "set"){
      if (nx === "NX"){ if (kv.has(key)) return json({ result: null }); kv.set(key, val); return json({ result: "OK" }); }
      kv.set(key, opts.body); return json({ result: "OK" });
    }
  }
  if (url === "https://api.prod.whoop.com/oauth/oauth2/token"){
    whoop.refreshes++;
    await sleep(40);                       // long enough for callers to overlap
    if (whoop.mode === "down") return json({ error: "temporarily_unavailable" }, 503);
    const rt = new URLSearchParams(opts.body).get("refresh_token");
    if (rt !== whoop.live) return json({ error: "invalid_grant", error_description: "refresh token already used" }, 400);
    whoop.n++; whoop.live = `rt-${whoop.n}`;
    return json({ access_token: `at-${whoop.n}`, refresh_token: whoop.live, expires_in: 3600 });
  }
  throw new Error("unexpected fetch " + url);
};

const stored = p => { const v = kv.get(`atlas:tokens:${p}`); return v ? unseal(v) : null; };
const store = (p, t) => kv.set(`atlas:tokens:${p}`, seal(t));
const browser = (p, t) => {
  const cookies = [];
  return { req: { headers: { cookie: t ? `atlas_${p}=${encodeURIComponent(seal(t))}` : "" } },
           res: { getHeader: () => cookies, setHeader: (k, v) => { cookies.length = 0; cookies.push(...[].concat(v)); } }, cookies };
};
const reset = () => { kv.clear(); storeDown = false; whoop = { live: "rt-1", n: 1, mode: "ok", refreshes: 0 }; };
const expired = rt => ({ access_token: "at-1", refresh_token: rt, expires_at: Date.now() - 1000 });

// ---- 1. browser + phone + a second browser all renewing at once: one refresh, all succeed ----
reset();
store("whoop", expired("rt-1"));
const b1 = browser("whoop", expired("rt-1")), b2 = browser("whoop", expired("rt-1"));
const got = await Promise.all([getToken("whoop", b1.req, b1.res), getTokenForLauncher("whoop"), getToken("whoop", b2.req, b2.res)]);
check("parallel renewals: exactly one refresh request", whoop.refreshes === 1, whoop.refreshes);
check("parallel renewals: everyone gets the new token", got.every(t => t === "at-2"), got);
check("parallel renewals: the store holds the rotated refresh token", stored("whoop")?.refresh_token === "rt-2", stored("whoop"));
check("parallel renewals: the browser's cookie is brought up to date", b1.cookies.some(c => c.startsWith("atlas_whoop=")), b1.cookies);

// ---- 2. a browser holding a spent refresh token doesn't break anything ----
reset();
whoop.live = "rt-5"; whoop.n = 5;
store("whoop", { access_token: "at-5", refresh_token: "rt-5", expires_at: Date.now() + 3600_000 });
const stale = browser("whoop", expired("rt-1"));
const s2 = await tokenState("whoop", stale.req, stale.res);
check("stale cookie: the shared login is used instead", s2.token === "at-5" && whoop.refreshes === 0, { s2, n: whoop.refreshes });
check("stale cookie: nothing wiped", stored("whoop")?.refresh_token === "rt-5");

// ---- 3. WHOOP briefly down: login kept, problem recorded, "temporary" not "reconnect" ----
reset();
whoop.mode = "down";
store("whoop", expired("rt-1"));
const s3 = await tokenState("whoop", null, null);
check("provider 503: reported as temporary", s3.token === null && s3.reason === "temporary", s3);
check("provider 503: the login is kept", stored("whoop")?.refresh_token === "rt-1", stored("whoop"));
const p3 = await lastProblem("whoop");
check("provider 503: the problem is recorded", /503/.test(p3?.message || "") && p3.at > 0, p3);
whoop.mode = "ok";
const s3b = await tokenState("whoop", null, null);
check("provider back: renews with the kept login", s3b.token === "at-2", s3b);

// ---- 4. a genuinely dead login: wiped, marked, needs reconnecting ----
reset();
whoop.live = "rt-9";
store("whoop", expired("rt-1"));
const dead = browser("whoop", expired("rt-1"));
const s4 = await tokenState("whoop", dead.req, dead.res);
check("invalid_grant: needs reconnecting", s4.token === null && s4.reason === "needs_reauth", s4);
check("invalid_grant: the store is marked cleared", stored("whoop")?.cleared_at > 0 && !stored("whoop")?.access_token, stored("whoop"));
check("invalid_grant: the browser's cookie is cleared", dead.cookies.some(c => /^atlas_whoop=;/.test(c) || /Max-Age=0/i.test(c)), dead.cookies);
check("invalid_grant: the reason is recorded", /invalid_grant/.test((await lastProblem("whoop"))?.message || ""));

// ---- 5. after a disconnect, an old cookie elsewhere isn't shared back in; a newer login is ----
reset();
kv.set("atlas:tokens:whoop", seal({ cleared_at: Date.now() - 1000 }));
const old = browser("whoop", { access_token: "at-old", refresh_token: "rt-old", expires_at: Date.now() + 3600_000 });
const s5 = await tokenState("whoop", old.req, old.res);
check("disconnected: an older cookie isn't adopted", s5.reason === "not_connected" && !stored("whoop")?.access_token, { s5, st: stored("whoop") });
const fresh = browser("whoop", { access_token: "at-new", refresh_token: "rt-new", expires_at: Date.now() + 3600_000, issued_at: Date.now() });
const s5b = await tokenState("whoop", fresh.req, fresh.res);
check("a login made after the disconnect is adopted", s5b.token === "at-new" && stored("whoop")?.access_token === "at-new", { s5b, st: stored("whoop") });

// ---- 6. empty store + a browser login: shared so the phone can use it ----
reset();
const only = browser("whoop", { access_token: "at-b", refresh_token: "rt-b", expires_at: Date.now() + 3600_000 });
await getToken("whoop", only.req, only.res);
check("empty store: the browser's login is shared", stored("whoop")?.access_token === "at-b", stored("whoop"));

// ---- 7. Todoist (never expires, no refresh token) just works ----
reset();
const td = browser("todoist", { access_token: "td-1", refresh_token: null, expires_at: null });
check("Todoist token returned without any refresh", (await getToken("todoist", td.req, td.res)) === "td-1" && whoop.refreshes === 0);

// ---- 8. the store unreachable: the phone hears "temporary", a browser falls back to its cookie ----
reset();
storeDown = true;
const s8 = await tokenState("whoop", null, null);
check("store down, phone: temporary (not reconnect)", s8.reason === "temporary", s8);
const cb = browser("whoop", { access_token: "at-c", refresh_token: "rt-c", expires_at: Date.now() + 3600_000 });
check("store down, browser: uses its own cookie", (await getToken("whoop", cb.req, cb.res)) === "at-c");

// ---- 9. the phone's lights: temporary trouble is amber (failed[]), a refused login is red (links false) ----
const run = async (server) => { if (server === "Todoist"){ const e = new Error("upstream 401"); e.code = "needs_reauth"; throw e; } return {}; };
const reauth = [];
const s9 = await buildSummary({ tokens: { google: null, todoist: "td", whoop: null, strava: null }, start: "a", end: "b", today: "2026-11-26",
  run, configuredIds: ["google", "todoist", "whoop"], trouble: { whoop: true }, onReauth: p => reauth.push(p) });
check("temporary trouble: still linked, its tile in failed[]", s9.links.whoop === true && s9.failed.includes("whoop"), s9);
check("refused by the API: links false, reported", s9.links.todoist === false && !s9.failed.includes("todoist") && reauth.includes("todoist"), { s9, reauth });
check("never connected: links false, not failed", s9.links.google === false && !s9.failed.includes("calendar"), s9);

console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
