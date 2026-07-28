/* Encrypted cookie sessions. Tokens never reach the browser in readable
   form and never touch a database — each provider's credentials ride in
   their own AES-256-GCM cookie, keyed from SESSION_SECRET. */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// trim() guards the same paste accident every one of these env vars is prone
// to: a trailing newline changes the derived key, so tokens sealed before a
// trim fix would silently fail to unseal after it — trim from the start.
const SECRET = (process.env.SESSION_SECRET || "").trim();
let KEY = null;
function key(){
  if (!SECRET) throw new Error("SESSION_SECRET is not set");
  return KEY || (KEY = scryptSync(SECRET, "atlas.session.v1", 32));
}

export function seal(obj){
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map(b => b.toString("base64url")).join(".");
}

export function unseal(str){
  try{
    const [iv, tag, body] = String(str).split(".").map(s => Buffer.from(s, "base64url"));
    if (!iv || !tag || !body) return null;
    const d = createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(body), d.final()]).toString("utf8"));
  }catch(_){ return null; }
}

export function parseCookies(req){
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")){
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(res, name, value, { maxAge = 60 * 60 * 24 * 365, path = "/" } = {}){
  const bits = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, "HttpOnly",
                "Secure", "SameSite=Lax", `Max-Age=${maxAge}`];
  const prev = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", [...(Array.isArray(prev) ? prev : prev ? [prev] : []), bits.join("; ")]);
}

export const clearCookie = (res, name) => setCookie(res, name, "", { maxAge: 0 });

/** Constant-time compare for the OAuth state nonce. */
export function sameToken(a, b){
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
