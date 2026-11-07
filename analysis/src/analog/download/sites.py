"""Site bounding boxes shared by all download scripts."""

from __future__ import annotations

import math
from dataclasses import dataclass

import yaml

from .. import CONFIG_DIR

BODY_RADIUS_KM = {"earth": 6371.0, "mars": 3389.5, "moon": 1737.4}


@dataclass(frozen=True)
class BBox:
    west: float
    south: float
    east: float
    north: float

    def as_tuple(self) -> tuple[float, float, float, float]:
        return (self.west, self.south, self.east, self.north)


def bbox_for(lat: float, lon: float, half_km: float, body: str = "earth") -> BBox:
    """Small lat/lon box around a site - we never download whole scenes."""
    km_per_deg = math.pi * BODY_RADIUS_KM[body] / 180.0
    dlat = half_km / km_per_deg
    dlon = half_km / (km_per_deg * max(math.cos(math.radians(lat)), 0.01))
    return BBox(lon - dlon, max(-90.0, lat - dlat), lon + dlon, min(90.0, lat + dlat))


def load_sites() -> dict[str, dict]:
    sites: dict[str, dict] = {}
    for name, body in (("earth_sites.yaml", "earth"), ("target_sites.yaml", None)):
        with open(CONFIG_DIR / name, encoding="utf-8") as fh:
            for s in yaml.safe_load(fh)["sites"]:
                s.setdefault("body", body)
                sites[s["id"]] = s
    return sites


def site_bbox(site_id: str) -> tuple[dict, BBox]:
    site = load_sites()[site_id]
    return site, bbox_for(site["lat"], site["lon"], site.get("bbox_km", 10), site["body"])
