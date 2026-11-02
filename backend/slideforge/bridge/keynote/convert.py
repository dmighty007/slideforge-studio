"""From Keynote's objects to a plain deck: slides, text boxes with styled runs, pictures and movies.

The result is neutral (Keynote points, run properties, media keys); the browser scales it to a page setup and makes
SlideForge elements of it, as it does for PowerPoint. Media bytes are returned beside it for the server to store.

Phase 2a of docs/plans/KEYNOTE.md: text, pictures and movies. Shapes, tables, charts, groups' own styling,
backgrounds and builds are counted in "skipped" and come in later phases.
"""

from __future__ import annotations

import bisect
import io
import math
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

from .iwa import KeynoteError, KeynotePackage, open_keynote

PICTURE_MIME = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}
MOVIE_MIME = {".mov": "video/quicktime", ".mp4": "video/mp4", ".m4v": "video/x-m4v"}
ALIGNMENTS = {0: "left", 1: "right", 2: "center", 3: "justify"}  # 4 is "natural": left for the scripts we expect
PLACEHOLDER_KINDS = {1: "slideNumber", 2: "title", 3: "body", 4: "object"}
MAX_STYLE_DEPTH = 32
MAX_GROUP_DEPTH = 16
VECTOR_PICTURE_SIDE = 2000  # PDF and SVG pictures are drawn this many pixels along their longer side
MAX_PICTURE_PIXELS = 64_000_000  # larger TIFF/BMP/... pictures are left out (decoding them takes gigabytes)
MAX_CONVERTED_SIDE = 4096  # converted pictures are scaled down to this


@dataclass
class Media:
    name: str
    mime: str
    data: bytes


@dataclass
class KeynoteDeck:
    width: float
    height: float
    slides: list[dict[str, Any]]
    media: dict[str, Media] = field(default_factory=dict)
    skipped: dict[str, int] = field(default_factory=dict)

    def as_json(self) -> dict[str, Any]:
        return {"width": self.width, "height": self.height, "slides": self.slides, "skipped": self.skipped}


def read_keynote(data: bytes) -> KeynoteDeck:
    return _Converter(open_keynote(data)).convert()


def _has(message, name: str) -> bool:
    try:
        return message.HasField(name)
    except ValueError:  # repeated fields have no presence
        return False


def _color(color) -> Optional[str]:
    if color is None:
        return None
    if _has(color, "model") and color.model == 3:  # white (grey) model
        level = round(max(0.0, min(1.0, color.w)) * 255)
        return f"#{level:02x}{level:02x}{level:02x}"
    if _has(color, "model") and color.model == 2:  # CMYK
        k = color.k
        r, g, b = ((1 - c) * (1 - k) for c in (color.c, color.m, color.y))
    else:
        r, g, b = color.r, color.g, color.b
    return "#" + "".join(f"{round(max(0.0, min(1.0, v)) * 255):02x}" for v in (r, g, b))


def _font_family(postscript: str) -> tuple[str, bool, bool]:
    """A family name and its weight/slant from a PostScript name: "HelveticaNeue-BoldItalic" -> Helvetica Neue."""
    family, _, face = postscript.partition("-")
    family = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", family).replace("MT", "").strip() or postscript
    # The name ends up in CSS (font-family): only characters font names use, so it cannot end the declaration.
    family = re.sub(r"[^\w .&+-]", "", family).strip()[:100] or "sans-serif"
    face = face.lower()
    return family, any(word in face for word in ("bold", "black", "heavy", "semibold")), any(word in face for word in ("italic", "oblique"))


