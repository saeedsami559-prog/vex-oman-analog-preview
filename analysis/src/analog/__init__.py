"""Oman Analog Explorer analysis package."""

from pathlib import Path

ANALYSIS_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = ANALYSIS_DIR.parent
CONFIG_DIR = ANALYSIS_DIR / "config"
DATA_DIR = REPO_DIR / "data"
