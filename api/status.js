/* What this deployment can currently do. The front-end probes this at
   load to decide whether to install the hosted connector shim. */
import { PROVIDERS, SERVER_PROVIDER, configured, envVar, tokenState } from "../lib/providers.js";
import { brainConfigured } from "../lib/brain.js";
import { ttsConfigured, pinnedVoice } from "../lib/tts.js";
import { syncConfigured } from "../lib/sync.js";
import { isOwner, gateConfigured } from "../lib/owner.js";
import { tokenStoreConfigured, getStoredToken, lastProblem } from "../lib/tokenStore.js";

export default async function handler(req, res){
  res.setHeader("cache-control", "no-store");
  // a locked browser learns only that it's locked - nothing about what's connected
  if (!isOwner(req))
    return res.json({ hosted: true, locked: true, gate: gateConfigured() ? "code" : "unset" });
  const hasSecret = Boolean(envVar("SESSION_SECRET"));
  const providers = {};
  // Actually exercises each login (refreshing it when it's near expiry)
  // rather than just checking one exists: "connected" would be a lie once
  // the provider has rejected the refresh token (e.g. Google expires them
  // after 7 days for an app still in Testing publish status). A refresh
  // that fails only temporarily keeps the login and reports `trouble`.
  // tokenState() shares one login and one refresh lock with every other
  // browser and the phone (lib/providers.js), so this can't race them.
  await Promise.all(Object.entries(PROVIDERS).map(async ([id, p]) => {
    const st = hasSecret && configured(id)
      ? await tokenState(id, req, res).catch(e => ({ token: null, reason: "temporary", error: String(e?.message || e) }))
      : { token: null, reason: "not_connected" };
    providers[id] = {
      label: p.label,
      servers: p.servers,
      configured: configured(id),
      // still connected while it's only in temporary trouble - the login is kept
      connected: Boolean(st.token) || st.reason === "temporary",
      trouble: st.reason === "temporary" ? String(st.error || "temporary trouble") : null,
      needsReauth: st.reason === "needs_reauth",
      // the last problem seen, {at, message} - shown in Accounts so a drop isn't a mystery
      lastProblem: configured(id) ? await lastProblem(id) : null,
      // can the phone launcher reach it? (null when there's no server-side store)
      phone: tokenStoreConfigured() && configured(id) ? Boolean(await getStoredToken(id).catch(() => null)) : null,
    };
  }));
  const servers = {};
  for (const [server, id] of Object.entries(SERVER_PROVIDER)) servers[server] = providers[id];
  res.setHeader("cache-control", "no-store");
  res.json({ hosted: true, sessionReady: hasSecret, providers, servers,
    brain: { configured: brainConfigured() },
    // pinned: the site-wide voice (ATLAS_VOICE) as {id, name}, {error}, or null
    tts: { configured: ttsConfigured(), pinned: await pinnedVoice() },
    sync: { configured: syncConfigured() } });
}
