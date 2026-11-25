/* /api/ai/plan (plan my day) and /api/ai/triage (inbox triage) - one function. */
import plan from "../../lib/routes/plan.js";
import triage from "../../lib/routes/triage.js";

const ROUTES = { plan, triage };

export default function handler(req, res){
  const route = ROUTES[String(req.query?.op || "")];
  if (!route) return res.status(404).json({ error: { code: "not_found" } });
  return route(req, res);
}
