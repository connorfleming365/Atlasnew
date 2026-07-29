/* The one endpoint the Claude-powered brain runs through: takes an
   utterance plus the prior conversation, lets Claude reason over a
   fresh snapshot of the day and call this deployment's own connector
   actions, and returns what it decided to say. */
import { converse } from "../lib/brain.js";
import { denyCrossSite } from "../lib/guard.js";

export default async function handler(req, res){
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error:{ code:"bad_request" } });
  // This can delete email and calendar events on the user's behalf —
  // same origin policy as /api/mcp, for the same reason.
  if (denyCrossSite(req, res)) return;

  let body = req.body;
  if (typeof body === "string"){ try{ body = JSON.parse(body); }catch(_){ body = null; } }
  const { message, history } = body || {};
  if (!message || typeof message !== "string")
    return res.status(400).json({ error:{ code:"bad_request", message:"message is required" } });
  const notes = Array.isArray(body?.notes)
    ? body.notes.filter(n => typeof n === "string" && n.trim()).slice(0, 20).map(n => n.trim().slice(0, 200))
    : undefined;

  try{
    res.json(await converse({ message, history, notes }, req, res));
  }catch(e){
    res.status(200).json({ error:{ code:"upstream_error", message:String(e.message).slice(0,300) } });
  }
}
