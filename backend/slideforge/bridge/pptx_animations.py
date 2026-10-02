"""Slide animations for the PowerPoint export.

python-pptx has no animation API, so the slide's <p:timing> is written here. The click order follows the editor's
show: lists with "Reveal bullets one by one" first (a bullet and its sub-points per click, the box's own entrance
coming in with the first bullet), then the click animations. Animations set to start with the slide play
automatically when it appears.

Exported: entrances and exits as Fade, Fly In/Out (four directions), Zoom and Appear/Disappear. Emphasis, colour,
path and other effects have no simple PowerPoint equivalent and are left out; the object is then simply visible.
"""

from __future__ import annotations

from typing import Any, Iterable, Optional

from lxml import etree

P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"

# CSS-like direction of travel -> where the object comes from / leaves to (PowerPoint's presetSubtype for Fly).
_FLY_SUBTYPE = {"up": 4, "down": 1, "left": 2, "right": 8}
_FLY_START = {  # (attribute, off-slide formula)
    4: ("ppt_y", "1+#ppt_h/2"),
    1: ("ppt_y", "0-#ppt_h/2"),
    2: ("ppt_x", "1+#ppt_w/2"),
    8: ("ppt_x", "0-#ppt_w/2"),
}
_LEGACY_EFFECTS = {
    "fade-in": ("fade", None),
    "slide-up": ("fly", "up"),
    "slide-down": ("fly", "down"),
    "slide-left": ("fly", "left"),
    "slide-right": ("fly", "right"),
    "zoom-in": ("zoom", None),
    "pop-in": ("zoom", None),
    "wipe-in": ("fade", None),
}


