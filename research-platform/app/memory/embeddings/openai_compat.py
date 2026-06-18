"""OpenAI-compatible embedding API provider."""

import httpx

from app.core.logging import get_logger
from app.memory.embeddings.base import EmbeddingProvider

logger = get_logger("memory.embeddings.openai")


class OpenAICompatEmbeddingProvider(EmbeddingProvider):
    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str = "text-embedding-3-small",
        vector_size: int = 1536,
    ):
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._vector_size = vector_size

    @property
    def model_name(self) -> str:
        return self._model

    @property
    def vector_size(self) -> int:
        return self._vector_size

    def embed(self, texts: list[str]) -> list[list[float]]:
        url = f"{self._base_url}/embeddings"
        headers = {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(url, headers=headers, json={"model": self._model, "input": texts})
            resp.raise_for_status()
            data = resp.json()["data"]
            return [item["embedding"] for item in sorted(data, key=lambda x: x["index"])]
