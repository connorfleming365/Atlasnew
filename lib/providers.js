/* OAuth provider definitions and token lifecycle.

   Google's Gmail scopes are "restricted": a published app needs Google's
   verification review, but an app left in Testing mode with your own
   account as a test user works immediately and indefinitely for you.
   That is the intended setup here — this is a personal dashboard, not a
   product. */
import { parseCookies, seal, unseal, setCookie, clearCookie } from "./session.js";
import { tokenStoreConfigured, readStoredToken, getStoredToken, setStoredToken, clearStoredToken,
         acquireRefreshLock, recordProblem } from "./tokenStore.js";

/* Copy-pasting a credential into an environment-variable form is the most
   error-prone step in the whole setup: a stray trailing newline, or a
   second paste landing in the same field instead of replacing it, both
   produce a value Google (or any provider) will reject as "not found"
   with no useful diagnostic. Collapsing internal whitespace and trimming
   the ends turns the common accidents into working config instead of a
   confusing 401. */
export function envVar(name){
  const raw = process.env[name];
  if (!raw) return raw;
  const clean = raw.trim();
  return clean.includes("\n") || clean.includes(" ")
    ? clean.split(/\s+/)[0]        // first token: the one real value, not the repeats
    : clean;
}

export const PROVIDERS = {
  google: {
    label: "Google",
    servers: ["Gmail", "Google Calendar"],
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    idEnv: "GOOGLE_CLIENT_ID",
    secretEnv: "GOOGLE_CLIENT_SECRET",
    scope: [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/gmail.modify",
    ].join(" "),
    // offline + consent is what actually yields a refresh token
    extraAuth: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  },
  todoist: {
    label: "Todoist",
    servers: ["Todoist"],
    authUrl: "https://todoist.com/oauth/authorize",
    tokenUrl: "https://todoist.com/oauth/access_token",
    idEnv: "TODOIST_CLIENT_ID",
    secretEnv: "TODOIST_CLIENT_SECRET",
    scope: "data:read_write",
    neverExpires: true,
  },
  strava: {
    label: "Strava",
    servers: ["Strava"],
    authUrl: "https://www.strava.com/oauth/authorize",
    tokenUrl: "https://www.strava.com/oauth/token",
    idEnv: "STRAVA_CLIENT_ID",
    secretEnv: "STRAVA_CLIENT_SECRET",
    scope: "activity:read_all,profile:read_all",
    extraAuth: { approval_prompt: "auto" },
  },
  whoop: {
    label: "WHOOP",
    servers: ["WHOOP"],
    authUrl: "https://api.prod.whoop.com/oauth/oauth2/auth",
    tokenUrl: "https://api.prod.whoop.com/oauth/oauth2/token",
    idEnv: "WHOOP_CLIENT_ID",
    secretEnv: "WHOOP_CLIENT_SECRET",
    // Read-only. "offline" is what makes WHOOP issue a refresh token at all;
    // without it the connection silently dies when the first access token
    // expires (about an hour).
    scope: "offline read:recovery read:cycles read:workout read:sleep read:profile",
    // WHOOP also wants "offline" repeated on every refresh request.
    refreshExtra: { scope: "offline" },
  },
};

export const SERVER_PROVIDER = {
  "Gmail": "google",
  "Google Calendar": "google",
  "Todoist": "todoist",
  "Strava": "strava",
  "WHOOP": "whoop",
};

export const cookieName = p => `atlas_${p}`;
export const configured = p =>
  Boolean(envVar(PROVIDERS[p].idEnv) && envVar(PROVIDERS[p].secretEnv));

/* Set APP_URL and the redirect can't be steered by a forged Host or
   X-Forwarded-Host header. Without it we fall back to the request's own
   host, which the OAuth provider's registered-URI check still constrains —
   but pinning it is strictly better, so SELF-HOSTING.md asks for it. */
