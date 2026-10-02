import re
from collections import defaultdict
from dataclasses import dataclass
from statistics import median
from typing import Iterable

import pymupdf as fitz

from .utils import figures_root


_LOW_SIGNAL_RE = re.compile(
    r"\b("
    r"downloaded from|view article online|published on|received:|accepted:|doi:|"
    r"copyright|all rights reserved|issn|www\.|http|journal homepage|"
    r"supporting information|supplementary material available"
    r")\b",
    re.I,
)
_SECTION_NUMBER_RE = re.compile(r"^(?:[0-9]+(?:\.[0-9]+)*|[IVXLC]+|[A-Z])\.?\s+", re.I)
_CAPTION_RE = re.compile(r"^(fig(?:ure)?|table|scheme|chart)\s*[\dA-Z.:-]*\s+", re.I)
_REFERENCE_START_RE = re.compile(r"^(references|bibliography)\b", re.I)
_EQUATION_LINE_RE = re.compile(
    r"("
    r"[=∑∫√∞≤≥≈≠±×÷]|"
    r"\b(?:exp|cos|sin|tan|log|ln|min|max|argmin|argmax)\s*[\[(]|"
    r"\b[A-Za-z]\s*\([^)]{1,24}\)\s*=|"
    r"\([0-9]{1,3}\)\s*$"
    r")"
)


@dataclass
class ExtractedLine:
    page: int
    x0: float
    y0: float
    x1: float
    y1: float
    text: str
    font_size: float
    is_bold: bool
    is_upper: bool


# Typographic ligatures PDFs store as one character, written out. The text was transliterated to ASCII instead, which
# also turned "α-helix" into "a-helix", "Müller" into "Muller", "Å" into "A" and Chinese into pinyin, and removed the
# maths symbols the equation detection below looks for.
_LIGATURES = str.maketrans({"\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl", "\ufb03": "ffi", "\ufb04": "ffl", "\ufb05": "st", "\ufb06": "st"})


def _clean_text(text: str) -> str:
    text = str(text or "").translate(_LIGATURES)
    text = text.replace("\u00ad", "")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _line_key(text: str) -> str:
    text = _clean_text(text).lower()
    text = re.sub(r"\d+", "#", text)
    return text


def _is_upperish(text: str) -> bool:
    letters = re.findall(r"[A-Za-z]", text or "")
    if len(letters) < 3:
        return False
    upper = sum(1 for ch in letters if ch.isupper())
    return upper / max(1, len(letters)) >= 0.72


def _iter_page_lines(page: fitz.Page, page_index: int) -> Iterable[ExtractedLine]:
    page_dict = page.get_text("dict")
    page_width = float(page.rect.width)
    for block in page_dict.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans = []
            for span in line.get("spans", []):
                text = _clean_text(span.get("text", ""))
                if not text:
                    continue
                spans.append((span, text))
            if not spans:
                continue

            text = _clean_text(" ".join(text for _, text in spans))
            if not text:
                continue
            x0 = min(float(span["bbox"][0]) for span, _ in spans)
            y0 = min(float(span["bbox"][1]) for span, _ in spans)
            x1 = max(float(span["bbox"][2]) for span, _ in spans)
            y1 = max(float(span["bbox"][3]) for span, _ in spans)
            if x1 <= 0 or x0 >= page_width:
                continue

            sizes = [float(span.get("size") or 0) for span, _ in spans if float(span.get("size") or 0) > 0]
            fonts = " ".join(str(span.get("font", "")) for span, _ in spans).lower()
            yield ExtractedLine(
                page=page_index,
                x0=x0,
                y0=y0,
                x1=x1,
                y1=y1,
                text=text,
                font_size=median(sizes) if sizes else 10.0,
                is_bold=("bold" in fonts or "black" in fonts or "semibold" in fonts),
                is_upper=_is_upperish(text),
            )


def _body_band(lines: list[ExtractedLine], page_height: float) -> tuple[float, float]:
    ys = sorted(line.y0 for line in lines)
    if len(ys) < 8:
        return page_height * 0.06, page_height * 0.94
    top = max(page_height * 0.04, ys[max(0, int(len(ys) * 0.03))] - 8)
    bottom = min(page_height * 0.96, ys[min(len(ys) - 1, int(len(ys) * 0.97))] + 18)
    return top, bottom


