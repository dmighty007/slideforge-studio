"""
Section-aware text chunking for academic PDFs.

Instead of sending the full paper text to every section LLM call, this module
splits the extracted text by detected section headings and returns only the
relevant chunk for each section — reducing cloud LLM token usage ~60-70%.
"""

import re
from typing import NamedTuple


_COMMON_HEADINGS = {
    "abstract",
    "introduction",
    "background",
    "related work",
    "methods",
    "methodology",
    "experimental",
    "experimental section",
    "experimental methods",
    "model and methods",
    "models and methods",
    "results",
    "results and discussion",
    "discussion",
    "conclusions",
    "conclusion",
    "summary",
    "references",
    "bibliography",
    "appendix",
    "acknowledgements",
    "acknowledgments",
    "supporting information",
    "data availability",
    "author contributions",
}
_ROMAN_SECTION_RE = r"(?:I|II|III|IV|V|VI|VII|VIII|IX|X)"
_JUNK_HEADINGS = {
    "chemical science",
    "edge article",
    "view article online",
    "information",
    "processing",
    "issn",
    "volume",
    "number",
    "pages",
    "rsc.li",
    "published on",
    "received",
    "accepted",
    "communicated",
}


class TextChunk(NamedTuple):
    heading: str
    text: str
    start_char: int
    end_char: int


class OutlineEntry(NamedTuple):
    heading: str
    normalized_heading: str
    level: int
    text: str
    start_char: int
    end_char: int


def _normalize_heading(heading: str) -> str:
    cleaned = re.sub(r"\s+", " ", (heading or "").strip())
    # Remove markdown #
    cleaned = re.sub(r"^#+\s+", "", cleaned)
    # Remove numbering like 1. or 1.1 or I.
    cleaned = re.sub(r"^[0-9IVXLCivxlc]+(?:\.[0-9IVXLCivxlc]+)*\.?\s+", "", cleaned)
    return cleaned.strip()


def _iter_lines_with_offsets(full_text: str):
    lines = full_text.splitlines(True)
    offset = 0
    idx = 0
    while idx < len(lines):
        line = lines[idx]
        cleaned = line.strip()
        # If line is just a section number, try to merge with next line
        if re.fullmatch(r"(\d+)(?:\.\d+)*\.?", cleaned) or re.fullmatch(rf"{_ROMAN_SECTION_RE}\.?", cleaned, re.I):
            if idx + 1 < len(lines):
                next_line = lines[idx+1]
                if next_line.strip() and not next_line.strip()[0].isdigit():
                    merged = cleaned + " " + next_line.strip()
                    yield merged, offset, offset + len(line) + len(next_line)
                    offset += len(line) + len(next_line)
                    idx += 2
                    continue
        
        yield line.rstrip("\n"), offset, offset + len(line)
        offset += len(line)
        idx += 1


def _is_heading_line(line: str) -> bool:
    cleaned = re.sub(r"\s+", " ", (line or "").strip())
    if len(cleaned) < 4 or len(cleaned) > 120:
        return False
    if not re.search(r"[A-Za-z]", cleaned):
        return False
    if re.search(r"https?://|doi\.org|@|received |published online|copyright|26 april|j\. chem\.", cleaned, re.I):
        return False
    if re.fullmatch(r"[A-Z]\.", cleaned):
        return False
    # Permit markdown headings (e.g. "# Introduction")
    if re.match(r"^#+\s+[A-Z][A-Za-z0-9 ,:;()/-]{2,}", cleaned):
        return True

    # Permit "1. Introduction" or "2.1 Methods" or "I. BACKGROUND"
    if re.match(r"^(?:[0-9IVXLC]+(?:\.[0-9IVXLC]+)*\.?)\s+[A-Z][A-Za-z0-9 ,:;()/-]{2,}", cleaned):
        return True
    # Permit "A. Specific Subheading"
    if re.match(r"^[A-Z]\.\s+[A-Z][A-Za-z0-9 ,:;()/-]{2,}", cleaned):
        return True
    
    normalized = _normalize_heading(cleaned).lower()
    if normalized in _COMMON_HEADINGS:
        return True
    if any(junk in normalized for junk in _JUNK_HEADINGS):
        return False
    
    # Heuristic for other headings: short, title case, no terminal period
    words = cleaned.split()
    if 2 <= len(words) <= 8 and cleaned[0].isupper() and not cleaned.endswith((".", ":", ",")):
        # If it's very short and title-like, it might be a heading
        # Filter out lines that look like citations or metadata
        if re.search(r"\b(19|20)\d{2}\b", cleaned): # Year like 2015
            return False
        if cleaned.count(",") >= 2 or cleaned.count(".") >= 2: # Citations often have multiple commas/periods
            return False
        if re.match(r"^[A-Z]\.\s+[A-Z]\.", cleaned): # "J. R. Smith"
            return False
        if any(token in cleaned.lower() for token in ["et al", "vol.", "pp.", "doi:", "arxiv:"]):
            return False
        # Only block journal names if they look like a citation (e.g. have a year or specific pattern)
        if re.search(r"\d{4}.*\d+", cleaned): # Year and some other numbers
             return False
            
        if all(w[0].isupper() or w.lower() in {"and", "of", "in", "the", "for", "with", "a", "an", "on", "to"} for w in words):
             # To avoid false positives, we only take these if they are reasonably long or look "important"
             if len(cleaned) >= 8:
                 return True

    return False


