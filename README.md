# Atlas — Daily Agent Dashboard

A single-file interactive dashboard that acts as a daily AI support agent. A living
particle entity ("Atlas") sits centre-screen — it breathes, blinks, watches the
pointer, and visibly shifts state between idle, listening, thinking, and speaking —
surrounded by four live widgets fed by claude.ai connectors.

## Widgets

| Panel | Connector | What it shows |
|---|---|---|
| TODAY | Google Calendar | Today + tomorrow timeline, NOW / next-up countdown chips |
| TASKS | Todoist | Overdue and due-today groups, priority chips, tick-to-complete, quick capture |
| INBOX | Gmail | Unread / recent / flagged counts, latest threads |
| TRAINING | Strava | 7-day distance/time/sessions, 14-day relative-effort chart, last activity |

## Voice

- **Mic button** — push-to-talk via the browser's speech recognition (Chrome/Edge).
- **VOICE** — spoken replies via speech synthesis (en-GB voice preferred).
- **FLOW** — hands-free mode: Atlas resumes listening after each spoken reply.
- Typed input always works as a fallback.

Commands: `brief me` · `what's next` · `inbox` · `tasks` · `training` ·
`add task <anything> [today|tomorrow|…]` · `help`

## Running it

The connector layer uses `window.claude.mcp`, which exists only when the page is
published as a **claude.ai Artifact** with this capability manifest:

```json
{"mcp": {"servers": [
  {"server": "Gmail",           "tools": ["search_threads"]},
  {"server": "Google Calendar", "tools": ["list_events"]},
  {"server": "Todoist",         "tools": ["find-tasks-by-date", "add-tasks", "complete-tasks"]},
  {"server": "Strava",          "tools": ["list_activities", "get_athlete_profile"]}
]}}
```

Opened as a plain file, the page still boots — entity, voice loop, and chat all
work — with each panel showing an "open via claude.ai artifacts" notice instead
of live data.

## Design notes

- Deliberately single-theme: a night-instrument console (petrol-blue ground,
  aurora teal/periwinkle spent only on the entity and live accents).
- Per-section failure containment: each connector error renders its own
  fix-it copy (reconnect / add connector / policy) while other panels stay live;
  transient errors keep last-good data with a staleness stamp.
- Respects `prefers-reduced-motion`; no external requests — fully self-contained.
