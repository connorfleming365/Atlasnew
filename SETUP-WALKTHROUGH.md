# Atlas setup — click-by-click

Personalized for your deployment: **atlasnew-ten.vercel.app**

Two values you'll paste repeatedly:

```
Redirect URI     https://atlasnew-ten.vercel.app/api/auth/callback
Callback domain  atlasnew-ten.vercel.app
```

Google and Todoist want the **full redirect URI**. Strava wants the **bare
domain**. Mixing these up is the single most common failure.

---

## Step 2 — Session secret and app URL

**2.1** Generate a secret. In any terminal:

```bash
openssl rand -hex 32
```

You'll get 64 hex characters. If you have no terminal to hand, use Node:
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

**2.2** In Vercel, open your project → **Settings** (top tabs) → **Environment
Variables** (left sidebar).

**2.3** Add the first variable:

| Field | Value |
|---|---|
| Key | `SESSION_SECRET` |
| Value | the 64 characters from 2.1 |
| Environments | tick **Production**, **Preview** and **Development** |

If there's a **Sensitive** toggle, turn it on — it stops the value being
readable back in the dashboard. Click **Save**.

**2.4** Add the second:

| Field | Value |
|---|---|
| Key | `APP_URL` |
| Value | `https://atlasnew-ten.vercel.app` |
| Environments | all three |

No trailing slash. `https://atlasnew-ten.vercel.app` ✅ ·
`https://atlasnew-ten.vercel.app/` ❌

**✅ Check:** the list shows both keys. Nothing works yet — that's expected.

---

## Step 3 — Lock the site to you

**3.1** **Settings → Deployment Protection**.

**3.2** Under **Vercel Authentication**, choose **Standard Protection** (protects
production and previews). Click **Save**.

This means only people logged into your Vercel account can load the site. It does
**not** break the OAuth connections in step 8 — those are redirects inside your
own already-signed-in browser.

**✅ Check:** open your URL in a private window. You should get a Vercel login
wall rather than Atlas.

---

## Step 4 — Google (Gmail + Calendar)

The longest step. Google renamed these screens recently, so both names are given.

### 4a. Project

1. Go to **console.cloud.google.com**.
2. Click the **project dropdown** in the top bar → **New Project**.
3. Name it `Atlas` → **Create**. Wait for the notification, then make sure the
   project dropdown now shows **Atlas** — everything after this applies to the
   selected project.

### 4b. Turn on the two APIs

1. In the top search bar type **Gmail API** → open it → **Enable**.
2. Search **Google Calendar API** → open it → **Enable**.

**✅ Check:** **APIs & Services → Enabled APIs & services** lists both.

### 4c. Consent screen

Left nav **APIs & Services → OAuth consent screen**. Newer consoles redirect you
to **Google Auth Platform**; if you land on a "Get started" page, follow it
through:

1. **App name** `Atlas`; **User support email** — your address.
2. **Audience** → **External**.
3. **Contact information** → your address.
4. Agree to the policy → **Create**.

You can **skip the Scopes screen** entirely if offered — Atlas asks for its
scopes at connect time.

### 4d. Add yourself as a test user — do not skip

1. Go to **Audience** (or **OAuth consent screen → Test users**).
2. Under **Test users** click **Add users**.
3. Enter the Google address whose mail and calendar you want Atlas to read.
4. **Save**.

Leave publishing status as **Testing**. Gmail's scopes are "restricted", so a
*published* app needs Google's verification review; a Testing app works
immediately and indefinitely for the users listed here. That's the right setup
for a personal dashboard.

**✅ Check:** your address is listed under Test users.

### 4e. Create the OAuth client

1. Left nav **Credentials** (newer: **Google Auth Platform → Clients**).
2. **Create Credentials → OAuth client ID** (newer: **Create client**).
3. **Application type: Web application**. Name it `Atlas Web`.
4. Under **Authorised redirect URIs** click **ADD URI** and paste exactly:
   ```
   https://atlasnew-ten.vercel.app/api/auth/callback
   ```
   Leave *Authorised JavaScript origins* empty.
5. **Create**.
6. A panel shows **Client ID** and **Client secret**. Copy both now — the secret
   can be re-shown from the client's page later, but it's easiest here.

**✅ Check:** the redirect URI on the client page ends in `/api/auth/callback`
and starts with `https://`.

---

## Step 5 — Todoist

1. Go to **developer.todoist.com/appconsole.html** (sign in if asked).
2. **Create a new app**.
3. **App name** `Atlas`; **App service URL** `https://atlasnew-ten.vercel.app`. **Create app**.
4. On the app's page find **OAuth redirect URL** and enter:
   ```
   https://atlasnew-ten.vercel.app/api/auth/callback
   ```
   **Save** / **Update app**.
5. Copy the **Client ID** and **Client secret** from the same page.

**✅ Check:** the redirect URL saved and is still shown after a page refresh.

---

## Step 6 — Strava

1. Go to **strava.com/settings/api**.
2. Fill the form:
   - **Application Name** `Atlas`
   - **Category** anything, e.g. *Training*
   - **Website** `https://atlasnew-ten.vercel.app`
   - **Application Description** anything
   - **Authorization Callback Domain** → **`atlasnew-ten.vercel.app`**
     — bare host only. No `https://`, no `/api/...`, no trailing slash.
