import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

from models.parse_context import ParseContext
from models.signal import NormalizedSignal, SignalValidationError
from providers.config import ProviderConfig


BASE_SYSTEM_PROMPT = """You classify and extract crypto FUTURES trading signals from Telegram VIP groups.

Return ONLY valid JSON (no markdown):
{
  "is_signal": true or false,
  "symbol": "SYMBOLUSDT",
  "side": "LONG" or "SHORT",
  "entry": number or 0,
  "stop_loss": number or 0,
  "take_profit": [tp1, tp2, tp3] or [],
  "confidence": 0-100,
  "levels_source": "text" | "chart" | "mixed" | "group_hint" | "inferred"
}

Rules:
- is_signal=false for: TP hit updates, profit brags, ads, news, "top gainer", polls, emoji-only chat.
- is_signal=TRUE for informal setups: "BSB long", "BTC buy from here", "short eth here", chart + "bounce from here".
- symbol must end with USDT (infer: BSB → BSBUSDT, #HBAR → HBARUSDT).
- side: LONG for buy/long/here (bullish), SHORT for sell/short.
- If group gives explicit SL/TP in text, USE THOSE (levels_source=text or mixed).
- If only direction + chart caption ("from here", "buy zone"): is_signal=true, set entry/sl/tp to 0, levels_source=group_hint — backend fills from SMC engine.
- IGNORE group risk instructions: leverage (3x, 50x), margin %, "use 2%", "risk 1%" — never parse those as trade params.
- Chart screenshots: read ticker, direction arrow, red/green zones when visible (levels_source=chart).
- If only one TP visible, return it — backend derives TP2/TP3.
- NEVER default to random symbols — read actual ticker from message/chart.
- Chart-only with zero symbol hint anywhere: {"is_signal": false}.
"""


