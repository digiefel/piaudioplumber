"""Audio control commands: master volume, mute, default sink."""
from __future__ import annotations

import logging

from pap.daemon.state_store import StateStore
from pap.pw.wpctl import get_volume, set_mute, set_volume

logger = logging.getLogger(__name__)


class AudioControl:
    """Wraps wpctl commands and keeps the StateStore in sync."""

    def __init__(self, store: StateStore) -> None:
        self._store = store

    async def refresh_volume(self) -> None:
        """Read current master volume from wpctl and update the store."""
        info = await get_volume()
        if info:
            self._store.update_master_volume(info.volume, info.muted)

    async def set_master_volume(self, volume: float) -> bool:
        """Set master volume (0.0 – 1.5). Updates store on success."""
        volume = max(0.0, min(1.5, volume))
        ok = await set_volume(volume)
        if ok:
            info = await get_volume()
            if info:
                self._store.update_master_volume(info.volume, info.muted)
        return ok

    async def set_master_mute(self, muted: bool) -> bool:
        """Set master mute state. Updates store on success."""
        ok = await set_mute(muted)
        if ok:
            info = await get_volume()
            if info:
                self._store.update_master_volume(info.volume, info.muted)
        return ok

    async def set_node_volume(self, node_id: int, volume: float) -> bool:
        """Set a specific node's volume (0.0 – 1.5)."""
        volume = max(0.0, min(1.5, volume))
        return await set_volume(volume, target=str(node_id))

    async def set_node_mute(self, node_id: int, muted: bool) -> bool:
        """Set a specific node's mute state."""
        return await set_mute(muted, target=str(node_id))


__all__ = ["AudioControl"]
