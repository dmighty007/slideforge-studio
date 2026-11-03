"""Keynote import (phase 2a): decoding, slides, text and pictures, and the import endpoint.

There are no real Keynote files in the repository yet (they need a Mac; docs/plans/KEYNOTE.md, step 0). These tests
build .key files from the same schemas the reader uses: real .iwa framing, Snappy blocks and protobuf messages.
"""

import io
import struct
import json
import shutil
import tempfile
import zipfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase, override_settings
from PIL import Image

from slideforge.bridge.keynote import KeynoteError, read_keynote
from slideforge.bridge.keynote.iwa import SCHEMA_DIR, decompress_iwa, message_class

TYPES = {name: int(number) for number, name in json.loads((SCHEMA_DIR / "types.json").read_text())["types"].items()}


def _varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def _compress(raw: bytes, chunk: int = 65536) -> bytes:
    import cramjam

    out = bytearray()
    for start in range(0, max(1, len(raw)), chunk):
        block = bytes(cramjam.snappy.compress_raw(raw[start : start + chunk]))
        out += b"\x00" + len(block).to_bytes(3, "little") + block
    return bytes(out)


def _png(color=(255, 0, 0), size=(4, 3), fmt="PNG") -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, fmt)
    return out.getvalue()


class KeyBuilder:
    """Objects by identifier, written as Index/Document.iwa (and Index/Metadata.iwa for the data list)."""

    def __init__(self):
        self.objects = {}
        self.data = {}  # Data/ name -> bytes
        self.datas = []  # (identifier, preferred name)
        self.next_id = 100

    def new(self, name, **fields):
        message = message_class(name)(**fields)
        self.next_id += 1
        self.objects[self.next_id] = (name, message)
        return self.next_id, message

    def put(self, identifier, name, message):
        self.objects[identifier] = (name, message)

    def add_data(self, preferred_name, payload) -> int:
        self.next_id += 1
        stem, _, ext = preferred_name.rpartition(".")
        self.data[f"{stem}-{self.next_id}.{ext}"] = payload
        self.datas.append((self.next_id, preferred_name))
        return self.next_id

    @staticmethod
    def _archives(objects) -> bytes:
        raw = bytearray()
        for identifier, (name, message) in objects:
            payload = message.SerializePartialToString()
            info = message_class("TSP.ArchiveInfo")(identifier=identifier)
            info.message_infos.add(type=TYPES[name], length=len(payload))
            info_bytes = info.SerializePartialToString()
            raw += _varint(len(info_bytes)) + info_bytes + payload
        return bytes(raw)

    def build(self, *, prefix="", index_zip=False, extra=None) -> bytes:
        metadata = message_class("TSP.PackageMetadata")()
        for identifier, preferred in self.datas:
            metadata.datas.add(identifier=identifier, preferred_file_name=preferred)
        document = _compress(self._archives(sorted(self.objects.items())))
        meta = _compress(self._archives([(2, ("TSP.PackageMetadata", metadata))]))
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as archive:
            if index_zip:
                inner = io.BytesIO()
                with zipfile.ZipFile(inner, "w") as index:
                    index.writestr("Index/Document.iwa", document)
                    index.writestr("Index/Metadata.iwa", meta)
                archive.writestr(prefix + "Index.zip", inner.getvalue())
            else:
                archive.writestr(prefix + "Index/Document.iwa", document)
                archive.writestr(prefix + "Index/Metadata.iwa", meta)
            for name, payload in self.data.items():
                archive.writestr(prefix + "Data/" + name, payload)
            for name, payload in (extra or {}).items():
                archive.writestr(name, payload)
        return out.getvalue()


def _geometry(message, x, y, w, h, angle=None):
    message.geometry.position.x, message.geometry.position.y = x, y
    message.geometry.size.width, message.geometry.size.height = w, h
    if angle is not None:
        message.geometry.angle = angle


def _color(message, hex_color, alpha=1.0):
    message.model = 1
    message.r, message.g, message.b = (int(hex_color[i : i + 2], 16) / 255 for i in (1, 3, 5))
    message.a = alpha