class AiParserClient:
    def __init__(self) -> None:
        self.enabled = os.getenv("AI_PARSER_ENABLED", "true").lower() == "true"
        self.url = os.getenv("AI_PARSER_URL", "").strip()
        self.gateway_url = os.getenv("AI_GATEWAY_URL", "http://ai-gateway:8080").rstrip("/")
        self.api_key = os.getenv("AI_PARSER_API_KEY", os.getenv("AI_API_KEY", ""))
        self.model = os.getenv("AI_PARSER_MODEL", "qwen2.5:7b-instruct")
        self.vision_model = os.getenv("AI_VISION_MODEL", "llava:7b")

    @property
    def _gateway_candidates(self) -> list[str]:
        urls = [
            self.gateway_url,
            os.getenv("AI_GATEWAY_PUBLIC_URL", "").strip(),
            "https://ai.deftluke.online",
        ]
        return list(dict.fromkeys(u.rstrip("/") for u in urls if u))

    def extract_raw(self, context: ParseContext) -> dict | None:
        """Return raw AI JSON (including is_signal=false) for audit trail."""
        if not self.enabled:
            return None
        return self._call_ai(context)

    def signal_from_extracted(
        self,
        extracted: dict,
        context: ParseContext,
        provider: ProviderConfig,
    ) -> NormalizedSignal | None:
        if not extracted or not extracted.get("is_signal"):
            return None
        signal = NormalizedSignal(
            provider=provider.name,
            symbol=extracted["symbol"],
            side=extracted["side"],
            entry=float(extracted.get("entry") or 0),
            stop_loss=float(extracted.get("stop_loss") or 0),
            take_profit=[float(v) for v in extracted.get("take_profit", []) if v],
            raw_message=context.combined_text() or context.text,
            parser="ai",
            confidence=float(extracted.get("confidence") or 70),
            metadata={
                "ai_model": self.vision_model if context.has_image else self.model,
                "ai_detected": True,
                "levels_source": extracted.get("levels_source") or ("chart" if context.has_image else "text"),
                "group_title": context.group_title,
                "has_image": context.has_image,
            },
        )
        levels_src = extracted.get("levels_source") or signal.metadata.get("levels_source")
        entry = float(signal.entry or 0)
        sl = float(signal.stop_loss or 0)
        if levels_src in ("group_hint", "inferred") or (sl <= 0 and entry >= 0):
            signal.metadata["levels_source"] = levels_src or "group_hint"
            signal.take_profit = signal.take_profit or [0.0, 0.0]
            if entry > 0 and sl <= 0:
                signal.metadata["entry_hint"] = entry
            return signal
        signal.ensure_take_profits()
        return signal.validate()

    def parse(self, context: ParseContext, provider: ProviderConfig) -> NormalizedSignal | None:
        if not self.enabled:
            return None

        extracted = self.extract_raw(context)
        if not extracted or not extracted.get("is_signal"):
            return None

        try:
            return self.signal_from_extracted(extracted, context, provider)
        except (KeyError, TypeError, ValueError, SignalValidationError):
            return None

    def learn_group_format(
        self,
        group_title: str,
        samples: list[dict[str, Any]],
        group_username: str | None = None,
    ) -> dict[str, Any]:
        if not self.enabled or not samples:
            return {
                "style": "unknown",
                "notes": "No samples collected",
                "learned_at": datetime.now(timezone.utc).isoformat(),
            }

        sample_text = json.dumps(samples[:25], ensure_ascii=False)[:12000]
        prompt = f"""Analyze Telegram messages from group "{group_title}" (@{group_username or 'unknown'}).

Describe how THIS group formats trading signals so a parser can recognize them later.

Return ONLY JSON:
{{
  "style": "text_levels" | "chart_image" | "chart_plus_caption" | "mixed" | "unknown",
  "signal_keywords": ["buy", "long", ...],
  "symbol_format": "how symbols appear e.g. #HBAR or HBARUSDT",
  "sl_tp_location": "text|chart|both",
  "notes": "2-4 sentences describing the pattern",
  "example_snippets": ["short example 1", "short example 2"]
}}

MESSAGES:
{sample_text}
"""
        content = self._post_json(f"{self.gateway_url}/chat", {
            "question": prompt,
            "systemPrompt": "You analyze Telegram crypto signal group message formats. Return JSON only.",
        }) if not self.url else self._post_json(self.url, {
            "question": prompt,
            "systemPrompt": "You analyze Telegram crypto signal group message formats. Return JSON only.",
        })
        parsed = self._parse_json_content(content) or {}
        parsed["learned_at"] = datetime.now(timezone.utc).isoformat()
        parsed["sample_count"] = len(samples)
        return parsed

    def _build_system_prompt(self, context: ParseContext) -> str:
        parts = [BASE_SYSTEM_PROMPT]
        profile = context.format_profile or {}
        if profile:
            parts.append("\nGROUP FORMAT PROFILE (learned from this channel):")
            parts.append(json.dumps({
                "style": profile.get("style"),
                "symbol_format": profile.get("symbol_format"),
                "sl_tp_location": profile.get("sl_tp_location"),
                "signal_keywords": profile.get("signal_keywords"),
                "notes": profile.get("notes"),
                "examples": (profile.get("example_snippets") or [])[:3],
            }, ensure_ascii=False))
        if context.group_title:
            parts.append(f"\nGroup: {context.group_title}")
        return "\n".join(parts)

    def _call_ai(self, context: ParseContext) -> dict | None:
        system = self._build_system_prompt(context)
        user_text = context.combined_text() or context.text or "Analyze the attached chart for a trading signal."

        if context.image_b64:
            vision = self._call_vision(system, user_text, context.image_b64)
            if vision:
                return vision

        if self.url and "/chat" in self.url:
            parsed = self._parse_json_content(self._post_json(self.url, {
                "question": f"{user_text}\n\nExtract the futures signal as JSON.",
                "systemPrompt": system,
            }))
            if parsed:
                return parsed

        for base in self._gateway_candidates:
            content = self._post_json(f"{base}/chat", {
                "question": f"{user_text}\n\nExtract the futures signal as JSON.",
                "systemPrompt": system,
            })
            parsed = self._parse_json_content(content)
            if parsed:
                return parsed
        return None

    def _call_vision(self, system: str, user_text: str, image_b64: str) -> dict | None:
        payload = {
            "model": self.vision_model,
            "prompt": f"{system}\n\nUSER MESSAGE:\n{user_text}\n\nRead the chart image and extract the signal JSON.",
            "stream": False,
            "images": [image_b64],
        }
        for base in self._gateway_candidates:
            content = self._post_json(f"{base}/ollama/generate", payload, ollama=True)
            parsed = self._parse_json_content(content)
            if parsed:
                return parsed
            payload["model"] = self.model
            content = self._post_json(f"{base}/ollama/generate", payload, ollama=True)
            parsed = self._parse_json_content(content)
            if parsed:
                return parsed
            payload["model"] = self.vision_model
        return None

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["X-API-Key"] = self.api_key
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _post_json(self, url: str, payload: dict, *, openai: bool = False, ollama: bool = False) -> str:
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers=self._headers(), method="POST")
        try:
            with urllib.request.urlopen(req, timeout=90) as res:
                raw = json.loads(res.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            return ""

        if ollama:
            return raw.get("response") or ""
        if openai:
            return (
                raw.get("choices", [{}])[0].get("message", {}).get("content")
                or raw.get("message", {}).get("content")
                or raw.get("content")
                or ""
            )
        return raw.get("answer") or raw.get("response") or ""

    def _parse_json_content(self, content: str) -> dict | None:
        if not content:
            return None
        text = content.strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
        try:
            extracted = json.loads(text)
        except json.JSONDecodeError:
            match = re.search(r"\{[\s\S]*\}", text)
            if not match:
                return None
            try:
                extracted = json.loads(match.group(0))
            except json.JSONDecodeError:
                return None
        if extracted.get("signal") is None and extracted.get("is_signal") is False:
            return {"is_signal": False}
        if extracted.get("is_signal") is not True and "symbol" not in extracted:
            return {"is_signal": False}
        return extracted
