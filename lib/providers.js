/* OAuth provider definitions and token lifecycle.

   Google's Gmail scopes are "restricted": a published app needs Google's
   verification review, but an app left in Testing mode with your own
   account as a test user works immediately and indefinitely for you.
   That is the intended setup here — this is a personal dashboard, not a
   product. */
import { parseCookies, seal, unseal, setCookie, clearCookie } from "./session.js";

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
};

export const SERVER_PROVIDER = {
  "Gmail": "google",
  "Google Calendar": "google",
  "Todoist": "todoist",
  "Strava": "strava",
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
  if (!r.ok) throw new Error(`${provider} token exchange failed (${r.status}): ${text.slice(0,200)}`);
  return json;
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
  };
}

/** Read a provider's tokens, refreshing in place when they've expired. */
export async function getToken(provider, req, res){
  const raw = parseCookies(req)[cookieName(provider)];
  const tok = raw && unseal(raw);
  if (!tok?.access_token) return null;
  const fresh = !tok.expires_at || tok.expires_at - Date.now() > 60_000;
  if (fresh || !tok.refresh_token) return tok.access_token;
  try{
    const j = await tokenRequest(provider, {
      grant_type: "refresh_token",
      refresh_token: tok.refresh_token,
    });
    const next = {
      access_token: j.access_token,
      refresh_token: j.refresh_token || tok.refresh_token,
      expires_at: j.expires_at ? j.expires_at * 1000
                : j.expires_in ? Date.now() + j.expires_in * 1000 : null,
    };
    if (res) setCookie(res, cookieName(provider), seal(next));
    return next.access_token;
  }catch(_){
    // The refresh token itself is dead — e.g. Google expires refresh tokens
    // after 7 days for an app still in Testing publish status, unrelated to
    // anything short-lived. Clearing the cookie here matters: leaving the
    // broken blob in place would make /api/status keep reporting
    // "connected" (it only checks a token exists, not that it still works)
    // indefinitely, masking the real state until someone actually tried to
    // use it and hit a live server_not_connected.
    if (res) clearCookie(res, cookieName(provider));
    return null;              // surfaces as needs_reauth upstream
  }
}
