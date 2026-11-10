"""Static checks for plgkit/nudges config and message files."""

from __future__ import annotations

import ast
import re
from pathlib import Path

import yaml

_AUDIENCE_LISTS = ("require_all", "require_one_of", "exclude")
_MSG_PREFIX = re.compile(r"^\d{14}-[a-z0-9-]+$")


def validate(config, messages, audience_names):
    """Return problem lines. An empty list means valid."""
    problems: list[str] = []
    known = set(audience_names) if audience_names is not None else set()
    problems.extend(_check_locations(config or {}))
    for message in messages or []:
        label = message.get("_path") or message.get("id") or "message"
        problems.extend(_check_message_audience(label, message, known))
        problems.extend(_check_message_id(label, message))
    return problems


def load_nudges_dir(root: Path, *, audiences_file: str = "audiences.py") -> tuple[dict, list[dict], set[str]]:
    """Load config.yml, messages/*.yml, and audience map keys from audiences_file."""
    root = Path(root)
    config_path = root / "config.yml"
    if not config_path.is_file():
        raise ValueError(f"{config_path}: config.yml not found")
    with config_path.open(encoding="utf-8") as handle:
        config = yaml.safe_load(handle) or {}
    if not isinstance(config, dict):
        raise ValueError(f"{config_path}: config must be a mapping")

    messages_dir = root / "messages"
    if not messages_dir.is_dir():
        raise ValueError(f"{messages_dir}: messages/ not found")
    messages: list[dict] = []
    for path in sorted(messages_dir.glob("*.yml")):
        with path.open(encoding="utf-8") as handle:
            parsed = yaml.safe_load(handle)
        if not isinstance(parsed, dict):
            raise ValueError(f"{path}: message must be a mapping")
        item = dict(parsed)
        item["id"] = path.stem
        item["_path"] = f"messages/{path.name}"
        messages.append(item)

    aud_path = root / audiences_file
    if not aud_path.is_file():
        raise ValueError(f"{aud_path}: {audiences_file} not found")
    names = audience_names_from_python(aud_path)
    return config, messages, names


def audience_names_from_python(path: Path) -> set[str]:
    text = Path(path).read_text(encoding="utf-8")
    tree = ast.parse(text, filename=str(path))
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id == "audiences":
                if isinstance(node.value, ast.Dict):
                    return _dict_keys(node.value)
    raise ValueError(f"{path}: no audiences = {{...}} mapping found")


def audience_names_from_typescript(text: str) -> set[str]:
    match = re.search(
        r"export\s+const\s+audiences\s*=\s*\{([^}]*)\}",
        text,
        re.DOTALL,
    )
    if not match:
        raise ValueError("no export const audiences = {...} found")
    body = match.group(1)
    return {m.group(1) for m in re.finditer(r"^\s*([a-z][a-z0-9_]*)\s*:", body, re.MULTILINE)}


def audience_names_from_go(text: str) -> set[str]:
    match = re.search(r"var\s+Audiences\s*=\s*map\[string\].*?\{([^}]*)\}", text, re.DOTALL)
    if not match:
        raise ValueError("no var Audiences = map[string]...{...} found")
    body = match.group(1)
    return {m.group(1) for m in re.finditer(r'"([^"]+)":', body)}


def _dict_keys(node: ast.Dict) -> set[str]:
    keys: set[str] = set()
    for key in node.keys:
        if isinstance(key, ast.Constant) and isinstance(key.value, str):
            keys.add(key.value)
    return keys


def _check_locations(config: dict) -> list[str]:
    problems: list[str] = []
    locations = config.get("locations")
    if locations is None:
        return problems
    if not isinstance(locations, dict):
        problems.append("config.yml: locations must be a mapping")
        return problems
    for loc_name, loc in locations.items():
        if not isinstance(loc, dict):
            problems.append(f"config.yml: locations.{loc_name} must be a mapping")
            continue
        loc_max = _limit(loc.get("max"), 1, f"config.yml: locations.{loc_name}.max")
        if loc_max is None:
            problems.append(f"config.yml: locations.{loc_name}.max must be a non-negative integer")
            continue
        surfaces = loc.get("surfaces")
        if surfaces is None:
            continue
        if not isinstance(surfaces, dict):
            problems.append(f"config.yml: locations.{loc_name}.surfaces must be a mapping")
            continue
        for surface_name, surface in surfaces.items():
            if not isinstance(surface, dict):
                problems.append(
                    f"config.yml: locations.{loc_name}.surfaces.{surface_name} must be a mapping",
                )
                continue
            surface_max = _limit(
                surface.get("max"),
                1,
                f"config.yml: locations.{loc_name}.surfaces.{surface_name}.max",
            )
            if surface_max is None:
                problems.append(
                    f"config.yml: locations.{loc_name}.surfaces.{surface_name}.max "
                    "must be a non-negative integer",
                )
                continue
            if surface_max > loc_max:
                problems.append(
                    f"config.yml: locations.{loc_name}.surfaces.{surface_name} max {surface_max} "
                    f"is higher than locations.{loc_name} max {loc_max}",
                )
    return problems


def _check_message_audience(label: str, message: dict, known: set[str]) -> list[str]:
    spec = message.get("audience")
    if spec is None:
        return []
    if not isinstance(spec, dict):
        return [f"{label}: audience must be a mapping"]
    problems: list[str] = []
    for key in _AUDIENCE_LISTS:
        if key not in spec or spec.get(key) is None:
            continue
        names = spec.get(key)
        if not isinstance(names, list):
            problems.append(f"{label}: audience.{key} must be a list of names")
            continue
        for name in names:
            if not isinstance(name, str) or name == "":
                problems.append(f"{label}: audience.{key} must be a list of names")
                break
            if name not in known:
                problems.append(f'{label}: audience name "{name}" is not in audiences.py')
    return problems


def _check_message_id(label: str, message: dict) -> list[str]:
    problems: list[str] = []
    msg_id = message.get("id")
    if isinstance(msg_id, str) and msg_id and not _MSG_PREFIX.match(msg_id):
        problems.append(f"{label}: message id must be YYYYMMDDHHMMSS-slug")
    return problems


def _limit(value, default: int, _label: str) -> int | None:
    if value is None:
        return default
    if isinstance(value, bool) or isinstance(value, str):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    if isinstance(value, float) and value.is_integer() and value >= 0:
        return int(value)
    return None
