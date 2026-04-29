"""Async wrapper around pw-metadata for reading PipeWire metadata."""
from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class MetadataItem:
    subject: int
    key: str
    type: str
    value: str


async def _run(args: list[str]) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return proc.returncode or 0, stdout.decode().strip(), stderr.decode().strip()


async def get_metadata(object_id: str = "0") -> list[MetadataItem]:
    """Read metadata for a PipeWire object (default: global settings object 0)."""
    code, out, err = await _run(["pw-metadata", object_id])
    if code != 0:
        logger.debug("pw-metadata failed for %s: %s", object_id, err)
        return []
    return _parse_metadata(out)


async def get_default_sink_id() -> int | None:
    """Return the node ID of the current default audio sink from metadata."""
    items = await get_metadata("0")
    for item in items:
        if item.key in ("default.audio.sink", "default.configured.audio.sink"):
            # value is a JSON string like '{"name": "alsa_output.usb..."}'
            try:
                import json
                data = json.loads(item.value)
                if isinstance(data, dict) and "name" in data:
                    return data.get("id")
            except Exception:
                pass
    return None


def _parse_metadata(output: str) -> list[MetadataItem]:
    """Parse pw-metadata output lines.

    Example line:
      Found "settings" metadata 0
      subject: 0, key: 'default.audio.sink', type: 'Spa:String:JSON', value: '{"name":"..."}'
    """
    items: list[MetadataItem] = []
    pattern = re.compile(
        r"subject:\s*(\d+),\s*key:\s*'([^']+)',\s*type:\s*'([^']*)',\s*value:\s*'(.*)'",
        re.DOTALL,
    )
    for m in pattern.finditer(output):
        items.append(
            MetadataItem(
                subject=int(m.group(1)),
                key=m.group(2),
                type=m.group(3),
                value=m.group(4),
            )
        )
    return items


__all__ = ["MetadataItem", "get_metadata", "get_default_sink_id"]
