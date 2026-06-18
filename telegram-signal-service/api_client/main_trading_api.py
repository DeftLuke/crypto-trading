import asyncio
import json
import os
import urllib.error
import urllib.request
from typing import Any


class MainTradingApiClient:
    def __init__(self) -> None:
        self.base_url = os.getenv("MAIN_TRADING_API_URL", "http://127.0.0.1:3001/api").rstrip("/")
        self.api_key = os.getenv("MAIN_TRADING_API_KEY", "")

    async def ingest_signal(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await asyncio.to_thread(self._post, "/external-signals/ingest", payload)

    async def sync_sources(self, sources: list[dict[str, Any]]) -> dict[str, Any]:
        return await asyncio.to_thread(self._post, "/telegram/sources/bulk", {"sources": sources})

    async def save_message(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await asyncio.to_thread(self._post, "/telegram/messages", payload)

    async def followed_sources(self) -> list[dict[str, Any]]:
        data = await asyncio.to_thread(self._get, "/telegram/sources?followed=true&limit=1000")
        return data.get("sources", [])

    async def validate_signal(self, payload: dict[str, Any]) -> dict[str, Any]:
        test_mode = os.getenv("TG_TEST_MODE", "").lower() in {"1", "true", "yes"}
        body = {**payload, "allow_stale": test_mode, "test_mode": test_mode}
        return await asyncio.to_thread(self._post, "/external-signals/validate", body)

    async def request_scrape_recent(self, limit: int = 25) -> dict[str, Any]:
        return await asyncio.to_thread(self._post, "/telegram/scrape-recent", {"limit": limit})

    async def supersede_chat_messages(self, chat_id: int, keep_message_id: int) -> dict[str, Any]:
        return await asyncio.to_thread(
            self._post,
            "/telegram/messages/supersede",
            {"telegram_chat_id": chat_id, "keep_message_id": keep_message_id},
        )

    async def update_source(self, source_id: str, body: dict[str, Any]) -> dict[str, Any]:
        return await asyncio.to_thread(self._patch, f"/telegram/sources/{source_id}", body)

    def _get(self, path: str) -> dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["X-Ingestion-Key"] = self.api_key

        req = urllib.request.Request(f"{self.base_url}{path}", headers=headers, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                return json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            try:
                detail = json.loads(err.read().decode("utf-8"))
            except json.JSONDecodeError:
                detail = {"error": str(err)}
            return {"ok": False, "status": err.code, "error": detail}

    def _patch(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["X-Ingestion-Key"] = self.api_key

        req = urllib.request.Request(f"{self.base_url}{path}", data=body, headers=headers, method="PATCH")
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                return json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            try:
                detail = json.loads(err.read().decode("utf-8"))
            except json.JSONDecodeError:
                detail = {"error": str(err)}
            return {"ok": False, "status": err.code, "error": detail}

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["X-Ingestion-Key"] = self.api_key

        req = urllib.request.Request(f"{self.base_url}{path}", data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                return json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            try:
                detail = json.loads(err.read().decode("utf-8"))
            except json.JSONDecodeError:
                detail = {"error": str(err)}
            return {"ok": False, "status": err.code, "error": detail}
