from abc import ABC, abstractmethod

from models.signal import NormalizedSignal
from providers.config import ProviderConfig


class ProviderParser(ABC):
    def __init__(self, provider: ProviderConfig):
        self.provider = provider

    @abstractmethod
    def parse(self, message: str) -> NormalizedSignal | None:
        raise NotImplementedError
