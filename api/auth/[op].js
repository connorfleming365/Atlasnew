/* /api/auth/start, /api/auth/callback, /api/auth/disconnect - one function.
   Vercel's Hobby plan allows 12 functions per deployment, so related routes
   share one entry point; the URLs (and the OAuth redirect URI) are unchanged. */
import start from "../../lib/routes/auth-start.js";
import callback from "../../lib/routes/auth-callback.js";
import disconnect from "../../lib/routes/auth-disconnect.js";

const ROUTES = { start, callback, disconnect };

export default function handler(req, res){
  const route = ROUTES[String(req.query?.op || "")];
  if (!route) return res.status(404).json({ error: { code: "not_found" } });
  return route(req, res);
}