class Deck:
    """A small deck: title + body text, a picture, notes, a hidden slide nested under the first."""

    def __init__(self):
        self.k = KeyBuilder()

    def storage(self, text, *, para_styles=(), char_styles=(), list_styles=(), levels=()):
        sid, storage = self.k.new("TSWP.StorageArchive", text=[text])
        for index, ref in para_styles:
            storage.table_para_style.entries.add(character_index=index).object.identifier = ref
        for index, ref in char_styles:
            entry = storage.table_char_style.entries.add(character_index=index)
            if ref:
                entry.object.identifier = ref
        for index, ref in list_styles:
            storage.table_list_style.entries.add(character_index=index).object.identifier = ref
        for index, level in levels:
            storage.table_para_data.entries.add(character_index=index, first=level)
        return sid

    def char_style(self, parent=None, **props):
        sid, style = self.k.new("TSWP.CharacterStyleArchive")
        style.super.name = "char"
        if parent:
            style.super.parent.identifier = parent
        color = props.pop("color", None)
        for key, value in props.items():
            setattr(style.char_properties, key, value)
        if color:
            _color(style.char_properties.font_color, *color) if isinstance(color, tuple) else _color(style.char_properties.font_color, color)
        return sid

    def para_style(self, *, alignment=None, list_style=None, parent=None, **char_props):
        sid, style = self.k.new("TSWP.ParagraphStyleArchive")
        style.super.name = "para"
        if parent:
            style.super.parent.identifier = parent
        if alignment is not None:
            style.para_properties.alignment = alignment
        if list_style:
            style.para_properties.list_style.identifier = list_style
        color = char_props.pop("color", None)
        for key, value in char_props.items():
            setattr(style.char_properties, key, value)
        if color:
            _color(style.char_properties.font_color, color)
        return sid

    def list_style(self, *labels):
        sid, style = self.k.new("TSWP.ListStyleArchive")
        style.super.name = "list"
        style.label_types.extend(labels)
        return sid

    def text_box(self, storage_id, x, y, w, h, *, angle=None, text_box=True):
        sid, shape = self.k.new("TSWP.ShapeInfoArchive", is_text_box=text_box)
        _geometry(shape.super.super, x, y, w, h, angle)
        shape.owned_storage.identifier = storage_id
        return sid

    def placeholder(self, kind, storage_id, x, y, w, h):
        sid, placeholder = self.k.new("KN.PlaceholderArchive", kind=kind)
        _geometry(placeholder.super.super.super, x, y, w, h)
        placeholder.super.owned_storage.identifier = storage_id
        return sid

    def movie(self, data_id, x, y, w, h, *, autoplay=False):
        sid, movie = self.k.new("TSD.MovieArchive", autoPlay=autoplay)
        _geometry(movie.super, x, y, w, h)
        movie.movieData.identifier = data_id
        return sid

    def picture(self, data_id, x, y, w, h):
        sid, image = self.k.new("TSD.ImageArchive")
        _geometry(image.super, x, y, w, h)
        image.data.identifier = data_id
        return sid

    def slide(self, drawables, *, title=None, body=None, notes=None, template=None, style=None):
        sid, slide = self.k.new("KN.SlideArchive")
        for ref in drawables:
            slide.drawables_z_order.add(identifier=ref)
            slide.owned_drawables.add(identifier=ref)
        if title:
            slide.titlePlaceholder.identifier = title
        if body:
            slide.bodyPlaceholder.identifier = body
        if notes is not None:
            note_id, note = self.k.new("KN.NoteArchive")
            note.containedStorage.identifier = self.storage(notes)
            slide.note.identifier = note_id
        if template:
            slide.template_slide.identifier = template
        if style:
            slide.style.identifier = style
        return sid

    def node(self, slide_id, *, children=(), hidden=False):
        sid, node = self.k.new("KN.SlideNodeArchive", isSkipped=hidden)
        node.slide.identifier = slide_id
        for child in children:
            node.children.add(identifier=child)
        return sid

    def build(self, nodes, *, size=(1920, 1080), **kwargs) -> bytes:
        root_id, root = self.k.new("KN.SlideNodeArchive")
        for ref in nodes:
            root.children.add(identifier=ref)
        show = message_class("KN.ShowArchive")()
        show.size.width, show.size.height = size
        show.slideTree.rootSlideNode.identifier = root_id
        document = message_class("KN.DocumentArchive")()
        document.show.identifier = 2
        self.k.put(1, "KN.DocumentArchive", document)
        self.k.put(2, "KN.ShowArchive", show)
        return self.k.build(**kwargs)


def sample_deck(**build_kwargs) -> bytes:
    d = Deck()
    red_bold = d.char_style(bold=True, font_size=44.0, color="#ff0000", font_name="HelveticaNeue-Medium")
    centred = d.para_style(alignment=2, font_size=30.0)
    title = d.placeholder(2, d.storage("Hello Keynote", para_styles=[(0, centred)], char_styles=[(0, red_bold)]), 100, 50, 1720, 200)
    bullets = d.list_style(2, 2, 3)
    body_para = d.para_style(alignment=0, font_size=28.0, color="#202020", font_name="Avenir-BookOblique")
    body = d.placeholder(
        3,
        d.storage("First point\nSecond point same paragraph", para_styles=[(0, body_para)], list_styles=[(0, bullets)], levels=[(0, 0), (12, 1)]),
        100,
        300,
        1000,
        600,
    )
    caption = d.text_box(d.storage("A caption"), 1200, 900, 400, 80, angle=15.0)
    picture = d.picture(d.k.add_data("photo.png", _png()), 1200, 300, 600, 450)
    empty_slide_number = d.placeholder(1, d.storage("7"), 1800, 1000, 80, 40)
    first = d.slide([title, body, caption, picture, empty_slide_number], title=title, body=body, notes="Say hello")
    hidden = d.slide([d.text_box(d.storage("Backup slide"), 0, 0, 500, 100)])
    second = d.slide([d.text_box(d.storage("Thanks"), 0, 0, 500, 100)])
    return d.build([d.node(first, children=[d.node(hidden, hidden=True)]), d.node(second)], **build_kwargs)