export function redirectUri(req){
  const pinned = envVar("APP_URL");
  if (pinned) return `${pinned.replace(/\/+$/, "")}/api/auth/callback`;
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}/api/auth/callback`;
}

export function authorizeUrl(provider, req, state){
  const p = PROVIDERS[provider];
  const q = new URLSearchParams({
    client_id: envVar(p.idEnv),
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: p.scope,
    state,
    ...(p.extraAuth || {}),
  });
  return `${p.authUrl}?${q}`;
}

async function tokenRequest(provider, body){
  const p = PROVIDERS[provider];
  const r = await fetch(p.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      client_id: envVar(p.idEnv),
      client_secret: envVar(p.secretEnv),
      ...body,
    }),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch(_) { json = { raw: text }; }
  if (!r.ok){
    const e = new Error(`${provider} token exchange failed (${r.status}): ${text.slice(0,200)}`);
    e.status = r.status; e.body = json;
    throw e;
  }
  return json;
}

/* Swap a refresh token for a new access token. Most providers need only
   the grant itself; some (WHOOP) want extra fields repeated each time. */
function refreshRequest(provider, refresh_token){
  return tokenRequest(provider, {
    grant_type: "refresh_token",
    refresh_token,
    ...(PROVIDERS[provider].refreshExtra || {}),
  });
}

export async function exchangeCode(provider, code, req){
  const j = await tokenRequest(provider, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(req),
  });
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token || null,
    // Strava returns absolute expires_at; Google returns expires_in
    expires_at: j.expires_at ? j.expires_at * 1000
              : j.expires_in ? Date.now() + j.expires_in * 1000
              : null,
    issued_at: Date.now(),       // newer than any earlier disconnect (see tokenState)
  };
}

/* ---- token lifecycle ----

   One login per provider. With the server-side store configured (see
   lib/tokenStore.js) that store holds THE copy: every browser and the phone
   read it, and only one of them refreshes it at a time (a short lock). The
   browser's own cookie is kept in step as a fallback for when the store
   can't be reached, and is adopted into the store if the store is empty.

   Why it matters: WHOOP rotates its refresh token on every refresh, so two
   copies refreshing separately (a browser and the phone, or two browsers)
   leave one holding a spent refresh token. The old code then treated that
   failure as "the login is dead" and wiped both copies.

   And a login is only wiped when the provider definitely rejects it (a
   400/401 to the refresh, after re-checking the store for a newer token).
   A timeout, a 5xx, a rate limit or an unreachable store is temporary: the
   login is kept, the problem is recorded, and the caller says "trouble,
   retrying" rather than "reconnect". */

const SOON = 60_000;
const isFresh = t => Boolean(t?.access_token) && (!t.expires_at || t.expires_at - Date.now() > SOON);
const stillValid = t => Boolean(t?.access_token) && (!t.expires_at || t.expires_at > Date.now());
const wait = ms => new Promise(r => setTimeout(r, ms));

/** The provider refused the refresh grant itself: the login really is gone. */
const isDeadGrant = e => e?.status === 400 || e?.status === 401;

function cookieToken(provider, req){
  const raw = req && parseCookies(req)[cookieName(provider)];
  const tok = raw && unseal(raw);
  return tok?.access_token ? tok : null;
}

/* Refresh under the lock, starting from the newest refresh token anyone has.
   Resolves to the new tokens; rejects with e.dead = true for a dead grant. */
async function refreshShared(provider, tok){
  let release = await acquireRefreshLock(provider);
  if (!release){
    // someone else is refreshing right now: use what they store (up to ~6 s)
    for (let i = 0; i < 24; i++){
      await wait(250);
      const s = await getStoredToken(provider);
      if (isFresh(s)) return s;
    }
    release = await acquireRefreshLock(provider);
    if (!release){ const e = new Error("another refresh is still running"); throw e; }
  }
  try{
    let base = tok;
    if (tokenStoreConfigured()){
      const latest = await readStoredToken(provider).catch(() => null);
      if (isFresh(latest)) return latest;             // refreshed while we waited for the lock
      if (latest?.refresh_token) base = latest;
    }
    let j;
    try{
      j = await refreshRequest(provider, base.refresh_token);
    }catch(e){
      if (isDeadGrant(e)){
        // one last look: a refresh that raced us without the lock may have stored a newer token
        const again = await getStoredToken(provider);
        if (isFresh(again) && again.refresh_token !== base.refresh_token) return again;
        e.dead = true;
      }
      throw e;
    }
    if (!j.access_token) throw new Error(`${provider} refresh returned no access token`);
    const next = {
      access_token: j.access_token,
      refresh_token: j.refresh_token || base.refresh_token,
      issued_at: base.issued_at || null,
      expires_at: j.expires_at ? j.expires_at * 1000
                : j.expires_in ? Date.now() + j.expires_in * 1000 : null,
    };
    // awaited: on Vercel the function can be frozen once the response is sent
    await setStoredToken(provider, next).catch(() => {});
    return next;
  }finally{
    await release();
  }
}

/**
 * A provider's access token, and if there isn't one, why:
 *   { token }                                    ready to use
 *   { token: null, reason: "not_connected" }     never connected (or disconnected)
 *   { token: null, reason: "needs_reauth", error }   the provider rejected the login: reconnect it
 *   { token: null, reason: "temporary", error }      couldn't renew right now; the login is kept
 * req/res are the browser's request and response (for its cookie copy);
 * pass null for both from the phone launcher, which uses the store alone.
 */
export async function tokenState(provider, req, res){
  const fromCookie = cookieToken(provider, req);
  let tok = fromCookie, storeDown = false;
  if (tokenStoreConfigured()){
    try{
      const stored = await readStoredToken(provider);
      if (stored?.access_token) tok = stored;
      else if (fromCookie && stored?.cleared_at && !(fromCookie.issued_at > stored.cleared_at)){
        // disconnected (or rejected) since this browser signed in: its copy is stale
        if (res) clearCookie(res, cookieName(provider));
        tok = null;
      }
      // the store is empty but this browser holds a login: share it
      else if (fromCookie) await setStoredToken(provider, fromCookie).catch(() => {});
    }catch(_){ storeDown = true; }
  }
  if (!tok) return storeDown && !req
    ? { token: null, reason: "temporary", error: "the token store couldn't be reached" }
    : { token: null, reason: "not_connected" };

  if (!isFresh(tok) && tok.refresh_token){
    try{
      tok = await refreshShared(provider, tok);
    }catch(e){
      const msg = String(e?.message || e).slice(0, 200);
      if (e?.dead){
        if (res) clearCookie(res, cookieName(provider));
        await clearStoredToken(provider).catch(() => {});
        await recordProblem(provider, `Sign-in rejected when renewing: ${msg}`);
        return { token: null, reason: "needs_reauth", error: msg };
      }
      await recordProblem(provider, `Couldn't renew the sign-in (will retry): ${msg}`);
      // the old access token may still have a few seconds left
      return stillValid(tok) ? { token: tok.access_token }
                             : { token: null, reason: "temporary", error: msg };
    }
  }
  // keep this browser's copy in step with the shared one
  if (res && fromCookie && (fromCookie.access_token !== tok.access_token || fromCookie.refresh_token !== tok.refresh_token))
    setCookie(res, cookieName(provider), seal({ access_token: tok.access_token, refresh_token: tok.refresh_token || null,
      expires_at: tok.expires_at || null, issued_at: tok.issued_at || fromCookie.issued_at || null }));
  return { token: tok.access_token };
}

/** Just the access token (null if there isn't a usable one) - for the browser's requests. */
export async function getToken(provider, req, res){
  return (await tokenState(provider, req, res)).token;
}

/** Same, for the phone launcher (store only - it has no cookie jar). */
export async function getTokenForLauncher(provider){
  return (await tokenState(provider, null, null)).token;
}

/** Note a problem a provider reported on a real request (e.g. a 401 from its API). */
export async function noteProblem(provider, message){
  await recordProblem(provider, message);
}