def _number(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _effect_of(animation: dict) -> Optional[dict]:
    """One editor animation as a PowerPoint effect, or None when it has no equivalent."""
    start = _number(animation.get("startOpacity"), 1.0)
    end = _number(animation.get("endOpacity"), 1.0)
    category = str(animation.get("category") or "")
    kind = "entr" if (start < end or category == "entrance") else "exit" if (start > end or category == "exit") else None
    if kind is None:
        return None
    anim_type = str(animation.get("type") or "")
    if anim_type == "transform" and animation.get("direction") in _FLY_SUBTYPE:
        effect, direction = "fly", str(animation["direction"])
    elif anim_type in {"scaleInPlace", "scale"}:
        effect, direction = "zoom", None
    else:
        effect, direction = "fade", None
    return {
        "kind": kind,
        "effect": effect,
        "direction": direction,
        "duration": int(max(100, min(20000, _number(animation.get("duration"), 600)))),
        "delay": int(max(0, min(60000, _number(animation.get("delay", animation.get("startTime")), 0)))),
        "click": animation.get("trigger") == "on-click",
    }


def element_effects(el: dict) -> list[dict]:
    """The exportable animations of an element, in their order."""
    animation = el.get("animation")
    if isinstance(animation, str) and animation.strip():
        animation = {"effect": animation.strip()}
    if not isinstance(animation, dict):
        return []
    if isinstance(animation.get("timelines"), list):
        effects = []
        for timeline in animation["timelines"]:
            for item in (timeline or {}).get("animations") or []:
                effect = _effect_of(item) if isinstance(item, dict) else None
                if effect:
                    effects.append(effect)
        return effects
    mapped = _LEGACY_EFFECTS.get(str(animation.get("effect") or ""))
    if not mapped:
        return []
    return [{
        "kind": "entr",
        "effect": mapped[0],
        "direction": mapped[1],
        "duration": int(max(100, min(20000, _number(animation.get("durationMs", el.get("animDuration")), 800)))),
        "delay": int(max(0, min(60000, _number(animation.get("delayMs", el.get("animDelay")), 0)))),
        "click": animation.get("trigger") == "on-click",
        "order": _number(animation.get("order"), 0),
    }]


def bullet_groups(levels: Iterable[int]) -> list[tuple[int, int]]:
    """Paragraph ranges revealed together: each top-level bullet with the sub-points under it."""
    groups: list[list[int]] = []
    for index, level in enumerate(levels):
        if level <= 0 or not groups:
            groups.append([index, index])
        else:
            groups[-1][1] = index
    return [(start, end) for start, end in groups]


class _Timing:
    def __init__(self):
        self._id = 2  # 1 is the root, 2 the main sequence
        self.clicks: list[str] = []
        self.builds: list[str] = []

    def _next(self) -> int:
        self._id += 1
        return self._id

    @staticmethod
    def _target(spid: int, paragraph: Optional[int]) -> str:
        if paragraph is None:
            return f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl>'
        return f'<p:tgtEl><p:spTgt spid="{spid}"><p:txEl><p:pRg st="{paragraph}" end="{paragraph}"/></p:txEl></p:spTgt></p:tgtEl>'

    def _set_visibility(self, target: str, value: str, delay: int = 0) -> str:
        return (
            f'<p:set><p:cBhvr><p:cTn id="{self._next()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="{delay}"/></p:stCondLst></p:cTn>'
            f"{target}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr>"
            f'<p:to><p:strVal val="{value}"/></p:to></p:set>'
        )

    def _anim(self, target: str, attr: str, start: str, end: str, dur: int) -> str:
        return (
            f'<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="{self._next()}" dur="{dur}" fill="hold"/>'
            f"{target}<p:attrNameLst><p:attrName>{attr}</p:attrName></p:attrNameLst></p:cBhvr>"
            f'<p:tavLst><p:tav tm="0"><p:val><p:strVal val="{start}"/></p:val></p:tav>'
            f'<p:tav tm="100000"><p:val><p:strVal val="{end}"/></p:val></p:tav></p:tavLst></p:anim>'
        )

    def _fade(self, target: str, direction: str, dur: int) -> str:
        return f'<p:animEffect transition="{direction}" filter="fade"><p:cBhvr><p:cTn id="{self._next()}" dur="{dur}"/>{target}</p:cBhvr></p:animEffect>'

    def _effect(self, effect: dict, spid: int, paragraph: Optional[int], node_type: str) -> str:
        target = self._target(spid, paragraph)
        dur = effect["duration"]
        entrance = effect["kind"] == "entr"
        subtype = _FLY_SUBTYPE.get(effect.get("direction") or "", 0) if effect["effect"] == "fly" else 0
        preset = {"fade": 10, "fly": 2, "zoom": 53, "appear": 1}[effect["effect"]]
        if effect["effect"] == "zoom":
            subtype = 16 if entrance else 32
        outer_id = self._next()
        parts = []
        if entrance:
            parts.append(self._set_visibility(target, "visible"))
            if effect["effect"] == "fade":
                parts.append(self._fade(target, "in", dur))
            elif effect["effect"] == "fly":
                attr, away = _FLY_START[subtype]
                other = "ppt_x" if attr == "ppt_y" else "ppt_y"
                parts.append(self._anim(target, other, f"#{other}", f"#{other}", dur))
                parts.append(self._anim(target, attr, away, f"#{attr}", dur))
            elif effect["effect"] == "zoom":
                parts.append(self._anim(target, "ppt_w", "0", "#ppt_w", dur))
                parts.append(self._anim(target, "ppt_h", "0", "#ppt_h", dur))
                parts.append(self._fade(target, "in", dur))
        else:
            if effect["effect"] == "fly":
                # Leaving goes on in the direction of travel: "up" exits through the top.
                attr, away = _FLY_START[{4: 1, 1: 4, 2: 8, 8: 2}[subtype]]
                other = "ppt_x" if attr == "ppt_y" else "ppt_y"
                parts.append(self._anim(target, other, f"#{other}", f"#{other}", dur))
                parts.append(self._anim(target, attr, f"#{attr}", away, dur))
            elif effect["effect"] == "zoom":
                parts.append(self._anim(target, "ppt_w", "#ppt_w", "0", dur))
                parts.append(self._anim(target, "ppt_h", "#ppt_h", "0", dur))
                parts.append(self._fade(target, "out", dur))
            elif effect["effect"] == "fade":
                parts.append(self._fade(target, "out", dur))
            parts.append(self._set_visibility(target, "hidden", max(0, dur - 1)))
        return (
            f'<p:par><p:cTn id="{outer_id}" presetID="{preset}" presetClass="{"entr" if entrance else "exit"}" presetSubtype="{subtype}" '
            f'fill="hold" grpId="0" nodeType="{node_type}"><p:stCondLst><p:cond delay="{effect.get("delay", 0)}"/></p:stCondLst>'
            f'<p:childTnLst>{"".join(parts)}</p:childTnLst></p:cTn></p:par>'
        )

    def add_step(self, effects: list[tuple[dict, int, Optional[int]]], *, click: bool) -> None:
        """One click (or, with click=False, the automatic start of the slide): effects that play together."""
        if not effects:
            return
        outer_id, inner_id = self._next(), self._next()
        first = "clickEffect" if click else "afterEffect"
        nodes = "".join(
            self._effect(effect, spid, paragraph, first if index == 0 else "withEffect")
            for index, (effect, spid, paragraph) in enumerate(effects)
        )
        start = '<p:cond delay="indefinite"/>' + ("" if click else '<p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>')
        self.clicks.append(
            f'<p:par><p:cTn id="{outer_id}" fill="hold"><p:stCondLst>{start}</p:stCondLst><p:childTnLst>'
            f'<p:par><p:cTn id="{inner_id}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst>'
            f"<p:childTnLst>{nodes}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>"
        )

    def xml(self) -> Optional[str]:
        if not self.clicks:
            return None
        builds = f'<p:bldLst>{"".join(self.builds)}</p:bldLst>' if self.builds else ""
        return (
            f'<p:timing xmlns:p="{P_NS}"><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>'
            '<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>'
            f'{"".join(self.clicks)}</p:childTnLst></p:cTn>'
            '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
            '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>'
            f"</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>{builds}</p:timing>"
        )


def _text_shape(shapes: list) -> Any:
    for shape in shapes:
        if getattr(shape, "has_text_frame", False) and len(shape.text_frame.paragraphs) > 0 and shape.text_frame.text.strip():
            return shape
    return None


def apply_slide_animations(slide: Any, elements: list[dict], shapes_of: dict[int, list]) -> int:
    """Write the slide's animation timing. `shapes_of` maps id(element) to the shapes it was exported as.

    Returns the number of click or automatic steps written (0: the slide has no exportable animation).
    """
    timing = _Timing()
    automatic: list[tuple[dict, int, Optional[int]]] = []
    bullet_steps: list[list[tuple[dict, int, Optional[int]]]] = []
    click_steps: list[tuple[float, list[tuple[dict, int, Optional[int]]]]] = []
    fade = {"kind": "entr", "effect": "fade", "direction": None, "duration": 380, "delay": 0, "click": True}

    for position, el in enumerate(elements):
        if not isinstance(el, dict):
            continue
        shapes = shapes_of.get(id(el)) or []
        if not shapes:
            continue
        effects = element_effects(el)
        text_shape = _text_shape(shapes) if el.get("type") == "text" and el.get("revealBullets") else None
        if text_shape is not None:
            levels = [paragraph.level or 0 for paragraph in text_shape.text_frame.paragraphs]
            groups = bullet_groups(levels)
            if len(groups) > 1 or (groups and effects):
                # The box's own click entrance sets how its bullets come in; otherwise they fade.
                own = next((effect for effect in effects if effect["kind"] == "entr" and effect["click"]), None)
                style = {**(own or fade), "delay": 0}
                for start, end in groups:
                    bullet_steps.append([(style, text_shape.shape_id, paragraph) for paragraph in range(start, end + 1)])
                timing.builds.append(f'<p:bldP spid="{text_shape.shape_id}" grpId="0" build="p"/>')
                effects = [effect for effect in effects if effect is not own]
        for index, effect in enumerate(effects):
            targets = [(effect, shape.shape_id, None) for shape in shapes]
            if effect["click"]:
                # Legacy animations share a click when they have the same order; the others take one click each.
                click_steps.append((effect.get("order", 1000 + position + index / 100), targets))
            else:
                automatic.extend(targets)

    timing.add_step(automatic, click=False)
    for step in bullet_steps:
        timing.add_step(step, click=True)
    merged: list[tuple[float, list]] = []
    for order, targets in sorted(click_steps, key=lambda item: item[0]):
        if merged and merged[-1][0] == order and order < 1000:
            merged[-1][1].extend(targets)
        else:
            merged.append((order, list(targets)))
    for _order, targets in merged:
        timing.add_step(targets, click=True)

    xml = timing.xml()
    if not xml:
        return 0
    node = etree.fromstring(xml)
    root = slide._element
    for existing in root.findall(f"{{{P_NS}}}timing"):
        root.remove(existing)
    # Schema order: cSld, clrMapOvr, transition, timing, extLst.
    ext = root.find(f"{{{P_NS}}}extLst")
    if ext is not None:
        ext.addprevious(node)
    else:
        root.append(node)
    return len(timing.clicks)
