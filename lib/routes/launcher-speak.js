/* The phone's spoken replies in the same voice as the dashboard:
   POST {text} with the launcher key → MP3 in the pinned ElevenLabs voice
   (ATLAS_VOICE). 204 when no voice is pinned or ElevenLabs isn't set up -
   the phone then uses its own built-in voice. */
import { envVar } from "../providers.js";
import { sameToken } from "../session.js";
import { ttsConfigured, synthesize, pinnedVoice } from "../tts.js";

export default async function handler(req, res){
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: { code: "bad_request" } });
  const key = envVar("LAUNCHER_API_KEY");
  if (!key || !sameToken(req.headers["x-launcher-key"], key)) return res.status(401).json({ error: { code: "unauthorized" } });

  let body = req.body;
  if (typeof body === "string"){ try{ body = JSON.parse(body); }catch(_){ body = null; } }
  const text = String(body?.text || "").slice(0, 600);
  if (!text) return res.status(400).json({ error: { code: "bad_request" } });
  const pin = ttsConfigured() ? await pinnedVoice() : null;
  if (!pin?.id) return res.status(204).end();
  try{
    const mp3 = await synthesize(text, pin.id);
    res.setHeader("content-type", "audio/mpeg");
    res.status(200).end(mp3);
  }catch(_){ res.status(204).end(); }
}