class _Converter:
    def __init__(self, package: KeynotePackage):
        self.pkg = package
        self.media: dict[str, Media] = {}
        self.skipped: dict[str, int] = {}
        self.data_infos = {}
        self._starts: dict[int, tuple[Any, list[int]]] = {}  # attribute table -> its entries' character indexes
        for meta in package.metadata.values():
            if meta.name != "TSP.PackageMetadata" or meta.message is None:
                continue
            for info in meta.message.datas:
                self.data_infos[info.identifier] = info

    def skip(self, what: str, count: int = 1) -> None:
        self.skipped[what] = self.skipped.get(what, 0) + count

    # ---- document --------------------------------------------------------------------------------------------

    def convert(self) -> KeynoteDeck:
        document = self.pkg.of_type("KN.DocumentArchive")[0].message
        show = self.pkg.message(document.show, "KN.ShowArchive")
        if show is None:
            raise KeynoteError("This Keynote file has no slides SlideForge can read")
        width = show.size.width if _has(show, "size") and show.size.width > 0 else 1920.0
        height = show.size.height if _has(show, "size") and show.size.height > 0 else 1080.0
        slides = []
        for node in self._slide_nodes(show.slideTree):
            slide = self.pkg.message(node.slide, "KN.SlideArchive")
            if slide is not None:
                slides.append(self._slide(slide, hidden=bool(node.isSkipped)))
        if not slides:
            raise KeynoteError("This Keynote file has no slides SlideForge can read")
        if self.pkg.undecodable:
            self.skip("unreadable parts", self.pkg.undecodable)
        return KeynoteDeck(width, height, slides, self.media, self.skipped)

    def _slide_nodes(self, tree) -> Iterable[Any]:
        """Slides in show order: depth first from the root node (indented slides follow their parent)."""
        seen: set[int] = set()

        def walk(references, depth=0):
            for reference in references:
                node = self.pkg.message(reference, "KN.SlideNodeArchive")
                if node is None or reference.identifier in seen or depth > 64:
                    continue
                seen.add(reference.identifier)
                yield node
                yield from walk(node.children, depth + 1)

        root = self.pkg.message(tree.rootSlideNode, "KN.SlideNodeArchive") if _has(tree, "rootSlideNode") else None
        if root is not None:
            yield from walk(root.children)
        else:
            yield from walk(tree.slides)

    def _slide(self, slide, *, hidden: bool) -> dict[str, Any]:
        elements: list[dict[str, Any]] = []
        template = self.pkg.message(slide.template_slide, "KN.SlideArchive") if _has(slide, "template_slide") else None
        if template is not None:
            # The master's own objects (a logo, a footer) show on the slide, under its objects; its placeholders do not.
            for element in self._drawables(template, master=True):
                element["fromMaster"] = True
                elements.append(element)
        elements += self._drawables(slide, master=False)
        self._builds(slide, elements)
        for element in elements:
            element.pop("source", None)
        result = {"hidden": hidden, "notes": self._notes(slide), "elements": elements}
        transition = self._transition(slide)
        if transition:
            result["transition"] = transition
        background = self._background(slide, template)
        if background:
            result["background"] = background
        return result

    def _background(self, slide, template) -> Optional[dict[str, Any]]:
        """The slide's fill (its own style, else its master's): a colour, or a picture."""
        fill = None
        for owner in (slide, template):
            if owner is None:
                continue
            for style in self._style_chain(owner.style if _has(owner, "style") else None):
                props = getattr(style, "slide_properties", None)
                if props is not None and _has(style, "slide_properties") and _has(props, "fill"):
                    fill = props.fill
                    break
            if fill is not None:
                break
        if fill is None:
            return None
        if _has(fill, "color"):
            return {"color": _color(fill.color)}
        if _has(fill, "image"):
            image = fill.image
            identifier = (image.imagedata if _has(image, "imagedata") else image.originalimagedata).identifier
            key = f"data-{identifier}"
            if key not in self.media:
                found = self._data_file(identifier) if identifier else None
                converted = _web_picture(found[0], found[2]) if found else None
                if converted is None:
                    self.skip("background pictures")
                    return {"color": _color(image.tint)} if _has(image, "tint") else None
                self.media[key] = converted
            fit = {0: "contain", 1: "stretch", 2: "tile", 3: "cover", 4: "contain"}.get(image.technique, "cover")
            return {"media": key, "fit": fit}
        if _has(fill, "gradient") and fill.gradient.stops:
            self.skip("gradient backgrounds (first colour used)")
            return {"color": _color(fill.gradient.stops[0].color)}
        return None

    def _slide_property(self, slide, name: str):
        for style in self._style_chain(slide.style if _has(slide, "style") else None):
            props = getattr(style, "slide_properties", None)
            if props is not None and _has(style, "slide_properties") and _has(props, name):
                return getattr(props, name)
        return None

    def _drawables(self, slide, *, master: bool) -> list[dict[str, Any]]:
        order = list(slide.drawables_z_order) or list(slide.owned_drawables)
        identifiers = [reference.identifier for reference in order]
        visible = {
            "title": self._slide_property(slide, "titlePlaceholderVisibility") is not False,
            "body": self._slide_property(slide, "bodyPlaceholderVisibility") is not False,
        }
        if not master:
            for kind, reference in (("body", slide.bodyPlaceholder), ("title", slide.titlePlaceholder)):
                if reference.identifier and reference.identifier not in identifiers and visible[kind]:
                    identifiers.insert(0, reference.identifier)
        elements = []
        for identifier in dict.fromkeys(identifiers):
            obj = self.pkg.get(identifier)
            if obj is None or obj.message is None:
                continue
            if obj.name == "KN.PlaceholderArchive":
                kind = PLACEHOLDER_KINDS.get(obj.message.kind)
                if master or kind not in ("title", "body", "object") or (kind in visible and not visible[kind]):
                    continue
            for element in self._drawable(obj, offset=(0.0, 0.0), depth=0):
                element.setdefault("source", identifier)  # what the slide's builds point at (a group: all of it)
                elements.append(element)
        return elements

    # ---- drawables -------------------------------------------------------------------------------------------

    def _drawable(self, obj, *, offset: tuple[float, float], depth: int) -> list[dict[str, Any]]:
        message = obj.message
        if obj.name == "KN.PlaceholderArchive":
            kind = PLACEHOLDER_KINDS.get(message.kind)
            element = self._text(message.super, offset, placeholder=kind)
            return [element] if element else []
        if obj.name == "TSWP.ShapeInfoArchive":
            # The shape (its outline and fill: a bar, a rule, a box behind a caption), then its words on top. Text
            # boxes are usually neither filled nor outlined, and come in as text only.
            return [element for element in (self._shape(message.super, offset), self._text(message, offset, placeholder=None)) if element]
        if obj.name in ("TSD.ShapeArchive", "TSD.ConnectionLineArchive"):
            element = self._shape(message if obj.name == "TSD.ShapeArchive" else message.super, offset)
            return [element] if element else []
        if obj.name == "TSD.ImageArchive":
            element = self._picture(message, offset)
            return [element] if element else []
        if obj.name == "TSD.MovieArchive":
            element = self._movie(message, offset)
            return [element] if element else []
        if obj.name == "TSD.GroupArchive" and depth < MAX_GROUP_DEPTH:
            return self._group(message, offset, depth)
        self.skip(_SKIPPED_NAMES.get(obj.name, "other objects"))
        return []

    def _geometry(self, drawable, offset) -> dict[str, float]:
        geometry = drawable.geometry
        x = geometry.position.x + offset[0]
        y = geometry.position.y + offset[1]
        box = {"x": x, "y": y, "width": max(1.0, geometry.size.width), "height": max(1.0, geometry.size.height)}
        # Keynote turns objects anticlockwise for a positive angle; CSS turns them clockwise.
        angle = (-geometry.angle) % 360 if _has(geometry, "angle") else 0
        if angle:
            box["rotation"] = round(angle, 2)
        return box

    def _group(self, group, offset, depth) -> list[dict[str, Any]]:
        frame = self._geometry(group.super, offset)
        children = [self.pkg.get(reference) for reference in group.children]
        children = [child for child in children if child is not None and child.message is not None]
        # Children's positions are inside the group when they all fit in its size; otherwise they are on the slide.
        boxes = [self._child_box(child) for child in children]
        relative = all(box and box[0] >= -1 and box[1] >= -1 and box[2] <= frame["width"] + 1 and box[3] <= frame["height"] + 1 for box in boxes)
        inner = (frame["x"], frame["y"]) if relative else offset
        elements = []
        for child in children:
            elements += self._drawable(child, offset=inner, depth=depth + 1)
        return elements

    @staticmethod
    def _child_box(child) -> Optional[tuple[float, float, float, float]]:
        message = child.message
        for _ in range(4):  # down the "super" chain to the TSD.DrawableArchive
            if _has(message, "geometry"):
                g = message.geometry
                return (g.position.x, g.position.y, g.position.x + g.size.width, g.position.y + g.size.height)
            if not _has(message, "super"):
                return None
            message = message.super
        return None

    # ---- text ------------------------------------------------------------------------------------------------

    def _text(self, shape_info, offset, *, placeholder: Optional[str]) -> Optional[dict[str, Any]]:
        storage = self.pkg.message(shape_info.owned_storage, "TSWP.StorageArchive") if _has(shape_info, "owned_storage") else None
        if storage is None:
            return None
        shape = shape_info.super
        layout = self._text_layout(shape.style if _has(shape, "style") else None)
        paragraphs = self._paragraphs(storage, layout.pop("paragraph_style", None))
        if not any(run["text"].strip() for paragraph in paragraphs for run in paragraph["runs"]):
            return None  # an empty placeholder only shows "Double-click to edit" in Keynote
        return {"kind": "text", "placeholder": placeholder, **self._geometry(shape.super, offset), **layout, "paragraphs": paragraphs}

    def _text_layout(self, style_reference) -> dict[str, Any]:
        """From the box's shape style: shrink text to fit, vertical alignment, and the default paragraph style."""
        layout: dict[str, Any] = {}
        for style in self._style_chain(style_reference):
            props = style.shape_properties if style.DESCRIPTOR.full_name == "TSWP.ShapeStyleArchive" and _has(style, "shape_properties") else None
            if props is None:
                continue
            if "shrinkToFit" not in layout and _has(props, "shrink_to_fit"):
                layout["shrinkToFit"] = bool(props.shrink_to_fit)
            if "verticalAlign" not in layout and _has(props, "vertical_alignment"):
                layout["verticalAlign"] = {0: "top", 1: "middle", 2: "bottom"}.get(props.vertical_alignment, "top")
            if "paragraph_style" not in layout and _has(props, "paragraph_style") and not props.paragraph_style_null:
                layout["paragraph_style"] = props.paragraph_style
        return layout

    def _notes(self, slide) -> str:
        note = self.pkg.message(slide.note, "KN.NoteArchive") if _has(slide, "note") else None
        storage = self.pkg.message(note.containedStorage, "TSWP.StorageArchive") if note is not None else None
        if storage is None:
            return ""
        return "\n".join("".join(run["text"] for run in paragraph["runs"]) for paragraph in self._paragraphs(storage)).strip()

    def _style_chain(self, reference) -> list[Any]:
        """A style and the styles it inherits from (through super.parent), nearest first."""
        chain, seen = [], set()
        while reference is not None and getattr(reference, "identifier", 0) and len(chain) < MAX_STYLE_DEPTH:
            if reference.identifier in seen:
                break
            seen.add(reference.identifier)
            obj = self.pkg.get(reference)
            if obj is None or obj.message is None:
                break
            chain.append(obj.message)
            base = _style_base(obj.message)
            reference = base.parent if base is not None and _has(base, "parent") else None
        return chain

    def _at(self, table, index: int):
        """The entry of an attribute table that covers a character index (the last one starting at or before it).

        Binary search over the table's starts (kept per table): a scan per lookup made long texts quadratic."""
        starts = self._starts.get(id(table))
        if starts is None or starts[0] is not table:  # the table is kept in the entry, so its id is not reused
            starts = (table, [entry.character_index for entry in table.entries])
            self._starts[id(table)] = starts
        position = bisect.bisect_right(starts[1], index) - 1
        return table.entries[position] if position >= 0 else None

    def _paragraphs(self, storage, default_style=None) -> list[dict[str, Any]]:
        text = "".join(storage.text)
        # Paragraph and character style changes, plus paragraph breaks, cut the text into runs.
        breaks = [match.start() for match in re.finditer("[\n ]", text)]
        starts = [0] + [index + 1 for index in breaks]
        ends = breaks + [len(text)]
        char_starts = sorted({entry.character_index for entry in storage.table_char_style.entries})
        default_chain = self._style_chain(default_style) if default_style is not None else []
        paragraphs = []
        for start, end in zip(starts, ends, strict=True):
            para_entry = self._at(storage.table_para_style, start)
            para_chain = self._style_chain(para_entry.object) if para_entry is not None and _has(para_entry, "object") else []
            para_chain += [style for style in default_chain if style not in para_chain]  # what the paragraph leaves unset
            level_entry = self._at(storage.table_para_data, start)
            level = int(level_entry.first) if level_entry is not None and level_entry.character_index == start else 0
            inside = char_starts[bisect.bisect_right(char_starts, start) : bisect.bisect_left(char_starts, end)]
            cuts = sorted({start, end, *inside})
            runs = []
            for run_start, run_end in zip(cuts, cuts[1:], strict=False):
                piece = _clean_text(text[run_start:run_end])
                if not piece:
                    continue
                char_entry = self._at(storage.table_char_style, run_start)
                char_chain = self._style_chain(char_entry.object) if char_entry is not None and _has(char_entry, "object") else []
                runs.append({"text": piece, **self._run_style(char_chain + para_chain)})
            paragraphs.append(
                {
                    "align": self._alignment(para_chain),
                    "level": max(0, min(8, level)),
                    "bullet": self._bullet(storage, start, level, para_chain),
                    "runs": runs,
                }
            )
        while paragraphs and not paragraphs[-1]["runs"]:
            paragraphs.pop()
        return paragraphs

    @staticmethod
    def _char_property(chain, name: str):
        for style in chain:
            if not _has(style, "char_properties"):
                continue
            props = style.char_properties
            if name in ("font_color", "font_name") and getattr(props, f"{name}_null", False):
                return None
            if _has(props, name):
                return getattr(props, name)
        return None

    def _run_style(self, chain) -> dict[str, Any]:
        style: dict[str, Any] = {}
        font = self._char_property(chain, "font_name")
        bold = self._char_property(chain, "bold")
        italic = self._char_property(chain, "italic")
        if font:
            family, font_bold, font_italic = _font_family(font)
            style["font"] = family
            bold = bold if bold is not None else font_bold or None
            italic = italic if italic is not None else font_italic or None
        size = self._char_property(chain, "font_size")
        color = self._char_property(chain, "font_color")
        underline = self._char_property(chain, "underline")
        strike = self._char_property(chain, "strikethru")
        if size:
            style["size"] = round(float(size), 2)
        if color is not None:
            style["color"] = _color(color)
            if _has(color, "a") and color.a < 1:
                style["opacity"] = round(max(0.0, color.a), 3)
        if bold:
            style["bold"] = True
        if italic:
            style["italic"] = True
        if underline:
            style["underline"] = True
        if strike:
            style["strike"] = True
        return style

    @staticmethod
    def _alignment(para_chain) -> str:
        for style in para_chain:
            if _has(style, "para_properties") and _has(style.para_properties, "alignment"):
                return ALIGNMENTS.get(style.para_properties.alignment, "left")
        return "left"

    def _bullet(self, storage, start: int, level: int, para_chain) -> str:
        list_style = None
        entry = self._at(storage.table_list_style, start)
        if entry is not None and _has(entry, "object") and entry.object.identifier:
            list_style = entry.object
        else:
            for style in para_chain:
                if _has(style, "para_properties") and _has(style.para_properties, "list_style"):
                    list_style = style.para_properties.list_style
                    break
        for style in self._style_chain(list_style):
            types = list(getattr(style, "label_types", []))
            if types:
                label = types[min(level, len(types) - 1)]
                return {0: "none", 1: "bullet", 2: "bullet", 3: "number"}.get(label, "none")
        return "none"

    # ---- media -----------------------------------------------------------------------------------------------

    def _data_file(self, identifier: int) -> Optional[tuple[str, str, bytes]]:
        """(display name, stored name, bytes) of a file in Data/. The display name is the one the file had when it
        went into Keynote ("photo.png", not "photo-111.png"); the stored file can differ from it in type (Keynote
        converts some movies and pictures), so the type comes from the stored name or the bytes."""
        info = self.data_infos.get(identifier)
        candidates = []
        if info is not None:
            candidates += [info.file_name, info.preferred_file_name]
            if info.preferred_file_name:
                stem, dot, ext = info.preferred_file_name.rpartition(".")
                candidates.append(f"{stem}-{identifier}.{ext}" if dot else f"{info.preferred_file_name}-{identifier}")
        candidates += [name for name in self.pkg.data_files if re.search(rf"-{identifier}(\.[^.]+)?$", name)]
        for name in candidates:
            if name and name in self.pkg.data_files:
                data = self.pkg.read_data(name)
                if data is not None:
                    preferred = info.preferred_file_name if info is not None else ""
                    return (preferred if "." in preferred else name), name, data
        return None

    def _picture(self, image, offset) -> Optional[dict[str, Any]]:
        for name in ("adjustedImageData", "data", "originalData"):
            if _has(image, name) and getattr(image, name).identifier:
                identifier = getattr(image, name).identifier
                break
        else:
            self.skip("pictures that could not be found")
            return None
        key = f"data-{identifier}"
        if key not in self.media:
            found = self._data_file(identifier)
            converted = _web_picture(found[0], found[2]) if found else None
            if converted is None:
                self.skip("pictures that could not be found" if found is None else "pictures in formats SlideForge cannot show")
                return None
            self.media[key] = converted
        element = {"kind": "image", **self._geometry(image.super, offset), "media": key}
        mask = self.pkg.message(image.mask, "TSD.MaskArchive") if _has(image, "mask") else None
        if mask is not None:
            self._crop(element, mask)
        return element

    def _crop(self, element: dict[str, Any], mask) -> None:
        """A masked (cropped) picture: the element becomes the visible part, the whole picture placed inside it.

        The mask's position is inside the picture's frame (a Keynote file showed three photos cropped to columns
        side by side); SlideForge's cropTransform gives the picture's size and offset as percentages of the box.
        """
        geometry = mask.super.geometry
        width, height = geometry.size.width, geometry.size.height
        if width <= 0 or height <= 0:
            return
        element["crop"] = {
            "widthPercent": round(element["width"] / width * 100, 4),
            "heightPercent": round(element["height"] / height * 100, 4),
            "leftPercent": round(-geometry.position.x / width * 100, 4),
            "topPercent": round(-geometry.position.y / height * 100, 4),
        }
        element.update(x=element["x"] + geometry.position.x, y=element["y"] + geometry.position.y, width=width, height=height)
        if not _is_rectangle(mask):
            self.skip("pictures cropped to a shape (cropped to its box)")


    def _movie(self, movie, offset) -> Optional[dict[str, Any]]:
        identifier = movie.movieData.identifier if _has(movie, "movieData") else 0
        found = self._data_file(identifier) if identifier else None
        stored = found[1].rsplit("/", 1)[-1] if found else ""
        extension = ("." + stored.rsplit(".", 1)[-1].lower()) if "." in stored else ""
        if found is None or extension not in MOVIE_MIME or movie.audioOnly:
            self.skip("sounds and movies in other formats" if found else "movies that could not be found")
            return None
        key = f"data-{identifier}"
        stem = found[0].rsplit("/", 1)[-1].rsplit(".", 1)[0] or "movie"
        self.media.setdefault(key, Media(stem + extension, MOVIE_MIME[extension], found[2]))
        return {
            "kind": "video",
            **self._geometry(movie.super, offset),
            "media": key,
            "loop": bool(_has(movie, "loop_option") and movie.loop_option) or bool(movie.loopOptionAsInteger),
            "autoplay": bool(movie.autoPlay),
        }

    # ---- shapes ----------------------------------------------------------------------------------------------

    def _shape(self, shape, offset) -> Optional[dict[str, Any]]:
        """A shape or line as an outline (SVG path data in the box's points) with its fill, stroke and line ends.

        None when it draws nothing (no fill and no stroke: most text boxes)."""
        box = self._geometry(shape.super, offset)
        props = self._shape_properties(shape)
        fill = self._fill(props.get("fill"))
        stroke = _stroke(props.get("stroke"))
        if fill is None and stroke is None:
            return None
        path = _path_data(shape.pathsource, box["width"], box["height"]) if _has(shape, "pathsource") else None
        if not path:
            self.skip("shapes")
            return None
        element: dict[str, Any] = {"kind": "shape", **box, "path": path, "fill": fill, "stroke": stroke}
        opacity = props.get("opacity")
        if opacity is not None and 0 <= opacity < 1:
            element["opacity"] = round(opacity, 3)
        if stroke is not None:
            for name, key in (("head_line_end", "headEnd"), ("tail_line_end", "tailEnd")):
                end = getattr(shape, name) if _has(shape, name) else props.get(name)
                kind = _line_end(end)
                if kind:
                    element[key] = kind
        return element

    def _shape_properties(self, shape) -> dict[str, Any]:
        """Fill, stroke, opacity and line ends from the shape's style chain (nearest style first)."""
        props: dict[str, Any] = {}
        for style in self._style_chain(shape.style if _has(shape, "style") else None):
            if style.DESCRIPTOR.full_name == "TSWP.ShapeStyleArchive":
                style = style.super  # TSD.ShapeStyleArchive
            if style.DESCRIPTOR.full_name != "TSD.ShapeStyleArchive" or not _has(style, "shape_properties"):
                continue
            for descriptor, value in style.shape_properties.ListFields():
                props.setdefault(descriptor.name, value)
        return props

    def _fill(self, fill) -> Optional[dict[str, Any]]:
        if fill is None:
            return None
        if _has(fill, "color"):
            color = _rgba(fill.color)
            return {"color": color} if color else None
        if _has(fill, "gradient") and fill.gradient.stops:
            gradient = fill.gradient
            stops = [{"pos": round(max(0.0, min(1.0, stop.fraction)) * 100, 2), "color": _rgba(stop.color, gradient.opacity if _has(gradient, "opacity") else 1.0)} for stop in gradient.stops]
            angle = 0.0
            if _has(gradient, "anglegradient"):
                angle = -gradient.anglegradient.gradientangle  # Keynote turns anticlockwise, SVG clockwise
            elif _has(gradient, "transformgradient"):
                t = gradient.transformgradient
                angle = math.degrees(math.atan2(t.end.y - t.start.y, t.end.x - t.start.x))
            return {"gradient": {"radial": gradient.type == 1, "angle": round(angle, 2), "stops": stops}}
        if _has(fill, "image"):
            self.skip("shapes filled with a picture (left unfilled)")
        return None

    def _transition(self, slide) -> Optional[dict[str, Any]]:
        """The slide's transition effect ("apple:dissolve"), from the slide or its style; None for no effect."""
        attributes = slide.transition.attributes if _has(slide, "transition") and _has(slide.transition, "attributes") else self._slide_property(slide, "transition")
        animation = attributes.animationAttributes if attributes is not None and _has(attributes, "animationAttributes") else None
        effect = animation.effect if animation is not None else ""
        if not effect or effect == "none":
            return None
        return {"effect": effect, "duration": round(animation.duration, 3) if animation.duration else 1.0, "direction": animation.direction}

    def _builds(self, slide, elements: list[dict[str, Any]]) -> None:
        """Keynote's builds as entrances on the elements made from their objects, in the slide's build order: one
        click per chunk that waits for a click, automatic chunks with the click before them (or when the slide
        opens). Starting or stopping a movie is what clicking it does here, and exits are left out (counted)."""
        chunks = list(slide.buildChunkArchives) + [chunk for chunk in (self.pkg.message(ref, "KN.BuildChunkArchive") for ref in slide.buildChunks) if chunk is not None]
        click = 0
        for chunk in chunks:
            build = self.pkg.message(chunk.build, "KN.BuildArchive")
            if build is None:
                continue
            if not chunk.automatic:
                click += 1
            animation = build.attributes.animationAttributes if _has(build, "attributes") else None
            effect = animation.effect if animation is not None else ""
            if effect in ("apple:movie-start", "apple:movie-stop", "apple:audio-start", "apple:audio-stop"):
                continue
            targets = [element for element in elements if element.get("source") == build.drawable.identifier]
            if not targets:
                continue
            kind = animation.animation_type if animation is not None else "In"
            if kind != "In":
                self.skip("builds out" if kind == "Out" else "action builds")
                continue
            for element in targets:
                element.setdefault("build", {"effect": effect, "order": click, "delay": round(chunk.delay, 3), "duration": round(chunk.duration or build.duration or 1.0, 3), "direction": animation.direction if animation is not None else 0})


