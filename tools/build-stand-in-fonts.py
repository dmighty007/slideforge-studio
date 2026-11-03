#!/usr/bin/env python3
"""Builds frontend/vendor/fonts/stand-in-fonts.css: free fonts drawn in place of commercial fonts that imported decks
name (Arial, Calibri, Garamond...), which SlideForge may not ship.

Each commercial name gets @font-face rules that use an installed copy first (local()) and the free font otherwise:
  * same letter widths (lines break as in PowerPoint): Arimo for Arial and Helvetica, Tinos for Times New Roman and
    Times, Carlito for Calibri, Caladea for Cambria;
  * look-alikes (the same style; widths differ): EB Garamond, TeX Gyre Schola (Century), Archivo Black, Anton
    (Impact), Cinzel (Castellar), Cinzel Decorative (Algerian), Great Vibes (script fonts), Noto Serif Devanagari,
    and the already bundled Comic Neue, Nunito and Inter.

Inputs (not in the repository):
  --npm DIR     unpacked @fontsource/<name>@5.3.0 packages, one folder per name (npm pack, then tar -x)
  --schola DIR  TeX Gyre Schola 2.005 from CTAN (fonts/tex-gyre.zip: tex-gyre/opentype/texgyreschola-*.otf and
                tex-gyre/doc/GUST-FONT-LICENSE.txt), plus lppl.txt (https://www.latex-project.org/lppl.txt)
Needs fontTools with brotli (for Schola's WOFF2 conversion).
"""

from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FONTS = ROOT / "frontend" / "vendor" / "fonts"
OUT = FONTS / "stand-ins"

# Faces of a family with regular and bold, upright and italic: (weights the rule answers to, style) -> source face.
TEXT = {("100 600", "normal"): ("400", "normal"), ("700 900", "normal"): ("700", "normal"), ("100 600", "italic"): ("400", "italic"), ("700 900", "italic"): ("700", "italic")}
UPRIGHT = {("100 600", "normal"): ("400", "normal"), ("700 900", "normal"): ("700", "normal")}
SINGLE = {("100 900", "normal"): ("400", "normal")}

# (name in decks, source, faces, also known as): source is an npm package, "schola", or "bundled:<fontsource name>".
STAND_INS = [
    ("Arial", "arimo", TEXT, ["ArialMT"]),
    ("Helvetica", "arimo", TEXT, []),
    ("Times New Roman", "tinos", TEXT, ["TimesNewRomanPSMT"]),
    ("Times", "tinos", TEXT, ["Times-Roman"]),
    # Times' PostScript names, which some decks give as the font ("Times-Italic"): its one face for every weight.
    ("Times-Roman", "tinos", {("100 900", "normal"): ("400", "normal")}, []),
    ("Times-Italic", "tinos", {("100 900", "normal"): ("400", "italic"), ("100 900", "italic"): ("400", "italic")}, []),
    ("Times-Bold", "tinos", {("100 900", "normal"): ("700", "normal")}, []),
    ("Times-BoldItalic", "tinos", {("100 900", "normal"): ("700", "italic"), ("100 900", "italic"): ("700", "italic")}, []),
    ("Calibri", "carlito", TEXT, []),
    ("Cambria", "caladea", TEXT, []),
    ("Garamond", "eb-garamond", TEXT, []),
    ("Century", "schola", TEXT, []),
    ("Arial Black", "archivo-black", SINGLE, ["Arial-Black"]),
    ("Impact", "anton", SINGLE, []),
    ("Castellar", "cinzel", UPRIGHT, []),
    ("Algerian", "cinzel-decorative", UPRIGHT, []),
    ("Edwardian Script ITC", "great-vibes", SINGLE, ["EdwardianScriptITC"]),
    ("Fairwater Script", "great-vibes", SINGLE, []),
    ("Adobe Devanagari", "noto-serif-devanagari", UPRIGHT, ["AdobeDevanagari-Regular"]),
    ("Comic Sans MS", "bundled:comic-neue", UPRIGHT, ["ComicSansMS"]),
    ("Arial Rounded MT Bold", "bundled:nunito", {("100 900", "normal"): ("700", "normal")}, ["ArialRoundedMTBold"]),
    ("System Font Regular", "bundled:inter", UPRIGHT, []),
]
SCHOLA = {("400", "normal"): "regular", ("700", "normal"): "bold", ("400", "italic"): "italic", ("700", "italic"): "bolditalic"}
SUFFIX = {("100 600", "normal"): "", ("700 900", "normal"): " Bold", ("100 600", "italic"): " Italic", ("700 900", "italic"): " Bold Italic", ("100 900", "normal"): "", ("100 900", "italic"): ""}


