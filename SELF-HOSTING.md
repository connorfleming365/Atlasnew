# Self-hosting Atlas

Run Atlas on your own domain and you get the half the artifact can't give you:
**a working microphone**. The page is served top-level rather than inside an
embedded frame, so the browser asks you for the mic directly.

The trade-off is that `window.claude.mcp` doesn't exist outside the artifact, so
this deployment brings its own connector bridge: `/api/mcp` speaks the same
`(server, tool, input)` triple and answers in the same payload shapes. The
dashboard cannot tell which mode it's running in — `index.html` is byte-identical
in both.

```
index.html          the dashboard (detects hosted mode at load)
api/status.js       what this deployment can do
api/mcp.js          the connector bridge
api/auth/*.js       OAuth start / callback / disconnect
lib/session.js      AES-256-GCM encrypted cookies
lib/providers.js    OAuth config + token refresh
lib/tools.js        provider REST → connector payload shapes
```

Tokens live in encrypted, HttpOnly cookies keyed from `SESSION_SECRET`. There is
no database, and no token is ever readable by the browser.

---

## Security model — read this before deploying

**What protects your data.** Provider tokens are sealed with AES-256-GCM and
stored in `HttpOnly; Secure; SameSite=Lax` cookies, so page scripts can't read
them and a cross-site POST can't spend them. `/api/mcp` and `/api/auth/disconnect`
additionally refuse any request that isn't same-origin. The OAuth handshake is
bound by a random state nonce compared in constant time. Nothing is logged or
persisted server-side; a deployment with no cookie has no access to anything.

**The deployment is public, and that is the thing to understand.** There is no
login. Anyone with the URL can load the dashboard — they will see the *connect*
screen, not your data, because they don't have your cookies. But they could
connect their own accounts through your deployment and use it as a free proxy.
For a personal URL nobody knows, that's an acceptable risk. If you'd rather close
it, put Vercel's Deployment Protection in front of the project (Settings →
Deployment Protection), which gates the whole site behind your Vercel login.

**Set `APP_URL`.** Without it the OAuth redirect is derived from the request's
`Host` header. Providers reject redirect URIs that aren't on their registered
list, so this isn't exploitable on its own — but pinning it removes the question
entirely.

**Scopes are broader than read-only, by design.** `gmail.modify` is what lets
Atlas archive and trash; it deliberately stops short of `mail.google.com`, so
nothing it does is unrecoverable — trashed mail sits in Trash for 30 days. The
Calendar scope is full read/write because Atlas creates and deletes focus blocks.
If you want to narrow either, edit `PROVIDERS` in `lib/providers.js` and disable
the matching actions.

**Rotating access.** `SESSION_SECRET` is the master key: change it and every
stored token becomes undecryptable, which is the fastest kill switch. You can
also revoke per provider at
[Google](https://myaccount.google.com/permissions),
[Todoist](https://todoist.com/prefs/integrations) and
[Strava](https://www.strava.com/settings/apps).

---

## 1. Deploy

Import this repository at [vercel.com/new](https://vercel.com/new). No build
settings needed — it's static files plus serverless functions. The first deploy
will succeed and show a "needs its API keys" banner; that's expected.

Note the domain it gives you (e.g. `atlas-yourname.vercel.app`). Every redirect
URI below uses it.

## 2. Session secret

Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add it in Vercel under **Settings → Environment Variables** as `SESSION_SECRET`.
Add `APP_URL` at the same time, set to your deployment's URL
(`https://YOUR-DOMAIN`, no trailing slash).

## 3. Google (Gmail + Calendar)

At [console.cloud.google.com](https://console.cloud.google.com):

1. Create a project.
2. **APIs & Services → Library** — enable **Gmail API** and **Google Calendar API**.
3. **OAuth consent screen** — User Type **External**, then leave it in **Testing**
   and add your own Google address under **Test users**.
   *Gmail's scopes are "restricted", so a published app would need Google's
   verification review. An app left in Testing works immediately and
   indefinitely for the test users you list — which for a personal dashboard is
   the right setup, not a workaround.*
4. **Credentials → Create credentials → OAuth client ID → Web application**.
   Authorised redirect URI:
   `https://YOUR-DOMAIN/api/auth/callback`
5. Copy the client ID and secret into Vercel as `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`.

Scopes requested: `calendar` and `gmail.modify` — enough to read mail, label,
archive and trash, and to create and delete calendar events.

## 4. Todoist

At [developer.todoist.com/appconsole.html](https://developer.todoist.com/appconsole.html):
create an app, set the OAuth redirect URL to `https://YOUR-DOMAIN/api/auth/callback`,
then copy the credentials into `TODOIST_CLIENT_ID` and `TODOIST_CLIENT_SECRET`.

## 5. Strava

At [strava.com/settings/api](https://www.strava.com/settings/api): create an app.
**Authorisation Callback Domain** is just the bare domain — `YOUR-DOMAIN`, with no
`https://` and no path. Copy into `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET`.

## 6. Redeploy and connect

Redeploy so the new variables are picked up, open the site, press **WAKE ATLAS**,
and use the **Connect** buttons. Allow the microphone when the browser asks.

---

## Running it locally

```bash
npm i -g vercel
vercel dev            # http://localhost:3000
```

Add `http://localhost:3000/api/auth/callback` as an extra redirect URI on each
provider, and put the variables in a local `.env` (see `.env.example`).
`http://localhost` counts as a secure origin, so the microphone works there too.

## If something doesn't connect

- **"That link expired"** — the state cookie timed out (10 minutes). Start again.
- **`redirect_uri_mismatch`** — the URI at the provider must match
  `https://YOUR-DOMAIN/api/auth/callback` exactly, including scheme.
- **Google 403 `access_denied`** — your address isn't in **Test users**.
- **Panels say "Connect …" after connecting** — the token was rejected on first
  use; disconnect at `/api/auth/disconnect?provider=google` and retry.
- Check what the deployment thinks it has at `/api/status`.
