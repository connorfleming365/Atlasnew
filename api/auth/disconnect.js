import { PROVIDERS, cookieName } from "../../lib/providers.js";
import { clearCookie } from "../../lib/session.js";

export default function handler(req, res){
  const only = String(req.query.provider || "");
  for (const id of Object.keys(PROVIDERS))
    if (!only || only === id) clearCookie(res, cookieName(id));
  res.writeHead(302, { Location: "/" }).end();
}
