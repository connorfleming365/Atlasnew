import { randomBytes } from "node:crypto";
import { PROVIDERS, configured, authorizeUrl } from "../../lib/providers.js";
import { setCookie } from "../../lib/session.js";

export default async function handler(req, res){
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