def _repeated_margin_keys(lines_by_page: dict[int, list[ExtractedLine]], page_heights: dict[int, float]) -> set[str]:
    page_count = max(1, len(lines_by_page))
    occurrences: dict[str, set[int]] = defaultdict(set)
    for page_idx, lines in lines_by_page.items():
        height = page_heights.get(page_idx, 792)
        for line in lines:
            key = _line_key(line.text)
            if not key or len(key) < 4:
                continue
            if line.y0 < height * 0.11 or line.y1 > height * 0.89:
                occurrences[key].add(page_idx)
    threshold = 2 if page_count <= 6 else max(3, int(page_count * 0.22))
    return {key for key, pages in occurrences.items() if len(pages) >= threshold}


def _looks_like_heading(line: ExtractedLine, body_font: float) -> bool:
    text = line.text.strip()
    if len(text) < 4 or len(text) > 150:
        return False
    if _LOW_SIGNAL_RE.search(text) or _CAPTION_RE.match(text):
        return False
    if re.match(r"^(equation|where|we then|cluster across|method in|iteration using)\b", text, re.I):
        return False
    if text.endswith((".", ",", ";")) and not re.match(r"^[0-9IVXLC]+\.?\s+", text, re.I):
        return False
    words = text.split()
    if len(words) > 12:
        return False

    normalized = re.sub(r"^#+\s*", "", text).strip()
    normalized_without_number = _SECTION_NUMBER_RE.sub("", normalized).strip()
    if re.match(r"^(equation|where|we then|cluster across|method in|iteration using)\b", normalized_without_number, re.I):
        return False
    normalized_lower = normalized.lower()
    common_heading_names = {
        "abstract",
        "introduction",
        "background",
        "method",
        "methods",
        "methodology",
        "theory",
        "results",
        "discussion",
        "results and discussion",
        "conclusion",
        "conclusions",
        "references",
    }
    if normalized_lower in common_heading_names:
        return True
    if re.match(r"^(?:[0-9]+(?:\.[0-9]+)*|[IVXLC]+|[A-Z])\.?\s+[A-Z][A-Za-z0-9 ,:;()/-]{2,}$", normalized):
        return True
    title_like = all(
        word[:1].isupper() or word.lower() in {"and", "or", "of", "in", "the", "for", "with", "to", "a", "an", "using"}
        for word in re.findall(r"[A-Za-z][A-Za-z-]*", normalized)
    )
    if line.font_size >= body_font + 1.4 and (line.is_bold or (len(words) <= 9 and title_like)):
        return True
    if line.is_bold and line.is_upper and len(words) <= 10:
        return True
    if line.is_bold and title_like and len(words) <= 9:
        return True
    return False


def _heading_level(text: str) -> int:
    cleaned = text.strip()
    if re.match(r"^[IVXLC]+\.?\s+", cleaned, re.I):
        return 1
    numbered = re.match(r"^([0-9]+(?:\.[0-9]+)*)\.?\s+", cleaned)
    if numbered:
        return min(4, numbered.group(1).count(".") + 1)
    if re.match(r"^[A-Z]\.?\s+", cleaned):
        return 2
    return 1


def _sort_page_lines(lines: list[ExtractedLine], page_width: float) -> list[ExtractedLine]:
    if len(lines) < 12:
        return sorted(lines, key=lambda line: (line.y0, line.x0))

    leftish = [line for line in lines if line.x1 < page_width * 0.58]
    rightish = [line for line in lines if line.x0 > page_width * 0.42]
    two_column = len(leftish) > 8 and len(rightish) > 8
    if not two_column:
        return sorted(lines, key=lambda line: (line.y0, line.x0))

    full_width = [line for line in lines if line.x0 < page_width * 0.22 and line.x1 > page_width * 0.78]
    columns = [line for line in lines if line not in full_width]
    left = [line for line in columns if (line.x0 + line.x1) / 2 <= page_width / 2]
    right = [line for line in columns if (line.x0 + line.x1) / 2 > page_width / 2]
    return (
        sorted(full_width, key=lambda line: (line.y0, line.x0))
        + sorted(left, key=lambda line: (line.y0, line.x0))
        + sorted(right, key=lambda line: (line.y0, line.x0))
    )


