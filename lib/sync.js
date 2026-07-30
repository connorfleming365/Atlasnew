/* Optional cross-device sync for two small settings — the chosen voice and
   standing memory notes — via Upstash Redis's REST API (a genuinely free
   tier, and HTTP-based so it fits this project's plain-fetch pattern with
   no persistent connection to manage). Without the two env vars below,
   everything stays exactly as it's always been: localStorage only, one
   browser at a time.

   The stored blob is sealed with the same AES-256-GCM/SESSION_SECRET
   mechanism already protecting provider tokens, so a leaked Upstash token
   alone doesn't hand over plaintext notes — this is the one exception to
   "nothing persisted server-side," and it's encrypted the same way
   everything else here already is. */
import { envVar } from "./providers.js";
import { seal, unseal } from "./session.js";

const URL_ = envVar("UPSTASH_REDIS_REST_URL");
const TOKEN = envVar("UPSTASH_REDIS_REST_TOKEN");
const KEY = "atlas:settings";

export const syncConfigured = () => Boolean(URL_ && TOKEN);

export async function getSettings(){
  if (!syncConfigured()) return null;
  const r = await fetch(`${URL_}/get/${KEY}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`upstash get failed (${r.status})`);
  const j = await r.json();
  return j.result ? unseal(j.result) : null;
}

export async function setSettings(data){
  if (!syncConfigured()) throw new Error("sync is not configured on this deployment");
  const r = await fetch(`${URL_}/set/${KEY}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: seal(data),
  });
  if (!r.ok) throw new Error(`upstash set failed (${r.status})`);
}
