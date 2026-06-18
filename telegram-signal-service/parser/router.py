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
        rule_signal = self._try_rule(context, provider)
        if rule_signal:
            rule_signal.parser = rule_signal.parser or "rule"
            return rule_signal

        if self.ai_parser:
            try:
                parsed = self.ai_parser.parse(context, provider)
                if parsed and acceptable_parsed_signal(parsed, context):
                    return parsed
            except SignalValidationError:
                pass

        return None
