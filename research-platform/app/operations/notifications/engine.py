"""Notification engine — Telegram, Discord, email, dashboard."""

from __future__ import annotations

from typing import Any

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("operations.notifications")


class NotificationEngine:
    def __init__(self) -> None:
        self.settings = get_settings()

    async def send(
        self,
        event_type: str,
        message: str,
        channels: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        channels = channels or ["dashboard"]
        results: dict[str, Any] = {}

        if "telegram" in channels:
            results["telegram"] = await self._telegram(message)
        if "discord" in channels and self.settings.discord_webhook_url:
            results["discord"] = await self._discord(message)
        if "email" in channels and self.settings.smtp_host:
            results["email"] = await self._email(event_type, message)
        if "n8n" in channels and self.settings.n8n_webhook_url:
            results["n8n"] = await self._n8n(event_type, message, metadata)

        results["dashboard"] = {"queued": True, "event_type": event_type}
        return results

    async def _telegram(self, message: str) -> dict[str, Any]:
        token = self.settings.telegram_bot_token
        chat_id = self.settings.telegram_chat_id
        if not token or not chat_id:
            return {"ok": False, "reason": "telegram not configured"}
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.post(
                    f"https://api.telegram.org/bot{token}/sendMessage",
                    json={"chat_id": chat_id, "text": message, "parse_mode": "HTML"},
                )
                return {"ok": r.is_success}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def _discord(self, message: str) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.post(self.settings.discord_webhook_url, json={"content": message[:2000]})
                return {"ok": r.is_success}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def _email(self, subject: str, body: str) -> dict[str, Any]:
        return {"ok": False, "reason": "email requires SMTP integration — configure SMTP_HOST"}

    async def _n8n(self, event_type: str, message: str, metadata: dict | None) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                r = await client.post(
                    self.settings.n8n_webhook_url,
                    json={"event_type": event_type, "message": message, "metadata": metadata or {}},
                )
                return {"ok": r.is_success, "status": r.status_code}
        except Exception as e:
            return {"ok": False, "error": str(e)}
