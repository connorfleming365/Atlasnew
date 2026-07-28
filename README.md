# Atlas — Daily Agent Dashboard

A single-file interactive dashboard that acts as a daily AI support agent. A living
particle entity ("Atlas") sits centre-screen — it breathes, blinks, watches the
pointer, and visibly shifts state between idle, listening, thinking, and speaking —
surrounded by four live widgets fed by claude.ai connectors.

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
- The entity's ring and glow are driven by **real microphone amplitude**
  (WebAudio analyser) while listening.
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
  aurora teal/periwinkle spent only on the entity and live accents).
- Per-section failure containment: each connector error renders its own
  fix-it copy (reconnect / add connector / policy) while other panels stay live;
  transient errors keep last-good data with a staleness stamp.
- Respects `prefers-reduced-motion`; no external requests — fully self-contained.
