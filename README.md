# Atlas — Daily Agent Dashboard

A single-file interactive dashboard that acts as a daily AI support agent. A living
character ("Atlas") sits centre-screen, surrounded by four live widgets fed by
claude.ai connectors.

## The character — Shoal

Atlas is a flock of liquid-metal droplets painted into a single metaball matte,
and **coherence is the only dial**. Gathered, the droplets fuse into a body that
carries the face. Let it slip, and the face doesn't fade out — it stops existing,
because there is no longer one surface for it to sit on. The body is never drawn:
it is what the flock does when it agrees.

| State | What it does |
|---|---|
| Waking | the flock arrives out of nothing and agrees for the first time |
| Idle | mostly gathered, loose droplets grazing the surface |
| Listening | fully fused and still — the face at its clearest; the surface carries real microphone amplitude |
| Thinking | holds together and breathes, eyes lifted and wandering, glow pulsing on the body's beat |
| Speaking | cohered but agitated, ripples driven by real speech energy, streaks trailing |

Specular and rim lighting are gated on coherence — ungated they hang in empty
space as a ring once the droplets scatter. The whole thing renders to an
offscreen buffer and is composited with a bloom pass; the working resolution is
capped (`900px` on the long side) so a large screen doesn't make it expensive,
since this runs all day beside everything else.

Other explored directions live in `character-lab.html`.

## Widgets

| Panel | Connector | What it shows / does |
|---|---|---|
| TODAY | Google Calendar | Today + tomorrow timeline, NOW / next-up chips; click an event to hear details (incl. attendee RSVPs) |
| TASKS | Todoist | Overdue / due-today groups, tick-to-complete, click a task for reschedule chips, quick capture, completion streak |
| INBOX | Gmail | Rules-based triage (priority vs low-priority fold), click a thread to read aloud or archive (undoable) |
| TRAINING | Strava | 7-day stat tiles, 14-day effort chart (click a bar for that day), readiness read (acute vs prior week load), 5K reference pace |

## Voice ("flow")

- **Mic button** — push-to-talk (Chrome/Edge speech recognition). Replies are spoken (en-GB voice preferred by default); typed input always works.
- **Voice picker** — the dropdown next to VOICE/FLOW lists every voice your
  browser has installed. Pick one to hear a preview and lock it in, or leave
  it on **Auto** for the en-GB neural pick above. Choice is remembered per
  browser via `localStorage`. Self-hosted with `ELEVENLABS_API_KEY` set, the
  same dropdown gets a **Cloud** group listing your ElevenLabs voices —
  pick one to have replies spoken through ElevenLabs instead (small
  per-character cost, a little more latency, automatic fallback to the
  local voice if a request ever fails). Details: **SELF-HOSTING.md → Cloud
  voices**.
- **FLOW** — hands-free: the mic stays open and everything you say is acted
  on, no wake word needed. Atlas pauses the mic while it speaks so it never
  hears itself — but anything else picked up (background conversation, a TV)
  gets sent as a command too, so it's best in a quiet room.
- The character's surface and ripples are driven by **real microphone amplitude**
  (WebAudio analyser) while listening, and by speech boundaries while talking.
- Settings, seen-mail memory, morning-brief marker persist in `localStorage`.
- Boots with personality: a morning wake auto-delivers the briefing (once per
  day); an evening wake offers the day debrief.

**Two brains, chosen automatically.** With `ANTHROPIC_API_KEY` set on a
self-hosted deployment, every utterance goes to real Claude reasoning —
arbitrary phrasing, follow-ups, genuine tool use over your tasks/email/
calendar. Without it (including always, inside the claude.ai artifact, which
has no backend to hold that key), Atlas falls back to a fixed set of exact
phrases:

`brief me` · `what's next` · `block time [tomorrow]` · `inbox` ·
`read the latest email` · `tasks` · `push <task> to <day>` · `training` ·
`am I ready to train` · `debrief` · `undo` · `help`

The fixed-phrase version is preserved unmodified on the `checkpoint/regex-
brain-v1` branch — a permanent revert point, not a snapshot that'll drift.
Details and the cost/latency trade-off: **SELF-HOSTING.md → The
conversational brain**.

## Running it

The connector layer uses `window.claude.mcp` (plus `window.claude.downloads`
for brief export), which exists only when the page is published as a
**claude.ai Artifact** with this capability manifest:

```json
{"mcp": {"servers": [
  {"server": "Gmail",           "tools": ["search_threads", "get_thread", "label_thread", "unlabel_thread"]},
  {"server": "Google Calendar", "tools": ["list_events", "create_event", "delete_event"]},
  {"server": "Todoist",         "tools": ["find-tasks-by-date", "add-tasks", "complete-tasks", "reschedule-tasks", "find-completed-tasks"]},
  {"server": "Strava",          "tools": ["list_activities", "get_athlete_profile", "get_athlete_zones"]}
]},
 "downloads": true}
```

Opened as a plain file, the page still boots — entity, voice loop, and chat all
work — with each panel showing an "open via claude.ai artifacts" notice instead
of live data.

### Two ways to run it

| | Live data | Spoken replies | Microphone |
|---|---|---|---|
| Published artifact | ✅ via `window.claude.mcp` | ✅ | ❌ withheld by the frame |
| **Self-hosted** (see [SELF-HOSTING.md](SELF-HOSTING.md)) | ✅ via its own OAuth backend | ✅ | ✅ |
| Opened as a plain file | ❌ | ✅ | ✅ |

`index.html` is byte-identical across all three. On load it probes for the
artifact connector bridge; failing that, for its own `/api/status`; failing
that, it runs unlinked. Self-hosting is the only configuration where voice
input and live data work at the same time.

Microphone and speech are Permissions-Policy features granted by whatever page
embeds this one, and a page cannot grant them to itself. The artifact frame
withholds the **microphone** but does allow **speech output** — so inside it
Atlas talks and you type, which the UI states up front: the mic and FLOW
controls are marked unavailable and explain why, and a **WHY?** link reports
exactly what the browser is permitting.

The mic button stays clickable even when marked unavailable. It makes a real
request rather than predicting the answer, so if the frame ever starts allowing
the microphone it recovers on its own.

For the full voice experience, serve it top-level over a secure origin —
`http://localhost` counts:

```bash
python3 -m http.server 8000     # then open http://localhost:8000/index.html
```

## Design notes

- Deliberately single-theme: a night-instrument console (petrol-blue ground,
  aurora teal/periwinkle spent only on the character and live accents).
- Per-section failure containment: each connector error renders its own
  fix-it copy (reconnect / add connector / policy) while other panels stay live;
  transient errors keep last-good data with a staleness stamp.
- Respects `prefers-reduced-motion`; no external requests — fully self-contained.
