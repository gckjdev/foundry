# realtime

## Overview

The realtime package owns the WebSocket fanout service that sits between Postgres
and the panel and runner clients. It holds a single `LISTEN foundry_changes`
connection and forwards each change notification only to clients that hold a
valid, team-scoped token for that row's team.

## Subdirectories & Boundaries

- src: [./src/EGM.md](./src/EGM.md) — the HTTP/WebSocket server and process entry point.
