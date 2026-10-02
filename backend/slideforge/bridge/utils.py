import json
import os
import re
import ast
import pymupdf as fitz
from pathlib import Path

def _emit(event: str, message: str, data: dict | None = None, json_mode: bool = False):
    """Print a progress event. In json_mode emit newline-delimited JSON."""
    if json_mode:
        payload = {"event": event, "message": message, **(data or {})}
        print(json.dumps(payload), flush=True)
    else:
        print(f"  → [{event}] {message}", flush=True)

def _strip_markdown_fences(text: str) -> str:
    stripped = (text or "").strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)
    return stripped.strip()

def _extract_balanced_json(text: str) -> str | None:
    text = text or ""
    starts = [idx for idx in (text.find("{"), text.find("[")) if idx != -1]
    if not starts:
        return None
    start = min(starts)
    opening = text[start]
    closing = "}" if opening == "{" else "]"
    depth = 0
    in_string = False
    escape = False
    for idx in range(start, len(text)):
        ch = text[idx]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
            continue
        if ch == opening:
            depth += 1
        elif ch == closing:
            depth -= 1
            if depth == 0:
                return text[start : idx + 1]
    return None

def _cleanup_json_candidate(text: str) -> str:
    candidate = (text or "").strip().replace("\ufeff", "")
    candidate = candidate.replace("“", '"').replace("”", '"').replace("’", "'").replace("‘", "'")
    candidate = re.sub(r",(\s*[}\]])", r"\1", candidate)
    return candidate

def _literal_eval_jsonish(text: str):
    normalized = re.sub(r"\bnull\b", "None", text)
    normalized = re.sub(r"\btrue\b", "True", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\bfalse\b", "False", normalized, flags=re.IGNORECASE)
    return ast.literal_eval(normalized)

def _parse_jsonish(raw: str):
    attempts = []
    def add_attempt(value: str | None):
        value = (value or "").strip()
        if value and value not in attempts:
            attempts.append(value)

    stripped = _strip_markdown_fences(raw)
    extracted = _extract_balanced_json(stripped)
    add_attempt(raw)
    add_attempt(stripped)
    add_attempt(extracted)
    add_attempt(_cleanup_json_candidate(raw))
    add_attempt(_cleanup_json_candidate(stripped))
    add_attempt(_cleanup_json_candidate(extracted))

    last_error = None
    for attempt in attempts:
        try:
            return json.loads(attempt)
        except Exception as exc:
            last_error = exc
        try:
            return _literal_eval_jsonish(attempt)
        except Exception as exc:
            last_error = exc
    raise last_error or ValueError("No JSON candidate found")

def _union_rect(rects):
    rects = [fitz.Rect(r) for r in rects if r]
    if not rects:
        return None
    result = fitz.Rect(rects[0])
    for rect in rects[1:]:
        result.include_rect(rect)
    return result

def _expand_rect(rect: fitz.Rect, dx: float = 0, dy: float = 0) -> fitz.Rect:
    return fitz.Rect(rect.x0 - dx, rect.y0 - dy, rect.x1 + dx, rect.y1 + dy)

def _rect_center(rect: fitz.Rect) -> tuple[float, float]:
    return ((rect.x0 + rect.x1) / 2.0, (rect.y0 + rect.y1) / 2.0)

def _rect_intersection_width(a: fitz.Rect, b: fitz.Rect) -> float:
    return max(0.0, min(a.x1, b.x1) - max(a.x0, b.x0))

def _rect_intersection_height(a: fitz.Rect, b: fitz.Rect) -> float:
    return max(0.0, min(a.y1, b.y1) - max(a.y0, b.y0))

def _truncate_words(text: str, limit: int) -> str:
    words = (text or "").split()
    if len(words) <= limit:
        return text
    return " ".join(words[:limit]) + "..."


def figures_root() -> Path:
    """Where extracted figures and equation crops are written (the app sets SLIDEFORGE_FIGURES_DIR)."""
    configured = os.environ.get("SLIDEFORGE_FIGURES_DIR")
    return Path(configured) if configured else Path.cwd() / "extracted_figures"

