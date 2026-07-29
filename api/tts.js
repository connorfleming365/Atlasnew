/* Turns a line of reply text into an MP3 using a cloud voice. Only
   reached when the client has picked a cloud voice from the picker;
   the default (Auto, and every plain browser voice) never calls this. */
import { denyCrossSite } from "../lib/guard.js";
import { ttsConfigured, synthesize } from "../lib/tts.js";

export default async function handler(req, res){
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error:{ code:"bad_request" } });
  if (denyCrossSite(req, res)) return;
  if (!ttsConfigured())
    return res.status(400).json({ error:{ code:"tts_not_configured", message:"ELEVENLABS_API_KEY is not set" } });

  let body = req.body;
  if (typeof body === "string"){ try{ body = JSON.parse(body); }catch(_){ body = null; } }
  const text = String(body?.text || "").slice(0, 600);
  const voiceId = String(body?.voiceId || "");
  if (!text || !voiceId)
    return res.status(400).json({ error:{ code:"bad_request", message:"text and voiceId are required" } });

  try{
    const mp3 = await synthesize(text, voiceId);
    res.setHeader("content-type", "audio/mpeg");
    res.status(200).end(mp3);
  }catch(e){
    res.status(502).json({ error:{ code:"tts_error", message: String(e.message).slice(0, 300) } });
  }
}
