/* The Android launcher's endpoints - /api/launcher/summary, /action, /ask and
   /speak - in one function (Vercel Hobby allows 12 per deployment). Each
   route checks the launcher key itself. */
import summary from "../../lib/routes/launcher-summary.js";
import action from "../../lib/routes/launcher-action.js";
import ask from "../../lib/routes/launcher-ask.js";
import speak from "../../lib/routes/launcher-speak.js";

const ROUTES = { summary, action, ask, speak };

export default function handler(req, res){
  const route = ROUTES[String(req.query?.op || "")];
  if (!route) return res.status(404).json({ error: { code: "not_found" } });
  return route(req, res);
}
