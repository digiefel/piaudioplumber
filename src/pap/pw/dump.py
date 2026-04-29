"""Async wrapper around `pw-dump --monitor`.

Parses the streaming JSON output into GraphObject events. pw-dump emits:
  - On startup: a JSON array of all current objects
  - On each change: either a single JSON object OR a 1-element JSON array
    (the array form is used by PipeWire 1.x for incremental updates)

Removal is indicated by type=null or info=null at the top level.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from collections.abc import AsyncIterator

from pap.model.graph import Graph, GraphObject, PipeWireType


class DumpReset:
    """Sentinel yielded by pw_dump_stream before each new pw-dump process.

    Signals graph_watcher to reset all state before replaying the initial dump.
    """

logger = logging.getLogger(__name__)

# Base reconnect delay; doubles on each failure up to MAX_RECONNECT_DELAY
_BASE_RECONNECT_DELAY = 1.0
_MAX_RECONNECT_DELAY = 30.0


class JsonStreamParser:
    """Extracts complete JSON values from a character stream.

    pw-dump outputs multi-line JSON. This parser tracks brace/bracket
    nesting and emits complete top-level values (arrays or objects).
    """

    def __init__(self) -> None:
        self._buf = ""
        self._depth = 0
        self._in_string = False
        self._escape_next = False
        self._started = False

    def feed(self, chunk: str) -> list[str]:
        """Feed a chunk of text; return list of complete JSON strings."""
        results: list[str] = []
        for ch in chunk:
            if self._escape_next:
                self._escape_next = False
                self._buf += ch
                continue
            if self._in_string:
                if ch == "\\":
                    self._escape_next = True
                elif ch == '"':
                    self._in_string = False
                self._buf += ch
                continue
            if ch == '"':
                self._in_string = True
                self._buf += ch
                self._started = True
            elif ch in "{[":
                self._depth += 1
                self._buf += ch
                self._started = True
            elif ch in "}]":
                self._depth -= 1
                self._buf += ch
                if self._depth == 0 and self._started:
                    results.append(self._buf.strip())
                    self._buf = ""
                    self._started = False
            else:
                if self._started or ch not in " \t\r\n":
                    self._buf += ch
                    self._started = True
        return results


def _parse_raw_object(raw: dict) -> GraphObject | None:
    """Parse a raw pw-dump dict into a GraphObject. Returns None for unknowns."""
    obj_id = raw.get("id")
    if obj_id is None:
        return None
    return GraphObject(
        id=obj_id,
        type=raw.get("type"),
        version=raw.get("version", 0),
        permissions=raw.get("permissions", []),
        info=raw.get("info"),
    )


def _is_removal(raw: dict) -> bool:
    """True if this update represents an object removal."""
    return raw.get("type") is None or raw.get("info") is None


async def pw_dump_stream(
    *,
    pipewire_runtime_dir: str | None = None,
) -> AsyncIterator[DumpReset | GraphObject]:
    """Yield GraphObjects from `pw-dump --monitor` with auto-reconnect.

    Yields:
        DumpReset before each new pw-dump process (signal to clear state)
        GraphObject for every object in the initial dump and each incremental update

    PipeWire 1.x emits both the initial state and incremental updates as JSON
    arrays (the initial dump is large; incremental updates are 1-element arrays).
    All arrays are flattened into individual GraphObject yields.

    Reconnects with exponential backoff if the process exits.
    """
    delay = _BASE_RECONNECT_DELAY
    env = dict(os.environ)
    if pipewire_runtime_dir:
        env["PIPEWIRE_RUNTIME_DIR"] = pipewire_runtime_dir
        env["XDG_RUNTIME_DIR"] = pipewire_runtime_dir

    while True:
        try:
            proc = await asyncio.create_subprocess_exec(
                "pw-dump",
                "--monitor",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            logger.info("pw-dump process started (pid=%s)", proc.pid)
            delay = _BASE_RECONNECT_DELAY
            parser = JsonStreamParser()

            # Signal to consumers that this is a fresh connection: clear state
            yield DumpReset()

            assert proc.stdout is not None
            async for chunk in _read_chunks(proc.stdout):
                for json_str in parser.feed(chunk):
                    try:
                        raw = json.loads(json_str)
                    except json.JSONDecodeError:
                        logger.debug("JSON parse error on: %s…", json_str[:120])
                        continue

                    items: list[dict] = raw if isinstance(raw, list) else [raw]
                    for item in items:
                        obj = _parse_raw_object(item)
                        if obj:
                            yield obj

            await proc.wait()
            logger.warning(
                "pw-dump exited (returncode=%s), reconnecting in %.1fs",
                proc.returncode,
                delay,
            )

        except FileNotFoundError:
            logger.error("pw-dump not found — is PipeWire installed?")
        except Exception:
            logger.exception("pw-dump stream error")

        await asyncio.sleep(delay)
        delay = min(delay * 2, _MAX_RECONNECT_DELAY)


async def _read_chunks(stream: asyncio.StreamReader) -> AsyncIterator[str]:
    """Yield decoded string chunks from a StreamReader."""
    while True:
        chunk = await stream.read(4096)
        if not chunk:
            break
        yield chunk.decode("utf-8", errors="replace")


async def take_initial_snapshot() -> Graph:
    """Run `pw-dump` once (no monitor) and return a full Graph snapshot."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "pw-dump",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        raw_list = json.loads(stdout.decode())
    except Exception:
        logger.exception("Failed to take pw-dump snapshot")
        return Graph()

    objects: dict[int, GraphObject] = {}
    for item in raw_list:
        obj = _parse_raw_object(item)
        if obj:
            objects[obj.id] = obj
    return Graph(version=1, objects=objects)


__all__ = [
    "DumpReset",
    "JsonStreamParser",
    "pw_dump_stream",
    "take_initial_snapshot",
]
