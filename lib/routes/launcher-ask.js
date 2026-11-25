/* Talk to Atlas from the phone: POST {message, history} with the launcher
   key. The same Claude brain as the dashboard (same tools, same "ask before
   deleting" rule, same saved notes), reading your accounts through the
   server-side token copy because the phone has no cookies. Returns
   {reply, history}; the phone sends history back with the next message. */
import { converse, brainConfigured } from "../brain.js";
import { envVar, configured, getTokenForLauncher } from "../providers.js";
import { sameToken } from "../session.js";
import { syncConfigured, getSettings } from "../sync.js";

export default async function handler(req, res){
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: { code: "bad_request" } });
  const key = envVar("LAUNCHER_API_KEY");
  if (!key || !sameToken(req.headers["x-launcher-key"], key)) return res.status(401).json({ error: { code: "unauthorized" } });
  if (!brainConfigured()) return res.status(200).json({ error: { code: "not_configured", message: "The AI brain isn't set up on this deployment." } });

  let body = req.body;
  if (typeof body === "string"){ try{ body = JSON.parse(body); }catch(_){ body = null; } }
  const message = String(body?.message || "").trim().slice(0, 1000);
  if (!message) return res.status(400).json({ error: { code: "bad_request", message: "message is required" } });
  const history = Array.isArray(body?.history) ? body.history : [];

  let notes;
  if (syncConfigured()){ try{ notes = (await getSettings())?.memory; }catch(_){ /* no notes, still answer */ } }

  // the brain reads tokens through this instead of cookies
  const phoneReq = { headers: {}, launcherTokenFor: p => configured(p) ? getTokenForLauncher(p).catch(() => null) : null };
  try{
    const out = await converse({ message, history,
      notes: [...(notes || []), "They're talking to you from their phone's home screen: keep replies to one or two short sentences."] },
      phoneReq, null);
    if (out.error) return res.status(200).json({ error: out.error });
    res.json({ reply: out.reply, history: out.history });
  }catch(e){
    res.status(200).json({ error: { code: "upstream_error", message: String(e.message).slice(0, 200) } });
  }
}
