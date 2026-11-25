/* The owner gate. Atlas is a one-person dashboard on a public URL, so every
   endpoint that spends your API credit, reads or writes your saved notes, or
   starts a provider connection answers only to a browser that has unlocked
   it with ATLAS_ACCESS_CODE. Unlocking sets an encrypted, HttpOnly cookie
   that lasts a year; changing the code signs every device out.

   Fails closed: with no ATLAS_ACCESS_CODE set, nothing unlocks, and the page
   says which variable to add. The launcher endpoint has its own key and
   stays outside this gate. */
import { createHash, timingSafeEqual } from "node:crypto";
import { parseCookies, seal, unseal, setCookie, clearCookie } from "./session.js";

export const OWNER_COOKIE = "atlas_owner";
const code = () => (process.env.ATLAS_ACCESS_CODE || "").trim();
const sha = s => createHash("sha256").update(s).digest();
// ties the cookie to the current code: change the code and old cookies stop working
const fingerprint = () => sha("atlas.owner.v1:" + code()).toString("base64url").slice(0, 22);

export const gateConfigured = () => code().length > 0;

export function isOwner(req){
  if (!gateConfigured() || !process.env.SESSION_SECRET) return false;
  const v = unseal(parseCookies(req)[OWNER_COOKIE]);
  return Boolean(v && v.o === 1 && v.f === fingerprint());
}

/** Constant-time check of a typed code against ATLAS_ACCESS_CODE. */
export function codeMatches(attempt){
  if (!gateConfigured()) return false;
  return timingSafeEqual(sha(String(attempt || "").trim()), sha(code()));
}

export function grantOwner(res){ setCookie(res, OWNER_COOKIE, seal({ o: 1, f: fingerprint() })); }
export function revokeOwner(res){ clearCookie(res, OWNER_COOKIE); }

/** For API routes: answers 401 and returns true when the caller isn't the owner. */
export function denyUnlessOwner(req, res){
  if (isOwner(req)) return false;
  res.status(401).json({ error: { code: "locked",
    message: gateConfigured() ? "Atlas is locked - enter your access code"
                              : "Set ATLAS_ACCESS_CODE on this deployment to unlock Atlas" } });
  return true;
}
