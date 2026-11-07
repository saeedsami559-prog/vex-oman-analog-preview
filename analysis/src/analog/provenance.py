"""Measured values with provenance, and missing values with a structured reason.

Every feature in config/weights.yaml ends up, for every site, as exactly one of:
  Measured  - a number computed by this pipeline from a downloaded/streamed dataset, plus where
              it came from (dataset, version, product IDs, URLs, dates, resolution, processing);
  Missing   - null, with a reason code, bilingual explanation and what would fix it.
Nothing is ever filled in by hand.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

REASON_CODES = ("no_coverage", "needs_login", "not_implemented", "calibration_missing",
                "not_applicable", "download_failed")

REQUIRED_PROVENANCE = ("dataset", "version", "products", "urls", "acquired", "native_resolution_m", "processing")

# Generic text per reason code; {source} and {detail} are filled per instance.
REASONS: dict[str, dict[str, str]] = {
    "no_coverage": {
        "en": "{source} has no usable pixels in this site's window{detail}.",
        "ar": "لا توجد بكسلات صالحة من {source} داخل نافذة هذا الموقع{detail}.",
    },
    "needs_login": {
        "en": "{source} is only available with a NASA Earthdata Login, which is not configured on the processing machine.",
        "ar": "بيانات {source} متاحة فقط بحساب NASA Earthdata، وهو غير مُعدّ على جهاز المعالجة.",
    },
    "not_implemented": {
        "en": "Reading {source} is not implemented in the pipeline yet{detail}.",
        "ar": "قراءة {source} غير مبرمجة في خط المعالجة بعد{detail}.",
    },
    "calibration_missing": {
        "en": "{source}: turning the data into this metric needs a calibration constant for which we have no cited source{detail}.",
        "ar": "{source}: تحويل البيانات إلى هذا المقياس يحتاج ثابت معايرة ليس لدينا مصدر موثّق له{detail}.",
    },
    "not_applicable": {
        "en": "Not compared for this body by design{detail}.",
        "ar": "لا يُقارن لهذا الجرم عن قصد{detail}.",
    },
    "download_failed": {
        "en": "Downloading or reading {source} failed{detail}.",
        "ar": "فشل تنزيل أو قراءة {source}{detail}.",
    },
}


@dataclass
class Measured:
    feature: str
    value: float
    provenance: dict[str, Any]

    def __post_init__(self) -> None:
        missing = [k for k in REQUIRED_PROVENANCE if k not in self.provenance]
        if missing:
            raise ValueError(f"{self.feature}: provenance lacks {missing}")
        if not (self.provenance["products"] or self.provenance["urls"]):
            raise ValueError(f"{self.feature}: provenance needs product IDs or URLs")

    def to_json(self) -> dict[str, Any]:
        return {"value": round(float(self.value), 6), "provenance": self.provenance}


@dataclass
class Missing:
    feature: str
    reason_code: str
    source: str
    needed: str
    needed_ar: str
    detail_en: str = ""
    detail_ar: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.reason_code not in REASON_CODES:
            raise ValueError(f"unknown reason code {self.reason_code}")

    def to_json(self) -> dict[str, Any]:
        text = REASONS[self.reason_code]
        out = {
            "feature": self.feature,
            "status": "not_applicable" if self.reason_code == "not_applicable" else "unavailable",
            "reason_code": self.reason_code,
            "reason_en": text["en"].format(source=self.source, detail=f" ({self.detail_en})" if self.detail_en else ""),
            "reason_ar": text["ar"].format(source=self.source, detail=f" ({self.detail_ar})" if self.detail_ar else ""),
            "needed": self.needed,
            "needed_ar": self.needed_ar,
        }
        if self.extra:
            out["details"] = self.extra
        return out
