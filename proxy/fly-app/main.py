"""Tiny WebSocket proxy for Gemini Live API.

The browser client opens a WebSocket to this server using the same path and
query string as it would have used against ``generativelanguage.googleapis.com``
(e.g. ``/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=...``).
We open an upstream WebSocket to Google with the identical path/query and then
shuttle messages between the two sockets in both directions until either side
closes.

The point of this proxy is to provide a stable upstream that lives in a region
where Google AI is reachable (e.g. San Jose, Frankfurt, IAD), so users in
regions where ``generativelanguage.googleapis.com`` is geofenced (Belarus,
Russia, Iran, Cuba, ...) can route their Live API traffic through it instead
of needing a VPN on every device.

Deployment lives on Fly.io. See ../README.md for step-by-step instructions.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import websockets
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

UPSTREAM_HOST = "generativelanguage.googleapis.com"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("livvv-proxy")

app = FastAPI(title="livvv-proxy")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/", response_class=PlainTextResponse)
@app.get("/health", response_class=PlainTextResponse)
def health() -> str:
    return "Liv proxy is alive. Use WebSocket to /ws/...\n"


@app.get("/debug", response_class=PlainTextResponse)
async def debug(request: Request) -> str:
    """Show the egress location, so we can verify which country Google sees us
    coming from. We hit Cloudflare's trace endpoint because it returns the
    perceived source country for the requesting IP."""
    import httpx

    headers_seen = {k: v for k, v in request.headers.items()}
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get("https://www.cloudflare.com/cdn-cgi/trace")
            trace = resp.text
    except Exception as exc:  # noqa: BLE001
        trace = f"trace fetch failed: {exc}"

    lines = [
        "== inbound headers ==",
        *(f"{k}: {v}" for k, v in headers_seen.items()),
        "",
        "== outbound (where this server calls upstream FROM) ==",
        trace,
    ]
    return "\n".join(lines)


@app.websocket("/ws/{path:path}")
async def proxy(client_ws: WebSocket, path: str) -> None:
    """Bidirectional pipe between the browser and Google Live API."""
    await client_ws.accept()

    query = client_ws.scope.get("query_string", b"").decode("utf-8")
    upstream_url = f"wss://{UPSTREAM_HOST}/ws/{path}"
    if query:
        upstream_url += f"?{query}"

    logger.info("opening upstream %s", upstream_url.split("?", 1)[0])

    try:
        async with websockets.connect(
            upstream_url,
            max_size=None,
            ping_interval=None,
            open_timeout=15,
        ) as upstream_ws:
            await asyncio.gather(
                _client_to_upstream(client_ws, upstream_ws),
                _upstream_to_client(client_ws, upstream_ws),
            )
    except websockets.exceptions.InvalidStatus as exc:
        # Upstream rejected the WS handshake (e.g. wrong API key, region block).
        # Surface the upstream HTTP status to the client by closing with a
        # descriptive reason — Liv displays this string in the events log.
        status = exc.response.status_code
        body = exc.response.body.decode("utf-8", errors="replace")[:200]
        reason = f"upstream rejected ws handshake: HTTP {status} {body}"
        logger.warning(reason)
        await _safe_close(client_ws, code=1011, reason=reason[:120])
    except Exception as exc:  # noqa: BLE001
        reason = f"upstream error: {type(exc).__name__}: {exc}"
        logger.exception("upstream connection failed")
        await _safe_close(client_ws, code=1011, reason=reason[:120])


async def _client_to_upstream(
    client_ws: WebSocket,
    upstream_ws: Any,
) -> None:
    try:
        while True:
            msg = await client_ws.receive()
            mtype = msg.get("type")
            if mtype == "websocket.disconnect":
                await upstream_ws.close()
                return
            if "text" in msg and msg["text"] is not None:
                await upstream_ws.send(msg["text"])
            elif "bytes" in msg and msg["bytes"] is not None:
                await upstream_ws.send(msg["bytes"])
    except WebSocketDisconnect:
        await upstream_ws.close()
    except Exception as exc:  # noqa: BLE001
        logger.warning("client->upstream pipe ended: %s", exc)
        await upstream_ws.close()


async def _upstream_to_client(
    client_ws: WebSocket,
    upstream_ws: Any,
) -> None:
    try:
        async for msg in upstream_ws:
            if isinstance(msg, str):
                await client_ws.send_text(msg)
                continue
            # Gemini Live sends responses as binary frames whose payload is
            # UTF-8 JSON. The downstream chain (Cloudflare Worker → browser)
            # can mangle binary frames in some browsers — Firefox in particular
            # decodes the Blob differently than expected, and the
            # "JSON.parse: unexpected character at line 1 column 2" error
            # appears. Convert to a text frame whenever the bytes successfully
            # decode as UTF-8 — this is the case for every Gemini Live message
            # documented today. Anything that can't be decoded (raw audio, if
            # Google ever switches format) is forwarded as binary unchanged.
            try:
                as_text = msg.decode("utf-8")
            except UnicodeDecodeError:
                await client_ws.send_bytes(msg)
                continue
            await client_ws.send_text(as_text)
        await _safe_close(client_ws, code=1000, reason="upstream closed")
    except websockets.ConnectionClosed as exc:
        reason = (exc.reason or "upstream closed")[:120]
        await _safe_close(client_ws, code=1000, reason=reason)
    except Exception as exc:  # noqa: BLE001
        logger.warning("upstream->client pipe ended: %s", exc)
        await _safe_close(client_ws, code=1011, reason=str(exc)[:120])


async def _safe_close(ws: WebSocket, *, code: int, reason: str) -> None:
    try:
        await ws.close(code=code, reason=reason)
    except RuntimeError:
        # Already closed — ignore.
        pass
