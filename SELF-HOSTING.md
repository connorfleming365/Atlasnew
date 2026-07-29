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
api/brain.js        the Claude-powered conversational brain
api/voices.js       lists your ElevenLabs voices, if configured
api/tts.js          turns a reply into an mp3 with a chosen cloud voice
api/auth/*.js       OAuth start / callback / disconnect
lib/session.js      AES-256-GCM encrypted cookies
lib/providers.js    OAuth config + token refresh
lib/tools.js        provider REST → connector payload shapes
lib/brain.js        context assembly + tool-calling loop for the brain
lib/tts.js          ElevenLabs voice list + speech synthesis
```

## Cloud voices

The voice picker in the dock always offers whatever `speechSynthesis` finds
installed on your OS/browser. Set `ELEVENLABS_API_KEY` (from
[elevenlabs.io](https://elevenlabs.io) → Settings → API Keys) and it also
fetches your ElevenLabs account's voice list — their stock library plus
anything you've added or cloned there — into a "Cloud" group in the same
dropdown. Picking one previews it immediately.

Each spoken reply then costs one ElevenLabs API call (billed by their
per-character pricing) instead of being free and instant like the browser's
own synthesis, and takes a little longer per reply since audio has to be
generated and downloaded before it plays. If a request ever fails — bad key,
account limit, offline — Atlas automatically falls back to the local browser
voice for that reply rather than staying silent. Leave `ELEVENLABS_API_KEY`
unset and nothing changes: the picker just doesn't show the Cloud group.

## The conversational brain

By default, voice and typed input are handled by a fixed set of phrase matches
("brief me", "add task …") — instant, free, and completely literal. Setting
`ANTHROPIC_API_KEY` replaces that with real Claude reasoning: arbitrary
phrasing, follow-up conversation, and tool access to the same actions (add/
reschedule tasks, archive/delete/read email, create/delete calendar events),
driven by a fresh snapshot of the day rather than canned templates.

**Cost and latency, honestly.** Each exchange is a few hundred tokens —
fractions of a cent on the default model (`claude-haiku-4-5-20251001`), more
on `claude-sonnet-5` if you set `ANTHROPIC_MODEL`. Replies take 1–3 seconds
rather than the instant regex match, longer if a tool call is involved (a
second round trip). Get a key at
[console.anthropic.com](https://console.anthropic.com) → API Keys.

**Revert point.** The original fixed-phrase brain is preserved exactly as it
was, untouched, on the `checkpoint/regex-brain-v1` branch — and it's still
what runs automatically wherever there's no backend to call Claude from (the
claude.ai artifact, or a plain file opened locally), regardless of whether
this deployment has a key set. To go back to it here too, just remove
`ANTHROPIC_API_KEY` — the app checks for it at runtime.

**Confirmation policy.** The system prompt instructs Claude to confirm in
words before archiving/deleting email or deleting a calendar event, and to
just proceed for everything else (adding a task, rescheduling, creating a
focus block, reading mail aloud).

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

> For a click-by-click version of everything below, see
> [SETUP-WALKTHROUGH.md](SETUP-WALKTHROUGH.md).

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
