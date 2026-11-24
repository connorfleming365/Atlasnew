/* Optional cloud voice: when ELEVENLABS_API_KEY is set, the browser's
   built-in speechSynthesis voices are joined by whatever's in your
   ElevenLabs account (their stock library plus any you've cloned/added
   there), fetched live so there's nothing to keep in sync here. */
import { envVar } from "./providers.js";

const KEY = envVar("ELEVENLABS_API_KEY");
const MODEL = envVar("ELEVENLABS_MODEL_ID") || "eleven_turbo_v2_5";
// Optional: one voice for every device. A voice's name as ElevenLabs shows
// it (e.g. "Brian") or its voice ID. Read raw, not via envVar(): a name can
// legitimately contain spaces, which envVar() would cut at the first one.
const PIN = (process.env.ATLAS_VOICE || "").trim();

export const ttsConfigured = () => Boolean(KEY);

// The voice list barely changes; one fetch per warm instance per 10 minutes
// keeps /api/status quick and doesn't spend API calls on every page load.
let voiceCache = null;
export async function listVoices(){
  if (voiceCache && Date.now() - voiceCache.at < 10 * 60000) return voiceCache.voices;
  const r = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": KEY },
  });
  if (!r.ok) throw new Error(`elevenlabs voices request failed (${r.status})`);
  const j = await r.json();
  const voices = (j.voices || []).map(v => ({ id: v.voice_id, name: v.name }));
  voiceCache = { at: Date.now(), voices };
  return voices;
}

/* The site-wide voice, if ATLAS_VOICE is set: {id, name}, or {error} when
   it names no voice in this ElevenLabs account. Matching runs exact ID,
   then exact name, then a name that starts with it, because ElevenLabs
   names often carry a description ("Brian - Deep, Resonant"). */
const looksLikeId = s => /^[A-Za-z0-9]{16,40}$/.test(s);
export async function pinnedVoice(){
  if (!KEY || !PIN) return null;
  try{
    const vs = await listVoices(), p = PIN.toLowerCase();
    const v = vs.find(x => x.id === PIN) || vs.find(x => x.name.toLowerCase() === p)
           || vs.find(x => x.name.toLowerCase().startsWith(p));
    if (v) return { id: v.id, name: v.name };
    return looksLikeId(PIN) ? { id: PIN, name: null }
         : { error: `ATLAS_VOICE "${PIN}" doesn't match any voice in this ElevenLabs account` };
  }catch(e){
    // can't list right now: an ID still works; a name can't be resolved
    return looksLikeId(PIN) ? { id: PIN, name: null } : { error: String(e.message).slice(0, 200) };
  }
}

export async function synthesize(text, voiceId){
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: MODEL }),
  });
  if (!r.ok){
    const detail = await r.text().catch(() => "");
    throw new Error(`elevenlabs speech request failed (${r.status}): ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await r.arrayBuffer());
}