def _rgba(color, alpha: float = 1.0) -> Optional[str]:
    hex_color = _color(color)
    if hex_color is None:
        return None
    a = (color.a if _has(color, "a") else 1.0) * alpha
    if a >= 0.999:
        return hex_color
    value = int(hex_color[1:], 16)
    return f"rgba({value >> 16 & 255}, {value >> 8 & 255}, {value & 255}, {round(max(0.0, a), 3)})"


def _stroke(stroke) -> Optional[dict[str, Any]]:
    """An outline: colour, width, dashes, caps. None for no outline (Keynote's empty stroke pattern)."""
    if stroke is None or not _has(stroke, "color"):
        return None
    pattern = stroke.pattern if _has(stroke, "pattern") else None
    if pattern is not None and pattern.type == 2:  # TSDEmptyPattern
        return None
    width = stroke.width if _has(stroke, "width") else 1.0
    if width <= 0:
        return None
    result: dict[str, Any] = {"color": _rgba(stroke.color), "width": round(width, 3)}
    if pattern is not None and pattern.type == 0 and pattern.count:
        dashes = [round(value * width, 3) for value in list(pattern.pattern)[: pattern.count] if value >= 0]
        if any(dashes):
            result["dash"] = dashes
    result["cap"] = {0: "butt", 1: "round", 2: "square"}.get(stroke.cap, "butt") if _has(stroke, "cap") else "butt"
    result["join"] = {0: "miter", 1: "round", 2: "bevel"}.get(stroke.join, "miter") if _has(stroke, "join") else "miter"
    return result