class KeynoteReaderTests(SimpleTestCase):
    def test_reads_slides_in_order_with_hidden_and_notes(self):
        deck = read_keynote(sample_deck())
        self.assertEqual((deck.width, deck.height), (1920, 1080))
        self.assertEqual(len(deck.slides), 3)
        self.assertEqual([s["hidden"] for s in deck.slides], [False, True, False])
        self.assertEqual(deck.slides[0]["notes"], "Say hello")
        self.assertEqual(deck.slides[1]["elements"][0]["paragraphs"][0]["runs"][0]["text"], "Backup slide")

    def test_title_text_keeps_its_style(self):
        title = read_keynote(sample_deck()).slides[0]["elements"][0]
        self.assertEqual(title["placeholder"], "title")
        self.assertEqual((title["x"], title["y"], title["width"], title["height"]), (100, 50, 1720, 200))
        paragraph = title["paragraphs"][0]
        self.assertEqual(paragraph["align"], "center")
        run = paragraph["runs"][0]
        self.assertEqual(run["text"], "Hello Keynote")
        # The character style wins over the paragraph style (44 pt, not 30); the font family comes from its PostScript name.
        self.assertEqual((run["size"], run["color"], run["bold"], run["font"]), (44.0, "#ff0000", True, "Helvetica Neue"))

    def test_body_is_a_list_with_levels_and_inherited_style(self):
        body = read_keynote(sample_deck()).slides[0]["elements"][1]
        self.assertEqual(body["placeholder"], "body")
        first, second = body["paragraphs"]
        self.assertEqual((first["bullet"], first["level"]), ("bullet", 0))
        self.assertEqual((second["bullet"], second["level"]), ("bullet", 1))
        self.assertEqual(second["runs"][0]["text"], "Second point\nsame paragraph")  # a line break stays inside
        run = first["runs"][0]
        self.assertEqual((run["size"], run["color"], run["font"], run.get("italic")), (28.0, "#202020", "Avenir", True))

    def test_text_box_rotation_and_slide_number_placeholder(self):
        elements = read_keynote(sample_deck()).slides[0]["elements"]
        caption = elements[2]
        self.assertIsNone(caption["placeholder"])
        self.assertEqual(caption["rotation"], 345.0)
        self.assertNotIn("7", [run["text"] for el in elements if el["kind"] == "text" for p in el["paragraphs"] for run in p["runs"]])

    def test_picture_is_found_in_data(self):
        deck = read_keynote(sample_deck())
        picture = deck.slides[0]["elements"][3]
        self.assertEqual(picture["kind"], "image")
        media = deck.media[picture["media"]]
        self.assertEqual((media.name, media.mime), ("photo.png", "image/png"))
        self.assertTrue(media.data.startswith(b"\x89PNG"))

    def test_sounds_come_in_as_audio(self):
        d = Deck()
        sound_id = d.movie(d.k.add_data("theme.mp3", b"ID3\x03\x00audio"), 30, 40, 45, 45)
        d.k.objects[sound_id][1].audioOnly = True
        aiff_id = d.movie(d.k.add_data("old.aiff", b"FORM"), 0, 0, 45, 45)
        d.k.objects[aiff_id][1].audioOnly = True
        deck = read_keynote(d.build([d.node(d.slide([sound_id, aiff_id]))]))
        (sound,) = deck.slides[0]["elements"]
        self.assertEqual((sound["kind"], sound["x"], sound["name"], sound["autoplay"]), ("audio", 30, "theme", False))
        self.assertEqual((deck.media[sound["media"]].name, deck.media[sound["media"]].mime), ("theme.mp3", "audio/mpeg"))
        self.assertEqual(deck.skipped, {"sounds in formats browsers cannot play": 1})

    def test_zipped_package_folder_and_old_index_zip_layout(self):
        for kwargs in ({"prefix": "Talk.key/"}, {"index_zip": True}, {"prefix": "Talk.key/", "index_zip": True}):
            with self.subTest(**kwargs):
                self.assertEqual(len(read_keynote(sample_deck(**kwargs)).slides), 3)

    def test_movies_come_in_and_sounds_are_counted(self):
        d = Deck()
        clip = d.movie(d.k.add_data("clip.mov", b"\x00\x00\x00\x14ftypqt  "), 10, 20, 320, 180, autoplay=True)
        sound = d.movie(d.k.add_data("theme.m4a", b"audio"), 0, 0, 10, 10)
        deck = read_keynote(d.build([d.node(d.slide([clip, sound]))]))
        (movie,) = deck.slides[0]["elements"]
        self.assertEqual((movie["kind"], movie["x"], movie["width"], movie["autoplay"]), ("video", 10, 320, True))
        self.assertEqual((deck.media[movie["media"]].name, deck.media[movie["media"]].mime), ("clip.mov", "video/quicktime"))
        self.assertEqual(deck.skipped, {"sounds and movies in other formats": 1})

    def test_tiff_and_pdf_pictures_become_png(self):
        import pymupdf

        pdf = pymupdf.open()
        pdf.new_page(width=200, height=100).draw_rect(pymupdf.Rect(10, 10, 190, 90), fill=(0, 0, 1))
        d = Deck()
        tiff = d.picture(d.k.add_data("scan.tiff", _png(fmt="TIFF")), 0, 0, 100, 100)
        vector = d.picture(d.k.add_data("logo.pdf", pdf.tobytes()), 0, 0, 100, 100)
        deck = read_keynote(d.build([d.node(d.slide([tiff, vector]))]))
        names = [deck.media[el["media"]].name for el in deck.slides[0]["elements"]]
        self.assertEqual(names, ["scan.png", "logo.png"])
        for el in deck.slides[0]["elements"]:
            self.assertTrue(deck.media[el["media"]].data.startswith(b"\x89PNG"))

    def test_unknown_objects_and_missing_pictures_are_counted(self):
        d = Deck()
        chart_id, chart = d.k.new("TSCH.ChartDrawableArchive")
        missing = d.picture(999_999, 0, 0, 10, 10)
        deck = read_keynote(d.build([d.node(d.slide([chart_id, missing]))]))
        self.assertEqual(deck.slides[0]["elements"], [])
        self.assertEqual(deck.skipped, {"charts": 1, "pictures that could not be found": 1})

    @staticmethod
    def _cell(kind, *, string_id=None, decimal=None, cell_style=None, text_style=None) -> bytes:
        """A version-5 cell record: version, type, six spare bytes, the flags word, then the values it flags."""
        flags, values = 0, b""
        if decimal is not None:  # Numbers' decimal128: the integer and its power of ten (exponent biased by 0x1820)
            mantissa, exponent = decimal
            flags |= 0x1
            values += ((((exponent + 0x1820) & 0x3FFF) << 113) | mantissa).to_bytes(16, "little")
        for flag, value in ((0x8, string_id), (0x20, cell_style), (0x40, text_style)):
            if value is not None:
                flags |= flag
                values += struct.pack("<i", value)
        return bytes([5, kind, 0, 0, 0, 0, 0, 0]) + struct.pack("<I", flags) + values

    def _table(self, d, x, y, cells, *, widths, heights, rows=None, cols=None, wide_row=None, merges=None):
        """A table whose cells are [[record bytes or None]] (row by row), with string and style tables."""
        model_id, model = d.k.new("TST.TableModelArchive", number_of_rows=rows or len(cells), number_of_columns=cols or len(cells[0]), default_column_width=100.0, default_row_height=20.0)
        store = model.base_data_store
        strings_id, strings = d.k.new("TST.TableDataList", listType=1, nextListID=10)
        strings.entries.add(key=1, refcount=1, string="Year")
        strings.entries.add(key=2, refcount=1, string="Total")
        store.stringTable.identifier = strings_id
        fill_id, fill_style = d.k.new("TST.CellStyleArchive")
        _color(fill_style.cell_properties.cell_fill.color, "#27c7bd")
        fill_style.cell_properties.vertical_alignment = 1
        text_id, text_style = d.k.new("TSWP.ParagraphStyleArchive")
        text_style.char_properties.font_size = 24.0
        text_style.char_properties.bold = True
        _color(text_style.char_properties.font_color, "#ffffff")
        text_style.para_properties.alignment = 2
        styles_id, styles = d.k.new("TST.TableDataList", listType=4, nextListID=10)
        styles.entries.add(key=1, refcount=1).reference.identifier = fill_id
        styles.entries.add(key=2, refcount=1).reference.identifier = text_id
        store.styleTable.identifier = styles_id
        columns_id, columns = d.k.new("TST.HeaderStorageBucket", bucketHashFunction=1)
        for index, width in enumerate(widths):
            columns.headers.add(index=index, numberOfCells=0, size=width, hidingState=0)
        store.columnHeaders.identifier = columns_id
        rows_id, row_bucket = d.k.new("TST.HeaderStorageBucket", bucketHashFunction=1)
        for index, height in enumerate(heights):
            row_bucket.headers.add(index=index, numberOfCells=0, size=height, hidingState=0)
        store.rowHeaders.bucketHashFunction = 1
        store.rowHeaders.buckets.add(identifier=rows_id)
        tile_id, tile = d.k.new("TST.Tile", maxColumn=len(cells[0]), maxRow=len(cells), numCells=0, numrows=len(cells), storage_version=5)
        for row, records in enumerate(cells):
            wide = row == wide_row
            buffer, offsets = b"", []
            for record in records:
                if record is None:
                    offsets.append(-1)
                    continue
                offsets.append(len(buffer) // 4 if wide else len(buffer))
                buffer += record + b"\0" * (-len(record) % 4)
            offsets += [-1] * (255 - len(offsets))
            info = tile.rowInfos.add(tile_row_index=row, cell_count=sum(1 for r in records if r is not None), cell_storage_buffer=buffer, cell_offsets=struct.pack(f"<{len(offsets)}h", *offsets), storage_version=5)
            if wide:
                info.has_wide_offsets = True
            info.cell_storage_buffer_pre_bnc = b""
            info.cell_offsets_pre_bnc = b""
        store.tiles.tiles.add(tileid=0).tile.identifier = tile_id
        store.tiles.should_use_wide_rows = False
        for merge in merges or ():  # (first row, last row, first column, last column), as Keynote's merge formulas
            node = model.merge_owner.formula_store.formulas.add(formula_index=len(model.merge_owner.formula_store.formulas)).formula.AST_node_array.AST_node.add(AST_node_type=67)  # COLON_TRACT_NODE
            node.AST_colon_tract.absolute_row.add(range_begin=merge[0], range_end=merge[1])
            node.AST_colon_tract.absolute_column.add(range_begin=merge[2], range_end=merge[3])
        info_id, table_info = d.k.new("TST.TableInfoArchive")
        _geometry(table_info.super, x, y, sum(widths), sum(heights))
        table_info.tableModel.identifier = model_id
        return info_id

    def test_tables_come_in_with_their_cells_sizes_and_styles(self):
        d = Deck()
        cell = self._cell
        table = self._table(
            d, 60, 500,
            [
                [cell(3, string_id=1, cell_style=1, text_style=2), None, cell(3, string_id=2)],
                [cell(2, decimal=(20145, -1)), cell(0, cell_style=1), None],
            ],
            widths=[150, 80, 220], heights=[60, 40], wide_row=1,
        )
        deck = read_keynote(d.build([d.node(d.slide([table]))]))
        [element] = deck.slides[0]["elements"]
        self.assertEqual(element["kind"], "table")
        self.assertEqual((element["x"], element["y"], element["columns"], element["rows"]), (60, 500, [150, 80, 220], [60, 40]))
        cells = element["cells"]
        self.assertEqual([[c["text"] for c in row] for row in cells], [["Year", "", "Total"], ["2014.5", "", ""]])
        first = cells[0][0]
        self.assertEqual((first["fill"], first["valign"], first["color"], first["size"], first.get("bold"), first["align"]), ("#27c7bd", "middle", "#ffffff", 24.0, True, "center"))
        self.assertEqual(cells[1][1]["fill"], "#27c7bd")  # styled, empty, in a row with 4-byte offsets
        self.assertNotIn("fill", cells[0][2])
        self.assertEqual(deck.skipped, {})
        self.assertNotIn("merges", element)
        # Merged cells: "Year" across the first two columns, the first column's two rows.
        m = Deck()
        merged = self._table(m, 0, 0, [[cell(3, string_id=1), None, cell(3, string_id=2)], [None, None, None]], widths=[50, 50, 50], heights=[20, 20], merges=[(0, 0, 0, 1), (0, 1, 2, 2)])
        [table_element] = read_keynote(m.build([m.node(m.slide([merged]))])).slides[0]["elements"]
        self.assertEqual(table_element["merges"], [{"row": 0, "col": 0, "rowSpan": 1, "colSpan": 2}, {"row": 0, "col": 2, "rowSpan": 2, "colSpan": 1}])
        # A table larger than a slide can show is still left out, and counted.
        big = Deck()
        huge = self._table(big, 0, 0, [[None]], widths=[10], heights=[10], rows=5000)
        huge_deck = read_keynote(big.build([big.node(big.slide([huge]))]))
        self.assertEqual(huge_deck.slides[0]["elements"], [])
        self.assertEqual(huge_deck.skipped, {"tables": 1})

    def _shape(self, d, x, y, w, h, path, *, fill=None, stroke=None, dashes=None, empty_stroke=False, head=None, text=None):
        """A Keynote shape: a Bezier outline (path: [(type, [(x, y), ...]), ...] in its natural size) and a style."""
        style_id, style = d.k.new("TSWP.ShapeStyleArchive")
        props = style.super.shape_properties
        if fill:
            _color(props.fill.color, fill)
        else:
            props.fill.SetInParent()
        if stroke or empty_stroke:
            _color(props.stroke.color, stroke or "#000000")
            props.stroke.width = 2.0
            props.stroke.pattern.type = 2 if empty_stroke else (0 if dashes else 1)
            if dashes:
                props.stroke.pattern.count = len(dashes)
                props.stroke.pattern.pattern.extend(dashes)
        sid, info = d.k.new("TSWP.ShapeInfoArchive", is_text_box=False)
        shape = info.super
        _geometry(shape.super, x, y, w, h)
        shape.style.identifier = style_id
        bezier = shape.pathsource.bezier_path_source
        bezier.naturalSize.width, bezier.naturalSize.height = w / 2, h / 2  # scaled up to the box
        for kind, points in path:
            element = bezier.path.elements.add(type=kind)
            for px, py in points:
                element.points.add(x=px, y=py)
        if head:
            shape.head_line_end.identifier = head
        if text:
            info.owned_storage.identifier = d.storage(text)
        return sid

    def test_shapes_come_in_as_outlines_with_fill_and_stroke(self):
        d = Deck()
        square = [(1, [(0, 0)]), (2, [(50, 0)]), (2, [(50, 25)]), (2, [(0, 25)]), (5, []), (1, [(0, 0)])]
        bar = self._shape(d, 10, 20, 100, 50, square, fill="#ff8800", text="Caption")
        rule = self._shape(d, 0, 300, 200, 0, [(1, [(0, 0)]), (2, [(100, 0)])], stroke="#112233", dashes=[2, 1], head="open circle")
        invisible = self._shape(d, 0, 0, 10, 10, square, empty_stroke=True)
        deck = read_keynote(d.build([d.node(d.slide([bar, rule, invisible]))]))
        shape, caption, line = deck.slides[0]["elements"]
        self.assertEqual((shape["kind"], shape["x"], shape["y"], shape["fill"]), ("shape", 10, 20, {"color": "#ff8800"}))
        self.assertEqual(shape["path"], "M 0 0 L 100 0 L 100 50 L 0 50 Z")  # scaled to the box; the trailing move dropped
        self.assertIsNone(shape["stroke"])
        self.assertEqual((caption["kind"], caption["paragraphs"][0]["runs"][0]["text"]), ("text", "Caption"))
        self.assertEqual(line["path"], "M 0 0 L 200 0")  # no height: not scaled vertically
        self.assertEqual(line["stroke"]["color"], "#112233")
        self.assertEqual(line["stroke"]["dash"], [4.0, 2.0])  # in line widths
        self.assertEqual(line["headEnd"], "open-circle")
        self.assertEqual(deck.skipped, {})

    def test_a_paragraph_style_entry_without_a_style_keeps_the_one_before(self):
        d = Deck()
        heading = d.para_style(font_size=80.0, bold=True)
        body = d.para_style(font_size=48.0)
        text = "Meet Alberto.\nHe moved.\nHe loved soccer."
        storage = d.storage(text, para_styles=[(0, heading), (14, body)])
        d.k.objects[storage][1].table_para_style.entries.add(character_index=25)  # no style: as body
        box = d.text_box(storage, 0, 0, 400, 300)
        shape = d.k.objects[box][1].super
        style_id, style = d.k.new("TSWP.ShapeStyleArchive")
        style.shape_properties.paragraph_style.identifier = heading  # the box's default: the heading's
        shape.style.identifier = style_id
        deck = read_keynote(d.build([d.node(d.slide([box]))]))
        sizes = [p["runs"][0]["size"] for p in deck.slides[0]["elements"][0]["paragraphs"]]
        self.assertEqual(sizes, [80.0, 48.0, 48.0])

    def test_group_children_sticking_out_a_little_stay_inside_the_group(self):
        d = Deck()
        card = d.picture(d.k.add_data("card.png", _png()), 0, 7, 464, 526)
        tape = d.picture(d.k.add_data("tape.png", _png()), 95, -1.4, 255, 96)
        group_id, group = d.k.new("TSD.GroupArchive")
        _geometry(group.super, 1424, 517, 464, 533)
        group.children.add(identifier=card)
        group.children.add(identifier=tape)
        deck = read_keynote(d.build([d.node(d.slide([group_id]))]))
        self.assertEqual([(round(e["x"]), round(e["y"])) for e in deck.slides[0]["elements"]], [(1424, 524), (1519, 516)])

    def test_a_flipped_cropped_picture_is_stored_mirrored_and_cropped_from_the_other_side(self):
        from PIL import Image

        d = Deck()
        picture = d.picture(d.k.add_data("cup.png", _png(size=(8, 4))), -77, 0, 867, 488)
        image = d.k.objects[picture][1]
        image.super.geometry.flags = 7  # 4: flipped across
        mask_id, mask = d.k.new("TSD.MaskArchive")
        _geometry(mask.super, 430, 0, 360, 405)
        image.mask.identifier = mask_id
        deck = read_keynote(d.build([d.node(d.slide([picture]))]))
        (element,) = deck.slides[0]["elements"]
        self.assertEqual((round(element["x"]), round(element["width"])), (0, 360))
        self.assertTrue(element["media"].endswith("-fliph"))
        with Image.open(io.BytesIO(deck.media[element["media"]].data)) as flipped:
            self.assertEqual(flipped.size, (8, 4))

    def test_a_placeholder_with_a_fill_gets_its_box(self):
        d = Deck()
        caption = d.placeholder(3, d.storage("Malibu sunset"), 20, 300, 300, 40)
        style_id, style = d.k.new("TSWP.ShapeStyleArchive")
        _color(style.super.shape_properties.fill.color, "#ffffff")
        shape = d.k.objects[caption][1].super.super
        shape.style.identifier = style_id
        bezier = shape.pathsource.bezier_path_source
        bezier.naturalSize.width, bezier.naturalSize.height = 300, 40
        for kind, points in [(1, [(0, 0)]), (2, [(300, 0)]), (2, [(300, 40)]), (2, [(0, 40)]), (5, [])]:
            element = bezier.path.elements.add(type=kind)
            for px, py in points:
                element.points.add(x=px, y=py)
        empty = d.placeholder(2, d.storage(""), 0, 0, 100, 40)
        d.k.objects[empty][1].super.super.style.identifier = style_id
        deck = read_keynote(d.build([d.node(d.slide([caption, empty]))]))
        kinds = [(e["kind"], e.get("fill")) for e in deck.slides[0]["elements"]]
        self.assertEqual(kinds, [("shape", {"color": "#ffffff"}), ("text", None)])

    def test_medium_and_light_faces_keep_their_weight(self):
        d = Deck()
        medium = d.char_style(font_name="HelveticaNeue-Medium")
        light = d.char_style(font_name="HelveticaNeue-Light")
        box = d.text_box(d.storage("Title body", char_styles=[(0, medium), (6, light)]), 0, 0, 400, 100)
        deck = read_keynote(d.build([d.node(d.slide([box]))]))
        runs = deck.slides[0]["elements"][0]["paragraphs"][0]["runs"]
        self.assertEqual([(r["text"], r.get("weight")) for r in runs], [("Title ", 600), ("body", 300)])

    def test_picture_opacity_is_kept(self):
        d = Deck()
        picture = d.picture(d.k.add_data("map.png", _png()), 0, 0, 100, 100)
        style_id, style = d.k.new("TSD.MediaStyleArchive")
        style.media_properties.opacity = 0.54
        d.k.objects[picture][1].style.identifier = style_id
        deck = read_keynote(d.build([d.node(d.slide([picture]))]))
        self.assertAlmostEqual(deck.slides[0]["elements"][0]["opacity"], 0.54)

    def test_bulleted_paragraphs_carry_their_label_and_spacing(self):
        d = Deck()
        list_id, list_style = d.k.new("TSWP.ListStyleArchive")
        list_style.super.name = "arrows"
        list_style.label_types.extend([2])
        list_style.strings.extend(["➔"])
        list_style.indents.extend([11.0])
        list_style.text_indents.extend([1.8])
        _color(list_style.font_color, "#f46524")
        para = d.para_style(list_style=list_id)
        d.k.objects[para][1].para_properties.space_before = 26.0
        storage = d.storage("Intro\nUnexpected", para_styles=[(6, para)], list_styles=[(6, list_id)])
        box = d.text_box(storage, 0, 0, 400, 300)
        deck = read_keynote(d.build([d.node(d.slide([box]))]))
        intro, item = deck.slides[0]["elements"][0]["paragraphs"]
        self.assertEqual(intro["bullet"], "none")
        self.assertEqual({k: item[k] for k in ("bullet", "glyph", "glyphColor", "labelIndent", "textIndent", "spaceBefore")}, {"bullet": "bullet", "glyph": "➔", "glyphColor": "#f46524", "labelIndent": 11.0, "textIndent": 1.8, "spaceBefore": 26.0})

    def test_transitions_and_builds_are_read(self):
        d = Deck()
        box = d.text_box(d.storage("Builds in"), 0, 0, 100, 50)
        slide_id = d.slide([box])
        slide = d.k.objects[slide_id][1]
        animation = slide.transition.attributes.animationAttributes
        animation.animation_type, animation.effect, animation.duration, animation.direction = "Transition", "apple:push", 1.5, 11
        build_id, build = d.k.new("KN.BuildArchive", delivery="All at Once", duration=0.5)
        build.drawable.identifier = box
        build.attributes.animationAttributes.animation_type = "In"
        build.attributes.animationAttributes.effect = "apple:dissolve"
        slide.builds.add(identifier=build_id)
        chunk = slide.buildChunkArchives.add(index=0, delay=0.25, duration=0.5, automatic=False)
        chunk.build.identifier = build_id
        out_id, out = d.k.new("KN.BuildArchive", delivery="All at Once")
        out.drawable.identifier = box
        out.attributes.animationAttributes.animation_type = "Out"
        out.attributes.animationAttributes.effect = "apple:dissolve"
        slide.buildChunkArchives.add(index=0, automatic=False).build.identifier = out_id
        deck = read_keynote(d.build([d.node(slide_id)]))
        result = deck.slides[0]
        self.assertEqual(result["transition"], {"effect": "apple:push", "duration": 1.5, "direction": 11})
        self.assertEqual(result["elements"][0]["build"], {"effect": "apple:dissolve", "order": 1, "delay": 0.25, "duration": 0.5, "direction": 0})
        self.assertEqual(deck.skipped, {"builds out": 1})

    def test_group_children_inside_the_group_are_offset(self):
        d = Deck()
        child = d.text_box(d.storage("In a group"), 10, 20, 100, 50)
        group_id, group = d.k.new("TSD.GroupArchive")
        _geometry(group.super, 300, 400, 200, 100)
        group.children.add(identifier=child)
        element = read_keynote(d.build([d.node(d.slide([group_id]))])).slides[0]["elements"][0]
        self.assertEqual((element["x"], element["y"]), (310, 420))

    def test_master_objects_show_under_the_slide_but_not_its_placeholders(self):
        d = Deck()
        logo = d.text_box(d.storage("ACME"), 10, 10, 100, 40)
        master_title = d.placeholder(2, d.storage("Master title"), 0, 0, 100, 100)
        master = d.slide([logo, master_title])
        own = d.text_box(d.storage("Slide text"), 0, 200, 100, 40)
        elements = read_keynote(d.build([d.node(d.slide([own], template=master))])).slides[0]["elements"]
        texts = [el["paragraphs"][0]["runs"][0]["text"] for el in elements]
        self.assertEqual(texts, ["ACME", "Slide text"])
        self.assertTrue(elements[0]["fromMaster"])

    def test_hidden_title_placeholder_stays_hidden(self):
        d = Deck()
        title = d.placeholder(2, d.storage("Hidden title"), 0, 0, 100, 100)
        style_id, style = d.k.new("KN.SlideStyleArchive")
        style.super.name = "slide"
        style.slide_properties.titlePlaceholderVisibility = False
        deck = read_keynote(d.build([d.node(d.slide([title], title=title, style=style_id))]))
        self.assertEqual(deck.slides[0]["elements"], [])


class KeynoteLayoutTests(SimpleTestCase):
    """Cropping, backgrounds and text box settings, shaped like a real Keynote 14 file showed them."""

    def test_masked_picture_becomes_a_cropped_box(self):
        d = Deck()
        image_ref = d.picture(d.k.add_data("photo.jpeg", _png(fmt="JPEG")), -126, -5.5, 304, 405)
        mask_id, mask = d.k.new("TSD.MaskArchive")
        _geometry(mask.super, 132, 11, 143.5, 394)
        path = mask.pathsource.bezier_path_source.path
        for kind, point in ((1, (0, 0)), (2, (143.5, 0)), (2, (143.5, 394)), (2, (0, 394))):
            element = path.elements.add(type=kind)
            element.points.add(x=point[0], y=point[1])
        path.elements.add(type=5)
        d.k.objects[image_ref][1].mask.identifier = mask_id
        deck = read_keynote(d.build([d.node(d.slide([image_ref]))]))
        picture = deck.slides[0]["elements"][0]
        self.assertEqual((picture["x"], picture["y"], picture["width"], picture["height"]), (6, 5.5, 143.5, 394))
        self.assertEqual(picture["crop"], {"widthPercent": 211.8467, "heightPercent": 102.7919, "leftPercent": -91.9861, "topPercent": -2.7919})
        self.assertEqual(deck.skipped, {})

    def test_slide_background_colour_from_its_style_or_master(self):
        d = Deck()

        def slide_style(hex_color):
            style_id, style = d.k.new("KN.SlideStyleArchive")
            style.super.name = "slide"
            _color(style.slide_properties.fill.color, hex_color)
            return style_id

        master = d.slide([], style=slide_style("#eb1e95"))
        own = d.slide([], style=slide_style("#0f9d58"), template=master)
        inherited = d.slide([], template=master)
        deck = read_keynote(d.build([d.node(own), d.node(inherited)]))
        self.assertEqual([s["background"] for s in deck.slides], [{"color": "#0f9d58"}, {"color": "#eb1e95"}])

    def test_text_box_style_shrink_alignment_and_default_paragraph_style(self):
        d = Deck()
        default_para = d.para_style(font_size=48.0, color="#666666", font_name="Helvetica")
        shape_style_id, shape_style = d.k.new("TSWP.ShapeStyleArchive")
        shape_style.super.super.name = "title"
        shape_style.shape_properties.shrink_to_fit = True
        shape_style.shape_properties.vertical_alignment = 2
        shape_style.shape_properties.paragraph_style.identifier = default_para
        title = d.placeholder(2, d.storage("WEST COAST\u2028ROAD TRIP"), 459, 132, 252, 199)
        d.k.objects[title][1].super.super.style.identifier = shape_style_id
        element = read_keynote(d.build([d.node(d.slide([title], title=title))])).slides[0]["elements"][0]
        self.assertEqual((element["shrinkToFit"], element["verticalAlign"]), (True, "bottom"))
        run = element["paragraphs"][0]["runs"][0]
        self.assertEqual((run["text"], run["size"], run["color"], run["font"]), ("WEST COAST\nROAD TRIP", 48.0, "#666666", "Helvetica"))


class KeynoteRejectionTests(SimpleTestCase):
    def assertRejected(self, data, fragment):
        with self.assertRaises(KeynoteError) as caught:
            read_keynote(data)
        self.assertIn(fragment, str(caught.exception))

    def _zip(self, files):
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as archive:
            for name, payload in files.items():
                archive.writestr(name, payload)
        return out.getvalue()

    def test_not_a_zip(self):
        self.assertRejected(b"%PDF-1.7 nope", "not a Keynote file")

    def test_keynote_09(self):
        self.assertRejected(self._zip({"index.apxl.gz": b"x"}), "Keynote '09")

    def test_password_protected(self):
        self.assertRejected(self._zip({"Index/Document.iwa": b"x", ".iwph": b"hint"}), "password")

    def test_zip_without_a_document(self):
        self.assertRejected(self._zip({"word/document.xml": b"<w/>"}), "no Keynote document")

    def test_damaged_chunks(self):
        self.assertRejected(self._zip({"Index/Document.iwa": b"\x01\x02\x03\x04"}), "damaged")
        self.assertRejected(self._zip({"Index/Document.iwa": b"\x00\xff\x00\x00abc"}), "damaged")
        with self.assertRaises(KeynoteError):
            decompress_iwa(b"\x00\x05\x00\x00" + b"\xff" * 5)

    def test_decompression_is_bounded(self):
        bomb = _compress(b"\x00" * 300_000)
        with self.assertRaises(KeynoteError):
            decompress_iwa(bomb, budget=100_000)

    def test_entries_outside_the_package_are_ignored(self):
        data = sample_deck(extra={"../evil.png": _png(), "/abs/Data/x.png": _png()})
        self.assertEqual(len(read_keynote(data).slides), 3)


class KeynoteReviewTests(SimpleTestCase):
    """Bugs found in the 0.3.0 review: each test failed before its fix."""

    def test_movie_type_comes_from_the_stored_file(self):
        # Keynote keeps the name the movie had ("clip.avi") but stores the file it converted it to (a .mov).
        d = Deck()
        d.k.next_id += 1
        movie_id = d.k.next_id
        d.k.data[f"clip-{movie_id}.mov"] = b"\x00\x00\x00\x14ftypqt  "
        d.k.datas.append((movie_id, "clip.avi"))
        deck = read_keynote(d.build([d.node(d.slide([d.movie(movie_id, 0, 0, 320, 180)]))]))
        (movie,) = deck.slides[0]["elements"]
        media = deck.media[movie["media"]]
        self.assertEqual((media.name, media.mime), ("clip.mov", "video/quicktime"))

    def test_huge_vector_pictures_are_drawn_at_a_bounded_size(self):
        import pymupdf

        from slideforge.bridge.keynote.convert import _web_picture

        document = pymupdf.open()
        document.new_page(width=14400, height=7200)
        svg = b'<svg xmlns="http://www.w3.org/2000/svg" width="9000" height="30000"><rect width="9" height="9"/></svg>'
        for name, data in (("page.pdf", document.tobytes()), ("drawing.svg", svg)):
            with Image.open(io.BytesIO(_web_picture(name, data).data)) as picture:
                self.assertLessEqual(max(picture.size), 2000, name)

    def test_huge_raster_pictures_are_left_out_or_scaled_down(self):
        from slideforge.bridge.keynote.convert import _web_picture

        def tiff(size):
            out = io.BytesIO()
            Image.new("1", size).save(out, "TIFF", compression="group4")
            return out.getvalue()

        self.assertIsNone(_web_picture("scan.tiff", tiff((9000, 9000))))  # 81 million pixels
        with Image.open(io.BytesIO(_web_picture("scan.tiff", tiff((6000, 3000))).data)) as picture:
            self.assertEqual(picture.size, (4096, 2048))

    def test_media_read_from_one_file_is_bounded_in_total(self):
        from slideforge.bridge.keynote import convert, iwa

        d = Deck()
        pictures = [d.picture(d.k.add_data(f"p{n}.png", _png(size=(50, 50))), 0, 0, 10, 10) for n in range(3)]
        data = d.build([d.node(d.slide(pictures))])
        package = iwa.open_keynote(data)
        package.data_budget = 2 * len(_png(size=(50, 50))) + 1
        with self.assertRaises(KeynoteError):
            convert._Converter(package).convert()

    def test_declared_snappy_size_is_checked_before_decompressing(self):
        block = _varint(0xFFFFFFF0) + b"\x00A"
        with self.assertRaises(KeynoteError) as caught:
            decompress_iwa(b"\x00" + len(block).to_bytes(3, "little") + block, budget=1_000_000)
        self.assertIn("too large", str(caught.exception))

    def test_further_messages_in_an_archive_do_not_duplicate_lists(self):
        d = Deck()
        caption = d.text_box(d.storage("Only once"), 0, 0, 500, 100)
        slide_id = d.slide([caption])
        data = d.build([d.node(slide_id)])
        # Rewrite the slide's archive with its message twice (as a real deck does for table styles).
        builder_objects = dict(d.k.objects)
        name, message = builder_objects[slide_id]
        payload = message.SerializePartialToString()
        info = message_class("TSP.ArchiveInfo")(identifier=slide_id)
        info.message_infos.add(type=TYPES[name], length=len(payload))
        info.message_infos.add(type=TYPES[name], length=len(payload))
        info_bytes = info.SerializePartialToString()
        twice = _varint(len(info_bytes)) + info_bytes + payload + payload
        others = KeyBuilder._archives(sorted((i, o) for i, o in builder_objects.items() if i != slide_id))
        out = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(data)) as source, zipfile.ZipFile(out, "w") as archive:
            for member in source.namelist():
                archive.writestr(member, _compress(others + twice) if member == "Index/Document.iwa" else source.read(member))
        from slideforge.bridge.keynote.iwa import open_keynote

        slide = open_keynote(out.getvalue()).message(slide_id)
        self.assertEqual(len(slide.drawables_z_order), 1)

    def test_font_names_cannot_break_out_of_css(self):
        d = Deck()
        style = d.char_style(font_name='Evil;}body{color:red-Bold"')
        deck = read_keynote(d.build([d.node(d.slide([d.text_box(d.storage("Hi", char_styles=[(0, style)]), 0, 0, 500, 100)]))]))
        run = deck.slides[0]["elements"][0]["paragraphs"][0]["runs"][0]
        self.assertNotRegex(run["font"], r"[;{}\"'<>]")