def _heading_level(heading: str) -> int:
    cleaned = (heading or "").strip()
    # Markdown levels
    m = re.match(r"^(#+)", cleaned)
    if m:
        return len(m.group(1))
        
    if re.match(r"^I\.\s+[A-Z][a-z]", cleaned):
        return 2
    roman = re.match(rf"^{_ROMAN_SECTION_RE}\.\s+", cleaned, re.I)
    if roman:
        return 1
    lettered = re.match(r"^[A-Z]\.\s+", cleaned)
    if lettered:
        return 2
    numbered = re.match(r"^(\d+(?:\.\d+)*)\s+", cleaned)
    if numbered:
        return min(4, numbered.group(1).count(".") + 1)
    return 1


def parse_document_outline(full_text: str) -> list[OutlineEntry]:
    outline = []
    for chunk in split_by_sections(full_text):
        heading = re.sub(r"\s+", " ", (chunk.heading or "").strip())
        if heading:
            outline.append(
                OutlineEntry(
                    heading=heading,
                    normalized_heading=_normalize_heading(heading),
                    level=_heading_level(heading),
                    text=chunk.text,
                    start_char=chunk.start_char,
                    end_char=chunk.end_char,
                )
            )
    return outline


def split_by_sections(full_text: str) -> list[TextChunk]:
    """
    Split *full_text* into chunks at detected section headings.
    Returns a list of TextChunk, ordered as they appear in the document.
    The first chunk (before any heading) has heading="".
    """
    heading_lines = [(line, start, end) for line, start, end in _iter_lines_with_offsets(full_text) if _is_heading_line(line)]
    if not heading_lines:
        return [TextChunk("", full_text, 0, len(full_text))]

    chunks: list[TextChunk] = []
    prev_start = 0
    prev_heading = ""

    for heading_line, start, _end in heading_lines:
        segment = full_text[prev_start:start].strip()
        if segment or prev_heading:
            chunks.append(TextChunk(prev_heading, segment, prev_start, start))
        prev_heading = heading_line.strip()
        prev_start = start

    # Final chunk
    segment = full_text[prev_start:].strip()
    chunks.append(TextChunk(prev_heading, segment, prev_start, len(full_text)))
    return chunks


def relevant_chunk(full_text: str, section_name: str, window: int = 6000) -> str:
    """
    Return the text most relevant to *section_name*.

    Strategy:
      1. Try to find a chunk whose heading is a close match.
      2. Fall back to a keyword search across all chunks.
      3. Last resort: return full_text[:window].

    *window* is the maximum character budget returned.
    """
    chunks = split_by_sections(full_text)

    name_lower = section_name.lower()
    name_words = set(re.findall(r"\w+", name_lower))

    def heading_score(chunk: TextChunk) -> float:
        h = chunk.heading.lower()
        h_words = set(re.findall(r"\w+", h))
        if not h_words:
            return 0.0
        common = name_words & h_words
        return len(common) / max(len(name_words), len(h_words))

    best = max(chunks, key=heading_score)
    if heading_score(best) >= 0.4:
        return best.text[:window]

    # Keyword fallback: score chunks by how many section_name words appear in text
    def text_score(chunk: TextChunk) -> int:
        return sum(chunk.text.lower().count(w) for w in name_words if len(w) > 3)

    best = max(chunks, key=text_score)
    if text_score(best) > 0:
        return best.text[:window]

    return full_text[:window]


def build_section_context(full_text: str, query: str, max_chars: int = 12000) -> str:
    """
    Return a focused text block for a given query (section name or keywords).
    """
    chunks = split_by_sections(full_text)
    if not chunks:
        return full_text[:max_chars]

    budget_main = int(max_chars * 0.7)
    budget_preamble = int(max_chars * 0.15)
    budget_tail = int(max_chars * 0.15)

    query_lower = query.lower()
    query_words = set(re.findall(r"\w+", query_lower))

    def score(c: TextChunk) -> float:
        # Heading match
        h = c.heading.lower()
        h_words = set(re.findall(r"\w+", h))
        h_score = 0.0
        if h_words:
            common = query_words & h_words
            h_score = (len(common) / max(len(query_words), len(h_words))) * 5.0 # Weight heading heavily
        
        # Content match
        t = c.text.lower()
        t_score = sum(1 for w in query_words if w in t and len(w) > 3) / 10.0
        
        return h_score + t_score

    best_idx = max(range(len(chunks)), key=lambda i: score(chunks[i]))
    main_chunk = chunks[best_idx].text[:budget_main]

    # Preamble: often contains the abstract or core intro
    preamble = chunks[0].text[:budget_preamble] if best_idx != 0 else ""

    # Tail: next section if available for continuity
    tail = ""
    if best_idx + 1 < len(chunks):
        tail = chunks[best_idx + 1].text[:budget_tail]

    parts = [p for p in [preamble, main_chunk, tail] if p.strip()]
    return "\n\n[... CONTINUITY CONTEXT ...]\n\n".join(parts)
