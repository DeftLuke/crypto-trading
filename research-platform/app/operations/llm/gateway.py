"""LLM gateway — dynamic reasoning without hardcoded responses."""

from __future__ import annotations

import json
import re
from typing import Any

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("operations.llm")


class LLMGateway:
    """Calls AI gateway or OpenAI-compatible API; falls back to structured synthesis."""

    def __init__(self) -> None:
        self.settings = get_settings()

    async def complete(
        self,
        prompt: str,
        system: str | None = None,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        sys = system or self._build_system_prompt(context)
        full_prompt = prompt
        if context:
            full_prompt = f"CONTEXT:\n{json.dumps(context, default=str)[:12000]}\n\n{prompt}"

        if self.settings.openclaw_gateway_url and self.settings.openclaw_gateway_token:
            try:
                return await self._call_openclaw(full_prompt, sys)
            except Exception as e:
                logger.warning("OpenClaw failed", extra={"error": str(e)})

        if self.settings.ai_gateway_url:
            try:
                return await self._call_gateway(full_prompt, sys)
            except Exception as e:
                logger.warning("AI gateway failed", extra={"error": str(e)})

        if self.settings.ai_openai_api_url and self.settings.ai_openai_api_key:
            try:
                return await self._call_openai_compat(full_prompt, sys)
            except Exception as e:
                logger.warning("OpenAI-compat failed", extra={"error": str(e)})

        return {"answer": self._structured_fallback(full_prompt, context), "model": "structured", "source": "fallback"}

    async def classify_intent(self, message: str, tools: list[dict]) -> dict[str, Any]:
        prompt = (
            f'Analyze this user message and return ONLY valid JSON:\n'
            f'{{"intent":"question|analysis|research|trading|risk|report|monitoring|strategy|workflow",'
            f'"tools":["tool_name",...],"agent":"coordinator|trading|research|memory|risk|monitoring|reporting",'
            f'"reasoning":"brief"}}\n\n'
            f"Available tools: {json.dumps([t['name'] for t in tools])}\n\n"
            f"Message: {message}"
        )
        result = await self.complete(prompt, system="You classify trading platform requests. Return JSON only.")
        text = result.get("answer", "")
        parsed = self._extract_json(text)
        if parsed:
            return parsed
        return self._keyword_intent(message, tools)

    def _build_system_prompt(self, context: dict[str, Any] | None) -> str:
        parts = [
            "You are the institutional trading platform AI operations assistant.",
            "Answer using ONLY the provided context and tool results.",
            "Never invent trade data, PnL, or strategy metrics.",
            "If data is missing, say what is unavailable and suggest an action.",
            "Be concise and actionable for professional traders.",
        ]
        if context and context.get("memories"):
            parts.append(f"Recalled memories: {len(context['memories'])} items available.")
        return "\n".join(parts)

    async def _call_openclaw(self, prompt: str, system: str) -> dict[str, Any]:
        url = f"{self.settings.openclaw_gateway_url.rstrip('/')}/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.settings.openclaw_gateway_token}",
            "Content-Type": "application/json",
        }
        body = {
            "model": self.settings.openclaw_model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
            "temperature": 0.3,
            "max_tokens": 900,
            "stream": False,
        }
        async with httpx.AsyncClient(timeout=180.0) as client:
            r = await client.post(url, json=body, headers=headers)
            r.raise_for_status()
            data = r.json()
            answer = data["choices"][0]["message"]["content"]
            return {"answer": answer, "model": data.get("model"), "source": "openclaw"}

    async def _call_gateway(self, prompt: str, system: str) -> dict[str, Any]:
        url = f"{self.settings.ai_gateway_url.rstrip('/')}/chat"
        headers = {"Content-Type": "application/json"}
        if self.settings.ai_api_key:
            headers["X-API-Key"] = self.settings.ai_api_key
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(url, json={"question": prompt, "systemPrompt": system}, headers=headers)
            r.raise_for_status()
            data = r.json()
            return {"answer": data.get("answer", ""), "model": data.get("model"), "source": "ai-gateway"}

    async def _call_openai_compat(self, prompt: str, system: str) -> dict[str, Any]:
        url = f"{self.settings.ai_openai_api_url.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.settings.ai_openai_api_key}",
            "Content-Type": "application/json",
        }
        body = {
            "model": self.settings.ai_openai_model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
            "temperature": 0.3,
            "max_tokens": 800,
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(url, json=body, headers=headers)
            r.raise_for_status()
            data = r.json()
            answer = data["choices"][0]["message"]["content"]
            return {"answer": answer, "model": data.get("model"), "source": "openai-compat"}

    def _extract_json(self, text: str) -> dict[str, Any] | None:
        try:
            return json.loads(text.strip())
        except json.JSONDecodeError:
            pass
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                return None
        return None

    def _keyword_intent(self, message: str, tools: list[dict]) -> dict[str, Any]:
        msg = message.lower()
        tool_names = [t["name"] for t in tools]
        selected: list[str] = []

        rules = [
            (("strategy", "strategies", "best strategy", "win rate"), "strategy", ["search_strategies", "search_trades"]),
            (("trade", "trades", "opened today", "position"), "trading", ["search_trades", "search_positions"]),
            (("backtest", "backtests"), "analysis", ["search_backtests"]),
            (("risk", "drawdown", "exposure", "circuit"), "risk", ["search_risk_events", "get_risk_status"]),
            (("research", "hypothesis", "discover"), "research", ["launch_research", "search_memories"]),
            (("report", "pdf", "summary", "daily", "weekly"), "report", ["generate_report"]),
            (("health", "status", "monitor", "system"), "monitoring", ["system_health"]),
            (("memory", "recall", "pattern", "reflection"), "analysis", ["search_memories", "search_reflections"]),
            (("signal", "signals"), "trading", ["search_signals"]),
            (("compare", "btc", "eth", "performance"), "analysis", ["search_trades", "search_strategies"]),
            (("reject", "failed", "why did"), "strategy", ["search_strategies", "search_reflections"]),
        ]
        intent = "question"
        agent = "coordinator"
        for keywords, intent_name, tools_list in rules:
            if any(k in msg for k in keywords):
                intent = intent_name
                selected = [t for t in tools_list if t in tool_names]
                break

        if not selected:
            selected = ["search_memories", "system_health"] if "search_memories" in tool_names else tool_names[:2]

        return {"intent": intent, "tools": selected[:4], "agent": agent, "reasoning": "keyword routing"}

    def _structured_fallback(self, prompt: str, context: dict[str, Any] | None) -> str:
        if not context:
            return "I processed your request but no LLM is configured. Set AI_GATEWAY_URL or AI_OPENAI_API_URL."
        tool_results = context.get("tool_results", {})
        if not tool_results:
            return "No tool data available for this query. Try asking about trades, strategies, risk, or system health."
        lines = ["Based on platform data:"]
        for name, result in tool_results.items():
            summary = result.get("summary") or result.get("message") or str(result)[:500]
            lines.append(f"\n**{name}**: {summary}")
        return "\n".join(lines)
