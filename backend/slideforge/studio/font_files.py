"""Fonts added from files: a font this computer lacks that Google Fonts does not have either (Cambria Math, a
company's font), given by the user from a file they have, or carried inside a PowerPoint file (embedded fonts).

Each user's fonts are their own: stored under MEDIA_ROOT/fonts/users/<user id>/ and served only to that user through
/api/fonts/own/ (a font from Office is licensed to its owner, and /media/ can be public in the web app). A stylesheet
of @font-face rules (fonts.css) lists every face under each name a deck may use for it: the typographic family
("Spectral", weight 600) and the Windows family PowerPoint writes ("Spectral SemiBold", regular).

Accepted: TrueType and OpenType (.ttf, .otf), collections (.ttc, split into their fonts), WOFF, and EOT (PowerPoint's
.fntdata), plain or MicroType Express compressed (font_mtx.py). Only the font tables are read here; nothing in a file
is run.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import struct
import threading
import zipfile
import zlib
from pathlib import Path
from typing import Optional

from django.conf import settings

MAX_FILE_BYTES = 40 * 1024 * 1024
# A .zip of fonts (as font sites and Microsoft hand them out): its font files are read, anything else is skipped.
MAX_ZIP_ENTRIES = 300
MAX_ZIP_FONTS = 120
MAX_ZIP_UNPACKED_BYTES = 200 * 1024 * 1024
ZIP_FONT_EXTENSIONS = (".ttf", ".otf", ".ttc", ".otc", ".woff", ".eot", ".fntdata")
MAX_FACES_PER_USER = 400
MAX_BYTES_PER_USER = 400 * 1024 * 1024
STYLES = ("regular", "bold", "italic", "boldItalic")
_lock = threading.Lock()


class FontFileError(ValueError):
    """Not a font file this can read (the message is shown to the user)."""


# ---------------------------------------------------------------------------------------------- reading font files


def _sfnt_tables(data: bytes, offset: int = 0) -> dict[bytes, tuple[int, int]]:
    """{tag: (offset, length)} of an sfnt's table directory starting at offset."""
    if len(data) < offset + 12:
        raise FontFileError("The font file is cut short")
    (num_tables,) = struct.unpack_from(">H", data, offset + 4)
    if not 0 < num_tables < 200 or len(data) < offset + 12 + 16 * num_tables:
        raise FontFileError("The font file is damaged")
    tables = {}
    for index in range(num_tables):
        tag, _checksum, table_offset, length = struct.unpack_from(">4sIII", data, offset + 12 + 16 * index)
        if table_offset + length > len(data):
            raise FontFileError("The font file is damaged")
        tables[tag] = (table_offset, length)
    return tables


def _standalone(data: bytes, offset: int) -> bytes:
    """One font of a collection as its own sfnt (its tables copied after a new directory)."""
    flavor = data[offset : offset + 4]
    tables = sorted(_sfnt_tables(data, offset).items())
    count = len(tables)
    power = 1 << (count.bit_length() - 1)
    header = struct.pack(">4sHHHH", flavor, count, power * 16, power.bit_length() - 1, count * 16 - power * 16)
    position = 12 + 16 * count
    directory, body = [], []
    for tag, (table_offset, length) in tables:
        chunk = data[table_offset : table_offset + length]
        checksum = _checksum(chunk)
        directory.append(struct.pack(">4sIII", tag, checksum, position, length))
        padded = chunk + b"\0" * (-length % 4)
        body.append(padded)
        position += len(padded)
    return header + b"".join(directory) + b"".join(body)


def _checksum(chunk: bytes) -> int:
    padded = chunk + b"\0" * (-len(chunk) % 4)
    return sum(struct.unpack(f">{len(padded) // 4}I", padded)) & 0xFFFFFFFF


