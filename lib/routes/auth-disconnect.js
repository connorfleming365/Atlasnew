import { PROVIDERS, cookieName } from "../providers.js";
import { clearCookie } from "../session.js";
import { sameOrigin } from "../guard.js";
import { isOwner } from "../owner.js";
import { clearStoredToken } from "../tokenStore.js";

/* Disconnect one provider (?provider=whoop) or all of them: clears this
   browser's login AND the server-side copy the phone launcher reads, so a
   disconnected account is gone everywhere. */
export default async function handler(req, res){
  if (!sameOrigin(req)) return res.status(403).send("cross-site request refused");
  if (!isOwner(req)) return res.status(401).send("Atlas is locked.");
  const only = String(req.query.provider || "");
  if (only && !PROVIDERS[only]) return res.status(400).send("Unknown provider");
  for (const id of Object.keys(PROVIDERS)){
    if (only && only !== id) continue;
    clearCookie(res, cookieName(id));
    await clearStoredToken(id).catch(() => {});
  }
  res.writeHead(302, { Location: "/?disconnected=" + encodeURIComponent(only || "all") }).end();
}
