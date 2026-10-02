"""
Local vision LLM utilities for extracted figures.

Calls an Ollama vision model via its REST API to classify extracted PDF images
and produce structured descriptions for real scientific figures before they
reach the text-generation stage.

Auto-detects available vision models in priority order.
Results are cached by SHA-256 of the image file so re-runs are free.
"""

import base64
import hashlib
import json
import logging
import os
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

_VISION_PRIORITY = [
    "gemma4:latest",
    "gemma4:31b",
    "llama3.2-vision:latest",
    "llama3.2-vision",
    # "qwen2.5vl",
    # "qwen2.5-vl",
    # "llama3.2-vision:90b",
    # "llama3.2-vision:11b",
    # "llava:34b",
    # "llava:13b",
    # "minicpm-v",
    # "llava",
    # "moondream",
    # "bakllava",
    # "llava-phi3",
]
_OLLAMA_BASE = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
_CACHE_DIR = Path(__file__).parent / ".vision_cache"
_LOW_SIGNAL_TEXT = (
    "logo",
    "publisher",
    "cover page",
    "table of contents",
    "graphical abstract",
    "dense paragraph",
    "copyright",
    "journal page",
    "title page",
    "author list",
)


def _available_vision_model() -> str | None:
    """Return the first available Ollama vision model, or None."""
    configured = os.getenv("OLLAMA_VISION_MODEL", "").strip()
    try:
        resp = requests.get(f"{_OLLAMA_BASE}/api/tags", timeout=5)
        resp.raise_for_status()
        available = set()
        for model in resp.json().get("models", []):
            name = model.get("name", "").strip()
            if not name:
                continue
            available.add(name)
            available.add(name.split(":")[0])
        if configured:
            return configured
        for name in _VISION_PRIORITY:
            if name in available:
                return name
    except Exception:
        pass
    return None