3. Strava may require an app icon — any small square image will do.
4. **Create**.
5. The page then shows **Client ID** and **Client Secret** (click *Show* for the
   secret). Copy both.

**✅ Check:** the callback domain field reads exactly `atlasnew-ten.vercel.app`
with nothing else around it.

---

## Step 7 — Add the six keys, then redeploy

**7.1** Vercel → **Settings → Environment Variables**. Add all six, each ticked
for all three environments:

| Key | From |
|---|---|
| `GOOGLE_CLIENT_ID` | step 4e |
| `GOOGLE_CLIENT_SECRET` | step 4e |
| `TODOIST_CLIENT_ID` | step 5 |
| `TODOIST_CLIENT_SECRET` | step 5 |
| `STRAVA_CLIENT_ID` | step 6 |
| `STRAVA_CLIENT_SECRET` | step 6 |

Watch for whitespace — a trailing space pasted into a secret is a genuinely
common and very confusing failure.

**7.2 Redeploy.** Vercel does **not** apply new variables to the running
deployment. Go to the **Deployments** tab → the **⋯** menu on the newest one →
**Redeploy** → confirm. Wait for **Ready**.

**✅ Check:** open `https://atlasnew-ten.vercel.app/api/status`. Every provider should read
`"configured": true` and `"connected": false`, and `"sessionReady": true`.

---

## Step 8 — Connect, and allow the microphone

1. Open `https://atlasnew-ten.vercel.app` and press **WAKE ATLAS**.
2. A bar appears with **CONNECT GOOGLE / TODOIST / STRAVA**.
3. **CONNECT GOOGLE** → choose your account → you'll see
   **"Google hasn't verified this app"** → **Advanced** → **Go to Atlas
   (unsafe)** → tick the Gmail and Calendar permissions → **Continue**.
   *That warning is expected for a Testing-mode app.*
4. **CONNECT TODOIST** → **Agree**.
5. **CONNECT STRAVA** → **Authorize**. Make sure **View data about your
   activities** stays ticked.
6. Back on the dashboard, click the **microphone**. Chrome asks for permission →
   **Allow**.

**✅ You're finished when:** the connect bar is gone, all four panels show your
real data, and pressing the mic turns it teal and starts listening instead of
showing a banner. Try saying *"Atlas, brief me"* after turning on **FLOW**.

---

## Step 9 — Enable real conversation (optional)

Everything above already works without this — Atlas answers a fixed set of
exact phrases instantly and for free. This step swaps that for genuine Claude
reasoning: arbitrary phrasing, follow-up questions, and the same actions
(tasks, email, calendar) driven by real understanding of your day instead of
templates. Costs a small amount per use and replies take a couple of seconds
rather than being instant — see **SELF-HOSTING.md → The conversational
brain** for the honest trade-off before turning it on.

**9.1** **console.anthropic.com** → **API Keys** → **Create Key**. Copy it.

**9.2** Vercel → **Settings → Environment Variables** → add:

| Key | Value |
|---|---|
| `ANTHROPIC_API_KEY` | the key from 9.1 |

Production + Preview only (Sensitive can't go in Development, same as before).

**9.3 Redeploy** — required, same as every other environment variable here.

**✅ Check:** `https://atlasnew-ten.vercel.app/api/status` now shows
`"brain": {"configured": true}`. Ask Atlas something you couldn't before —
an oddly-phrased question, or two asks in one sentence — and it should
actually understand it.

**To turn it back off:** delete `ANTHROPIC_API_KEY` in Vercel and redeploy.
Atlas immediately goes back to the exact fixed-phrase behavior from before
this step — nothing else changes.

---

## Troubleshooting

Always start at **`https://atlasnew-ten.vercel.app/api/status`** — it tells you which
providers are configured (keys present) and which are connected (you've
authorised them).

| What you see | What it means |
|---|---|
| `redirect_uri_mismatch` | The provider's URI must equal `https://atlasnew-ten.vercel.app/api/auth/callback` exactly — scheme, host, path |
| Google **403 access_denied** | Your address isn't under **Test users** (step 4d) |
| Strava error on connect | Callback domain has a scheme or path in it (step 6) |
| **"That link expired"** | The state nonce lives 10 minutes. Click Connect again |
| `status` says `configured: false` | Key missing or misspelled, or you didn't redeploy after adding it |
| `sessionReady: false` | `SESSION_SECRET` isn't set for this environment |
| Panels still say *Connect…* after connecting | Token rejected on first use. Visit `/api/auth/disconnect?provider=google` then reconnect |
| Mic button still struck through | You're on the artifact, not your own domain — check the URL |

### Undoing things

- Disconnect one provider: `/api/auth/disconnect?provider=google`
- Disconnect everything: `/api/auth/disconnect`
- Revoke from the provider's side:
  [Google](https://myaccount.google.com/permissions) ·
  [Todoist](https://todoist.com/prefs/integrations) ·
  [Strava](https://www.strava.com/settings/apps)
- Kill every stored token at once: change `SESSION_SECRET` and redeploy.
