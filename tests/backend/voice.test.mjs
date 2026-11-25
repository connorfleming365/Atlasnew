// Tests ATLAS_VOICE resolution and enforcement. Each case runs in a fresh
// process because lib/tts.js reads its env vars once at import.
import { execFileSync } from "node:child_process";
const TTS_URL = new URL("../../lib/tts.js", import.meta.url).href;
const TTS_API_URL = new URL("../../api/tts.js", import.meta.url).href;
const fails = [];
const check = (name, ok, got) => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  got: " + JSON.stringify(got))); if (!ok) fails.push(name); };

const CHILD = `
process.env.ELEVENLABS_API_KEY = "k";
const voices = [{ voice_id: "pNInz6obpgDQGcFmaJgB", name: "Adam" },
                { voice_id: "nPczCjzI2devNBz1zQrb", name: "Brian - Deep, Resonant" },
                { voice_id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte" }];
let listCalls = 0, ttsVoice = null;
globalThis.fetch = async (url, opts) => {
  if (String(url).endsWith("/v1/voices")) {
    listCalls++;
    if (process.env.LIST_FAILS) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ voices }) };
  }
  ttsVoice = decodeURIComponent(String(url).split("/text-to-speech/")[1]);
  return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) };
};
const tts = await import("${TTS_URL}");
const handler = (await import("${TTS_API_URL}")).default;
const pin = await tts.pinnedVoice();
await tts.pinnedVoice();                               // second call should hit the cache
const res = { headers: {}, code: 0, setHeader(k, v){ this.headers[k] = v; }, status(c){ this.code = c; return this; },
              end(){ return this; }, json(){ return this; } };
await handler({ method: "POST", headers: { "sec-fetch-site": "same-origin" },
                body: { text: "hello", voiceId: "SomeOtherVoiceId000000" } }, res);
console.log(JSON.stringify({ pin, listCalls, ttsVoice }));
`;
const run = env => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", CHILD],
  { env: { ...process.env, ...env }, encoding: "utf8" }).trim().split("\n").pop());

let r = run({ ATLAS_VOICE: "Charlotte" });
check("exact name → its ID", r.pin?.id === "XB0fDUnXU5powFXDhCwa" && r.pin.name === "Charlotte", r.pin);
check("server speaks with the pinned voice, not the one the browser asked for", r.ttsVoice === "XB0fDUnXU5powFXDhCwa", r.ttsVoice);
check("voice list fetched once, then cached", r.listCalls === 1, r.listCalls);

r = run({ ATLAS_VOICE: "  brian " });
check("prefix + case-insensitive + trimmed: 'brian' → Brian - Deep, Resonant", r.pin?.id === "nPczCjzI2devNBz1zQrb", r.pin);

r = run({ ATLAS_VOICE: "pNInz6obpgDQGcFmaJgB" });
check("voice ID works directly", r.pin?.id === "pNInz6obpgDQGcFmaJgB" && r.pin.name === "Adam", r.pin);

r = run({ ATLAS_VOICE: "Morgan Freeman" });
check("unknown name → clear error, no pin", !r.pin?.id && /doesn't match any voice/.test(r.pin?.error || ""), r.pin);
check("unknown name: browser's own choice is used", r.ttsVoice === "SomeOtherVoiceId000000", r.ttsVoice);

r = run({ ATLAS_VOICE: "XB0fDUnXU5powFXDhCwa", LIST_FAILS: "1" });
check("voice list down: an ID still pins", r.pin?.id === "XB0fDUnXU5powFXDhCwa", r.pin);

r = run({ ATLAS_VOICE: "" });
check("unset → no pin, browser choice used", r.pin === null && r.ttsVoice === "SomeOtherVoiceId000000", r);

console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
