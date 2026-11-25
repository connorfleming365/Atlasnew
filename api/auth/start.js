import { randomBytes } from "node:crypto";
import { PROVIDERS, configured, authorizeUrl } from "../../lib/providers.js";
import { setCookie } from "../../lib/session.js";
import { isOwner } from "../../lib/owner.js";

export default async function handler(req, res){
  // only the unlocked owner can connect accounts: a stranger connecting
  // theirs would replace the token copy the phone launcher reads
  if (!isOwner(req)) return res.status(401).send("Atlas is locked - open it and enter your access code first.");
  const provider = String(req.query.provider || "");
  if (!PROVIDERS[provider]) return res.status(400).send("Unknown provider");
  if (!configured(provider)){
    const p = PROVIDERS[provider];
    return res.status(503).send(
      `${p.label} isn't configured yet. Set ${p.idEnv} and ${p.secretEnv} in the ` +
      `project's environment variables, then redeploy.`);
  }
  // state nonce, echoed back by the provider and checked on the way in
  const state = randomBytes(18).toString("base64url");
  setCookie(res, `atlas_state_${provider}`, state, { maxAge: 600 });
  res.writeHead(302, { Location: authorizeUrl(provider, req, state) }).end();
}
