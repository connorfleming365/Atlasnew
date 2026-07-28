import { PROVIDERS, cookieName, exchangeCode } from "../../lib/providers.js";
import { parseCookies, seal, setCookie, clearCookie, sameToken } from "../../lib/session.js";

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

const page = (title, body) => `<!doctype html><meta charset="utf-8">
<title>Atlas — ${esc(title)}</title>
<style>body{background:#070d11;color:#e8f1ef;font:15px/1.5 system-ui,-apple-system,sans-serif;
display:grid;place-items:center;height:100vh;margin:0;text-align:center}
a{color:#45e0be}code{font-family:ui-monospace,monospace;color:#9db2b5;word-break:break-all}
div{max-width:46ch;padding:24px}</style><div>${body}</div>`;

export default async function handler(req, res){
  res.setHeader("content-type", "text/html; charset=utf-8");
  // nothing on this page is meant to run scripts or be framed
  res.setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");

  const { code, state, error } = req.query;
  const cookies = parseCookies(req);
  // the provider echoes our state; find which pending handshake it belongs to
  const provider = Object.keys(PROVIDERS)
    .find(p => cookies[`atlas_state_${p}`] && sameToken(cookies[`atlas_state_${p}`], state));

  if (error)
    return res.status(400).send(page("Declined",
      `<h2>Connection declined</h2><p><code>${esc(String(error).slice(0,120))}</code></p>
       <p><a href="/">Back to Atlas</a></p>`));
  if (!provider)
    return res.status(400).send(page("Expired",
      `<h2>That link expired</h2><p>Start the connection again from the dashboard.</p>
       <p><a href="/">Back to Atlas</a></p>`));
  if (!code)
    return res.status(400).send(page("Incomplete",
      `<h2>No authorisation code came back</h2><p><a href="/">Back to Atlas</a></p>`));

  try{
    const tokens = await exchangeCode(provider, code, req);
    if (!tokens.access_token) throw new Error("no access token returned");
    clearCookie(res, `atlas_state_${provider}`);
    const sealed = seal(tokens);
    // 4 KB is the per-cookie ceiling; fail loudly rather than silently dropping it
    if (sealed.length > 3800) throw new Error("token bundle too large to store in a cookie");
    setCookie(res, cookieName(provider), sealed);
    res.writeHead(302, { Location: `/?connected=${encodeURIComponent(provider)}` }).end();
  }catch(e){
    res.status(502).send(page("Failed",
      `<h2>Couldn't finish connecting ${esc(PROVIDERS[provider].label)}</h2>
       <p><code>${esc(String(e.message).slice(0,200))}</code></p>
       <p>Check the client ID, secret and redirect URI, then
       <a href="/api/auth/start?provider=${encodeURIComponent(provider)}">try again</a>.</p>`));
  }
}