def fontsource_faces(package_dir: Path, weight: str, style: str) -> list[tuple[str, str]]:
    """[(woff2 file name, unicode-range)] of one weight and style of a Fontsource package (from its CSS)."""
    css = (package_dir / (f"{weight}-italic.css" if style == "italic" else f"{weight}.css")).read_text(encoding="utf-8")
    faces = []
    for block in re.findall(r"@font-face\s*{([^}]*)}", css):
        url = re.search(r"url\(\./files/([^)]+\.woff2)\)", block)
        ranges = re.search(r"unicode-range:\s*([^;]+);", block)
        if url:
            faces.append((url.group(1), ranges.group(1).strip() if ranges else ""))
    if not faces:
        raise SystemExit(f"No faces for {package_dir.name} {weight} {style}")
    return faces


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--npm", type=Path, required=True)
    parser.add_argument("--schola", type=Path, required=True)
    args = parser.parse_args()

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    rules = []
    copied: set[str] = set()
    for name, source, faces, aliases in STAND_INS:
        rules.append(f"/* {name}: {source.split(':')[-1]} */")
        for (weights, style), (weight, source_style) in faces.items():
            locals_ = [f'local("{name}{SUFFIX[(weights, style)]}")'] + [f'local("{alias}")' for alias in aliases if not SUFFIX[(weights, style)]]
            if source == "schola":
                target = OUT / "tex-gyre-schola" / f"texgyreschola-{SCHOLA[(weight, source_style)]}.woff2"
                if str(target) not in copied:
                    from fontTools.ttLib import TTFont

                    target.parent.mkdir(exist_ok=True)
                    font = TTFont(args.schola / "tex-gyre" / "opentype" / f"texgyreschola-{SCHOLA[(weight, source_style)]}.otf")
                    font.flavor = "woff2"
                    font.save(target)
                    copied.add(str(target))
                files = [(f"stand-ins/tex-gyre-schola/{target.name}", "")]
            elif source.startswith("bundled:"):
                package = source.split(":", 1)[1]
                files = [(f"../fontsource/{package}/files/{file}", ranges) for file, ranges in fontsource_faces(FONTS.parent / "fontsource" / package, weight, source_style)]
            else:
                package_dir = args.npm / source
                files = []
                for file, ranges in fontsource_faces(package_dir, weight, source_style):
                    (OUT / source).mkdir(exist_ok=True)
                    if file not in copied:
                        shutil.copy2(package_dir / "files" / file, OUT / source / file)
                        copied.add(file)
                    files.append((f"stand-ins/{source}/{file}", ranges))
            for url, ranges in files:
                rule = f'@font-face {{ font-family: "{name}"; font-style: {style}; font-weight: {weights}; font-display: swap; src: {", ".join(locals_)}, url("{url}") format("woff2");'
                rules.append(rule + (f" unicode-range: {ranges};" if ranges else "") + " }")
    for package in {source for _name, source, _faces, _aliases in STAND_INS if not source.startswith("bundled:") and source != "schola"}:
        shutil.copy2(args.npm / package / "LICENSE", OUT / package / "LICENSE")
    shutil.copy2(args.schola / "tex-gyre" / "doc" / "GUST-FONT-LICENSE.txt", OUT / "tex-gyre-schola" / "GUST-FONT-LICENSE.txt")
    shutil.copy2(args.schola / "lppl.txt", OUT / "tex-gyre-schola" / "LPPL-1.3c.txt")
    header = (
        "/* Free fonts drawn in place of commercial fonts imported decks name (generated by\n"
        "   tools/build-stand-in-fonts.py; see THIRD_PARTY_NOTICES.md). An installed copy of the named font is used first\n"
        "   (local()); the free font otherwise. Files load only when text uses them. Arimo, Tinos, Carlito and Caladea\n"
        "   have the same letter widths as Arial, Times New Roman, Calibri and Cambria; the others are look-alikes. */\n"
    )
    (FONTS / "stand-in-fonts.css").write_text(header + "\n".join(rules) + "\n", encoding="utf-8")
    print(f"{len(rules)} lines, {len(copied)} files")


if __name__ == "__main__":
    main()
