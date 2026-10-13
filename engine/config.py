"""config.yaml 로더. 모든 기준값은 여기서 읽는다 (하드코딩 금지)."""
import copy
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.yaml"


def _deep_merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out


def load_config(path=None, overrides=None) -> dict:
    """config.yaml을 읽고, overrides(설정 화면의 슬라이더 값 등)를 덮어쓴다."""
    with open(path or CONFIG_PATH, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    return _deep_merge(cfg, overrides)