# Keynote's line ends (their identifiers) as the ends SlideForge draws.
LINE_ENDS = {
    "simple arrow": "arrow", "open arrow": "arrow", "filled arrow": "triangle", "inverted arrow": "triangle",
    "filled circle": "circle", "open circle": "open-circle", "filled square": "square", "open square": "open-square",
    "filled diamond": "diamond", "open diamond": "open-diamond", "line": "bar",
}


def _line_end(end) -> Optional[str]:
    identifier = (end.identifier if end is not None and _has(end, "identifier") else "").strip().lower()
    if not identifier or identifier == "none":
        return None
    return LINE_ENDS.get(identifier) or ("arrow" if "arrow" in identifier else "circle" if "circle" in identifier else "triangle")


def _fmt(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".") if value else "0"


def _path_data(source, width: float, height: float) -> Optional[str]:
    """SVG path data for a shape's outline, scaled from its natural size to its box (points), flips applied."""
    commands: list[tuple[str, list[tuple[float, float]]]] = []
    natural = None
    if _has(source, "bezier_path_source") or _has(source, "connection_line_path_source"):
        bezier = source.bezier_path_source if _has(source, "bezier_path_source") else source.connection_line_path_source.super
        natural = bezier.naturalSize
        letters = {1: "M", 2: "L", 3: "Q", 4: "C", 5: "Z"}
        for element in bezier.path.elements:
            letter = letters.get(element.type)
            if letter:
                commands.append((letter, [(point.x, point.y) for point in element.points]))
    elif _has(source, "editable_bezier_path_source"):
        editable = source.editable_bezier_path_source
        natural = editable.naturalSize
        for subpath in editable.subpaths:
            nodes = list(subpath.nodes)
            if not nodes:
                continue
            point = lambda p: (p.x, p.y)  # noqa: E731
            commands.append(("M", [point(nodes[0].nodePoint)]))
            pairs = list(zip(nodes, nodes[1:])) + ([(nodes[-1], nodes[0])] if subpath.closed else [])
            for before, after in pairs:
                commands.append(("C", [point(before.outControlPoint), point(after.inControlPoint), point(after.nodePoint)]))
            if subpath.closed:
                commands.append(("Z", []))
    elif _has(source, "scalar_path_source"):
        scalar = source.scalar_path_source
        natural = scalar.naturalSize
        commands = _scalar_path(scalar.type, scalar.scalar, natural.width, natural.height)
    elif _has(source, "point_path_source"):
        point_source = source.point_path_source
        natural = point_source.naturalSize
        commands = _point_path(point_source.type, point_source.point.x, point_source.point.y, natural.width, natural.height)
    if not commands or natural is None:
        return None
    sx = width / natural.width if natural.width > 0 else 1.0
    sy = height / natural.height if natural.height > 0 else 1.0
    flip_x = bool(source.horizontalFlip)
    flip_y = bool(source.verticalFlip)
    parts = []
    for letter, points in commands:
        coords = []
        for x, y in points:
            x, y = x * sx, y * sy
            coords.append(f"{_fmt(width - x if flip_x else x)} {_fmt(height - y if flip_y else y)}")
        parts.append(" ".join([letter, *coords]))
    if parts and parts[-1].startswith("M"):
        parts.pop()  # Keynote ends closed outlines with a move, which draws nothing
    return " ".join(parts) if any(p[0] in "LCQ" for p in parts) else None


