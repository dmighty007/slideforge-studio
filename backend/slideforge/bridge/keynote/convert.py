"""From Keynote's objects to a plain deck: slides, text boxes with styled runs, pictures and movies.

The result is neutral (Keynote points, run properties, media keys); the browser scales it to a page setup and makes
SlideForge elements of it, as it does for PowerPoint. Media bytes are returned beside it for the server to store.

Phase 2a of docs/plans/KEYNOTE.md: text, pictures and movies. Shapes, tables, charts, groups' own styling,
backgrounds and builds are counted in "skipped" and come in later phases.
"""

from __future__ import annotations

import bisect
import io
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
        result = {"hidden": hidden, "notes": self._notes(slide), "elements": elements}
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
            elements += self._drawable(obj, offset=(0.0, 0.0), depth=0)
        return elements

    # ---- drawables -------------------------------------------------------------------------------------------

    def _drawable(self, obj, *, offset: tuple[float, float], depth: int) -> list[dict[str, Any]]:
        message = obj.message
        if obj.name == "KN.PlaceholderArchive":
            kind = PLACEHOLDER_KINDS.get(message.kind)
            element = self._text(message.super, offset, placeholder=kind)
            return [element] if element else []
        if obj.name == "TSWP.ShapeInfoArchive":
            element = self._text(message, offset, placeholder=None)
            if element is None:
                self.skip("shapes")
                return []
            if not message.is_text_box:
                self.skip("shape outlines and fills")  # the text is kept; the shape itself comes in phase 2b
            return [element]
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
    "TSD.ShapeArchive": "shapes",
    "TSD.ConnectionLineArchive": "lines",
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
