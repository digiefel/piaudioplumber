# piaudioplumber

PipeWire audio supervisor daemon for Raspberry Pi (and any Linux with PipeWire).

Observes and controls the local PipeWire/WirePlumber audio graph and exposes it as:
- A live block-canvas **web UI** showing nodes, links, and signal activity
- A **WebSocket API** for real-time graph events and control commands
- A **Home Assistant** `media_player` entity via MQTT discovery
- A **debug CLI** (`papctl`) for inspecting the live graph

Audio sources → PipeWire/WirePlumber → speakers. This daemon is an observer/controller, never in the audio path.

## Requirements

- Linux with PipeWire 1.0+ and WirePlumber 0.5+
- Python 3.11+
- [uv](https://docs.astral.sh/uv/)

## Install

```sh
git clone https://github.com/digiefel/piaudioplumber
cd piaudioplumber
uv sync
```

### Systemd user services

```sh
cp deploy/systemd/*.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now pap-daemon
# optionally:
systemctl --user enable --now pap-ha-adapter
```

The daemon serves the web UI at `http://localhost:7070/` once the React app is built (see below).

### First-time PipeWire setup on Raspberry Pi

If PipeWire is not yet installed, or you need to configure system audio services (shairport-sync, SPDIF loopback, etc.) to connect to PipeWire:

```sh
bash deploy/setup-pipewire.sh
```

Run this once on the Pi. It installs packages, enables user services, and sets socket permissions so system-level audio services can connect.

### Web UI

```sh
cd web/ui
npm install
npm run build   # output goes to web/ui/dist/, served by the daemon
```

For development with hot reload:

```sh
npm run dev     # proxies /api to localhost:7070
```

## Usage

```sh
# Run daemon directly
uv run pap-daemon

# Debug CLI
uv run papctl dump-graph
uv run papctl watch
uv run papctl explain <node-id>
uv run papctl volume 0.7
uv run papctl mute true
```

## Configuration

Place files in `~/.config/pap/`:

| File | Purpose |
|------|---------|
| `daemon.toml` | Host, port, log level |
| `classification.yaml` | Map PipeWire node names to user-facing labels |
| `ha-adapter.env` | MQTT credentials for the HA adapter |

Example files are in `deploy/config/`.

### classification.yaml

Rules run top-to-bottom; first match wins. Unknown nodes appear as-is — they are never silently dropped.

```yaml
rules:
  - match:
      app_name: "shairport-sync"
    result:
      label: "AirPlay"
      kind: software_source
```

### ha-adapter.env

```sh
MQTT_HOST=homeassistant.local
MQTT_PORT=1883
MQTT_USER=pap
MQTT_PASSWORD=secret
HA_DEVICE_NAME="Living Room Audio"
```

## Architecture

```
PipeWire / WirePlumber  ← audio path, untouched
        │
        ▼ pw-dump --monitor / wpctl / pw-link
pap-daemon (asyncio + FastAPI)
        │
        ├── GET/WS /api/events     ← live graph events
        ├── GET    /api/graph      ← current snapshot
        ├── POST   /api/control/*  ← volume, mute
        ├── GET    /api/diagnostics/*
        └── static web/ui/dist/
             ↑         ↑         ↑
          web UI   HA adapter  visualizer (future)
          (browser) (separate   (separate
                    process)    process)
```

All clients — web UI, HA adapter, future plugins — are separate processes that connect to the daemon's API. Killing any client does not affect audio or the daemon.

## Development

```sh
uv sync --extra dev
uv run pytest
uv run ruff check .
uv run mypy src/
```

## Roadmap

- Slice 2: Source classification rules engine
- Slice 3: Activity detection (stream state, signal threshold, metadata)
- Slice 4: Routing rules and persistence
- Slice 5: Persistent canvas layouts
- Slice 6: Fullscreen visualizer (Chromium kiosk)
- Slice 7: Metadata adapters (MPRIS, Shairport-Sync metadata pipe)
