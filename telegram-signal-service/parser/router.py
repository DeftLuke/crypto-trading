import importlib.util
from pathlib import Path

from models.parse_context import ParseContext
from models.signal import NormalizedSignal, SignalValidationError
from parser.signal_quality import acceptable_parsed_signal, has_trade_text
from providers.config import ProviderConfig
from providers.generic import GenericProviderParser
from providers.vip_channel_1 import VipChannel1Parser


PARSERS = {
    "generic": GenericProviderParser,
    "vip_channel_1": VipChannel1Parser,
}


def _load_ai_parser():
    client_path = Path(__file__).resolve().parents[1] / "ai-parser" / "client.py"
    spec = importlib.util.spec_from_file_location("telegram_signal_ai_parser", client_path)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.AiParserClient()


class SignalParserRouter:
    def __init__(self) -> None:
        self.ai_parser = _load_ai_parser()

    def _try_rule(self, context: ParseContext, provider: ProviderConfig) -> NormalizedSignal | None:
        text = (context.text or "").strip()
        if not text or not has_trade_text(text):
            return None
        parser_cls = PARSERS.get(provider.parser, GenericProviderParser)
        try:
            signal = parser_cls(provider).parse(text)
            if signal and acceptable_parsed_signal(signal, context):
                signal.ensure_take_profits()
                return signal.validate()
        except SignalValidationError:
            return None
        return None

    def parse(self, context: ParseContext, provider: ProviderConfig) -> NormalizedSignal | None:
        signal, _audit = self.parse_with_audit(context, provider)
        return signal

    def parse_with_audit(self, context: ParseContext, provider: ProviderConfig) -> tuple[NormalizedSignal | None, dict]:
        audit: dict = {
            "parse_stage": "none",
            "parser_used": None,
            "model_used": None,
            "ai_output": None,
            "has_image": context.has_image,
            "original_text": context.text or "",
            "reject_reason": None,
            "failed_rules": [],
        }

        rule_signal = self._try_rule(context, provider)
        if rule_signal:
            audit["parse_stage"] = "rule"
            audit["parser_used"] = "rule"
            audit["ai_output"] = rule_signal.to_main_api_payload()
            audit["model_used"] = "regex"
            return rule_signal, audit

        if self.ai_parser:
            raw = self.ai_parser.extract_raw(context)
            audit["ai_output"] = raw
            audit["model_used"] = self.ai_parser.vision_model if context.has_image else self.ai_parser.model
            audit["parse_stage"] = "vision" if context.has_image else "ai"

            if raw and raw.get("is_signal"):
                try:
                    parsed = self.ai_parser.signal_from_extracted(raw, context, provider)
                    if parsed and acceptable_parsed_signal(parsed, context):
                        audit["parser_used"] = "ai"
                        audit["ai_output"] = {**(raw or {}), **parsed.to_main_api_payload()}
                        return parsed, audit
                    audit["reject_reason"] = "quality_check_failed"
                    audit["failed_rules"] = ["acceptable_parsed_signal"]
                except SignalValidationError as exc:
                    audit["reject_reason"] = str(exc)
                    audit["failed_rules"] = [str(exc)]
            elif raw:
                audit["reject_reason"] = "ai_not_signal"
            else:
                audit["reject_reason"] = "ai_unavailable"

        if not audit["reject_reason"]:
            audit["reject_reason"] = "no_parser_match"
        return None, audit
