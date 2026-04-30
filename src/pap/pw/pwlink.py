"""Async wrapper around pw-link for creating/destroying PipeWire links."""
from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)


async def _run(args: list[str]) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return proc.returncode or 0, stdout.decode().strip(), stderr.decode().strip()


async def link_nodes(
    output_node: int | str,
    input_node: int | str,
    *,
    output_port: str | None = None,
    input_port: str | None = None,
) -> bool:
    """Create a link between two nodes. Returns True on success."""
    args = ["pw-link"]
    if output_port:
        args += [f"{output_node}:{output_port}"]
    else:
        args += [str(output_node)]
    if input_port:
        args += [f"{input_node}:{input_port}"]
    else:
        args += [str(input_node)]
    code, _, err = await _run(args)
    if code != 0:
        logger.warning("pw-link failed: %s", err)
    return code == 0


async def unlink_nodes(
    output_node: int | str,
    input_node: int | str,
) -> bool:
    """Destroy a link between two nodes. Returns True on success."""
    code, _, err = await _run(["pw-link", "-d", str(output_node), str(input_node)])
    if code != 0:
        logger.warning("pw-link -d failed: %s", err)
    return code == 0


async def unlink_by_id(link_id: int) -> bool:
    """Destroy a link by its global PipeWire object ID. Most reliable form."""
    code, _, err = await _run(["pw-link", "-d", str(link_id)])
    if code != 0:
        logger.warning("pw-link -d <id> failed: %s", err)
    return code == 0


async def list_links() -> str:
    """Return raw pw-link --list-links output for diagnostics."""
    _, out, _ = await _run(["pw-link", "--list-links"])
    return out


__all__ = ["link_nodes", "unlink_nodes", "unlink_by_id", "list_links"]