def _from_woff(data: bytes) -> bytes:
    """A WOFF 1 file as the sfnt it wraps (zlib tables inflated)."""
    if len(data) < 44:
        raise FontFileError("The font file is cut short")
    flavor, _length, num_tables = struct.unpack_from(">4sIH", data, 4)
    entries = []
    for index in range(num_tables):
        tag, offset, comp_length, orig_length, _stored_checksum = struct.unpack_from(">4sIIII", data, 44 + 20 * index)
        if offset + comp_length > len(data) or orig_length > MAX_FILE_BYTES:
            raise FontFileError("The font file is damaged")
        chunk = data[offset : offset + comp_length]
        if comp_length < orig_length:
            try:
                chunk = zlib.decompress(chunk)
            except zlib.error as exc:
                raise FontFileError("The font file is damaged") from exc
        entries.append((tag, chunk))
    count = len(entries)
    power = 1 << (count.bit_length() - 1)
    header = struct.pack(">4sHHHH", flavor, count, power * 16, power.bit_length() - 1, count * 16 - power * 16)
    position = 12 + 16 * count
    directory, body = [], []
    for tag, chunk in sorted(entries):
        directory.append(struct.pack(">4sIII", tag, _checksum(chunk), position, len(chunk)))
        padded = chunk + b"\0" * (-len(chunk) % 4)
        body.append(padded)
        position += len(padded)
    return header + b"".join(directory) + b"".join(body)


def _from_eot(data: bytes) -> bytes:
    """An Embedded OpenType file (PowerPoint's .fntdata) as the font it carries: the font data is its last field,
    XOR-scrambled with 0x50 when flag 0x10000000 is set, and MicroType Express compressed when flag 0x4 is."""
    eot_size, font_size, _version, flags = struct.unpack_from("<IIII", data, 0)
    if eot_size > len(data) or font_size > eot_size or font_size == 0:
        raise FontFileError("The embedded font is damaged")
    payload = data[eot_size - font_size : eot_size]
    if flags & 0x10000000:
        payload = bytes(byte ^ 0x50 for byte in payload)
    if flags & 0x4:
        try:
            from .font_mtx import MtxError, decompress_mtx
        except ImportError as exc:  # pragma: no cover - the module ships with the app
            raise FontFileError("Compressed embedded fonts cannot be read here") from exc
        try:
            payload = decompress_mtx(payload)
        except MtxError as exc:
            raise FontFileError("The embedded font could not be decompressed") from exc
    return payload


def _is_eot(data: bytes) -> bool:
    return len(data) > 82 and data[34:36] == b"LP" and struct.unpack_from("<I", data, 8)[0] in (0x00010000, 0x00020001, 0x00020002)


def _names(data: bytes, tables: dict) -> dict[int, str]:
    """The name table's strings by name ID: Windows English first, then Mac Roman, then any Unicode record."""
    if b"name" not in tables:
        return {}
    base, length = tables[b"name"]
    _format, count, string_offset = struct.unpack_from(">HHH", data, base)
    found: dict[int, tuple[int, str]] = {}
    for index in range(count):
        platform, encoding, language, name_id, size, offset = struct.unpack_from(">HHHHHH", data, base + 6 + 12 * index)
        start = base + string_offset + offset
        raw = data[start : start + size]
        if platform == 3 and encoding in (0, 1, 10):
            text, rank = raw.decode("utf-16-be", "replace"), 0 if language == 0x409 else 1
        elif platform == 0:
            text, rank = raw.decode("utf-16-be", "replace"), 2
        elif platform == 1 and encoding == 0:
            text, rank = raw.decode("mac_roman", "replace"), 3
        else:
            continue
        text = text.strip("\0 ").strip()
        if text and (name_id not in found or rank < found[name_id][0]):
            found[name_id] = (rank, text)
    return {name_id: text for name_id, (_rank, text) in found.items()}


def _face(data: bytes, fallback_family: Optional[str] = None) -> dict:
    """{"data", "ext", "family", "typo_family", "subfamily", "weight", "italic"} of one sfnt."""
    tables = _sfnt_tables(data)
    if b"glyf" not in tables and b"CFF " not in tables and b"CFF2" not in tables:
        raise FontFileError("The file has no glyphs")
    names = _names(data, tables)
    weight, italic = 400, False
    if b"OS/2" in tables:
        base, length = tables[b"OS/2"]
        if length >= 64:
            weight = struct.unpack_from(">H", data, base + 4)[0] or 400
            italic = bool(struct.unpack_from(">H", data, base + 62)[0] & 0x1)
    subfamily = names.get(2, "Regular")
    italic = italic or bool(re.search(r"italic|oblique", subfamily, re.I))
    # A subset PowerPoint embeds can lack its names: the presentation's name for it stands in.
    family = names.get(1) or names.get(16) or fallback_family
    if not family:
        raise FontFileError("The font has no name")
    return {
        "data": data,
        "ext": ".otf" if data[:4] == b"OTTO" else ".ttf",
        "family": family,
        "typo_family": names.get(16) or family,
        "subfamily": subfamily,
        "weight": max(1, min(1000, weight)),
        "italic": italic,
    }


