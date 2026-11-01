"""Reading a Keynote file: the zip, the .iwa archives inside it, and the objects they hold.

A Keynote file (Keynote 6 and later) is a zip, or a macOS package folder that was zipped, holding:
  Index/*.iwa   the document: Snappy-compressed chunks, each a run of [varint length][TSP.ArchiveInfo][messages];
  Data/         pictures, movies and fonts as their own files;
  Metadata/, preview.jpg.
A package saved by older versions keeps Index/ as a zip of its own (Index.zip). Keynote '09 used index.apxl (XML).

Everything here is bounded (sizes, counts), since the file comes from outside.
"""

from __future__ import annotations

import io
import json
import zipfile
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path, PurePosixPath
from typing import Any, Optional

SCHEMA_DIR = Path(__file__).resolve().parent / "schema"

MAX_MEMBERS = 50_000
MAX_INDEX_BYTES = 512 * 1024 * 1024  # all .iwa data, decompressed
MAX_DATA_FILE_BYTES = 512 * 1024 * 1024  # one picture or movie
MAX_DATA_TOTAL_BYTES = 1024 * 1024 * 1024  # every picture and movie read from one file, together
MAX_OBJECTS = 2_000_000


class KeynoteError(ValueError):
    """The file cannot be read as a Keynote presentation (the message is shown to the user)."""


@lru_cache(maxsize=1)
def _schema():
    from google.protobuf import descriptor_pb2, descriptor_pool

    pool = descriptor_pool.DescriptorPool()
    pool.Add(_descriptor_proto_file())
    descriptor_set = descriptor_pb2.FileDescriptorSet.FromString((SCHEMA_DIR / "keynote.binpb").read_bytes())
    for file_proto in descriptor_set.file:
        pool.Add(file_proto)
    types = {int(number): name for number, name in json.loads((SCHEMA_DIR / "types.json").read_text("utf-8"))["types"].items()}
    return pool, types


def _descriptor_proto_file():
    from google.protobuf import descriptor_pb2

    proto = descriptor_pb2.FileDescriptorProto()
    descriptor_pb2.DESCRIPTOR.CopyToProto(proto)
    return proto


@lru_cache(maxsize=None)
def message_class(full_name: str):
    from google.protobuf import message_factory

    pool, _types = _schema()
    return message_factory.GetMessageClass(pool.FindMessageTypeByName(full_name))


def type_name(type_number: int) -> Optional[str]:
    return _schema()[1].get(type_number)


