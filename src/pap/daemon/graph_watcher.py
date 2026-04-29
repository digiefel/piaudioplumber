"""Graph watcher — owns the pw-dump subprocess and feeds the StateStore."""
from __future__ import annotations

import asyncio
import logging
from typing import Callable

from pap.model.graph import GraphObject
from pap.pw.dump import pw_dump_stream

logger = logging.getLogger(__name__)


class GraphWatcher:
    """Runs pw-dump --monitor and applies updates to the StateStore.

    Designed to run as a long-lived asyncio task.
    """

    def __init__(
        self,
        on_object: Callable[[GraphObject], None],
        on_removal: Callable[[int], None],
        on_reset: Callable[[], None],
        *,
        pipewire_runtime_dir: str | None = None,
    ) -> None:
        self._on_object = on_object
        self._on_removal = on_removal
        self._on_reset = on_reset
        self._pipewire_runtime_dir = pipewire_runtime_dir
        self._task: asyncio.Task | None = None
        self._initial_received = False

    async def start(self) -> None:
        """Start the watcher task."""
        self._task = asyncio.create_task(self._run(), name="graph-watcher")
        logger.info("GraphWatcher started")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("GraphWatcher stopped")

    async def _run(self) -> None:
        async for update in pw_dump_stream(pipewire_runtime_dir=self._pipewire_runtime_dir):
            if isinstance(update, list):
                # Initial full dump — reset state then apply all objects
                logger.info("Initial dump received: %d objects", len(update))
                self._on_reset()
                self._initial_received = True
                for obj in update:
                    self._handle_object(obj)
            else:
                self._handle_object(update)

    def _handle_object(self, obj: GraphObject) -> None:
        # Removal: type is null or info is null after initial dump
        if obj.type is None or (obj.info is None and self._initial_received):
            self._on_removal(obj.id)
        else:
            self._on_object(obj)


__all__ = ["GraphWatcher"]
