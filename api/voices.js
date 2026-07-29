/* Lists the cloud voices available to speak with, when a key is set.
   Returns an empty list rather than an error when it isn't configured,
   so the client can just skip the "cloud" group in the voice picker. */
import { denyCrossSite } from "../lib/guard.js";
import { ttsConfigured, listVoices } from "../lib/tts.js";

export default async function handler(req, res){
  res.setHeader("cache-control", "no-store");
  if (denyCrossSite(req, res)) return;
  if (!ttsConfigured()) return res.status(200).json({ voices: [] });
  try{
    res.status(200).json({ voices: await listVoices() });
  }catch(e){
    res.status(200).json({ voices: [], error: { code:"tts_error", message: String(e.message).slice(0, 300) } });
  }
}
