/* Server-side token persistence for the Android launcher's polling endpoint.
   Same Upstash Redis + AES-256-GCM sealing as lib/sync.js's cross-device
   settings sync - this is the second (and only other) exception to
   "nothing persisted server-side" described in session.js, made for the
   same reason sync.js was: the launcher has no browser cookie jar to carry
   provider tokens in, so a copy has to live somewhere the server can reach
   without one. Without the two Upstash env vars, this is a no-op throughout
   and the launcher's dashboard endpoint simply reports no connected data. */
import { seal, unseal } from "./session.js";

function envVar(name){
  const raw = process.env[name];
  if (!raw) return raw;
  const clean = raw.trim();
  return clean.includes("\n") || clean.includes(" ") ? clean.split(/\s+/)[0] : clean;
}

const URL_ = envVar("UPSTASH_REDIS_REST_URL");
const TOKEN = envVar("UPSTASH_REDIS_REST_TOKEN");
const keyFor = provider => `atlas:tokens:${provider}`;

export const tokenStoreConfigured = () => Boolean(URL_ && TOKEN);

export async function getStoredToken(provider){
  if (!tokenStoreConfigured()) return null;
  const r = await fetch(`${URL_}/get/${keyFor(provider)}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) return null;
  const j = await r.json();
  return j.result ? unseal(j.result) : null;
}

export async function setStoredToken(provider, tokens){
  if (!tokenStoreConfigured()) return;
  await fetch(`${URL_}/set/${keyFor(provider)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: seal(tokens),
  });
}

export async function clearStoredToken(provider){
  if (!tokenStoreConfigured()) return;
  await fetch(`${URL_}/del/${keyFor(provider)}`, { headers: { authorization: `Bearer ${TOKEN}` } });
}
