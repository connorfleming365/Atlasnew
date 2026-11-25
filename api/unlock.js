/* Unlock (or lock) this browser. POST {code} checks it against
   ATLAS_ACCESS_CODE and sets the owner cookie; POST {lock:true} clears it.
   Wrong codes are slowed down and, when Upstash is configured, limited to
   10 tries per 15 minutes per address. */
import { denyCrossSite } from "../lib/guard.js";
import { codeMatches, gateConfigured, grantOwner, revokeOwner } from "../lib/owner.js";
import { envVar } from "../lib/providers.js";

const WINDOW_S = 15 * 60, MAX_TRIES = 10;
const memTries = new Map();   // per warm instance, when Upstash isn't set up

async function tooMany(ip){
  const url = envVar("UPSTASH_REDIS_REST_URL"), token = envVar("UPSTASH_REDIS_REST_TOKEN");
  const key = `atlas:unlock:${ip}`;
  if (url && token){
    try{
      const h = { authorization: `Bearer ${token}` };
      const n = (await (await fetch(`${url}/incr/${encodeURIComponent(key)}`, { headers: h })).json()).result;
      if (n === 1) await fetch(`${url}/expire/${encodeURIComponent(key)}/${WINDOW_S}`, { headers: h });
      return n > MAX_TRIES;
    }catch(_){ /* fall through to the in-memory count */ }
  }
  const now = Date.now(), e = memTries.get(ip);
  const next = e && now - e.at < WINDOW_S * 1000 ? { at: e.at, n: e.n + 1 } : { at: now, n: 1 };
  memTries.set(ip, next);
  return next.n > MAX_TRIES;
}

export default async function handler(req, res){
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: { code: "bad_request" } });
  if (denyCrossSite(req, res)) return;
  let body = req.body;
  if (typeof body === "string"){ try{ body = JSON.parse(body); }catch(_){ body = null; } }

  if (body?.lock){ revokeOwner(res); return res.json({ ok: true, locked: true }); }
  if (!gateConfigured() || !process.env.SESSION_SECRET)
    return res.status(503).json({ error: { code: "gate_not_configured",
      message: "Set ATLAS_ACCESS_CODE (and SESSION_SECRET) on this deployment, then redeploy." } });

  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim();
  if (await tooMany(ip))
    return res.status(429).json({ error: { code: "rate_limited", message: "Too many tries - wait 15 minutes." } });

  if (!codeMatches(body?.code)){
    await new Promise(r => setTimeout(r, 600));   // makes guessing slow even without the limiter
    return res.status(401).json({ error: { code: "wrong_code", message: "That code isn't right." } });
  }
  grantOwner(res);
  res.json({ ok: true });
}
