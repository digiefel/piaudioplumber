"""papctl — debug CLI for piaudioplumber.

Commands talk to the running pap-daemon via its HTTP API.
"""
from __future__ import annotations

import asyncio
import json
import sys
from typing import Annotated

import httpx
import typer
from rich import print as rprint
from rich.table import Table

app = typer.Typer(name="papctl", help="piaudioplumber debug CLI", add_completion=False)

_DEFAULT_URL = "http://localhost:7070"


def _url(path: str, base: str) -> str:
    return f"{base.rstrip('/')}{path}"


def _get(path: str, base: str) -> dict:
    with httpx.Client(timeout=5) as client:
        resp = client.get(_url(path, base))
        resp.raise_for_status()
        return resp.json()


@app.command("dump-graph")
def dump_graph(
    base: Annotated[str, typer.Option("--url", "-u", help="Daemon URL")] = _DEFAULT_URL,
    raw: Annotated[bool, typer.Option("--raw", help="Print raw JSON")] = False,
) -> None:
    """Show the current normalized graph (nodes, links, master)."""
    data = _get("/api/graph", base)
    if raw:
        print(json.dumps(data, indent=2))
        return

    table = Table(title=f"Graph v{data['version']} ({data['raw_object_count']} objects)")
    table.add_column("ID", style="cyan")
    table.add_column("Name", style="green")
    table.add_column("Description")
    table.add_column("Class")
    table.add_column("App")
    table.add_column("State")
    for node in data.get("nodes", []):
        state_style = "bold green" if node.get("is_running") else "dim"
        table.add_row(
            str(node["id"]),
            node.get("name") or "",
            node.get("description") or "",
            node.get("media_class") or "",
            node.get("application") or "",
            f"[{state_style}]{node.get('state') or ''}[/{state_style}]",
        )
    rprint(table)

    master = data.get("master", {})
    rprint(
        f"\n[bold]Master:[/bold] volume={master.get('volume', '?'):.2f} "
        f"muted={master.get('muted')} sink={master.get('sink_name') or master.get('sink_node_id')}"
    )


@app.command("dump-raw")
def dump_raw(
    base: Annotated[str, typer.Option("--url", "-u")] = _DEFAULT_URL,
) -> None:
    """Dump the raw PipeWire graph objects."""
    data = _get("/api/diagnostics/raw-graph", base)
    print(json.dumps(data, indent=2))


@app.command("dump-diagnostics")
def dump_diagnostics(
    base: Annotated[str, typer.Option("--url", "-u")] = _DEFAULT_URL,
) -> None:
    """Dump the full diagnostics snapshot."""
    data = _get("/api/diagnostics/dump", base)
    print(json.dumps(data, indent=2))


@app.command("explain")
def explain(
    node_id: int,
    base: Annotated[str, typer.Option("--url", "-u")] = _DEFAULT_URL,
) -> None:
    """Explain why a node is classified as it is."""
    data = _get(f"/api/diagnostics/node/{node_id}", base)
    print(json.dumps(data, indent=2))


@app.command("watch")
def watch(
    base: Annotated[str, typer.Option("--url", "-u")] = _DEFAULT_URL,
) -> None:
    """Watch live events from the daemon (Ctrl-C to stop)."""
    import websockets  # optional dep

    async def _watch() -> None:
        ws_url = _url("/api/events", base).replace("http://", "ws://").replace("https://", "wss://")
        rprint(f"[dim]Connecting to {ws_url}...[/dim]")
        async with websockets.connect(ws_url) as ws:
            rprint("[green]Connected.[/green] Listening for events (Ctrl-C to stop)")
            async for msg in ws:
                data = json.loads(msg)
                kind = data.get("type") or data.get("kind", "?")
                rprint(f"[cyan]{kind}[/cyan] {json.dumps(data, separators=(',', ':'))[:200]}")

    try:
        asyncio.run(_watch())
    except KeyboardInterrupt:
        pass


@app.command("volume")
def set_volume(
    value: float,
    base: Annotated[str, typer.Option("--url", "-u")] = _DEFAULT_URL,
) -> None:
    """Set master volume (0.0 – 1.5)."""
    with httpx.Client(timeout=5) as client:
        resp = client.post(_url("/api/control/volume", base), json={"volume": value})
        resp.raise_for_status()
    rprint(resp.json())


@app.command("mute")
def set_mute(
    muted: bool,
    base: Annotated[str, typer.Option("--url", "-u")] = _DEFAULT_URL,
) -> None:
    """Set master mute (true/false)."""
    with httpx.Client(timeout=5) as client:
        resp = client.post(_url("/api/control/mute", base), json={"muted": muted})
        resp.raise_for_status()
    rprint(resp.json())


if __name__ == "__main__":
    app()
