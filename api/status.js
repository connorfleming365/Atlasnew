/* What this deployment can currently do. The front-end probes this at
   load to decide whether to install the hosted connector shim. */
import { PROVIDERS, SERVER_PROVIDER, cookieName, configured, envVar } from "../lib/providers.js";
import { parseCookies, unseal } from "../lib/session.js";
import { brainConfigured } from "../lib/brain.js";
import { ttsConfigured } from "../lib/tts.js";

export default function handler(req, res){
  const cookies = parseCookies(req);
  const hasSecret = Boolean(envVar("SESSION_SECRET"));
  const providers = {};
  for (const [id, p] of Object.entries(PROVIDERS)){
    const tok = hasSecret && cookies[cookieName(id)] ? unseal(cookies[cookieName(id)]) : null;
    providers[id] = {
      label: p.label,
      servers: p.servers,
      configured: configured(id),
      connected: Boolean(tok?.access_token),
    };
  }
  const servers = {};
  for (const [server, id] of Object.entries(SERVER_PROVIDER)) servers[server] = providers[id];
  res.setHeader("cache-control", "no-store");
  res.json({ hosted: true, sessionReady: hasSecret, providers, servers,
    brain: { configured: brainConfigured() },
    tts: { configured: ttsConfigured() } });
}