def _scalar_path(kind: int, scalar: float, w: float, h: float) -> list[tuple[str, list[tuple[float, float]]]]:
    """Rounded rectangles (scalar: corner radius), regular polygons (scalar: sides) and chevrons (scalar: notch)."""
    if w <= 0 or h <= 0:
        return []
    if kind == 0:  # rounded rectangle
        r = max(0.0, min(scalar, w / 2, h / 2))
        k = r * 0.5523  # a quarter circle as a cubic curve
        return [
            ("M", [(r, 0)]), ("L", [(w - r, 0)]), ("C", [(w - r + k, 0), (w, r - k), (w, r)]),
            ("L", [(w, h - r)]), ("C", [(w, h - r + k), (w - r + k, h), (w - r, h)]),
            ("L", [(r, h)]), ("C", [(r - k, h), (0, h - r + k), (0, h - r)]),
            ("L", [(0, r)]), ("C", [(0, r - k), (r - k, 0), (r, 0)]), ("Z", []),
        ]
    if kind == 1:  # regular polygon, a point at the top
        sides = max(3, min(64, round(scalar) or 5))
        points = [(w / 2 + w / 2 * math.sin(2 * math.pi * i / sides), h / 2 - h / 2 * math.cos(2 * math.pi * i / sides)) for i in range(sides)]
        return [("M", [points[0]]), *[("L", [p]) for p in points[1:]], ("Z", [])]
    if kind == 2:  # chevron pointing right
        notch = max(0.0, min(scalar, w / 2))
        return [("M", [(0, 0)]), ("L", [(w - notch, 0)]), ("L", [(w, h / 2)]), ("L", [(w - notch, h)]), ("L", [(0, h)]), ("L", [(notch, h / 2)]), ("Z", [])]
    return []