def extract_structured_text(pdf_path: str, start: int = 0, end: int = -1) -> str:
    """
    Extract PDF text as section-aware Markdown using span coordinates.

    This borrows the useful part of the inspiration workflow: span-level font,
    bold, uppercase and coordinate metadata. It avoids the brittle JSON breakpoint
    file and instead derives headings, reading order, and repeated header/footer
    cleanup directly from the PDF.
    """
    lines_by_page: dict[int, list[ExtractedLine]] = {}
    page_widths: dict[int, float] = {}
    page_heights: dict[int, float] = {}

    with fitz.open(pdf_path) as doc:
        last_page = len(doc) - 1
        if last_page < 0:
            return ""
        if end < 0 or end > last_page:
            end = last_page
        start = max(0, min(start, last_page))
        if end < start:
            return ""

        for page_idx in range(start, end + 1):
            page = doc.load_page(page_idx)
            page_widths[page_idx] = float(page.rect.width)
            page_heights[page_idx] = float(page.rect.height)
            raw_lines = list(_iter_page_lines(page, page_idx))
            top, bottom = _body_band(raw_lines, float(page.rect.height))
            filtered = [
                line
                for line in raw_lines
                if top <= line.y0 <= bottom
                and line.x1 > page.rect.width * 0.04
                and line.x0 < page.rect.width * 0.96
                and not _LOW_SIGNAL_RE.search(line.text)
            ]
            lines_by_page[page_idx] = filtered

    repeated = _repeated_margin_keys(lines_by_page, page_heights)
    all_sizes = [
        line.font_size
        for lines in lines_by_page.values()
        for line in lines
        if _line_key(line.text) not in repeated and len(line.text) > 2
    ]
    body_font = median(all_sizes) if all_sizes else 10.0

    output: list[str] = []
    previous = ""
    in_references = False

    for page_idx in sorted(lines_by_page):
        page_lines = [
            line
            for line in lines_by_page[page_idx]
            if _line_key(line.text) not in repeated
            and len(_line_key(line.text)) > 1
        ]
        for line in _sort_page_lines(page_lines, page_widths.get(page_idx, 612)):
            text = line.text.strip()
            if not text:
                continue
            if _REFERENCE_START_RE.match(text):
                in_references = True
                output.append(f"\n# {text}\n")
                continue
            if in_references:
                continue
            if text == previous:
                continue

            if _looks_like_heading(line, body_font):
                title = re.sub(r"\s+", " ", text)
                level = _heading_level(title)
                title = _SECTION_NUMBER_RE.sub("", title).strip() or title
                output.append(f"\n{'#' * level} {title}\n")
            elif _CAPTION_RE.match(text):
                output.append(f"\n{text}\n")
            else:
                if output and output[-1] and not output[-1].endswith("\n"):
                    output[-1] = output[-1] + " "
                output.append(text)
            previous = text

    markdown = "\n".join(part for part in output if str(part).strip())
    markdown = re.sub(r"\n{3,}", "\n\n", markdown)
    markdown = re.sub(r"(?<!\n)\n(?![#\n])", " ", markdown)
    markdown = re.sub(r" +", " ", markdown)
    return markdown.strip()


def _looks_like_equation_text(text: str) -> bool:
    cleaned = _clean_text(text)
    if len(cleaned) < 8 or len(cleaned) > 420:
        return False
    if _LOW_SIGNAL_RE.search(cleaned) or _CAPTION_RE.match(cleaned):
        return False
    symbol_count = len(re.findall(r"[=+\-*/^_∑∫√∞≤≥≈≠±×÷(){}\[\]]", cleaned))
    alpha_count = len(re.findall(r"[A-Za-z]", cleaned))
    if not _EQUATION_LINE_RE.search(cleaned):
        return False
    equals_at = cleaned.find("=")
    starts_like_math = bool(
        re.match(r"^[A-Za-z]\s*(?:[({=]|[A-Za-z]?\s*\()", cleaned)
        or re.match(r"^(?:[A-Za-z]\s+){1,5}[A-Za-z]?\s*=", cleaned)
        or re.match(r"^[RrKkVv]\s*(?:\(|=)", cleaned)
    )
    if equals_at > 40 and not starts_like_math:
        return False
    first_word = re.match(r"^[A-Za-z]+", cleaned)
    if first_word and first_word.group(0).islower() and not starts_like_math:
        return False
    word_count = len(re.findall(r"[A-Za-z]{2,}", cleaned))
    math_density = symbol_count / max(1, len(cleaned))
    if word_count > 20 and math_density < 0.08:
        return False
    return symbol_count >= 2 and alpha_count >= 1


