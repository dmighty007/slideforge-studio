import re

_MAX_FIGURES_PER_SLIDE = 3


def _tokenize(text: str) -> set[str]:
    return set(re.findall(r"\w+", (text or "").lower()))


_LOW_VALUE_FIGURE_TERMS = {
    "publisher",
    "publishing",
    "journal",
    "copyright",
    "license",
    "logo",
    "authors",
    "author",
    "affiliation",
    "abstract",
    "introduction",
    "received",
    "accepted",
    "supplementary",
    "supporting",
    "table of contents",
    "graphical abstract",
    "cover",
    "frontispiece",
    "view article",
    "downloaded",
    "email",
    "orcid",
}
_HIGH_VALUE_FIGURE_TYPES = {"graph", "chart", "diagram", "microscopy", "table", "equation"}


def _figure_text_blob(figure: dict) -> str:
    vision = figure.get("vision", {}) or {}
    return " ".join(
        part
        for part in [
            figure.get("caption", ""),
            vision.get("caption_enhanced", ""),
            vision.get("key_finding", ""),
            " ".join(vision.get("axis_labels", []) or []),
        ]
        if part
    )


def _figure_quality_score(figure: dict) -> float:
    vision = figure.get("vision", {}) or {}
    screen = figure.get("screen", {}) or {}
    text_blob = _figure_text_blob(figure).lower()
    score = 0.0

    if figure.get("low_value_visual"):
        score -= 1.5
    if isinstance(screen, dict) and not screen.get("is_figure") and float(screen.get("confidence") or 0.0) >= 0.55:
        score -= 1.2
    if isinstance(screen, dict):
        screen_reason = str(screen.get("brief_reason") or "").lower()
        if any(term in screen_reason for term in _LOW_VALUE_FIGURE_TERMS):
            score -= 0.9

    if any(term in text_blob for term in _LOW_VALUE_FIGURE_TERMS):
        score -= 0.75
    if vision.get("figure_type") in _HIGH_VALUE_FIGURE_TYPES:
        score += 0.45
    if vision.get("axis_labels"):
        score += 0.2
    if vision.get("key_finding"):
        score += 0.15
    if re.search(r"\b(fig(?:ure)?|chart|plot|diagram|scheme|table)\b", text_blob):
        score += 0.15
    if re.search(r"\b(aip publishing|elsevier|springer|wiley|acs publications)\b", text_blob):
        score -= 1.0

    figure_id = str(figure.get("id", "")).lower()
    if (
        "picture" in figure_id
        and not vision.get("axis_labels")
        and vision.get("figure_type") not in _HIGH_VALUE_FIGURE_TYPES
    ):
        score -= 0.2

    return score


def _figure_match_score(text: str, figure: dict) -> float:
    text_tokens = _tokenize(text)
    caption_tokens = _tokenize(figure.get("caption", ""))
    finding_tokens = _tokenize(figure.get("vision", {}).get("key_finding", ""))
    fig_tokens = caption_tokens | finding_tokens
    if not text_tokens or not fig_tokens:
        return 0.0
    overlap = len(text_tokens & fig_tokens)
    return overlap / max(1, min(len(text_tokens), len(fig_tokens)))


def _serialize_figure(f: dict) -> dict:
    return {
        "id": f["id"],
        "caption": f.get("caption", ""),
        "finding": f.get("vision", {}).get("key_finding", ""),
        "type": f.get("vision", {}).get("figure_type", ""),
        "path": f.get("path"),
    }


def _slide_content_text(title: str, points: list[dict]) -> str:
    content = [title]
    for p in points:
        content.append(p.get("heading", ""))
        content.extend(p.get("content", []))
    return " ".join(content)


def _rank_figures_for_text(text: str, figures: list[dict], limit: int = 3) -> list[dict]:
    ranked = sorted(
        figures,
        key=lambda figure: (_figure_match_score(text, figure), _figure_quality_score(figure)),
        reverse=True,
    )
    return ranked[: min(limit, len(ranked))]