def _file_hash(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def _load_cache(cache_path: Path) -> dict:
    if cache_path.exists():
        try:
            return json.loads(cache_path.read_text("utf-8"))
        except Exception:
            pass
    return {}


def _save_cache(cache_path: Path, data: dict) -> None:
    _CACHE_DIR.mkdir(exist_ok=True)
    cache_path.write_text(json.dumps(data, indent=2), encoding="utf-8")


_FIGURE_PROMPT = (
    "You are a scientific figure analyst. Examine this figure carefully.\n"
    "Return a JSON object with exactly these keys:\n"
    "  caption_enhanced: a 1-2 sentence precise scientific caption\n"
    "  key_finding: the single most important result shown\n"
    "  axis_labels: list of axis/legend labels you can read (empty list if none)\n"
    "  figure_type: one of [graph, chart, diagram, microscopy, photo, table, equation, other]\n"
    "Output ONLY the JSON object, no markdown."
)

_FIGURE_SCREEN_PROMPT = (
    "You are screening an extracted PDF image candidate.\n"
    "Decide whether it is a meaningful scientific figure (e.g., plot, diagram, chart, microscopy) worth keeping for a slide deck.\n"
    "CRITICAL: Reject entire pages of text, cover pages, dense paragraphs, logos, publisher marks, blank fragments, tiny crops, and UI artifacts.\n"
    "Return a JSON object with exactly these keys:\n"
    "  is_figure: true or false\n"
    "  confidence: number from 0 to 1\n"
    "  figure_type: one of [graph, chart, diagram, microscopy, photo, table, equation, other]\n"
    "  brief_reason: short explanation\n"
    "  caption_enhanced: a 1-2 sentence scientific caption if is_figure is true, otherwise empty string\n"
    "  key_finding: the main takeaway if is_figure is true, otherwise empty string\n"
    "  axis_labels: list of readable axis or legend labels, otherwise empty list\n"
    "Output ONLY the JSON object, no markdown."
)


def _call_vision_model(image_path: str, prompt: str, model: str, cache_prefix: str) -> dict | None:
    """Run a local vision prompt against *image_path* and cache the JSON result."""
    img_hash = _file_hash(image_path)
    cache_key = f"{cache_prefix}_{model}_{img_hash}"
    cache_path = _CACHE_DIR / f"{cache_key}.json"

    cache = _load_cache(cache_path)
    if cache:
        return cache

    with open(image_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode("utf-8")

    payload = {
        "model": model,
        "prompt": prompt,
        "images": [img_b64],
        "stream": False,
        "format": "json",
        "keep_alive": "2m",
        "options": {
            "num_ctx": int(os.getenv("PPTMAKER_VISION_NUM_CTX", "2048")),
            "num_predict": int(os.getenv("PPTMAKER_VISION_NUM_PREDICT", "220")),
            "temperature": float(os.getenv("PPTMAKER_VISION_TEMPERATURE", "0.1")),
        },
    }
    resp = requests.post(
        f"{_OLLAMA_BASE}/api/generate",
        json=payload,
        timeout=120,
    )
    resp.raise_for_status()
    raw = resp.json().get("response", "")
    result = json.loads(raw)
    _save_cache(cache_path, result)
    return result


def enrich_figure(image_path: str, model: str | None = None) -> dict | None:
    """
    Run a local vision LLM on *image_path* and return a structured dict, or
    None if Ollama is unavailable or the model call fails.

    The result is cached in bridge/.vision_cache/<hash>.json so repeated calls
    for the same file are instant.
    """
    if not os.path.isfile(image_path):
        return None

    model = model or _available_vision_model()
    if not model:
        return None

    try:
        result = _call_vision_model(
            image_path=image_path,
            prompt=_FIGURE_PROMPT,
            model=model,
            cache_prefix="enrich",
        )
        if result:
            logger.debug(f"Figure enrichment succeeded for {image_path} using model {model}")
        return result
    except Exception as exc:
        logger.exception(f"Figure enrichment failed for {image_path} with model {model}: {exc}")


def analyze_figure_candidate(image_path: str, model: str | None = None) -> dict | None:
    """
    Classify whether *image_path* is a meaningful scientific figure and, if so,
    return structured metadata suitable for downstream slide generation.
    """
    if not os.path.isfile(image_path):
        return None

    model = model or _available_vision_model()
    if not model:
        return None

    try:
        result = _call_vision_model(
            image_path=image_path,
            prompt=_FIGURE_SCREEN_PROMPT,
            model=model,
            cache_prefix="screen",
        )
        if not result:
            logger.warning(f"Figure candidate analysis returned empty result for {image_path}")
            return None
    except Exception as exc:
        logger.exception(f"Figure candidate analysis failed for {image_path} with model {model}: {exc}")
        return None

    if not isinstance(result, dict):
        return None

    result["is_figure"] = bool(result.get("is_figure"))
    try:
        result["confidence"] = float(result.get("confidence", 0.0))
    except (TypeError, ValueError):
        result["confidence"] = 0.0

    axis_labels = result.get("axis_labels")
    result["axis_labels"] = axis_labels if isinstance(axis_labels, list) else []
    return result


def enrich_catalog(visual_catalog: list, status_cb=None) -> list:
    """
    Run enrich_figure on every entry in *visual_catalog* that has a valid path.
    Returns a new list with `vision` key added to enriched entries.
    """
    if os.getenv("PPTMAKER_ENABLE_VISION_ENRICHMENT", "1") != "1":
        if status_cb:
            status_cb("vision_skip", "Vision enrichment disabled")
        return visual_catalog

    model = _available_vision_model()
    if not model:
        if status_cb:
            status_cb("vision_skip", "No Ollama vision model available — skipping figure enrichment")
        return visual_catalog

    try:
        max_items = max(0, int(os.getenv("PPTMAKER_MAX_VISION_FIGURES", "8")))
    except ValueError:
        max_items = 8
    catalog_to_enrich = visual_catalog[:max_items] if max_items else []
    skipped = visual_catalog[max_items:] if max_items else visual_catalog

    if status_cb:
        status_cb("vision_start", f"Enriching figures with {model}", {"current": 0, "total": len(catalog_to_enrich)})

    enriched = []
    total = len(catalog_to_enrich)
    for idx, entry in enumerate(catalog_to_enrich, start=1):
        new_entry = dict(entry)
        path = entry.get("path")
        screen = None
        if path and os.path.isfile(path):
            screen = analyze_figure_candidate(path, model=model)
            if screen:
                new_entry["screen"] = screen
                if status_cb:
                    status_cb("vision_candidate", f"Screened {entry.get('id', path)}", {"current": idx, "total": total})
                if _should_drop_candidate(new_entry):
                    new_entry["low_value_visual"] = True
                    if status_cb:
                        status_cb(
                            "vision_candidate", f"Rejected {entry.get('id', path)}", {"current": idx, "total": total}
                        )
                    enriched.append(new_entry)
                    continue
        if new_entry.get("vision"):
            enriched.append(new_entry)
            if status_cb:
                status_cb(
                    "vision_figure", f"Reused enrichment for {entry.get('id', path)}", {"current": idx, "total": total}
                )
            continue
        if path and os.path.isfile(path):
            result = enrich_figure(path, model=model)
            if result:
                new_entry["vision"] = result
                if status_cb:
                    status_cb("vision_figure", f"Enriched {entry.get('id', path)}", {"current": idx, "total": total})
        enriched.append(new_entry)

    return enriched + skipped


def _should_drop_candidate(entry: dict) -> bool:
    screen = entry.get("screen") or {}
    if not isinstance(screen, dict):
        return False

    confidence = float(screen.get("confidence") or 0.0)
    brief_reason = str(screen.get("brief_reason") or "").lower()
    caption = str(entry.get("caption") or "").lower()

    if not screen.get("is_figure") and confidence >= 0.55:
        return True
    if any(term in brief_reason for term in _LOW_SIGNAL_TEXT):
        return True
    if any(term in caption for term in ("table of contents", "articles you may be interested", "aip publishing")):
        return True
    return False
