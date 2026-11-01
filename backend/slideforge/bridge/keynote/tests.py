"""Keynote import (phase 2a): decoding, slides, text and pictures, and the import endpoint.

There are no real Keynote files in the repository yet (they need a Mac; docs/plans/KEYNOTE.md, step 0). These tests
build .key files from the same schemas the reader uses: real .iwa framing, Snappy blocks and protobuf messages.
"""

import io
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
        shape_id, shape = d.k.new("TSD.ShapeArchive")
        _geometry(shape.super, 0, 0, 10, 10)
        missing = d.picture(999_999, 0, 0, 10, 10)
        deck = read_keynote(d.build([d.node(d.slide([shape_id, missing]))]))
        self.assertEqual(deck.slides[0]["elements"], [])
        self.assertEqual(deck.skipped, {"shapes": 1, "pictures that could not be found": 1})

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
