"""Home Assistant adapter — publishes Pi audio state via MQTT discovery.

Runs as a separate process. Connects to the pap-daemon WebSocket and
publishes a media_player entity to MQTT using HA's discovery protocol.

Configuration via environment variables:
  PAP_DAEMON_URL   — ws://hostname:7070 (default: ws://localhost:7070)
  MQTT_HOST        — MQTT broker hostname (default: localhost)
  MQTT_PORT        — MQTT broker port (default: 1883)
  MQTT_USER        — optional username
  MQTT_PASSWORD    — optional password
  HA_DEVICE_NAME   — entity label (default: Pi Audio Supervisor)
  HA_DISCOVERY_PREFIX — default: homeassistant
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time

logger = logging.getLogger(__name__)

_DAEMON_URL = os.environ.get("PAP_DAEMON_URL", "ws://localhost:7070")
_MQTT_HOST = os.environ.get("MQTT_HOST", "localhost")
_MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
_MQTT_USER = os.environ.get("MQTT_USER")
_MQTT_PASSWORD = os.environ.get("MQTT_PASSWORD")
_DEVICE_NAME = os.environ.get("HA_DEVICE_NAME", "Pi Audio Supervisor")
_DISCOVERY_PREFIX = os.environ.get("HA_DISCOVERY_PREFIX", "homeassistant")
_OBJECT_ID = "pi_audio_supervisor"

_STATE_TOPIC = f"pap/{_OBJECT_ID}/state"
_ATTR_TOPIC = f"pap/{_OBJECT_ID}/attributes"
_CMD_VOLUME_TOPIC = f"pap/{_OBJECT_ID}/cmd/volume"
_CMD_MUTE_TOPIC = f"pap/{_OBJECT_ID}/cmd/mute"
_DISCOVERY_TOPIC = f"{_DISCOVERY_PREFIX}/media_player/{_OBJECT_ID}/config"

_RECONNECT_DELAY = 5.0
_IDLE_TIMEOUT = 30.0


def _build_discovery_payload() -> dict:
    return {
        "name": _DEVICE_NAME,
        "unique_id": f"pap_{_OBJECT_ID}",
        "state_topic": _STATE_TOPIC,
        "json_attributes_topic": _ATTR_TOPIC,
        "command_topic": f"pap/{_OBJECT_ID}/cmd",
        "volume_command_topic": _CMD_VOLUME_TOPIC,
        "volume_state_topic": _ATTR_TOPIC,
        "volume_state_template": "{{ value_json.volume }}",
        "is_volume_muted_topic": _ATTR_TOPIC,
        "is_volume_muted_template": "{{ value_json.muted }}",
        "source_list": [],
        "device": {
            "identifiers": [f"pap_{_OBJECT_ID}"],
            "name": _DEVICE_NAME,
            "model": "PiAudioPlumber",
            "manufacturer": "pap",
        },
        "availability_topic": f"pap/{_OBJECT_ID}/availability",
        "payload_available": "online",
        "payload_not_available": "offline",
    }


class HAAdapter:
    def __init__(self) -> None:
        self._mqtt = None
        self._volume: float = 1.0
        self._muted: bool = False
        self._any_running: bool = False
        self._last_active: float = 0.0
        self._connected = False

    def _setup_mqtt(self):
        import paho.mqtt.client as mqtt

        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        client.on_connect = self._on_mqtt_connect
        client.on_message = self._on_mqtt_message
        if _MQTT_USER:
            client.username_pw_set(_MQTT_USER, _MQTT_PASSWORD)

        client.will_set(f"pap/{_OBJECT_ID}/availability", "offline", retain=True)
        client.connect(_MQTT_HOST, _MQTT_PORT, keepalive=60)
        client.loop_start()
        return client

    def _on_mqtt_connect(self, client, userdata, flags, reason_code, properties):
        logger.info("MQTT connected (rc=%s)", reason_code)
        self._connected = True
        client.subscribe(_CMD_VOLUME_TOPIC)
        client.subscribe(_CMD_MUTE_TOPIC)
        # Publish discovery
        client.publish(
            _DISCOVERY_TOPIC,
            json.dumps(_build_discovery_payload()),
            retain=True,
        )
        client.publish(f"pap/{_OBJECT_ID}/availability", "online", retain=True)
        self._publish_state(client)

    def _on_mqtt_message(self, client, userdata, msg):
        """Handle volume/mute commands from HA."""
        topic = msg.topic
        payload = msg.payload.decode()
        logger.debug("MQTT message on %s: %s", topic, payload)

        if topic == _CMD_VOLUME_TOPIC:
            try:
                volume = float(payload)
                asyncio.create_task(self._send_volume_to_daemon(volume))
            except ValueError:
                pass
        elif topic == _CMD_MUTE_TOPIC:
            muted = payload.lower() in ("true", "1", "on", "mute")
            asyncio.create_task(self._send_mute_to_daemon(muted))

    async def _send_volume_to_daemon(self, volume: float) -> None:
        import httpx
        daemon_http = _DAEMON_URL.replace("ws://", "http://").replace("wss://", "https://")
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                await client.post(
                    f"{daemon_http}/api/control/volume",
                    json={"volume": volume},
                )
        except Exception:
            logger.warning("Failed to send volume command to daemon")

    async def _send_mute_to_daemon(self, muted: bool) -> None:
        import httpx
        daemon_http = _DAEMON_URL.replace("ws://", "http://").replace("wss://", "https://")
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                await client.post(
                    f"{daemon_http}/api/control/mute",
                    json={"muted": muted},
                )
        except Exception:
            logger.warning("Failed to send mute command to daemon")

    def _publish_state(self, client) -> None:
        if not self._connected:
            return
        state = "playing" if self._any_running else "idle"
        client.publish(_STATE_TOPIC, state, retain=False)
        attrs = {
            "volume": round(self._volume, 3),
            "muted": self._muted,
            "source": "PipeWire",
        }
        client.publish(_ATTR_TOPIC, json.dumps(attrs), retain=False)
        logger.debug("Published state=%s volume=%.2f muted=%s", state, self._volume, self._muted)

    def _handle_ws_message(self, data: dict) -> bool:
        """Process a WS message. Returns True if state changed."""
        changed = False
        kind = data.get("type") or data.get("kind")

        if kind == "snapshot":
            nodes = data.get("nodes", [])
            was = self._any_running
            self._any_running = any(n.get("is_running") for n in nodes)
            master = data.get("master", {})
            self._volume = master.get("volume", self._volume)
            self._muted = master.get("muted", self._muted)
            if self._any_running:
                self._last_active = time.monotonic()
            changed = (was != self._any_running)

        elif kind == "object_changed":
            obj = data.get("obj", {})
            if obj.get("type") == "PipeWire:Interface:Node":
                info = obj.get("info") or {}
                state = info.get("state")
                if state == "running":
                    if not self._any_running:
                        self._any_running = True
                        self._last_active = time.monotonic()
                        changed = True
                elif state in ("idle", "suspended"):
                    self._last_active = time.monotonic()

        elif kind in ("volume_changed", "mute_changed"):
            if kind == "volume_changed":
                self._volume = data.get("volume", self._volume)
            else:
                self._muted = data.get("muted", self._muted)
            changed = True

        elif kind == "graph_reset":
            self._any_running = False
            changed = True

        return changed

    async def run(self) -> None:
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s [ha-adapter] %(levelname)s %(message)s",
        )

        import websockets

        mqtt_client = self._setup_mqtt()

        while True:
            ws_url = f"{_DAEMON_URL.rstrip('/')}/api/events"
            try:
                logger.info("Connecting to daemon at %s", ws_url)
                async with websockets.connect(ws_url) as ws:
                    logger.info("Connected to daemon")
                    async for raw in ws:
                        data = json.loads(raw)
                        changed = self._handle_ws_message(data)
                        if changed:
                            self._publish_state(mqtt_client)

            except Exception as e:
                logger.warning("WS disconnected: %s — reconnecting in %.0fs", e, _RECONNECT_DELAY)
                self._connected_to_daemon = False

            await asyncio.sleep(_RECONNECT_DELAY)


def main() -> None:
    adapter = HAAdapter()
    asyncio.run(adapter.run())


if __name__ == "__main__":
    main()