class KeynoteImportViewTests(TestCase):
    def setUp(self):
        self.media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.media, True)
        override = override_settings(MEDIA_ROOT=self.media)
        override.enable()
        self.addCleanup(override.disable)
        self.user = get_user_model().objects.create_user(username="keynote", password="strong-password-123")

    def _upload(self, data, name="Talk.key"):
        return SimpleUploadedFile(name, data, content_type="application/vnd.apple.keynote")

    def test_requires_sign_in(self):
        response = self.client.post("/api/presentations/import/keynote/", {"file": self._upload(sample_deck())})
        self.assertEqual(response.status_code, 401)

    def test_returns_the_deck_with_stored_pictures(self):
        from slideforge.studio.models import Asset

        self.client.force_login(self.user)
        response = self.client.post("/api/presentations/import/keynote/", {"file": self._upload(sample_deck())})
        self.assertEqual(response.status_code, 200, response.content)
        deck = response.json()
        self.assertEqual(len(deck["slides"]), 3)
        picture = deck["slides"][0]["elements"][3]
        self.assertNotIn("media", picture)
        self.assertTrue(picture["src"].startswith("/media/"))
        self.assertEqual(picture["contentType"], "image/png")
        self.assertEqual(Asset.objects.filter(owner=self.user, asset_type="image").count(), 1)

    def test_movie_is_stored_as_a_video_asset(self):
        from slideforge.studio.models import Asset

        d = Deck()
        clip = d.movie(d.k.add_data("clip.mp4", b"\x00\x00\x00\x18ftypmp42"), 0, 0, 320, 180)
        self.client.force_login(self.user)
        response = self.client.post("/api/presentations/import/keynote/", {"file": self._upload(d.build([d.node(d.slide([clip]))]))})
        self.assertEqual(response.status_code, 200, response.content)
        (movie,) = response.json()["slides"][0]["elements"]
        self.assertEqual(movie["kind"], "video")
        self.assertTrue(movie["src"].startswith("/media/"))
        self.assertEqual(Asset.objects.filter(owner=self.user, asset_type="video").count(), 1)

    def test_unreadable_file_is_a_clear_error(self):
        self.client.force_login(self.user)
        response = self.client.post("/api/presentations/import/keynote/", {"file": self._upload(b"not a zip")})
        self.assertEqual(response.status_code, 422)
        self.assertIn("not a Keynote file", response.json()["error"])

    def test_presentation_of_another_user_is_not_found(self):
        from slideforge.studio.models import Presentation

        other = get_user_model().objects.create_user(username="other", password="strong-password-123")
        theirs = Presentation.objects.create(owner=other, title="Theirs")
        self.client.force_login(self.user)
        response = self.client.post("/api/presentations/import/keynote/", {"file": self._upload(sample_deck()), "presentationId": str(theirs.id)})
        self.assertEqual(response.status_code, 404)

    def test_a_picture_that_cannot_be_stored_does_not_stop_the_import(self):
        from unittest import mock

        self.client.force_login(self.user)
        with mock.patch("slideforge.studio.views._save_asset_file", side_effect=OSError("disk full")):
            response = self.client.post("/api/presentations/import/keynote/", {"file": self._upload(sample_deck())})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["skipped"].get("pictures and movies that could not be stored"), 1)
