/* Request-origin checks.

   SameSite=Lax already stops a cross-site POST from carrying the session
   cookies, so CSRF is mostly closed by the cookie attributes alone. This
   is the belt to that pair of braces: it rejects anything that doesn't
   look like it came from our own page, which also covers the case of a
   browser (or a future cookie-policy change) being more permissive than
   expected. */
export function sameOrigin(req){
  const site = req.headers["sec-fetch-site"];
  // sent by every browser that can run this dashboard
  if (site) return site === "same-origin" || site === "none";
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return true;                    // curl and friends: no ambient cookies anyway
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  try { return new URL(origin).host === host; } catch { return false; }
}

export function denyCrossSite(req, res){
  if (sameOrigin(req)) return false;
  res.status(403).json({ error: { code: "blocked_by_policy",
    message: "cross-site request refused" } });
  return true;
}