def _varint(data: bytes, pos: int) -> tuple[int, int]:
    result = shift = 0
    while True:
        if pos >= len(data) or shift > 63:
            raise KeynoteError("The presentation's data is damaged (bad length)")
        byte = data[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result, pos
        shift += 7


def decompress_iwa(data: bytes, budget: int = MAX_INDEX_BYTES) -> bytes:
    """Undo .iwa compression: chunks of [0x00][3-byte little-endian length][Snappy block, no framing]."""
    import cramjam

    out = bytearray()
    pos = 0
    while pos < len(data):
        if data[pos] != 0x00 or pos + 4 > len(data):
            raise KeynoteError("The presentation's data is damaged (bad chunk)")
        length = int.from_bytes(data[pos + 1 : pos + 4], "little")
        chunk = data[pos + 4 : pos + 4 + length]
        if len(chunk) != length:
            raise KeynoteError("The presentation's data is damaged (cut short)")
        pos += 4 + length
        # A Snappy block starts with its decompressed size: refuse before decompressing, not after.
        if len(out) + _varint(chunk, 0)[0] > budget:
            raise KeynoteError("The presentation is too large to import")
        try:
            block = bytes(cramjam.snappy.decompress_raw(chunk))
        except Exception as exc:
            raise KeynoteError("The presentation's data is damaged (cannot decompress)") from exc
        out += block
        if len(out) > budget:
            raise KeynoteError("The presentation is too large to import")
    return bytes(out)


@dataclass
class KeynoteObject:
    identifier: int
    type: int
    name: Optional[str]  # message full name, None when the type is unknown to the schema
    message: Any  # the decoded message, or None


@dataclass
class KeynotePackage:
    objects: dict[int, KeynoteObject] = field(default_factory=dict)
    # Index/Metadata.iwa numbers its objects on its own (its PackageMetadata lists the files in Data/).
    metadata: dict[int, KeynoteObject] = field(default_factory=dict)
    data_files: dict[str, zipfile.ZipInfo] = field(default_factory=dict)  # name within Data/ -> member
    _zip: Optional[zipfile.ZipFile] = None
    _data_prefix: str = ""
    undecodable: int = 0
    data_budget: int = MAX_DATA_TOTAL_BYTES

    def get(self, reference) -> Optional[KeynoteObject]:
        """The object a TSP.Reference (or a plain identifier) points to."""
        identifier = getattr(reference, "identifier", reference)
        return self.objects.get(int(identifier)) if identifier else None

    def message(self, reference, expected: Optional[str] = None):
        found = self.get(reference)
        if found is None or found.message is None or (expected and found.name != expected):
            return None
        return found.message

    def of_type(self, full_name: str) -> list[KeynoteObject]:
        return [obj for obj in self.objects.values() if obj.name == full_name]

    def read_data(self, name: str) -> Optional[bytes]:
        info = self.data_files.get(name)
        if info is None or self._zip is None or info.file_size > MAX_DATA_FILE_BYTES:
            return None
        if info.file_size > self.data_budget:
            raise KeynoteError("The presentation's pictures and movies are too large to import")
        self.data_budget -= info.file_size
        return self._zip.read(info)


def _parse_archives(raw: bytes, package: KeynotePackage, table: dict[int, KeynoteObject]) -> None:
    pool_types = _schema()[1]
    archive_info = message_class("TSP.ArchiveInfo")
    pos = 0
    while pos < len(raw):
        length, pos = _varint(raw, pos)
        if pos + length > len(raw):
            raise KeynoteError("The presentation's data is damaged (archive cut short)")
        info = archive_info.FromString(raw[pos : pos + length])
        pos += length
        decoded = None
        first_type = None
        # The object is the first message. Keynote files also hold archives with further messages (a real deck
        # repeated its table styles twice); merging those in duplicated every list in the object, so they are skipped.
        for index, message_info in enumerate(info.message_infos):
            payload = raw[pos : pos + message_info.length]
            pos += message_info.length
            if index:
                continue
            first_type = message_info.type
            name = pool_types.get(first_type)
            if name is None:
                continue
            try:
                decoded = message_class(name).FromString(payload)
            except Exception:
                package.undecodable += 1
        if first_type is None or not info.identifier:
            continue
        table[info.identifier] = KeynoteObject(info.identifier, first_type, pool_types.get(first_type), decoded)
        if len(table) > MAX_OBJECTS:
            raise KeynoteError("The presentation is too large to import")


def _safe_members(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    members = archive.infolist()
    if len(members) > MAX_MEMBERS:
        raise KeynoteError("The file holds too many parts to be a presentation")
    safe = []
    for info in members:
        path = PurePosixPath(info.filename.replace("\\", "/"))
        if path.is_absolute() or ".." in path.parts:
            continue  # never followed: names are only looked up, but such entries are not ours either
        safe.append(info)
    return safe


def open_keynote(data: bytes) -> KeynotePackage:
    """Read every object in a Keynote file. Raises KeynoteError with a message for the user."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise KeynoteError(
            "This is not a Keynote file SlideForge can read. If it is a Keynote package folder, zip it first, "
            "or save it as a single file in Keynote (File > Advanced > Change File Type)."
        ) from exc
    members = _safe_members(archive)
    names = [info.filename for info in members]
    lowered = [name.lower() for name in names]

    if any(name.endswith(("index.apxl", "index.apxl.gz")) for name in lowered):
        raise KeynoteError("This presentation was saved by Keynote '09 or older. Open it in a newer Keynote and save it again.")
    if any(name.endswith((".iwph", ".iwpv2")) or name.endswith("/.iwph") for name in lowered):
        raise KeynoteError("This presentation is protected with a password. Remove the password in Keynote, then import it.")

    # Where the package starts inside the zip: "" for a single-file .key, "Talk.key/" for a zipped package folder.
    prefix = None
    for name in names:
        for marker in ("Index/Document.iwa", "Index.zip"):
            if name.endswith(marker) and (name == marker or name[: -len(marker)].endswith("/")):
                prefix = name[: -len(marker)]
                break
        if prefix is not None:
            break
    if prefix is None:
        raise KeynoteError("This file has no Keynote document inside. Is it a Keynote presentation?")

    package = KeynotePackage(_zip=archive, _data_prefix=prefix + "Data/")
    index_members: list[tuple[zipfile.ZipFile, zipfile.ZipInfo]] = []
    inner_name = prefix + "Index.zip"
    if inner_name in names:
        inner_info = archive.getinfo(inner_name)
        if inner_info.file_size > MAX_INDEX_BYTES:
            raise KeynoteError("The presentation is too large to import")
        inner = zipfile.ZipFile(io.BytesIO(archive.read(inner_info)))
        index_members += [(inner, info) for info in _safe_members(inner) if info.filename.endswith(".iwa")]
    index_prefix = prefix + "Index/"
    index_members += [(archive, info) for info in members if info.filename.startswith(index_prefix) and info.filename.endswith(".iwa")]

    budget = MAX_INDEX_BYTES
    for container, info in index_members:
        if info.file_size > budget:
            raise KeynoteError("The presentation is too large to import")
        raw = decompress_iwa(container.read(info), budget)
        budget -= len(raw)
        is_metadata = info.filename.rsplit("/", 1)[-1] == "Metadata.iwa"
        _parse_archives(raw, package, package.metadata if is_metadata else package.objects)

    for info in members:
        if info.filename.startswith(package._data_prefix) and not info.is_dir():
            package.data_files[info.filename[len(package._data_prefix) :]] = info

    if not package.of_type("KN.DocumentArchive"):
        raise KeynoteError("This file has no Keynote document inside. Is it a Keynote presentation?")
    return package
