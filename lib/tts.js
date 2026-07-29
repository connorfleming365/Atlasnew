/* Optional cloud voice: when ELEVENLABS_API_KEY is set, the browser's
   built-in speechSynthesis voices are joined by whatever's in your
   ElevenLabs account (their stock library plus any you've cloned/added
   there), fetched live so there's nothing to keep in sync here. */
import { envVar } from "./providers.js";

const KEY = envVar("ELEVENLABS_API_KEY");
const MODEL = envVar("ELEVENLABS_MODEL_ID") || "eleven_turbo_v2_5";

export const ttsConfigured = () => Boolean(KEY);

export async function listVoices(){
  const r = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": KEY },
  });
  if (!r.ok) throw new Error(`elevenlabs voices request failed (${r.status})`);
  const j = await r.json();
  return (j.voices || []).map(v => ({ id: v.voice_id, name: v.name }));
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
