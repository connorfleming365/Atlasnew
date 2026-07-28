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

- **Mic button** — push-to-talk (Chrome/Edge speech recognition). Replies are spoken (en-GB voice preferred); typed input always works.
- **FLOW** — hands-free: the mic stays open and only sentences addressed as
  **"Atlas, …"** are acted on (wake word). Atlas pauses the mic while it speaks
  so it never hears itself.
- The character's surface and ripples are driven by **real microphone amplitude**
  (WebAudio analyser) while listening, and by speech boundaries while talking.
- Settings, seen-mail memory, morning-brief marker persist in `localStorage`.
- Boots with personality: a morning wake auto-delivers the briefing (once per
  day); an evening wake offers the day debrief.

Commands: `brief me` · `what's next` · `block time [tomorrow]` · `inbox` ·
`read the latest email` · `tasks` · `push <task> to <day>` · `training` ·
`am I ready to train` · `debrief` · `save my brief` · `undo` · `help`

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

### Voice vs. live data

These pull in opposite directions, and it's worth knowing before you pick where
to run it:

| | Live connector data | Microphone + spoken replies |
|---|---|---|
| Published artifact | ✅ | ❌ — the embedding frame withholds both |
| Run locally / self-hosted | ❌ — no `window.claude.mcp` | ✅ |

Microphone access and speech synthesis are granted by whatever page embeds this
one. The artifact frame doesn't pass either through, so inside it Atlas answers
in text; the mic button explains this and a **WHY?** link shows exactly what the
browser is permitting. Nothing in the page can grant itself those permissions.

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
