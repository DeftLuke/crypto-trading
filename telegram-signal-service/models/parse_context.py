from dataclasses import dataclass, field
from typing import Any


@dataclass
class ParseContext:
    text: str = ""
    image_b64: str | None = None
    group_title: str = ""
    group_username: str | None = None
    format_profile: dict[str, Any] = field(default_factory=dict)
    has_image: bool = False

    def combined_text(self) -> str:
        parts = []
        if self.text.strip():
            parts.append(self.text.strip())
        if self.has_image:
            parts.append("[attached TradingView/chart image]")
        return "\n".join(parts).strip()