def _assign_figures_to_slides(slides: list[dict], candidate_figures: list[dict]) -> dict[int, list[str]]:
    if not slides or not candidate_figures:
        return {}

    slide_texts = {
        idx: _slide_content_text(slide.get("title", ""), slide.get("points", [])) for idx, slide in enumerate(slides)
    }
    valid_figures = [figure for figure in candidate_figures if _figure_quality_score(figure) >= -0.8]
    if not valid_figures:
        return {idx: [] for idx in range(len(slides))}

    all_pairs = []
    for idx, slide_text in slide_texts.items():
        for figure in valid_figures:
            match_score = _figure_match_score(slide_text, figure)
            quality_score = _figure_quality_score(figure)
            all_pairs.append((idx, figure["id"], match_score, quality_score, match_score + (quality_score * 0.35)))
    all_pairs.sort(key=lambda item: item[4], reverse=True)

    assignments = {idx: [] for idx in range(len(slides))}
    figure_use_counts = {figure["id"]: 0 for figure in valid_figures}

    for idx, slide in enumerate(slides):
        fids = slide.get("fig_ids", [])
        if not fids and slide.get("fig_id"):
            fids = [slide.get("fig_id")]
        for fid in fids:
            if fid and fid in figure_use_counts and figure_use_counts[fid] == 0:
                if fid not in assignments[idx]:
                    assignments[idx].append(fid)
                    figure_use_counts[fid] += 1

    for idx, figure_id, score, _quality_score, combined_score in all_pairs:
        if assignments[idx] or figure_use_counts[figure_id] > 0:
            continue
        if score < 0.1 or combined_score < 0.08:
            continue
        assignments[idx].append(figure_id)
        figure_use_counts[figure_id] += 1

    # Cover high-value figures at least once before allowing repeats.
    high_value_figures = sorted(
        valid_figures,
        key=lambda figure: _figure_quality_score(figure),
        reverse=True,
    )
    for figure in high_value_figures:
        figure_id = figure["id"]
        if figure_use_counts[figure_id] > 0:
            continue
        best = None
        for idx, pair_figure_id, score, quality_score, combined_score in all_pairs:
            if pair_figure_id != figure_id:
                continue
            if len(assignments[idx]) >= _MAX_FIGURES_PER_SLIDE:
                continue
            candidate = (combined_score, score, quality_score, idx)
            if best is None or candidate > best:
                best = candidate
        if best and (best[1] >= 0.08 or best[2] >= 0.25):
            idx = best[3]
            assignments[idx].append(figure_id)
            figure_use_counts[figure_id] += 1

    for idx, figure_id, score, _quality_score, combined_score in all_pairs:
        if len(assignments[idx]) >= _MAX_FIGURES_PER_SLIDE:
            continue
        if figure_id in assignments[idx]:
            continue
        if figure_use_counts[figure_id] >= 1:
            continue
        if score < 0.18 or combined_score < 0.18:
            continue
        assignments[idx].append(figure_id)
        figure_use_counts[figure_id] += 1

    # If there are more slides than figures, allow a small number of highly relevant repeats.
    repeat_cap = 2 if len(slides) > len(valid_figures) else 1
    for idx, figure_id, score, quality_score, combined_score in all_pairs:
        if assignments[idx] or figure_use_counts[figure_id] >= repeat_cap:
            continue
        if score < 0.28 or combined_score < 0.24 or quality_score < 0.1:
            continue
        assignments[idx].append(figure_id)
        figure_use_counts[figure_id] += 1

    # Attach remaining important figures to the least-loaded relevant slide, but never logos/junk.
    for figure in valid_figures:
        figure_id = figure["id"]
        if figure_use_counts[figure_id] > 0:
            continue
        if _figure_quality_score(figure) < 0.15:
            continue

        assigned = False
        for idx, pair_figure_id, score, quality_score, _combined_score in all_pairs:
            if pair_figure_id != figure_id:
                continue
            if figure_id in assignments[idx]:
                assigned = True
                break
            if len(assignments[idx]) >= _MAX_FIGURES_PER_SLIDE:
                continue
            if score < 0.06 and quality_score < 0.25:
                continue
            assignments[idx].append(figure_id)
            figure_use_counts[figure_id] += 1
            assigned = True
            break

        if assigned:
            continue

        fallback_idx = min(assignments, key=lambda slide_idx: (len(assignments[slide_idx]), slide_idx))
        if figure_id not in assignments[fallback_idx]:
            assignments[fallback_idx].append(figure_id)
            figure_use_counts[figure_id] += 1

    return assignments


def _rank_equations_for_text(text: str, equations: list[dict], limit: int = 3) -> list[dict]:
    def _equation_text(entry: dict) -> str:
        return " ".join(
            part for part in [entry.get("label", ""), entry.get("latex", ""), entry.get("text", "")] if part
        )

    def _equation_match_score(slide_text: str, equation: dict) -> float:
        equation_tokens = _tokenize(_equation_text(equation))
        slide_tokens = _tokenize(slide_text)
        if not slide_tokens or not equation_tokens:
            return 0.0
        overlap = len(slide_tokens & equation_tokens)
        return overlap / max(1, min(len(slide_tokens), len(equation_tokens)))

    ranked = sorted(equations, key=lambda equation: _equation_match_score(text, equation), reverse=True)
    return ranked[: min(limit, len(ranked))]


def _serialize_equation(entry: dict) -> dict:
    return {
        "page": entry.get("page"),
        "label": entry.get("label", ""),
        "latex": entry.get("latex", ""),
        "text": entry.get("text", ""),
        "path": entry.get("path"),
    }
