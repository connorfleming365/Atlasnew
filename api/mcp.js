/* The one data endpoint. Takes the same (server, tool, input) triple the
   claude.ai connector bridge takes and answers with the same payload
   shape, so the dashboard cannot tell which mode it is running in. */
import { SERVER_PROVIDER, configured, getToken } from "../lib/providers.js";
import { runTool, ToolError } from "../lib/tools.js";
import { denyCrossSite } from "../lib/guard.js";

export default async function handler(req, res){
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: { code: "bad_request" } });
  // this endpoint deletes mail and calendar entries — it answers to our page only
  if (denyCrossSite(req, res)) return;
  if (!process.env.SESSION_SECRET)
    return res.status(500).json({ error: { code: "upstream_error",
      message: "SESSION_SECRET is not set on this deployment" } });

  let body = req.body;
  if (typeof body === "string"){ try { body = JSON.parse(body); } catch(_) { body = null; } }
  const { server, tool, input } = body || {};
  const provider = SERVER_PROVIDER[server];
  if (!provider || !tool)
    return res.status(400).json({ error: { code: "bad_request", message: "server and tool required" } });

  if (!configured(provider))
    return res.status(200).json({ error: { code: "server_not_connected", server,
      message: `${server} is not configured on this deployment` } });

  const token = await getToken(provider, req, res);
  if (!token)
    return res.status(200).json({ error: { code: "server_not_connected", server,
      message: `${server} is not connected yet` } });

  try{
    const payload = await runTool(server, tool, input, token);
    res.json({ payload });
  }catch(e){
    const code = e instanceof ToolError ? e.code : "upstream_error";
    res.status(200).json({ error: { code, server, message: String(e.message).slice(0, 300),
      ...(code === "server_unavailable" ? { retryable: true } : {}) } });
  }
}
