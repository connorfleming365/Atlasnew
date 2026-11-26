/* Server-side token store (Upstash Redis REST + the same AES-256-GCM sealing
   as lib/sync.js). When it's configured, this is the ONE copy of each
   provider's login: the dashboard (in any browser) and the phone launcher
   both read and refresh the same tokens here, so providers that rotate their
   refresh tokens on every refresh (WHOOP does) can't end up with one copy
   holding a refresh token another copy has already spent. A short lock makes
   sure only one refresh runs at a time.

   Also keeps the last problem seen per provider (when, and what), so the
   Accounts panel can say why an account dropped.

   Without the two Upstash env vars all of this is a no-op: logins live only
   in each browser's cookie, and the launcher reports no connected data. */
import { seal, unseal } from "./session.js";
import { randomBytes } from "node:crypto";

function envVar(name){
  const raw = process.env[name];
  if (!raw) return raw;
  const clean = raw.trim();
  return clean.includes("\n") || clean.includes(" ") ? clean.split(/\s+/)[0] : clean;
}

const URL_ = envVar("UPSTASH_REDIS_REST_URL");
const TOKEN = envVar("UPSTASH_REDIS_REST_TOKEN");
const keyFor = provider => `atlas:tokens:${provider}`;
const lockFor = provider => `atlas:lock:${provider}`;
const errFor = provider => `atlas:lasterr:${provider}`;
const auth = () => ({ authorization: `Bearer ${TOKEN}` });

export const tokenStoreConfigured = () => Boolean(URL_ && TOKEN);

/** The stored entry, null when there is none. Throws when the store can't be reached.
    The entry is either the tokens, or { cleared_at } after a disconnect or a rejected login. */
export async function readStoredToken(provider){
  if (!tokenStoreConfigured()) return null;
  const r = await fetch(`${URL_}/get/${keyFor(provider)}`, { headers: auth() });
  if (!r.ok) throw new Error(`token store ${r.status}`);
  const j = await r.json();
  return j.result ? unseal(j.result) : null;
}

/** The stored tokens, or null (none, cleared, or the store can't be reached). */
export async function getStoredToken(provider){
  try{ const t = await readStoredToken(provider); return t?.access_token ? t : null; }catch(_){ return null; }
}

export async function setStoredToken(provider, tokens){
  if (!tokenStoreConfigured()) return;
  await fetch(`${URL_}/set/${keyFor(provider)}`, {
    method: "POST",
    headers: auth(),
    body: seal({ ...tokens, updated_at: Date.now() }),
  });
}

/* Leaves a marker rather than deleting, so a login still sitting in some
   other browser's cookie from before this isn't quietly shared back in. */
export async function clearStoredToken(provider){
  if (!tokenStoreConfigured()) return;
  await fetch(`${URL_}/set/${keyFor(provider)}`, { method: "POST", headers: auth(), body: seal({ cleared_at: Date.now() }) });
}

/* ---- one refresh at a time ---- */

/** Take the refresh lock for a provider (15 s at most). Returns a release function, or null if someone else holds it. */
export async function acquireRefreshLock(provider){
  if (!tokenStoreConfigured()) return async () => {};
  const id = randomBytes(8).toString("hex");
  try{
    const r = await fetch(`${URL_}/set/${lockFor(provider)}/${id}/NX/PX/15000`, { headers: auth() });
    const j = await r.json().catch(() => ({}));
    if (j.result !== "OK") return null;
  }catch(_){
    return async () => {};          // store unreachable: don't block the refresh on it
  }
  return async () => {
    try{
      const r = await fetch(`${URL_}/get/${lockFor(provider)}`, { headers: auth() });
      const j = await r.json().catch(() => ({}));
      if (j.result === id) await fetch(`${URL_}/del/${lockFor(provider)}`, { headers: auth() });
    }catch(_){ /* the lock expires on its own */ }
  };
}

/* ---- the last problem per provider ---- */

export async function recordProblem(provider, message){
  if (!tokenStoreConfigured()) return;
  try{
    await fetch(`${URL_}/set/${errFor(provider)}`, {
      method: "POST", headers: auth(),
      body: JSON.stringify({ at: Date.now(), message: String(message).slice(0, 200) }),
    });
  }catch(_){}
}

export async function lastProblem(provider){
  if (!tokenStoreConfigured()) return null;
  try{
    const r = await fetch(`${URL_}/get/${errFor(provider)}`, { headers: auth() });
    const j = await r.json();
    return j.result ? JSON.parse(j.result) : null;
  }catch(_){ return null; }
}

export async function clearProblem(provider){
  if (!tokenStoreConfigured()) return;
  try{ await fetch(`${URL_}/del/${errFor(provider)}`, { headers: auth() }); }catch(_){}
}
