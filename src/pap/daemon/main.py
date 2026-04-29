"""Daemon entrypoint — wires all components together and starts the server."""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
from pathlib import Path

import uvicorn

from pap.api.http import build_app
from pap.daemon.control import AudioControl
from pap.daemon.diagnostics import Diagnostics
from pap.daemon.graph_watcher import GraphWatcher
from pap.daemon.state_store import StateStore

logger = logging.getLogger(__name__)

_DEFAULT_HOST = "0.0.0.0"
_DEFAULT_PORT = 7070


def _configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )


async def run_daemon(
    host: str = _DEFAULT_HOST,
    port: int = _DEFAULT_PORT,
    log_level: str = "INFO",
) -> None:
    _configure_logging(log_level)

    store = StateStore()
    diag = Diagnostics()
    control = AudioControl(store)

    pipewire_runtime_dir = os.environ.get(
        "PIPEWIRE_RUNTIME_DIR",
        os.environ.get("XDG_RUNTIME_DIR"),
    )

    watcher = GraphWatcher(
        on_object=store.apply_object,
        on_removal=store.remove_object,
        on_reset=store.reset,
        pipewire_runtime_dir=pipewire_runtime_dir,
    )

    app = build_app(store=store, control=control, diag=diag)

    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        log_level=log_level.lower(),
        access_log=False,
    )
    server = uvicorn.Server(config)

    stop_event = asyncio.Event()

    def _on_signal(*_) -> None:
        logger.info("Shutdown signal received")
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, _on_signal)

    await watcher.start()
    await control.refresh_volume()
    logger.info("pap-daemon listening on %s:%s", host, port)

    serve_task = asyncio.create_task(server.serve())
    await stop_event.wait()
    server.should_exit = True
    await serve_task
    await watcher.stop()
    logger.info("pap-daemon stopped")


def main() -> None:
    host = os.environ.get("PAP_HOST", _DEFAULT_HOST)
    port = int(os.environ.get("PAP_PORT", str(_DEFAULT_PORT)))
    log_level = os.environ.get("PAP_LOG_LEVEL", "INFO")
    asyncio.run(run_daemon(host=host, port=port, log_level=log_level))


if __name__ == "__main__":
    main()
