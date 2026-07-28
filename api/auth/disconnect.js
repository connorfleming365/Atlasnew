import { PROVIDERS, cookieName } from "../../lib/providers.js";
import { clearCookie } from "../../lib/session.js";
import { sameOrigin } from "../../lib/guard.js";

export default function handler(req, res){
  if (!sameOrigin(req)) return res.status(403).send("cross-site request refused");
  const only = String(req.query.provider || "");
  if (only && !PROVIDERS[only]) return res.status(400).send("Unknown provider");
  for (const id of Object.keys(PROVIDERS))
    if (!only || only === id) clearCookie(res, cookieName(id));
  res.writeHead(302, { Location: "/" }).end();
}