def _point_path(kind: int, px: float, py: float, w: float, h: float) -> list[tuple[str, list[tuple[float, float]]]]:
    """Arrows (point: where the head starts along the length, and the shaft's half-thickness as a fraction of the
    half-height), stars (point: number of points, inner radius as a fraction) and plus signs."""
    if w <= 0 or h <= 0:
        return []
    poly = lambda points: [("M", [points[0]]), *[("L", [p]) for p in points[1:]], ("Z", [])]  # noqa: E731
    if kind in (0, 1, 2):  # left, right, double arrow
        head = max(0.0, min(w - px if px <= w else w / 2, w / (2 if kind == 2 else 1)))
        shaft = h / 2 * max(0.05, min(1.0, py)) if py <= 1 else max(1.0, min(h / 2, h / 2 - py))
        top, bottom = h / 2 - shaft, h / 2 + shaft
        right = [(0, top), (w - head, top), (w - head, 0), (w, h / 2), (w - head, h), (w - head, bottom), (0, bottom)]
        if kind == 1:
            return poly(right)
        if kind == 0:
            return poly([(w - x, y) for x, y in right])
        return poly([(0, h / 2), (head, 0), (head, top), (w - head, top), (w - head, 0), (w, h / 2), (w - head, h), (w - head, bottom), (head, bottom), (head, h)])
    if kind == 3:  # star
        count = max(3, min(64, round(px) or 5))
        inner = max(0.05, min(1.0, py or 0.5))
        points = []
        for i in range(count * 2):
            radius = 1.0 if i % 2 == 0 else inner
            angle = math.pi * i / count
            points.append((w / 2 + w / 2 * radius * math.sin(angle), h / 2 - h / 2 * radius * math.cos(angle)))
        return poly(points)
    if kind == 4:  # plus
        arm = max(0.05, min(1.0, px if px <= 1 else px / max(w, 1))) * min(w, h) / 2
        cx, cy = w / 2, h / 2
        return poly([(cx - arm, 0), (cx + arm, 0), (cx + arm, cy - arm), (w, cy - arm), (w, cy + arm), (cx + arm, cy + arm), (cx + arm, h), (cx - arm, h), (cx - arm, cy + arm), (0, cy + arm), (0, cy - arm), (cx - arm, cy - arm)])
    return []


