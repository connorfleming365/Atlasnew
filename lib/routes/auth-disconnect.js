import { PROVIDERS, cookieName } from "../providers.js";
import { clearCookie } from "../session.js";
import { sameOrigin } from "../guard.js";
import { isOwner } from "../owner.js";

export default function handler(req, res){
  if (!sameOrigin(req)) return res.status(403).send("cross-site request refused");
  if (!isOwner(req)) return res.status(401).send("Atlas is locked.");
  const only = String(req.query.provider || "");
  if (only && !PROVIDERS[only]) return res.status(400).send("Unknown provider");
  for (const id of Object.keys(PROVIDERS))
    if (!only || only === id) clearCookie(res, cookieName(id));
  res.writeHead(302, { Location: "/" }).end();
}
