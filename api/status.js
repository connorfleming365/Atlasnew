/* What this deployment can currently do. The front-end probes this at
   load to decide whether to install the hosted connector shim. */
import { PROVIDERS, SERVER_PROVIDER, configured, envVar, getToken } from "../lib/providers.js";
import { brainConfigured } from "../lib/brain.js";
import { ttsConfigured } from "../lib/tts.js";
import { syncConfigured } from "../lib/sync.js";

export default async function handler(req, res){
  const hasSecret = Boolean(envVar("SESSION_SECRET"));
  const providers = {};
  // Actually exercises each token (refreshing it, or clearing it if the
  // refresh itself fails) rather than just checking a cookie exists — a
  // cookie can be present and "connected" would still be a lie once the
  // refresh token behind it has died (e.g. Google expires refresh tokens
  // after 7 days for an app still in Testing publish status). getToken()
  // only makes a real network call when the current access token is
  // actually near expiry, so this stays cheap in the common case.
  await Promise.all(Object.entries(PROVIDERS).map(async ([id, p]) => {
    const accessToken = hasSecret && configured(id) ? await getToken(id, req, res).catch(() => null) : null;
    providers[id] = {
      label: p.label,
      servers: p.servers,
      configured: configured(id),
      connected: Boolean(accessToken),
    };
  }));
  const servers = {};
  for (const [server, id] of Object.entries(SERVER_PROVIDER)) servers[server] = providers[id];
  res.setHeader("cache-control", "no-store");
  res.json({ hosted: true, sessionReady: hasSecret, providers, servers,
    brain: { configured: brainConfigured() },
    tts: { configured: ttsConfigured() },
    sync: { configured: syncConfigured() } });
}