def _is_rectangle(mask) -> bool:
    if not _has(mask, "pathsource") or not _has(mask.pathsource, "bezier_path_source"):
        return False
    elements = mask.pathsource.bezier_path_source.path.elements
    if not elements:
        return False
    names = elements[0].DESCRIPTOR.fields_by_name["type"].enum_type.values_by_number
    kinds = [names[element.type].name if element.type in names else "" for element in elements]
    return all(kind in ("moveTo", "lineTo", "closeSubpath") for kind in kinds) and kinds.count("lineTo") <= 4


_SKIPPED_NAMES = {
    "TST.TableInfoArchive": "tables",
    "TSCH.ChartDrawableArchive": "charts",
    "TSD.GroupArchive": "groups nested too deep",
}


def _style_base(style):
    """The TSS.StyleArchive under a style (TSWP.ShapeStyleArchive -> TSD.ShapeStyleArchive -> TSS.StyleArchive)."""
    for _ in range(4):
        if style is None or style.DESCRIPTOR.full_name == "TSS.StyleArchive":
            return style
        style = style.super if _has(style, "super") else None
    return None


def _clean_text(text: str) -> str:
    text = text.replace(" ", "\n").replace("\u000b", "\n").replace("￼", "")
    return "".join(ch for ch in text if ch in "\n\t" or ord(ch) >= 0x20)


