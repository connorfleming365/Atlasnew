/* One structured call to Claude: a system prompt, a user message, and a
   single tool whose input schema is the answer's shape. Forcing that tool
   makes the reply machine-readable JSON instead of prose to be parsed.
   Used by the day planner and inbox triage; the conversational brain has
   its own loop in lib/brain.js. */
import { envVar } from "./providers.js";

const MODEL = () => envVar("ANTHROPIC_MODEL") || "claude-haiku-4-5-20251001";
export const aiConfigured = () => Boolean(envVar("ANTHROPIC_API_KEY"));

export async function structured({ system, prompt, tool, maxTokens = 1200 }){
  if (!aiConfigured()) throw Object.assign(new Error("ANTHROPIC_API_KEY is not set"), { code: "not_configured" });
  let r;
  try{
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": envVar("ANTHROPIC_API_KEY"),
                 "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL(), max_tokens: maxTokens, system,
        tools: [tool], tool_choice: { type: "tool", name: tool.name },
        messages: [{ role: "user", content: prompt }] }),
    });
  }catch(_){
    throw Object.assign(new Error("couldn't reach the Anthropic API"), { code: "server_unavailable" });
  }
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.type === "error")
    throw Object.assign(new Error(j?.error?.message || `HTTP ${r.status}`), { code: "upstream_error" });
  const use = (j.content || []).find(b => b.type === "tool_use" && b.name === tool.name);
  if (!use) throw Object.assign(new Error("no structured answer came back"), { code: "upstream_error" });
  return use.input || {};
}