def _equation_label(text: str, index: int) -> str:
    match = re.search(r"\(([0-9]{1,3})\)\s*$", text)
    if match:
        return f"Equation {match.group(1)}"
    return f"Equation {index}"


def _clean_equation_candidate(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    for marker in (" . Reflecting ", " . For ", " . The ", " . This ", " . To "):
        if marker in cleaned:
            cleaned = cleaned.split(marker, 1)[0]
    cleaned = re.sub(r",\s+where\s+.*$", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\s+\.\s*$", "", cleaned)
    return cleaned.strip()


def extract_equations_from_pdf(pdf_path: str, start: int = 0, end: int = -1, limit: int = 12) -> list[dict]:
    """
    Extract likely display equations as raw equation text.

    Scientific PDFs often lose reliable LaTeX during text extraction. We keep a
    raw text representation and label/page metadata, then place these on a
    dedicated slide when KaTeX rendering would be risky.
    """
    candidates: list[dict] = []
    seen: set[str] = set()
    crop_dir = figures_root() / "equations"
    crop_dir.mkdir(parents=True, exist_ok=True)

    with fitz.open(pdf_path) as doc:
        last_page = len(doc) - 1
        if last_page < 0:
            return []
        if end < 0 or end > last_page:
            end = last_page
        start = max(0, min(start, last_page))
        if end < start:
            return []

        for page_idx in range(start, end + 1):
            page = doc.load_page(page_idx)
            lines = list(_iter_page_lines(page, page_idx))
            top, bottom = _body_band(lines, float(page.rect.height))
            page_lines = [
                line
                for line in _sort_page_lines(lines, float(page.rect.width))
                if top <= line.y0 <= bottom
            ]
            idx = 0
            while idx < len(page_lines):
                line = page_lines[idx]
                text = line.text.strip()
                combined = text
                equation_lines = [line]
                if _looks_like_equation_text(text):
                    # Pull short continuation lines around broken PDF equations.
                    lookahead = idx + 1
                    while lookahead < len(page_lines) and lookahead <= idx + 2:
                        next_text = page_lines[lookahead].text.strip()
                        if len(next_text) <= 160 and (
                            _looks_like_equation_text(next_text)
                            or re.search(r"^\(?[0-9]{1,3}\)?$", next_text)
                            or re.search(r"^[+\-*/=]|[+\-*/=]$", next_text)
                        ):
                            combined = f"{combined} {next_text}"
                            equation_lines.append(page_lines[lookahead])
                            lookahead += 1
                            continue
                        break
                    normalized = _clean_equation_candidate(combined)
                    if not _looks_like_equation_text(normalized):
                        idx = max(idx + 1, lookahead)
                        continue
                    key = re.sub(r"\W+", "", normalized.lower())
                    if key and key not in seen:
                        seen.add(key)
                        x0 = max(0, min(item.x0 for item in equation_lines) - 18)
                        y0 = max(0, min(item.y0 for item in equation_lines) - 12)
                        x1 = min(float(page.rect.width), max(item.x1 for item in equation_lines) + 18)
                        y1 = min(float(page.rect.height), max(item.y1 for item in equation_lines) + 12)
                        crop_path = crop_dir / f"equation_p{page_idx + 1}_{len(candidates) + 1}.png"
                        try:
                            pix = page.get_pixmap(matrix=fitz.Matrix(2.4, 2.4), clip=fitz.Rect(x0, y0, x1, y1), alpha=False)
                            pix.save(str(crop_path))
                            crop_value = str(crop_path)
                        except Exception:
                            crop_value = ""
                        candidates.append({
                            "page": page_idx + 1,
                            "label": _equation_label(normalized, len(candidates) + 1),
                            "latex": normalized,
                            "text": normalized,
                            "path": crop_value,
                            "bbox": [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)],
                        })
                        if len(candidates) >= limit:
                            return candidates
                    idx = max(idx + 1, lookahead)
                    continue
                idx += 1

    return candidates
