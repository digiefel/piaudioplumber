"""Async wrapper around wpctl for volume and default-sink control."""
from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class VolumeInfo:
    volume: float
    muted: bool


async def _run(args: list[str]) -> tuple[int, str, str]:
    """Run a subprocess; return (returncode, stdout, stderr)."""
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return proc.returncode or 0, stdout.decode().strip(), stderr.decode().strip()


async def get_volume(target: str = "@DEFAULT_AUDIO_SINK@") -> VolumeInfo | None:
    """Return current volume and mute state for a wpctl target."""
    code, out, err = await _run(["wpctl", "get-volume", target])
    if code != 0:
        logger.warning("wpctl get-volume failed: %s", err)
        return None
    # Output: "Volume: 0.80" or "Volume: 0.80 [MUTED]"
    m = re.search(r"Volume:\s+([0-9.]+)(\s+\[MUTED\])?", out)
    if not m:
        logger.debug("Could not parse wpctl output: %s", out)
        return None
    return VolumeInfo(volume=float(m.group(1)), muted=bool(m.group(2)))


async def set_volume(volume: float, target: str = "@DEFAULT_AUDIO_SINK@") -> bool:
    """Set volume (0.0–1.5). Returns True on success."""
    volume = max(0.0, min(1.5, volume))
    code, _, err = await _run(["wpctl", "set-volume", target, f"{volume:.3f}"])
    if code != 0:
        logger.warning("wpctl set-volume failed: %s", err)
    return code == 0


async def set_mute(muted: bool, target: str = "@DEFAULT_AUDIO_SINK@") -> bool:
    """Set mute state. Returns True on success."""
    code, _, err = await _run(["wpctl", "set-mute", target, "1" if muted else "0"])
    if code != 0:
        logger.warning("wpctl set-mute failed: %s", err)
    return code == 0


async def set_default(node_id: int) -> bool:
    """Set the default audio sink by node ID. Returns True on success."""
    code, _, err = await _run(["wpctl", "set-default", str(node_id)])
    if code != 0:
        logger.warning("wpctl set-default failed: %s", err)
    return code == 0


async def status() -> str:
    """Return raw wpctl status output for diagnostics."""
    _, out, _ = await _run(["wpctl", "status"])
    return out


__all__ = ["VolumeInfo", "get_volume", "set_volume", "set_mute", "set_default", "status"]
