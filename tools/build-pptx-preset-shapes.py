#!/usr/bin/env python3
"""Builds the preset-shape table in frontend/js/export/pptxPresetShapes.js from presetShapeDefinitions.xml.

presetShapeDefinitions.xml is the DrawingML preset geometry annex of ECMA-376 Part 1 (OfficeOpenXML-
DrawingMLGeometries.zip in https://ecma-international.org/publications-and-standards/standards/ecma-376/). The copy
read here is Apache POI's (poi/src/main/resources/org/apache/poi/sl/draw/geom/presetShapeDefinitions.xml,
https://github.com/apache/poi), which fixes an erratum in the ECMA file: its upArrow is missing and upDownArrow is
defined twice. Pass the file's path:

    python3 -I tools/build-pptx-preset-shapes.py path/to/presetShapeDefinitions.xml

Only the table between the BEGIN/END markers of the JS file is rewritten; the evaluator around it is hand-written.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "js" / "export" / "pptxPresetShapes.js"
NS = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
BEGIN = "// BEGIN GENERATED PRESETS (tools/build-pptx-preset-shapes.py)"
END = "// END GENERATED PRESETS"


def number_or_name(value: str):
    """A literal as a number, a guide name as a string."""
    try:
        number = float(value)
    except ValueError:
        return value
    return int(number) if number.is_integer() else number


def shape_entry(shape: ET.Element) -> dict:
    entry: dict = {}
    av = shape.find(NS + "avLst")
    if av is not None and len(av):
        # avLst holds "val N" only (checked below); the default is stored as the number.
        entry["av"] = []
        for gd in av:
            fmla = gd.get("fmla", "").split()
            if len(fmla) != 2 or fmla[0] != "val":
                raise SystemExit(f"{shape.tag}: unexpected avLst formula {gd.get('fmla')!r}")
            entry["av"].append([gd.get("name"), number_or_name(fmla[1])])
    gd_list = shape.find(NS + "gdLst")
    if gd_list is not None and len(gd_list):
        entry["gd"] = [[gd.get("name"), " ".join(gd.get("fmla", "").split())] for gd in gd_list]
    rect = shape.find(NS + "rect")
    if rect is not None:
        entry["rect"] = [number_or_name(rect.get(k, "")) for k in ("l", "t", "r", "b")]
    paths = []
    path_list = shape.find(NS + "pathLst")
    for path in path_list if path_list is not None else []:
        out: dict = {}
        for key in ("w", "h"):
            if path.get(key):
                out[key] = int(path.get(key))
        if path.get("fill") and path.get("fill") != "norm":
            out["fill"] = path.get("fill")
        if path.get("stroke") in ("false", "0"):
            out["stroke"] = False
        if path.get("extrusionOk") in ("false", "0"):
            out["ext"] = False
        commands = []
        for command in path:
            tag = command.tag.replace(NS, "")
            points = [number_or_name(v) for pt in command.findall(NS + "pt") for v in (pt.get("x"), pt.get("y"))]
            if tag == "moveTo":
                commands.append(["M", *points])
            elif tag == "lnTo":
                commands.append(["L", *points])
            elif tag == "quadBezTo":
                commands.append(["Q", *points])
            elif tag == "cubicBezTo":
                commands.append(["C", *points])
            elif tag == "arcTo":
                commands.append(["A", *(number_or_name(command.get(k, "0")) for k in ("wR", "hR", "stAng", "swAng"))])
            elif tag == "close":
                commands.append(["Z"])
            else:
                raise SystemExit(f"{shape.tag}: unknown path command {tag}")
        out["c"] = commands
        paths.append(out)
    entry["paths"] = paths
    return entry


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=Path, help="presetShapeDefinitions.xml")
    args = parser.parse_args()
    root = ET.parse(args.source).getroot()
    shapes = {}
    for shape in root:
        if shape.tag in shapes:
            raise SystemExit(f"{shape.tag} is defined twice (the ECMA file's erratum: use Apache POI's copy)")
        shapes[shape.tag] = shape_entry(shape)
    compact = lambda value: json.dumps(value, separators=(",", ":"), ensure_ascii=True)  # noqa: E731
    lines = [BEGIN, "const PPTX_PRESET_SHAPES = {"]
    lines += [f"    {json.dumps(name)}:{compact(shapes[name])}," for name in sorted(shapes)]
    lines += ["};", END]
    table = "\n".join(lines)
    text = OUT.read_text(encoding="utf-8")
    pattern = re.compile(re.escape(BEGIN) + r".*?" + re.escape(END), re.S)
    if not pattern.search(text):
        raise SystemExit(f"{OUT}: no generated-table markers")
    OUT.write_text(pattern.sub(lambda _: table, text), encoding="utf-8")
    print(f"{len(shapes)} presets written to {OUT.relative_to(ROOT)}", file=sys.stderr)


if __name__ == "__main__":
    main()