def _web_picture(name: str, data: bytes) -> Optional[Media]:
    """The picture in a format the app stores and browsers show (PNG, JPEG, GIF, WebP); None if impossible."""
    base = name.rsplit("/", 1)[-1].rsplit(".", 1)[0] or "picture"
    head = data[:16]
    if head.startswith(b"\x89PNG"):
        return Media(f"{base}.png", PICTURE_MIME["png"], data)
    if head.startswith(b"\xff\xd8"):
        return Media(f"{base}.jpg", PICTURE_MIME["jpg"], data)
    if head.startswith(b"GIF8"):
        return Media(f"{base}.gif", PICTURE_MIME["gif"], data)
    if head.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return Media(f"{base}.webp", PICTURE_MIME["webp"], data)
    png = None
    if head.startswith(b"%PDF") or data[:512].lstrip().startswith((b"<svg", b"<?xml")):
        png = _render_vector(data, "pdf" if head.startswith(b"%PDF") else "svg")
    else:  # TIFF, BMP, ... (HEIC needs a Pillow plugin and is usually not readable)
        try:
            from PIL import Image

            with Image.open(io.BytesIO(data)) as picture:
                if picture.width * picture.height > MAX_PICTURE_PIXELS:
                    return None
                picture.thumbnail((MAX_CONVERTED_SIDE, MAX_CONVERTED_SIDE))
                out = io.BytesIO()
                picture.convert("RGBA").save(out, "PNG")
                png = out.getvalue()
        except Exception:
            png = None
    return Media(f"{base}.png", PICTURE_MIME["png"], png) if png else None


def _render_vector(data: bytes, filetype: str) -> Optional[bytes]:
    """First page of a PDF, or an SVG, drawn as a PNG 2000 px along its longer side (Keynote keeps vector pictures as
    PDF). The scale follows the page's size both ways: a huge page must not become a huge picture."""
    try:
        import pymupdf

        with pymupdf.open(stream=data, filetype=filetype) as document:
            page = document[0]
            longest = max(1.0, page.rect.width, page.rect.height)
            scale = min(8.0, VECTOR_PICTURE_SIDE / longest)
            return page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=True).tobytes("png")
    except Exception:
        return None
