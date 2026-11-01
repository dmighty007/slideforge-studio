"""Regenerate keynote.binpb and types.json from keynote-parser (development only, not imported by the app).

    pip install keynote-parser
    python backend/slideforge/bridge/keynote/schema/build_schema.py

keynote-parser (MIT, https://github.com/psobot/keynote-parser) ships Keynote's message schemas, recovered from the
app. Only their descriptors are kept here, as one FileDescriptorSet, so the app needs the protobuf runtime alone
(no generated Python tied to one protobuf version), plus the map from the type numbers in .iwa files to names.
"""

import importlib
import json
from pathlib import Path

from google.protobuf import descriptor_pb2

import keynote_parser
from keynote_parser.versions import LATEST_VERSION

HERE = Path(__file__).resolve().parent


def main() -> None:
    version = LATEST_VERSION.short_version_string.replace(".", "_")
    mapping = importlib.import_module(f"keynote_parser.versions.v{version}.mapping")
    files, seen = [], set()

    def visit(file_descriptor):
        if file_descriptor.name in seen:
            return
        seen.add(file_descriptor.name)
        for dependency in file_descriptor.dependencies:
            visit(dependency)
        if file_descriptor.name != "google/protobuf/descriptor.proto":  # the runtime has it
            files.append(file_descriptor)

    for message_class in mapping.ID_NAME_MAP.values():
        visit(message_class.DESCRIPTOR.file)
    descriptor_set = descriptor_pb2.FileDescriptorSet()
    for file_descriptor in files:  # dependencies first
        file_descriptor.CopyToProto(descriptor_set.file.add())
    (HERE / "keynote.binpb").write_bytes(descriptor_set.SerializeToString(deterministic=True))
    types = {str(number): cls.DESCRIPTOR.full_name for number, cls in sorted(mapping.ID_NAME_MAP.items())}
    payload = {"keynote": LATEST_VERSION.short_version_string, "keynote_parser": keynote_parser.__version__, "types": types}
    (HERE / "types.json").write_text(json.dumps(payload, indent=1) + "\n", encoding="utf-8")
    print(f"{len(files)} schema files, {len(types)} types, Keynote {LATEST_VERSION.short_version_string}")


if __name__ == "__main__":
    main()
