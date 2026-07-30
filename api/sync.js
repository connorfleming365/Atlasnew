/* Cross-device settings sync — GET returns the saved voice choice and
   memory notes, POST saves new ones. Same-origin only, same as /api/mcp,
   since a cross-site POST could otherwise overwrite your saved notes. */
import { denyCrossSite } from "../lib/guard.js";
import { syncConfigured, getSettings, setSettings } from "../lib/sync.js";

export default async function handler(req, res){
  res.setHeader("cache-control", "no-store");
  if (denyCrossSite(req, res)) return;
  if (!syncConfigured())
    return res.status(200).json({ configured:false, voiceName:null, memory:[] });

  if (req.method === "GET"){
    try{
      const data = await getSettings();
      return res.status(200).json({ configured:true, voiceName: data?.voiceName ?? null, memory: data?.memory ?? [] });
    }catch(e){
      return res.status(200).json({ configured:true, voiceName:null, memory:[],
        error:{ code:"sync_error", message:String(e.message).slice(0, 300) } });
    }
  }

  if (req.method === "POST"){
    let body = req.body;
    if (typeof body === "string"){ try{ body = JSON.parse(body); }catch(_){ body = null; } }
    const voiceName = typeof body?.voiceName === "string" ? body.voiceName.slice(0, 120) : null;
    const memory = Array.isArray(body?.memory)
      ? body.memory.filter(n => typeof n === "string" && n.trim()).slice(0, 20).map(n => n.trim().slice(0, 200))
      : [];
    try{
      await setSettings({ voiceName, memory });
      return res.status(200).json({ ok:true });
    }catch(e){
      return res.status(502).json({ error:{ code:"sync_error", message:String(e.message).slice(0, 300) } });
    }
  }

  return res.status(405).json({ error:{ code:"bad_request" } });
}