def _read_zip(data: bytes) -> list[dict]:
    """Every font in a .zip: its .ttf/.otf/.ttc/.woff/.eot entries, in folders too; other files (readme.html, macOS
    resource forks under __MACOSX/) are skipped. Sizes are checked before anything is unpacked (a zip bomb is refused)."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        entries = archive.infolist()
    except (zipfile.BadZipFile, ValueError, OSError) as exc:
        raise FontFileError("The .zip file is damaged") from exc
    if len(entries) > MAX_ZIP_ENTRIES:
        raise FontFileError("The .zip file holds too many files")
    fonts = [
        entry for entry in entries
        if not entry.is_dir() and entry.filename.lower().endswith(ZIP_FONT_EXTENSIONS)
        and "__MACOSX/" not in entry.filename and not entry.filename.rsplit("/", 1)[-1].startswith("._")
    ][:MAX_ZIP_FONTS]
    if not fonts:
        raise FontFileError("The .zip file holds no font files")
    if sum(entry.file_size for entry in fonts) > MAX_ZIP_UNPACKED_BYTES or any(entry.file_size > MAX_FILE_BYTES for entry in fonts):
        raise FontFileError("The fonts in the .zip file are too large")
    faces, problems = [], []
    for entry in fonts:
        try:
            with archive.open(entry) as handle:
                chunk = handle.read(MAX_FILE_BYTES + 1)
            if len(chunk) > MAX_FILE_BYTES:
                raise FontFileError("The font file is too large")
            faces.extend(read_faces(chunk, _nested=True))
        except (FontFileError, zipfile.BadZipFile, RuntimeError, OSError, zlib.error) as exc:
            # An encrypted entry raises RuntimeError; a damaged one, the others. The rest of the zip still counts.
            problems.append(f"{entry.filename.rsplit('/', 1)[-1]}: {exc}")
    if not faces:
        raise FontFileError("No font in the .zip file could be read" + (f" ({problems[0]})" if problems else ""))
    return faces


def read_faces(data: bytes, fallback_family: Optional[str] = None, *, _nested: bool = False) -> list[dict]:
    """Every font in a file (a collection holds several; a .zip, every font file in it)."""
    if len(data) > MAX_FILE_BYTES:
        raise FontFileError("The font file is too large")
    if len(data) < 12:
        raise FontFileError("Not a font file")
    if data[:4] == b"PK\x03\x04" and not _nested:
        return _read_zip(data)
    magic = data[:4]
    if _is_eot(data):
        data = _from_eot(data)
        magic = data[:4]
    if magic == b"wOFF":
        data = _from_woff(data)
        magic = data[:4]
    if magic == b"wOF2":
        raise FontFileError("WOFF2 files cannot be added: use the font's TTF or OTF file")
    if magic == b"ttcf":
        (count,) = struct.unpack_from(">I", data, 8)
        if not 0 < count <= 64:
            raise FontFileError("The font collection is damaged")
        offsets = struct.unpack_from(f">{count}I", data, 12)
        return [_face(_standalone(data, offset), fallback_family) for offset in offsets]
    if magic in (b"\x00\x01\x00\x00", b"OTTO", b"true"):
        return [_face(data, fallback_family)]
    raise FontFileError("Not a font file (TrueType, OpenType, WOFF, EOT, or a .zip of them)")


# ---------------------------------------------------------------------------------------------- storing them


def _user_dir(user) -> Path:
    return Path(settings.MEDIA_ROOT) / "fonts" / "users" / str(int(user.pk))


def _index(user) -> dict:
    try:
        data = json.loads((_user_dir(user) / "index.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"faces": [], "version": 0}
    if not isinstance(data, dict) or not isinstance(data.get("faces"), list):
        return {"faces": [], "version": 0}
    return data


def _css_family(name: str) -> str:
    return re.sub(r"[\"\\\n\r<>]", "", name)


def _write_stylesheet(user, index: dict) -> None:
    rules = []
    for face in index["faces"]:
        url = f"files/{face['file']}"
        fmt = "opentype" if face["file"].endswith(".otf") else "truetype"
        for family, weight, style in face["names"]:
            rules.append(
                f'@font-face {{ font-family: "{_css_family(family)}"; font-style: {style}; font-weight: {int(weight)}; '
                f'font-display: swap; src: url("{url}") format("{fmt}"); }}'
            )
    (_user_dir(user) / "fonts.css").write_text("/* Fonts added from files: see font_files.py */\n" + "\n".join(rules) + "\n", encoding="utf-8")


def _registrations(face: dict, family: Optional[str], style: Optional[str]) -> list[list]:
    """The names a face answers to: [family, weight, "normal" | "italic"]."""
    italic = "italic" if face["italic"] else "normal"
    windows_bold = re.search(r"\bbold\b", face["subfamily"], re.I) is not None
    names = [[face["typo_family"], face["weight"], italic], [face["family"], 700 if windows_bold else 400, italic]]
    if family:
        # As the presentation names it (an embedded font: <p:font typeface="..."/> and its regular/bold/... slot).
        names.append([family, 700 if style in ("bold", "boldItalic") else 400, "italic" if style in ("italic", "boldItalic") else "normal"])
    unique = []
    for entry in names:
        if entry[0] and entry not in unique:
            unique.append(entry)
    return unique


def add(user, data: bytes, *, family: Optional[str] = None, style: Optional[str] = None) -> list[dict]:
    """Reads a font file and keeps its faces for the user. Returns [{"family", "weight", "style"}] per face added."""
    if family is not None:
        family = str(family).strip()[:63] or None
        if family and not re.match(r"^[^\"\\<>\n\r]{1,63}$", family):
            raise FontFileError("Not a font name")
    if style is not None and style not in STYLES:
        style = None
    faces = read_faces(data, family)
    added = []
    with _lock:
        folder = _user_dir(user)
        (folder / "files").mkdir(parents=True, exist_ok=True)
        index = _index(user)
        total = sum(int(face.get("bytes", 0)) for face in index["faces"])
        for face in faces:
            digest = hashlib.sha256(face["data"]).hexdigest()[:24]
            name = f"{digest}{face['ext']}"
            names = _registrations(face, family, style)
            existing = next((entry for entry in index["faces"] if entry["file"] == name), None)
            if existing:
                for entry in names:
                    if entry not in existing["names"]:
                        existing["names"].append(entry)
            else:
                if len(index["faces"]) >= MAX_FACES_PER_USER or total + len(face["data"]) > MAX_BYTES_PER_USER:
                    raise FontFileError("There is no room for more fonts: remove some first")
                (folder / "files" / name).write_bytes(face["data"])
                total += len(face["data"])
                index["faces"].append({"file": name, "names": names, "bytes": len(face["data"])})
            added.append({"family": face["typo_family"], "weight": face["weight"], "style": "italic" if face["italic"] else "normal", "names": sorted({entry[0] for entry in names})})
        index["version"] = int(index.get("version", 0)) + 1
        (folder / "index.json").write_text(json.dumps(index, indent=1), encoding="utf-8")
        _write_stylesheet(user, index)
    return added


def families(user) -> dict:
    """{family: {"css": <the user's stylesheet URL>, "faces": n, "source": "file"}} for the page to load."""
    if not getattr(user, "is_authenticated", False):
        return {}
    index = _index(user)
    if not index["faces"]:
        return {}
    css = f"/api/fonts/own/fonts.css?v={int(index.get('version', 0))}"
    counts: dict[str, int] = {}
    for face in index["faces"]:
        for family, _weight, _style in face["names"]:
            counts[family] = counts.get(family, 0) + 1
    return {family: {"css": css, "faces": count, "source": "file"} for family, count in counts.items()}


def own_file(user, path: str) -> Optional[tuple[Path, str]]:
    """(path on disk, content type) of one of the user's font files or their stylesheet; None for anything else."""
    if path == "fonts.css":
        target = _user_dir(user) / "fonts.css"
        return (target, "text/css; charset=utf-8") if target.is_file() else None
    match = re.fullmatch(r"files/([0-9a-f]{24})\.(ttf|otf)", path)
    if not match:
        return None
    target = _user_dir(user) / "files" / f"{match.group(1)}.{match.group(2)}"
    return (target, "font/otf" if match.group(2) == "otf" else "font/ttf") if target.is_file() else None
