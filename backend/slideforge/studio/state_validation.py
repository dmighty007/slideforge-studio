from __future__ import annotations

from dataclasses import dataclass
from typing import Any


MAX_SLIDES = 2000
MAX_ELEMENTS_PER_SLIDE = 5000
MAX_ID_LENGTH = 160
MAX_ELEMENT_TYPE_LENGTH = 64


@dataclass(frozen=True)
class StateValidationError(ValueError):
    message: str

    def __str__(self) -> str:
        return self.message


def _validate_id(value: Any, *, label: str) -> str:
    if not isinstance(value, str):
        raise StateValidationError(f"{label} id must be a string")
    item_id = value.strip()
    if not item_id:
        raise StateValidationError(f"{label} id is required")
    if len(item_id) > MAX_ID_LENGTH:
        raise StateValidationError(f"{label} id is too long")
    return item_id


def validate_presentation_state(state: Any) -> None:
    """
    Validate the minimum SlideForge deck contract accepted by persistence/export.

    The frontend schema is intentionally flexible because object types evolve quickly.
    This validator only rejects states that are structurally corrupt, ambiguous, or
    likely hostile while allowing object-specific payloads to pass through.
    """
    if not isinstance(state, dict):
        raise StateValidationError("Presentation state must be a JSON object")

    slides = state.get("slides")
    if not isinstance(slides, list):
        raise StateValidationError("Presentation state must include a slides array")
    if len(slides) > MAX_SLIDES:
        raise StateValidationError(f"Presentation exceeds the {MAX_SLIDES} slide limit")

    slide_ids: set[str] = set()
    element_ids: set[str] = set()
    for slide_index, slide in enumerate(slides):
        if not isinstance(slide, dict):
            raise StateValidationError(f"Slide {slide_index + 1} must be an object")

        slide_id = _validate_id(slide.get("id"), label=f"Slide {slide_index + 1}")
        if slide_id in slide_ids:
            raise StateValidationError(f"Duplicate slide id: {slide_id}")
        slide_ids.add(slide_id)

        elements = slide.get("elements", [])
        if elements is None:
            elements = []
        if not isinstance(elements, list):
            raise StateValidationError(f"Slide {slide_id} elements must be an array")
        if len(elements) > MAX_ELEMENTS_PER_SLIDE:
            raise StateValidationError(
                f"Slide {slide_id} exceeds the {MAX_ELEMENTS_PER_SLIDE} element limit",
            )

        for element_index, element in enumerate(elements):
            if not isinstance(element, dict):
                raise StateValidationError(
                    f"Element {element_index + 1} on slide {slide_id} must be an object",
                )

            element_id = _validate_id(
                element.get("id"),
                label=f"Element {element_index + 1} on slide {slide_id}",
            )
            if element_id in element_ids:
                raise StateValidationError(f"Duplicate element id: {element_id}")
            element_ids.add(element_id)

            element_type = element.get("type")
            if not isinstance(element_type, str) or not element_type.strip():
                raise StateValidationError(f"Element {element_id} type is required")
            if len(element_type) > MAX_ELEMENT_TYPE_LENGTH:
                raise StateValidationError(f"Element {element_id} type is too long")

            styles = element.get("styles", {})
            if styles is not None and not isinstance(styles, dict):
                raise StateValidationError(f"Element {element_id} styles must be an object")
