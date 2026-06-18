"""Zone lifecycle — active, mitigated, invalidated, broken."""

from app.smc.types import Direction, Zone, ZoneStatus, ZoneType


class ZoneStateEngine:
    """Track historical zones until invalidated."""

    def __init__(self) -> None:
        self.zones: list[Zone] = []

    def add_zone(self, zone: Zone) -> None:
        self.zones.append(zone)

    def update(self, high: float, low: float, close: float, ts: int) -> list[Zone]:
        changed: list[Zone] = []
        for zone in self.zones:
            if zone.status not in (ZoneStatus.ACTIVE, ZoneStatus.MITIGATED):
                continue
            if zone.direction == Direction.BULLISH:
                if low <= zone.top and low >= zone.bottom:
                    zone.status = ZoneStatus.MITIGATED
                    changed.append(zone)
                if close < zone.bottom:
                    zone.status = ZoneStatus.INVALIDATED
                    changed.append(zone)
            else:
                if high >= zone.bottom and high <= zone.top:
                    zone.status = ZoneStatus.MITIGATED
                    changed.append(zone)
                if close > zone.top:
                    zone.status = ZoneStatus.INVALIDATED
                    changed.append(zone)
        return changed

    def active_zones(self, zone_type: ZoneType | None = None) -> list[Zone]:
        out = [z for z in self.zones if z.status == ZoneStatus.ACTIVE]
        if zone_type:
            out = [z for z in out if z.zone_type == zone_type]
        return out

    def historical(self) -> list[dict]:
        return [z.to_dict() for z in self.zones]
