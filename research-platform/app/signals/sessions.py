"""Trading session detection (UTC)."""

from datetime import UTC, datetime
from enum import Enum
from typing import Any


class Session(str, Enum):
    ASIAN = "asian"
    LONDON = "london"
    NEW_YORK = "new_york"
    OVERLAP = "overlap"
    OFF = "off"


class SessionEngine:
    """Detect Asian / London / New York sessions in UTC."""

    ASIAN = (0, 8)
    LONDON = (8, 16)
    NEW_YORK = (13, 21)

    def detect(self, ts_ms: int | None = None) -> dict[str, Any]:
        dt = datetime.fromtimestamp((ts_ms or 0) / 1000, tz=UTC) if ts_ms else datetime.now(UTC)
        hour = dt.hour
        in_asian = self.ASIAN[0] <= hour < self.ASIAN[1]
        in_london = self.LONDON[0] <= hour < self.LONDON[1]
        in_ny = self.NEW_YORK[0] <= hour < self.NEW_YORK[1]
        if in_london and in_ny:
            session = Session.OVERLAP.value
        elif in_asian:
            session = Session.ASIAN.value
        elif in_london:
            session = Session.LONDON.value
        elif in_ny:
            session = Session.NEW_YORK.value
        else:
            session = Session.OFF.value
        return {"session": session, "hour_utc": hour}
