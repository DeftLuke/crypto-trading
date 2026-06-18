from models.signal import NormalizedSignal
from parser.rule_parser import parse_generic_signal
from providers.base import ProviderParser


class GenericProviderParser(ProviderParser):
    def parse(self, message: str) -> NormalizedSignal | None:
        return parse_generic_signal(message, self.provider)
