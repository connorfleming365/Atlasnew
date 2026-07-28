import { PROVIDERS, cookieName, exchangeCode } from "../../lib/providers.js";
import { parseCookies, seal, setCookie, clearCookie, sameToken } from "../../lib/session.js";

const page = (title, body) => `<!doctype html><meta charset="utf-8">
<title>Atlas — ${title}</title>
<style>body{background:#070d11;color:#e8f1ef;font:15px/1.5 system-ui,-apple-system,sans-serif;
display:grid;place-items:center;height:100vh;margin:0;text-align:center}
a{color:#45e0be}code{font-family:ui-monospace,monospace;color:#9db2b5}
div{max-width:46ch;padding:24px}</style><div>${body}</div>`;

export default async function handler(req, res){
  const { code, state, error } = req.query;
  // the provider echoes our state; find which one this belongs to
  const cookies = parseCookies(req);
  const provider = Object.keys(PROVIDERS)
    .find(p => cookies[`atlas_state_${p}`] && sameToken(cookies[`atlas_state_${p}`], state));

  if (error)
    return res.status(400).send(page("Declined",
      `<h2>Connection declined</h2><p>${String(error).slice(0,120)}</p><p><a href="/">Back to Atlas</a></p>`));
  if (!provider)
    return res.status(400).send(page("Expired",
      `<h2>That link expired</h2><p>Start the connection again from the dashboard.</p>
       <p><a href="/">Back to Atlas</a></p>`));

  try{
    const tokens = await exchangeCode(provider, code, req);
    if (!tokens.access_token) throw new Error("no access token returned");
    clearCookie(res, `atlas_state_${provider}`);
    setCookie(res, cookieName(provider), seal(tokens));
    res.writeHead(302, { Location: "/?connected=" + provider }).end();
  }catch(e){
    res.status(502).send(page("Failed",
      `<h2>Couldn't finish connecting ${PROVIDERS[provider].label}</h2>
       <p><code>${String(e.message).slice(0,200).replace(/[<>&]/g, "")}</code></p>
       <p>Check the client ID, secret and redirect URI, then
       <a href="/api/auth/start?provider=${provider}">try again</a>.</p>`));
  }
}
