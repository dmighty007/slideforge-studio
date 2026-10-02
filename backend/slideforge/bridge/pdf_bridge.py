import json
import os
import re
import argparse
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError

import pymupdf as fitz


from .standalone_pdf2ppt import PDF2PPTx, PPTXGenerator
from .text_utils import build_section_context, parse_document_outline
from .vision import enrich_catalog
from .utils import _emit, _truncate_words
from .llm_utils import (
    _validate_local_models, build_provider, build_task_provider,
    _generate_structured_json, _unload_ollama_models
)
from .processors import LocalVisionPDFProcessor
from .core_logic import (
    _rank_figures_for_text, _assign_figures_to_slides, _serialize_figure,
    _serialize_equation
)

class PDF2PPTxBridge(PDF2PPTx):
    _GENERIC_VISUAL_TEXT_RE = re.compile(
        r"\b("
        r"this (diagram|figure|image|chart) (illustrates|shows|depicts|visualizes)|"
        r"the (diagram|figure|image|chart) (illustrates|shows|depicts|visualizes)|"
        r"visualiz(?:e|es|ing) the|sequential resampling process|complex workflow|"
        r"shown in the figure|as shown|figure shows"
        r")\b",
        re.I,
    )
    _GENERIC_CLAIM_RE = re.compile(
        r"\b("
        r"improves (?:the )?efficiency|improves (?:the )?accuracy|"
        r"improves (?:the )?efficiency, accuracy, and convergence|"
        r"significantly improves (?:the )?efficiency|enhances performance|better results|"
        r"more accurate rates|faster convergence|significant improvement|future potential|"
        r"important implications|novel approach|robust framework|efficient simulations|"
        r"improved simulation outcomes"
        r")\b",
        re.I,
    )
    _PROMPT_REMNANT_RE = re.compile(
        r"^\s*(summari[sz]e|explain|discuss|describe|recognize|understand|provide|outline|"
        r"key takeaways|#\s+|comparison of folding and unfolding kinetics)\b",
        re.I,
    )
    _SUSPICIOUS_FIGURE_CLAIM_RE = re.compile(
        r"\b("
        r"md (?:simulations? )?(?:generally )?(?:show|shows|exhibit|exhibits) (?:significantly )?higher folding rates|"
        r"t[_ ]?fre (?:is )?(?:significantly |markedly )?(?:larger|smaller)|"
        r"larger t[_ ]?fre|higher folding rates"
        r")\b",
        re.I,
    )
    _SPECIFICITY_TERMS_RE = re.compile(
        r"\b("
        r"chignolin|trp-?cage|trajectory intensity|temporal coherence|history window|"
        r"string methods?|swarms?|trajector(?:y|ies)|local drift|free-?energy|transition pathways?|"
        r"productive walkers?|unproductive walkers?|statistical weights?|weighted intensity|"
        r"conventional (?:binned )?we|targeted we|proximity-based|mean first-passage|mfpt|"
        r"rate constants?|run-to-run variability|folding|unfolding|40-fold|aggregate simulation time|"
        r"steady-state|dominant pathways?"
        r")\b",
        re.I,
    )

    @classmethod
    def _clean_generated_text(cls, value, fallback=""):
        text = re.sub(r"\s+", " ", str(value or "").strip())
        if not text:
            return fallback
        if cls._PROMPT_REMNANT_RE.search(text):
            return fallback
        if re.fullmatch(r"(imported|untitled|content|slide|section|figure|image|chart|table)(\s+\w+){0,4}", text, re.I):
            return fallback
        if cls._GENERIC_VISUAL_TEXT_RE.search(text):
            return fallback
        return text

    def _llm_trace_snapshot(self, **providers):
        snapshot = {}
        for name, provider in providers.items():
            if not provider:
                continue
            trace = getattr(provider, "trace", None)
            if trace is not None:
                snapshot[name] = list(trace)
            last_provider = getattr(provider, "last_provider", None)
            if last_provider:
                snapshot[f"{name}_last_provider"] = last_provider
        return snapshot

    def _env_int(self, name, default, minimum=1, maximum=8):
        raw = os.getenv(name, "").strip()
        if not raw:
            return default
        try:
            value = int(raw)
        except ValueError:
            return default
        return max(minimum, min(maximum, value))

    def _provider_labels(self, llm):
        providers = getattr(llm, "providers", []) or []
        return [provider.provider_label().lower() for provider in providers if hasattr(provider, "provider_label")]

    def _has_api_first_provider(self, llm):
        labels = self._provider_labels(llm)
        return bool(labels) and not labels[0].startswith("ollama")

    def _slide_writing_mode(self, slide_llm):
        configured = os.getenv("PPTMAKER_SLIDE_WRITING_MODE", "").strip().lower()
        aliases = {
            "deterministic": "fast",
            "local": "fast",
            "off": "fast",
            "api": "llm",
            "full": "llm",
        }
        configured = aliases.get(configured, configured)
        if configured in {"fast", "balanced", "llm"}:
            return configured
        return "llm" if self._has_api_first_provider(slide_llm) else "fast"

    def _slide_generation_workers(self, slide_llm):
        mode = self._slide_writing_mode(slide_llm)
        if mode == "fast":
            return 1

        configured = os.getenv("PPTMAKER_SLIDE_WRITERS", "").strip()
        if configured:
            return self._env_int("PPTMAKER_SLIDE_WRITERS", 1, minimum=1, maximum=8)

        if self._has_api_first_provider(slide_llm):
            return self._env_int("PPTMAKER_API_SLIDE_WRITERS", 1, minimum=1, maximum=4)
        return self._env_int("PPTMAKER_LOCAL_SLIDE_WRITERS", 1, minimum=1, maximum=4)

    def _source_snippets(self, text, orig_slide=None, limit=10):
        query = " ".join(
            str(part or "")
            for part in [
                orig_slide.get("title") if isinstance(orig_slide, dict) else "",
                orig_slide.get("claim") if isinstance(orig_slide, dict) else "",
                " ".join(orig_slide.get("keywords") or []) if isinstance(orig_slide, dict) else "",
            ]
        )
        query_words = {w for w in re.findall(r"[A-Za-z][A-Za-z0-9-]{3,}", query.lower())}
        sentences = [
            re.sub(r"\s+", " ", sentence).strip()
            for sentence in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9])|\n+", str(text or ""))
        ]
        candidates = []
        for idx, sentence in enumerate(sentences):
            if len(sentence) < 45 or len(sentence) > 420:
                continue
            if self._GENERIC_VISUAL_TEXT_RE.search(sentence):
                continue
            words = {w for w in re.findall(r"[A-Za-z][A-Za-z0-9-]{3,}", sentence.lower())}
            score = len(query_words & words) / max(1, min(len(query_words), len(words))) if query_words else 0
            if re.search(r"\b(result|demonstrat|show|indicat|increase|decrease|faster|slower|rate|conver|method|we-rl|weighted ensemble|sampling)\b", sentence, re.I):
                score += 0.25
            candidates.append((score, idx, sentence))
        candidates.sort(key=lambda item: (-item[0], item[1]))
        selected = sorted(candidates[:limit], key=lambda item: item[1])
        return [{"id": i + 1, "text": sentence} for i, (_, __, sentence) in enumerate(selected)]

    def _fallback_slide_payload_from_source(self, orig_slide, snippets, ordered_figures=None):
        title = self._clean_generated_text(orig_slide.get("title"), "Key Finding")
        claim = self._clean_generated_text(orig_slide.get("claim"), "")
        source_texts = [item["text"] for item in snippets if item.get("text")]
        bullets = []
        for sentence in source_texts:
            cleaned = _truncate_words(sentence, 16)
            if cleaned and cleaned not in bullets:
                bullets.append(cleaned)
            if len(bullets) >= 3:
                break
        if not bullets and claim:
            bullets.append(_truncate_words(claim, 16))
        if not bullets:
            bullets.append("Needs manual review: source evidence was insufficient.")
        return {
            "title": _truncate_words(title, 9),
            "fig_id": (ordered_figures or [{}])[0].get("id") if ordered_figures else None,
            "points": [{"heading": _truncate_words(claim or title, 5), "content": bullets}],
        }

    def _payload_quality_issues(self, payload):
        issues = []
        if not isinstance(payload, dict):
            return ["not_json_object"]
        title = str(payload.get("title") or "")
        if self._GENERIC_VISUAL_TEXT_RE.search(title):
            issues.append("generic_title")
        points = payload.get("points")
        if not isinstance(points, list) or not points:
            issues.append("missing_points")
            return issues
        useful_bullets = 0
        for point in points:
            if not isinstance(point, dict):
                issues.append("bad_point")
                continue
            heading = str(point.get("heading") or "")
            if self._GENERIC_VISUAL_TEXT_RE.search(heading):
                issues.append("generic_heading")
            content = point.get("content") or []
            if isinstance(content, str):
                content = [content]
            for bullet in content:
                bullet_text = str(bullet or "").strip()
                if not bullet_text:
                    continue
                if self._GENERIC_VISUAL_TEXT_RE.search(bullet_text):
                    issues.append("generic_bullet")
                    continue
                useful_bullets += 1
        if useful_bullets < 2:
            issues.append("too_few_grounded_bullets")
        return sorted(set(issues))

    def _flatten_slide_payload_text(self, payload):
        parts = []
        if isinstance(payload, dict):
            parts.append(str(payload.get("title", "")))
            for point in payload.get("points") or []:
                if not isinstance(point, dict):
                    continue
                parts.append(str(point.get("heading", "")))
                content = point.get("content") or []
                if isinstance(content, str):
                    content = [content]
                parts.extend(str(item or "") for item in content)
        return " ".join(parts)

    def _review_slide_payload(self, payload, orig_slide, source_snippets, brief_evidence):
        issues = self._payload_quality_issues(payload)
        text = self._flatten_slide_payload_text(payload)
        lower = text.lower()

        if self._GENERIC_CLAIM_RE.search(text) and not self._SPECIFICITY_TERMS_RE.search(text):
            issues.append("generic_claim_without_specifics")
        if self._PROMPT_REMNANT_RE.search(text):
            issues.append("prompt_remnant")
        if self._SUSPICIOUS_FIGURE_CLAIM_RE.search(text):
            evidence_blob = " ".join(
                [item.get("text", "") for item in source_snippets if isinstance(item, dict)]
                + [
                    f"{item.get('claim', '')} {item.get('support', '')}"
                    for item in brief_evidence
                    if isinstance(item, dict)
                ]
            ).lower()
            suspicious_matches = self._SUSPICIOUS_FIGURE_CLAIM_RE.findall(text)
            if not suspicious_matches or not all(str(match).lower() in evidence_blob for match in suspicious_matches):
                issues.append("suspicious_figure_only_claim")

        bullets = []
        if isinstance(payload, dict):
            for point in payload.get("points") or []:
                if not isinstance(point, dict):
                    continue
                content = point.get("content") or []
                if isinstance(content, str):
                    content = [content]
                bullets.extend(str(item or "").strip() for item in content if str(item or "").strip())
        for bullet in bullets:
            if self._PROMPT_REMNANT_RE.search(bullet):
                issues.append("prompt_remnant_bullet")
            if self._GENERIC_CLAIM_RE.search(bullet) and not self._SPECIFICITY_TERMS_RE.search(bullet):
                issues.append("generic_bullet_without_specifics")
        if len(bullets) < 3:
            issues.append("too_few_bullets")
        if len(bullets) > 6:
            issues.append("too_many_bullets")
        if len(set(b.lower() for b in bullets)) < len(bullets):
            issues.append("duplicate_bullets")
        if len(lower.split()) >= 18 and not self._SPECIFICITY_TERMS_RE.search(text):
            issues.append("low_specificity")

        return sorted(set(issues))

    def _deterministic_review_payload(self, orig_slide, source_snippets, brief_evidence, ordered_figures=None):
        title = self._clean_generated_text(orig_slide.get("title"), "Key Finding")
        evidence = [item for item in brief_evidence if isinstance(item, dict)]
        bullets = []
        heading = self._clean_generated_text(orig_slide.get("claim"), "") or "Evidence"
        for item in evidence:
            claim = self._clean_generated_text(item.get("claim"), "")
            support = self._clean_generated_text(item.get("support"), "")
            if (
                claim
                and not self._SUSPICIOUS_FIGURE_CLAIM_RE.search(claim)
                and not (self._GENERIC_CLAIM_RE.search(claim) and not self._SPECIFICITY_TERMS_RE.search(claim))
            ):
                bullets.append(_truncate_words(claim, 14))
            if (
                support
                and len(bullets) < 5
                and not self._SUSPICIOUS_FIGURE_CLAIM_RE.search(support)
                and not (self._GENERIC_CLAIM_RE.search(support) and not self._SPECIFICITY_TERMS_RE.search(support))
            ):
                bullets.append(_truncate_words(support, 14))
            if len(bullets) >= 4:
                break
        for item in source_snippets:
            sentence = self._clean_generated_text(item.get("text") if isinstance(item, dict) else "", "")
            if (
                sentence
                and not self._SUSPICIOUS_FIGURE_CLAIM_RE.search(sentence)
                and not (self._GENERIC_CLAIM_RE.search(sentence) and not self._SPECIFICITY_TERMS_RE.search(sentence))
            ):
                bullets.append(_truncate_words(sentence, 14))
            if len(bullets) >= 4:
                break

        claim = self._clean_generated_text(orig_slide.get("claim"), "")
        if claim and len(bullets) < 3:
            bullets.append(_truncate_words(claim, 14))

        unique_bullets = []
        for bullet in bullets:
            if bullet and bullet.lower() not in {item.lower() for item in unique_bullets}:
                unique_bullets.append(bullet)
        if claim and len(unique_bullets) < 3 and claim.lower() not in {item.lower() for item in unique_bullets}:
            unique_bullets.append(_truncate_words(claim, 14))
        if not unique_bullets:
            unique_bullets = ["Needs manual review: source evidence was insufficient."]
        return {
            "title": _truncate_words(title, 9),
            "layout_hint": orig_slide.get("layout_hint") or "text",
            "fig_id": (ordered_figures or [{}])[0].get("id") if ordered_figures else None,
            "points": [{"heading": _truncate_words(heading, 5), "content": unique_bullets[:5]}],
        }

    def _infer_document_title(self, text, frame=None):
        frame = frame or {}
        for key in ("title", "paper_title", "name"):
            candidate = self._clean_generated_text(frame.get(key))
            if candidate:
                return _truncate_words(candidate, 18)

        lines = [re.sub(r"\s+", " ", line).strip() for line in str(text or "").splitlines()]
        lines = [
            line
            for line in lines[:80]
            if 12 <= len(line) <= 180
            and not re.search(r"\b(abstract|introduction|copyright|journal|doi:|received|accepted)\b", line, re.I)
        ]
        if not lines:
            return "Imported Presentation"
        scored = sorted(lines[:12], key=lambda line: (len(re.findall(r"[A-Za-z]{4,}", line)), -len(line)), reverse=True)
        return _truncate_words(scored[0], 18)

    def _extract_document_metadata(self, pdf_path, full_text):
        metadata = {}
        first_page_lines = []
        def clean_meta_text(value):
            value = re.sub(r"[\ue000-\uf8ff]", "", str(value or ""))
            value = re.sub(r"\b(View Online|Export Citation)\b.*$", "", value, flags=re.I)
            return re.sub(r"\s+", " ", value).strip(" ,;")

        try:
            with fitz.open(pdf_path) as doc:
                doc_meta = doc.metadata or {}
                title = self._clean_generated_text(clean_meta_text(doc_meta.get("title")))
                if title and not re.search(r"\b(untitled|microsoft|powerpoint|acrobat|pdf|research article|review article)\b|\|", title, re.I):
                    metadata["title"] = _truncate_words(title, 22)
                if doc_meta.get("author"):
                    authors = clean_meta_text(doc_meta.get("author", ""))
                    if authors:
                        metadata["authors"] = authors
                if len(doc):
                    page = doc.load_page(0)
                    blocks = page.get_text("blocks")
                    for block in sorted(blocks, key=lambda item: (round(float(item[1]), 1), round(float(item[0]), 1))):
                        text = clean_meta_text(block[4])
                        if text:
                            first_page_lines.append(text)
        except Exception:
            pass

        if not first_page_lines:
            first_page_lines = [
                clean_meta_text(line)
                for line in str(full_text or "").splitlines()[:80]
                if re.sub(r"\s+", " ", line).strip()
            ]

        clean_lines = [
            line
            for line in first_page_lines[:60]
            if not re.search(r"\b(downloaded|copyright|all rights reserved|view article|supplementary)\b", line, re.I)
        ]

        doi_match = re.search(r"\b10\.\d{4,9}/[-._;()/:A-Za-z0-9]+\b", "\n".join(clean_lines[:80]))
        if doi_match:
            metadata["doi"] = doi_match.group(0).rstrip(".,;")

        if "title" not in metadata:
            title_parts = []
            for line in clean_lines[:18]:
                if re.search(r"\b(abstract|introduction|received|accepted|published|doi:|@)\b", line, re.I):
                    break
                if len(line) < 12 or len(line) > 220:
                    continue
                if re.search(r"\b(research article|review article|article|october|january|february|march|april|may|june|july|august|september|november|december)\b.*\b(19|20)\d{2}\b", line, re.I):
                    continue
                if re.search(r"\b(journal|volume|issue|pages?|university|department|institute)\b", line, re.I):
                    continue
                if re.search(r"\d{4}|[,;].*[,;]", line) and len(title_parts) > 0:
                    break
                title_parts.append(line)
                if len(" ".join(title_parts)) > 70:
                    break
            if title_parts:
                metadata["title"] = _truncate_words(clean_meta_text(" ".join(title_parts)), 24)

        if "authors" not in metadata:
            title_text = metadata.get("title", "")
            title_seen = False
            author_candidates = []
            for line in clean_lines[:30]:
                if title_text and line in title_text:
                    title_seen = True
                    continue
                if not title_seen and title_text:
                    continue
                if re.search(r"\b(abstract|introduction|department|university|institute|received|accepted|published|doi:|@)\b", line, re.I):
                    if author_candidates:
                        break
                    continue
                if 6 <= len(line) <= 220 and re.search(r"[A-Z][a-z]+", line):
                    if re.search(r"\d{4}|https?://", line):
                        continue
                    author_candidates.append(clean_meta_text(re.sub(r"\s*\d+\s*", " ", line)))
                    if len(author_candidates) >= 2:
                        break
            if author_candidates:
                authors = clean_meta_text(" ".join(author_candidates))
                if authors:
                    metadata["authors"] = authors

        for line in clean_lines[:40]:
            if "journal_name" not in metadata and re.search(r"\b(journal|proceedings|transactions|letters|nature|science|cell|acs|aip|ieee)\b", line, re.I):
                metadata["journal_name"] = _truncate_words(line, 14)
            if "publish_date" not in metadata:
                year = re.search(r"\b(19|20)\d{2}\b", line)
                if year and re.search(r"\b(published|received|accepted|online|copyright|\bvol\.|\bissue\b)\b", line, re.I):
                    metadata["publish_date"] = year.group(0)

        return metadata

    def _normalize_slide_payload(self, payload, orig_slide):
        fallback_title = self._clean_generated_text(orig_slide.get("title"), "Content")
        normalized = payload if isinstance(payload, dict) else {}

        title = self._clean_generated_text(normalized.get("title"), fallback_title) or fallback_title

        normalized_points = []
        raw_points = normalized.get("points", [])
        if isinstance(raw_points, list):
            for raw_point in raw_points:
                if not isinstance(raw_point, dict):
                    continue
                heading = str(raw_point.get("heading") or "").strip()
                raw_content = raw_point.get("content", [])
                if isinstance(raw_content, list):
                    content = [self._clean_generated_text(item) for item in raw_content if self._clean_generated_text(item)]
                elif isinstance(raw_content, str) and raw_content.strip():
                    cleaned = self._clean_generated_text(raw_content)
                    content = [cleaned] if cleaned else []
                else:
                    content = []
                heading = self._clean_generated_text(heading)
                if heading or content:
                    normalized_points.append({"heading": heading, "content": content})

        if not normalized_points and orig_slide.get("claim"):
            normalized_points.append({
                "heading": "Takeaway",
                "content": [_truncate_words(self._clean_generated_text(orig_slide.get("claim"), fallback_title), 18)],
            })

        fig_ids = []
        model_fig_id = normalized.get("fig_id")
        if model_fig_id:
            fig_ids.append(str(model_fig_id))
        for requested_fig_id in orig_slide.get("fig_ids", []):
            if requested_fig_id and requested_fig_id not in fig_ids:
                fig_ids.append(requested_fig_id)

        return {
            "title": title,
            "points": normalized_points,
            "fig_id": fig_ids[0] if fig_ids else None,
            "fig_ids": fig_ids,
            "layout_hint": self._clean_generated_text(normalized.get("layout_hint"), orig_slide.get("layout_hint", "")),
            "review": normalized.get("review") if isinstance(normalized.get("review"), dict) else {},
        }

    def _run_with_progress(self, work, emit, event, messages, percent_start, percent_end, interval=2.5):
        messages = [msg for msg in messages if msg]
        if not messages:
            messages = ["Working"]
        emit(event, messages[0], {"percent": percent_start, "phase": "start"})
        started_at = time.monotonic()
        tick = 0
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(work)
            while True:
                try:
                    result = future.result(timeout=interval)
                    emit(event, messages[-1], {"percent": percent_end, "phase": "complete"})
                    return result
                except TimeoutError:
                    tick += 1
                    elapsed = int(time.monotonic() - started_at)
                    fraction = min(0.92, 1 - (0.78 ** tick))
                    percent = int(round(percent_start + (percent_end - percent_start) * fraction))
                    base_message = messages[min(tick, len(messages) - 2)] if len(messages) > 1 else messages[0]
                    emit(
                        event,
                        f"{base_message} ({elapsed}s elapsed)",
                        {"percent": percent, "phase": "running", "elapsed_seconds": elapsed},
                    )

    def convert_to_json(self, pdf_path, json_output, pptx_output=None, start=0, end=-1, 
                        max_slides=0, max_sections=0, json_progress=False, status_callback=None):
        
        stage_ranges = {
            "processing": (6, 18), "vision_extract": (18, 36), "vision": (36, 38), 
            "analysis": (54, 60), "brief": (60, 68), "storyboard": (68, 72), "section": (72, 96), 
            "export": (96, 99), "done": (100, 100)
        }

        def emit(event, message, data=None):
            payload = dict(data or {})
            if "percent" not in payload:
                s, e = stage_ranges.get(event, (0, 0))
                try:
                    curr, tot = payload.get("current"), payload.get("total")
                    if tot and float(tot) > 0:
                        payload["percent"] = int(round(s + (e - s) * (float(curr or 0) / float(tot))))
                    else:
                        payload["percent"] = e if event == "done" else s
                except (TypeError, ValueError):
                    payload["percent"] = e if event == "done" else s
            if status_callback:
                try: status_callback(event, message, payload)
                except Exception: status_callback(message)
            _emit(event, message, payload, json_mode=json_progress)

        # 1. Extract
        emit("processing", "Extracting text and visuals from PDF")
        proc = LocalVisionPDFProcessor(pdf_path, self.llm, status_callback=lambda ev, msg, data=None: emit(ev, msg, data))
        proc.extract_visuals_hybrid()
        full_text = proc.extract_text(start, end)
        document_metadata = self._extract_document_metadata(pdf_path, full_text)
        mineru_summary = self._summarize_mineru_context(getattr(proc, "mineru_context", {}) or {})
        
        # 2. Enrich
        emit("vision", "Running local vision LLM on figures")
        enriched_catalog = enrich_catalog(proc.visual_catalog, status_cb=lambda ev, msg, data=None: emit(ev, msg, data))
        _unload_ollama_models()
        
        # 3. Plan
        planning_llm = build_task_provider(task="planning", allow_remote=True)
        paper_frame = self._frame_paper(planning_llm, enriched_catalog, mineru_summary, full_text, emit)
        document_outline = parse_document_outline(full_text)
        coarse_context = self._coarse_story_context(document_outline, full_text)
        brief_llm = build_task_provider(task="paper_brief", allow_remote=True)
        storyboard_llm = build_task_provider(task="storyboard", allow_remote=True)
        paper_brief = self._build_paper_brief(brief_llm, paper_frame, document_outline, enriched_catalog, emit)
        storyboard = self._plan_storyboard(storyboard_llm, paper_frame, enriched_catalog, emit, document_outline, coarse_context, paper_brief)
        if isinstance(storyboard, list): storyboard = {"slides": storyboard}
        if not isinstance(storyboard, dict): storyboard = {"slides": []}
        if document_metadata.get("title"):
            storyboard["title"] = document_metadata["title"]
        elif not self._clean_generated_text(storyboard.get("title")):
            storyboard["title"] = self._infer_document_title(full_text, paper_frame)
        for meta_key in ("authors", "journal_name", "publish_date", "doi"):
            if document_metadata.get(meta_key):
                storyboard[meta_key] = document_metadata[meta_key]
        if not self._clean_generated_text(storyboard.get("sub")):
            core = self._clean_generated_text(paper_frame.get("core_innovation") or paper_frame.get("problem") or paper_frame.get("thesis"))
            if core:
                storyboard["sub"] = _truncate_words(core, 22)
        
        # 4. Generate
        slide_llm = build_task_provider(task="slide_writing", allow_remote=True)
        llm_trace_providers = {
            "planning": planning_llm,
            "paper_brief": brief_llm,
            "storyboard": storyboard_llm,
            "slide_writing": slide_llm,
        }
        return self._generate_slides(
            storyboard, enriched_catalog, full_text, mineru_summary, slide_llm,
            json_output, pptx_output, max_slides, max_sections, emit, paper_frame, getattr(proc, "mineru_context", {}), paper_brief, llm_trace_providers
        )

    def _summarize_mineru_context(self, context):
        return {
            "backend": context.get("backend"),
            "visuals": [{"page": i.get("page"), "caption": i.get("caption", ""), "path": i.get("path")} for i in (context.get("visuals") or [])[:18]],
            "figure_captions": (context.get("captions") or [])[:24],
            "equations": [{"page": i.get("page"), "label": i.get("label", ""), "latex": i.get("latex", "")} for i in (context.get("equations") or [])[:16]],
        }

    def _frame_paper(self, llm, catalog, summary, text, emit):
        prompt = (
            "You are a senior scientific editor. Identify the core innovation, problem, and evidence.\n"
            f"Figures: {json.dumps([{'id': f['id'], 'caption': f.get('vision', {}).get('caption_enhanced') or f.get('caption', '')} for f in catalog])}\n"
            f"Paper excerpt: {text[:18000]}"
        )
        res = self._run_with_progress(
            lambda: _generate_structured_json(llm, prompt, "Scientific analysis mode.", "paper framing"),
            emit,
            "analysis",
            [
                "Extracting the paper's central thesis and evidence",
                "Reading abstract, introduction, and results for central claims",
                "Separating evidence from background and figure captions",
                "Structuring problem, innovation, and supporting evidence",
                "Central thesis and evidence extracted",
            ],
            54,
            60,
        )
        if not isinstance(res, dict): res = {}
        return res

    def _coarse_story_context(self, document_outline, full_text):
        preferred = []
        for entry in document_outline or []:
            name = (entry.normalized_heading or entry.heading or "").lower()
            if any(key in name for key in ("abstract", "introduction", "conclusion", "summary")):
                preferred.append({
                    "heading": entry.normalized_heading or entry.heading,
                    "level": entry.level,
                    "preview": _truncate_words(re.sub(r"\s+", " ", entry.text or "").strip(), 120),
                })
        if preferred:
            return preferred[:6]
        return [{"heading": "Document opening", "level": 1, "preview": _truncate_words(full_text[:3000], 160)}]

    def _brief_source_pack(self, document_outline, max_sections=14):
        preferred_names = (
            "abstract", "introduction", "method", "methods", "algorithm", "results",
            "discussion", "conclusion", "summary",
        )
        junk_names = (
            "articles you may be interested", "references", "bibliography", "affiliations",
            "view online", "export citation", "supporting information",
        )
        entries = []
        for entry in document_outline or []:
            heading = entry.normalized_heading or entry.heading or "Document"
            name = heading.lower()
            text = re.sub(r"\s+", " ", entry.text or "").strip()
            if not text or any(key in name for key in junk_names):
                continue
            if re.search(r"\b(view online|export citation|articles you may be interested)\b", text[:500], re.I):
                continue
            if any(key in name for key in preferred_names) or (
                len(entries) < 3
                and re.search(
                    r"\b(we introduce|we benchmark|we demonstrate|method|algorithm|results|rate estimates|mean first-passage|baseline)\b",
                    text,
                    re.I,
                )
            ):
                entries.append({
                    "heading": heading,
                    "level": entry.level,
                    "text": _truncate_words(text, 170),
                })
            if len(entries) >= max_sections:
                break
        if not entries:
            for entry in document_outline or []:
                heading = entry.normalized_heading or entry.heading or "Document"
                name = heading.lower()
                text = re.sub(r"\s+", " ", entry.text or "").strip()
                if not text or any(key in name for key in junk_names):
                    continue
                entries.append({
                    "heading": heading,
                    "level": entry.level,
                    "text": _truncate_words(text, 170),
                })
                if len(entries) >= max_sections:
                    break
        return entries

    def _fallback_paper_brief(self, frame, document_outline):
        source_pack = self._brief_source_pack(document_outline, max_sections=8)
        abstract = next((item["text"] for item in source_pack if "abstract" in item["heading"].lower()), "")
        intro = next((item["text"] for item in source_pack if "introduction" in item["heading"].lower()), "")
        frame = frame or {}
        return {
            "central_thesis": frame.get("thesis") or frame.get("core_innovation") or _truncate_words(abstract or intro, 35),
            "problem": frame.get("problem") or _truncate_words(intro or abstract, 32),
            "method_mechanism": [],
            "benchmarks": [],
            "key_findings": [],
            "limitations": [],
            "takeaway": frame.get("impact") or frame.get("takeaway") or "",
            "evidence_items": [
                {"id": f"E{idx + 1}", "claim": item["heading"], "support": item["text"], "section": item["heading"]}
                for idx, item in enumerate(source_pack[:8])
            ],
        }

    def _build_paper_brief(self, llm, frame, document_outline, catalog, emit):
        source_pack = self._brief_source_pack(document_outline)
        figure_pack = [
            {
                "id": f.get("id"),
                "caption": f.get("vision", {}).get("caption_enhanced") or f.get("caption", ""),
                "finding": f.get("vision", {}).get("key_finding", ""),
            }
            for f in catalog[:16]
        ]
        prompt = (
            "Build a factual paper brief for slide generation. Use only SOURCE_SECTIONS and FIGURES.\n"
            "Do not write generic statements. Preserve concrete method terms, benchmarks, baselines, and measured outcomes.\n"
            "Each evidence item must be a claim that can justify a slide bullet.\n\n"
            "Return JSON only with this schema:\n"
            "{\n"
            '  "central_thesis": "one sentence",\n'
            '  "problem": "specific scientific/computational problem",\n'
            '  "method_mechanism": ["specific mechanism step", "..."],\n'
            '  "benchmarks": ["system/baseline/metric", "..."],\n'
            '  "key_findings": ["finding with comparator or metric", "..."],\n'
            '  "limitations": ["limitation or caveat if stated"],\n'
            '  "takeaway": "final implication",\n'
            '  "evidence_items": [\n'
            '    {"id":"E1","claim":"atomic claim","support":"short source-grounded support","section":"section name","figure_ids":["figure id"]}\n'
            "  ]\n"
            "}\n\n"
            "Quality rules:\n"
            "- Include 10-16 evidence_items.\n"
            "- Include benchmarks/baselines by name when present.\n"
            "- Prefer exact source terms over paraphrased filler.\n"
            "- Do not infer numerical direction unless the source section states it.\n\n"
            f"PAPER_FRAME: {json.dumps(frame or {}, ensure_ascii=False)}\n"
            f"SOURCE_SECTIONS: {json.dumps(source_pack, ensure_ascii=False)}\n"
            f"FIGURES: {json.dumps(figure_pack, ensure_ascii=False)}"
        )
        try:
            brief = self._run_with_progress(
                lambda: _generate_structured_json(llm, prompt, "Paper brief extraction mode.", "paper brief"),
                emit,
                "brief",
                [
                    "Building structured paper brief",
                    "Extracting method mechanism and benchmarks",
                    "Grounding findings to source sections",
                    "Paper brief ready",
                ],
                60,
                68,
            )
        except Exception:
            brief = self._fallback_paper_brief(frame, document_outline)
        if not isinstance(brief, dict):
            brief = self._fallback_paper_brief(frame, document_outline)
        if not isinstance(brief.get("evidence_items"), list) or not brief.get("evidence_items"):
            fallback = self._fallback_paper_brief(frame, document_outline)
            brief["evidence_items"] = fallback.get("evidence_items", [])
        cleaned_evidence = []
        for item in brief.get("evidence_items") or []:
            if not isinstance(item, dict):
                continue
            claim = str(item.get("claim", ""))
            support = str(item.get("support", ""))
            section = str(item.get("section", ""))
            blob = f"{claim} {support}"
            if self._SUSPICIOUS_FIGURE_CLAIM_RE.search(blob):
                continue
            if self._PROMPT_REMNANT_RE.search(claim) or self._PROMPT_REMNANT_RE.search(support):
                continue
            if section.lower() == "figures" and not self._SPECIFICITY_TERMS_RE.search(blob):
                continue
            cleaned_evidence.append(item)
        if cleaned_evidence:
            for idx, item in enumerate(cleaned_evidence, start=1):
                item["id"] = str(item.get("id") or f"E{idx}")
            brief["evidence_items"] = cleaned_evidence[:16]
        return brief

    def _brief_evidence_for_slide(self, paper_brief, orig_slide, limit=6):
        evidence = paper_brief.get("evidence_items") if isinstance(paper_brief, dict) else []
        if not isinstance(evidence, list):
            return []
        query = " ".join(
            str(part or "")
            for part in [
                orig_slide.get("title", ""),
                orig_slide.get("claim", ""),
                " ".join(orig_slide.get("keywords") or []),
                " ".join(orig_slide.get("evidence_ids") or []),
            ]
        )
        query_tokens = {w for w in re.findall(r"[A-Za-z][A-Za-z0-9-]{3,}", query.lower())}
        scored = []
        requested = set(str(item) for item in (orig_slide.get("evidence_ids") or []))
        for idx, item in enumerate(evidence):
            if not isinstance(item, dict):
                continue
            blob = " ".join(str(item.get(key, "")) for key in ("id", "claim", "support", "section"))
            tokens = {w for w in re.findall(r"[A-Za-z][A-Za-z0-9-]{3,}", blob.lower())}
            score = len(query_tokens & tokens) / max(1, min(len(query_tokens), len(tokens))) if query_tokens else 0
            if str(item.get("id")) in requested:
                score += 1.0
            scored.append((score, idx, item))
        scored.sort(key=lambda row: (-row[0], row[1]))
        return [item for score, _, item in scored[:limit] if score > 0 or requested][:limit]

    def _fallback_storyboard(self, frame, catalog, document_outline=None, coarse_context=None, paper_brief=None, reason="", llm=None):
        frame = frame or {}
        paper_brief = paper_brief if isinstance(paper_brief, dict) else {}
        evidence = [item for item in (paper_brief.get("evidence_items") or []) if isinstance(item, dict)]
        available_fig_ids = {str(fig.get("id")) for fig in (catalog or []) if fig.get("id")}

        def clean(value, fallback=""):
            return self._clean_generated_text(value, fallback)

        def evidence_ids(*items):
            ids = []
            for item in items:
                if isinstance(item, dict) and item.get("id"):
                    ids.append(str(item["id"]))
            return ids[:3]

        def figure_ids(*items):
            ids = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                for fid in item.get("figure_ids") or item.get("fig_ids") or []:
                    fid = str(fid)
                    if fid in available_fig_ids and fid not in ids:
                        ids.append(fid)
            return ids[:2]

        slides = []

        problem = clean(paper_brief.get("problem") or frame.get("problem"))
        thesis = clean(paper_brief.get("central_thesis") or frame.get("thesis") or frame.get("core_innovation"))
        if problem or thesis:
            first_ev = evidence[0] if evidence else {}
            slides.append({
                "section": "Setup",
                "title": _truncate_words(problem or thesis, 8),
                "goal": _truncate_words(thesis or problem, 22),
                "evidence_ids": evidence_ids(first_ev),
                "fig_ids": figure_ids(first_ev),
                "layout_hint": "text",
                "context_keywords": ["problem", "motivation"],
            })

        for idx, step in enumerate(paper_brief.get("method_mechanism") or []):
            ev = evidence[min(idx + 1, len(evidence) - 1)] if evidence else {}
            slides.append({
                "section": "Method",
                "title": _truncate_words(step, 8),
                "goal": _truncate_words(step, 20),
                "evidence_ids": evidence_ids(ev),
                "fig_ids": figure_ids(ev),
                "layout_hint": "mechanism",
                "context_keywords": ["method", "mechanism", *re.findall(r"[A-Za-z][A-Za-z0-9-]{3,}", str(step))[:4]],
            })
            if len(slides) >= 5:
                break

        findings = list(paper_brief.get("benchmarks") or []) + list(paper_brief.get("key_findings") or [])
        for idx, finding in enumerate(findings):
            ev = evidence[min(idx + 2, len(evidence) - 1)] if evidence else {}
            slides.append({
                "section": "Insight",
                "title": _truncate_words(finding, 8),
                "goal": _truncate_words(finding, 20),
                "evidence_ids": evidence_ids(ev),
                "fig_ids": figure_ids(ev),
                "layout_hint": "results",
                "context_keywords": ["results", "benchmark", *re.findall(r"[A-Za-z][A-Za-z0-9-]{3,}", str(finding))[:4]],
            })
            if len(slides) >= 9:
                break

        if len(slides) < 6:
            used = {eid for slide in slides for eid in slide.get("evidence_ids", [])}
            for item in evidence:
                item_id = str(item.get("id") or "")
                if item_id in used:
                    continue
                claim = clean(item.get("claim") or item.get("support"))
                if not claim:
                    continue
                section = clean(item.get("section"), "Evidence")
                slides.append({
                    "section": section if len(section.split()) <= 5 else "Evidence",
                    "title": _truncate_words(claim, 8),
                    "goal": _truncate_words(item.get("support") or claim, 20),
                    "evidence_ids": evidence_ids(item),
                    "fig_ids": figure_ids(item),
                    "layout_hint": "figure" if figure_ids(item) else "text",
                    "context_keywords": re.findall(r"[A-Za-z][A-Za-z0-9-]{3,}", f"{claim} {section}")[:6],
                })
                if len(slides) >= 10:
                    break

        if len(slides) < 4:
            for entry in (coarse_context or []):
                heading = clean(entry.get("heading") if isinstance(entry, dict) else "")
                preview = clean(entry.get("preview") if isinstance(entry, dict) else "")
                if not heading and not preview:
                    continue
                slides.append({
                    "section": heading or "Document",
                    "title": _truncate_words(heading or preview, 8),
                    "goal": _truncate_words(preview or heading, 20),
                    "evidence_ids": [],
                    "fig_ids": [],
                    "layout_hint": "text",
                    "context_keywords": re.findall(r"[A-Za-z][A-Za-z0-9-]{3,}", f"{heading} {preview}")[:6],
                })
                if len(slides) >= 6:
                    break

        takeaway = clean(paper_brief.get("takeaway") or frame.get("impact") or frame.get("takeaway"))
        if takeaway:
            slides.append({
                "section": "Impact",
                "title": _truncate_words(takeaway, 8),
                "goal": _truncate_words(takeaway, 20),
                "evidence_ids": evidence_ids(evidence[-1] if evidence else {}),
                "fig_ids": figure_ids(evidence[-1] if evidence else {}),
                "layout_hint": "summary",
                "context_keywords": ["takeaway", "impact"],
            })

        if not slides:
            slides = [{
                "section": "Summary",
                "title": "Source Document",
                "goal": "Needs manual review: source evidence was insufficient.",
                "evidence_ids": [],
                "fig_ids": [],
                "layout_hint": "summary",
                "context_keywords": ["summary"],
            }]

        debug = {
            "fallback": True,
            "reason": _truncate_words(str(reason), 80),
        }
        if llm is not None:
            debug["llm_trace"] = self._llm_trace_snapshot(storyboard=llm)

        return {
            "title": clean(frame.get("title") or paper_brief.get("title") or thesis, "Imported Paper"),
            "sub": clean(thesis or takeaway or problem, ""),
            "slides": slides[:12],
            "_debug": {"storyboard": debug},
        }

    def _plan_storyboard(self, llm, frame, catalog, emit, document_outline=None, coarse_context=None, paper_brief=None):
        emit("storyboard", "Developing scientific narrative storyboard")
        outline_payload = []
        for entry in (document_outline or [])[:28]:
            preview = re.sub(r"\s+", " ", entry.text or "").strip()
            outline_payload.append({
                "heading": entry.normalized_heading or entry.heading,
                "level": entry.level,
                "preview": _truncate_words(preview, 45),
            })
        prompt = (
            "You are designing a high-impact scientific presentation using a hierarchical workflow.\n\n"
            "Step 1: Build the coarse storyline from PAPER_BRIEF and COARSE_CONTEXT.\n"
            "Step 2: Expand that storyline into section-wise slides using DOCUMENT_OUTLINE.\n"
            "Step 3: Attach evidence item ids and figure ids only when directly relevant.\n\n"
            "Create a narrative arc (8–12 slides) that:\n"
            "* starts from problem/motivation\n"
            "* explains method sections in order\n"
            "* elaborates result sections with evidence\n"
            "* ends with implications/takeaway\n\n"
            "Each slide must have:\n"
            "* a **clear claim**\n"
            "* a **role in the story**\n\n"
            "Structure:\n"
            "{\n"
            '  "title": "Talk title (compelling, not generic)",\n'
            '  "sub": "Subtitle (what audience gains)",\n'
            '  "authors": "List of authors (if available)",\n'
            '  "journal_name": "Journal or conference name (if available)",\n'
            '  "publish_date": "Publication date/year (if available)",\n'
            '  "doi": "DOI string (if available)",\n'
            '  "slides": [\n'
            "    {\n"
            '      "section": "Act (Setup / Problem / Method / Insight / Impact)",\n'
            '      "title": "Short, punchy title",\n'
            '      "goal": "What audience learns",\n'
            '      "evidence_ids": ["E1"],\n'
            '      "fig_ids": ["relevant figure ids"],\n'
            '      "layout_hint": "text | figure | results | comparison | mechanism | summary",\n'
            '      "context_keywords": ["keywords"]\n'
            "    }\n"
            "  ]\n"
            "}\n\n"
            "Rules:\n"
            "* Start with a **hook**\n"
            "* Build tension → resolve → insight\n"
            "* Avoid flat structure\n"
            "* Each slide must feel necessary\n\n"
            "Grounding rules:\n"
            "* Use PAPER_BRIEF as the primary content source.\n"
            "* Prefer the supplied document outline for section names and slide topics.\n"
            "* Every content slide should reference one or more evidence_ids.\n"
            "* Vary layout_hint by slide purpose; do not mark every slide as figure.\n"
            "* Do not invent results absent from PAPER_BRIEF or outline previews.\n"
            "* Use figure ids only when the figure caption is directly relevant to the slide role.\n\n"
            "Return JSON only.\n\n"
            f"Paper frame: {json.dumps(frame)}\n"
            f"PAPER_BRIEF: {json.dumps(paper_brief or {}, ensure_ascii=False)}\n"
            f"COARSE_CONTEXT: {json.dumps(coarse_context or [])}\n"
            f"Document outline: {json.dumps(outline_payload)}\n"
            f"Figures: {json.dumps([{'id': f['id'], 'caption': f.get('vision', {}).get('caption_enhanced') or f.get('caption', '')} for f in catalog])}\n"
        )
        try:
            storyboard = _generate_structured_json(llm, prompt, "Storyboarding mode.", "scientific storyboarding")
            slides = storyboard.get("slides") if isinstance(storyboard, dict) else storyboard if isinstance(storyboard, list) else None
            if not isinstance(slides, list) or not slides:
                raise ValueError("storyboard response did not include slides")
            return storyboard
        except Exception as exc:
            emit(
                "storyboard",
                "AI storyboard JSON failed; using deterministic storyboard fallback",
                {
                    "percent": 68,
                    "fallback": True,
                    "error": str(exc)[:600],
                    "llm_trace": self._llm_trace_snapshot(storyboard=llm),
                },
            )
            return self._fallback_storyboard(
                frame,
                catalog,
                document_outline=document_outline,
                coarse_context=coarse_context,
                paper_brief=paper_brief,
                reason=str(exc),
                llm=llm,
            )

    def _generate_slides(self, storyboard, enriched_catalog, full_text, mineru_summary, slide_llm, 
                         json_output, pptx_output, max_slides, max_sections, emit, paper_frame, mineru_context, paper_brief=None, llm_trace=None):
        gen = PPTXGenerator()
        deck_title = self._clean_generated_text(storyboard.get("title"), self._infer_document_title(full_text, paper_frame))
        deck_subtitle = self._clean_generated_text(storyboard.get("sub"), "")
        gen.add_title(deck_title, deck_subtitle)
        export_data = {
            "title": deck_title, 
            "sub": deck_subtitle, 
            "authors": storyboard.get("authors"),
            "journal_name": storyboard.get("journal_name"),
            "publish_date": storyboard.get("publish_date"),
            "doi": storyboard.get("doi"),
            "paper_brief": paper_brief or {},
            "llm_trace": {},
            "slides": []
        }
        if isinstance(storyboard.get("_debug"), dict):
            export_data["import_debug"] = storyboard["_debug"]
        
        sections = []
        current_section = None
        for s_slide in storyboard.get("slides", []):
            s_name = self._clean_generated_text(s_slide.get("section"), "Main")
            if not current_section or current_section["name"] != s_name:
                current_section = {"name": s_name, "slides": []}
                sections.append(current_section)
            current_section["slides"].append({
                "title": self._clean_generated_text(s_slide.get("title"), s_slide.get("goal") or s_name),
                "claim": self._clean_generated_text(s_slide.get("goal"), ""),
                "fig_ids": s_slide.get("fig_ids") or ([s_slide.get("fig_id")] if s_slide.get("fig_id") else []),
                "evidence_ids": s_slide.get("evidence_ids") or ([s_slide.get("evidence_id")] if s_slide.get("evidence_id") else []),
                "layout_hint": self._clean_generated_text(s_slide.get("layout_hint"), ""),
                "keywords": s_slide.get("context_keywords", [])
            })

        if max_sections: sections = sections[:max_sections]
        total_content_slides = 0
        planned_total = sum(len(s["slides"]) for s in sections)
        if max_slides: planned_total = min(planned_total, max_slides)

        candidate_figure_map = {f["id"]: f for f in enriched_catalog}
        generated_sections = []
        slide_mode = self._slide_writing_mode(slide_llm)
        slide_workers = self._slide_generation_workers(slide_llm)
        export_data["generation"] = {
            "slide_writing_mode": slide_mode,
            "slide_workers": slide_workers,
            "api_retries": self._env_int("PPTMAKER_API_RETRIES", 3, minimum=1, maximum=8),
        }
        emit(
            "generation",
            (
                "Writing slide content from source evidence"
                if slide_mode == "fast"
                else f"Writing slide content with {slide_workers} worker{'s' if slide_workers != 1 else ''}"
            ),
            {"slide_writing_mode": slide_mode, "slide_workers": slide_workers, "total": planned_total},
        )

        for s_idx, section in enumerate(sections):
            emit(
                "section",
                f"Elaborating section {s_idx+1}/{len(sections)}: {section['name']}",
                {"current": total_content_slides, "total": planned_total, "slide_writing_mode": slide_mode},
            )

            # Parallel slide generation for speed
            def process_slide(orig_slide):
                keywords = orig_slide.get("keywords", [])
                search_query = " ".join(keywords) if keywords else orig_slide["title"]
                context_chars = self._env_int(
                    "PPTMAKER_FAST_SLIDE_CONTEXT_CHARS" if slide_mode == "fast" else "PPTMAKER_SLIDE_CONTEXT_CHARS",
                    4500 if slide_mode == "fast" else 6500,
                    minimum=1800,
                    maximum=12000,
                )
                snippet_limit = self._env_int(
                    "PPTMAKER_FAST_SLIDE_SNIPPETS" if slide_mode == "fast" else "PPTMAKER_SLIDE_SNIPPETS",
                    6 if slide_mode == "fast" else 8,
                    minimum=3,
                    maximum=12,
                )
                slide_source_text = build_section_context(full_text, search_query, max_chars=context_chars)
                
                requested_fids = orig_slide.get("fig_ids", [])
                ordered_figures = []
                for fid in requested_fids:
                    if fid in candidate_figure_map: ordered_figures.append(_serialize_figure(candidate_figure_map[fid]))
                
                ranked = _rank_figures_for_text(f"{orig_slide['title']} {orig_slide['claim']}", enriched_catalog, limit=4)
                for r in ranked:
                    if r["id"] not in requested_fids: ordered_figures.append(_serialize_figure(r))

                source_snippets = self._source_snippets(slide_source_text, orig_slide, limit=snippet_limit)
                brief_evidence = self._brief_evidence_for_slide(paper_brief or {}, orig_slide, limit=6)
                if not source_snippets:
                    return self._normalize_slide_payload(
                        self._fallback_slide_payload_from_source(orig_slide, source_snippets, ordered_figures),
                        orig_slide,
                    )

                if slide_mode == "fast":
                    res = self._deterministic_review_payload(orig_slide, source_snippets, brief_evidence, ordered_figures)
                    review_issues = self._review_slide_payload(res, orig_slide, source_snippets, brief_evidence)
                    res["review"] = {
                        "issues": review_issues,
                        "status": "fast_source_writer" if not review_issues else "fast_source_writer_needs_review",
                    }
                    return self._normalize_slide_payload(res, orig_slide)

                prompt = (
                    "You are a strict scientific slide editor.\n\n"
                    "Create slide text ONLY from BRIEF_EVIDENCE and numbered SOURCE_SNIPPETS below.\n"
                    "Do not use the vision caption as a source of scientific claims; use figures only to select fig_id.\n"
                    "Every heading and bullet must be grounded in BRIEF_EVIDENCE or SOURCE_SNIPPETS.\n"
                    "If source evidence is weak, write 'Needs manual review: source evidence was insufficient.' as the only bullet.\n\n"
                    "BANNED generic visual prose:\n"
                    "- This diagram illustrates...\n"
                    "- This figure shows...\n"
                    "- The image visualizes...\n"
                    "- sequential process / complex workflow / shown in the figure\n\n"
                    "Style rules:\n"
                    "- One concrete claim per slide, with enough detail to be useful.\n"
                    "- 3-5 bullets total across 1-3 point groups.\n"
                    "- Each bullet <= 14 words.\n"
                    "- Include named systems, baselines, metrics, or mechanism terms when provided.\n"
                    "- Avoid vague bullets like 'faster convergence' unless a comparator is named.\n"
                    "- Choose layout_hint: text, figure, results, comparison, mechanism, or summary.\n"
                    "- Prefer concrete nouns from the source text.\n"
                    "- No filler, no hype, no visual descriptions.\n\n"
                    "Return JSON:\n"
                    "{\n"
                    '  "title": "grounded slide title, <= 9 words",\n'
                    '  "layout_hint": "text | figure | results | comparison | mechanism | summary",\n'
                    '  "fig_id": "best matching figure id (or null)",\n'
                    '  "points": [\n'
                    "    {\n"
                    '      "heading": "claim phrase, <= 5 words",\n'
                    '      "content": ["specific bullet from source", "specific bullet from source"]\n'
                    "    }\n"
                    "  ]\n"
                    "}\n\n"
                    f"Section: {section['name']}\n"  # noqa: B023 - executor.map finishes within this iteration
                    f"Planned slide title: {orig_slide['title']}\n"
                    f"Planned slide claim: {orig_slide['claim']}\n"
                    f"Planned layout hint: {orig_slide.get('layout_hint') or ''}\n"
                    f"FIGURE_OPTIONS: {json.dumps(ordered_figures[:4])}\n"
                    f"BRIEF_EVIDENCE: {json.dumps(brief_evidence, ensure_ascii=False)}\n"
                    f"SOURCE_SNIPPETS: {json.dumps(source_snippets, ensure_ascii=False)}\n\n"
                    "Return only JSON."
                )
                res = _generate_structured_json(slide_llm, prompt, "Write technical slides.", "slide generation")
                issues = self._review_slide_payload(res, orig_slide, source_snippets, brief_evidence)
                review_issues = issues
                if issues and slide_mode == "llm":
                    retry_prompt = (
                        "The previous slide draft failed quality checks: "
                        f"{', '.join(issues)}.\n"
                        "Rewrite it using ONLY BRIEF_EVIDENCE and SOURCE_SNIPPETS. Avoid generic claims. "
                        "Remove unsupported direction/comparison claims, especially figure-only T_FRE or MD-rate claims. "
                        "Use named systems, mechanisms, baselines, or metrics from evidence. "
                        "Return valid JSON only in the same schema.\n\n"
                    f"Planned slide title: {orig_slide['title']}\n"
                    f"Planned slide claim: {orig_slide['claim']}\n"
                    f"Planned layout hint: {orig_slide.get('layout_hint') or ''}\n"
                        f"FIGURE_OPTIONS: {json.dumps(ordered_figures[:4])}\n"
                        f"BRIEF_EVIDENCE: {json.dumps(brief_evidence, ensure_ascii=False)}\n"
                        f"SOURCE_SNIPPETS: {json.dumps(source_snippets, ensure_ascii=False)}"
                    )
                    try:
                        retry = _generate_structured_json(slide_llm, retry_prompt, "Grounded rewrite only.", "slide regeneration")
                        if not self._review_slide_payload(retry, orig_slide, source_snippets, brief_evidence):
                            res = retry
                        else:
                            res = self._deterministic_review_payload(orig_slide, source_snippets, brief_evidence, ordered_figures)
                    except Exception:
                        res = self._deterministic_review_payload(orig_slide, source_snippets, brief_evidence, ordered_figures)
                    review_issues = self._review_slide_payload(res, orig_slide, source_snippets, brief_evidence)
                if isinstance(res, dict):
                    res["review"] = {
                        "issues": review_issues,
                        "status": "passed" if not review_issues else "fallback_or_needs_review",
                    }
                return self._normalize_slide_payload(res, orig_slide)

            with ThreadPoolExecutor(max_workers=slide_workers) as executor:
                slides_to_process = section["slides"]
                if max_slides:
                    remaining = max_slides - total_content_slides
                    if remaining <= 0: break
                    slides_to_process = slides_to_process[:remaining]
                
                generated_slides = list(executor.map(process_slide, slides_to_process))
                generated_sections.append({"name": section["name"], "slides": generated_slides})
                total_content_slides += len(generated_slides)

        flat_generated_slides = [slide for section in generated_sections for slide in section["slides"]]
        assigned = _assign_figures_to_slides(flat_generated_slides, enriched_catalog)

        flat_idx = 0
        for section in generated_sections:
            gen.add_section_slide(section["name"])
            section_summary = next(
                (
                    self._clean_generated_text(slide.get("title") or slide.get("claim"))
                    for slide in section["slides"]
                    if self._clean_generated_text(slide.get("title") or slide.get("claim"))
                ),
                "",
            )
            export_data["slides"].append({"type": "section", "title": section["name"], "summary": section_summary})

            for s_data in section["slides"]:
                fids = assigned.get(flat_idx, [])
                slide_visuals = []
                for fid in fids:
                    fig = candidate_figure_map.get(fid)
                    if fig: slide_visuals.append({"id": fid, "path": fig.get("path"), "caption": fig.get("vision", {}).get("caption_enhanced") or fig.get("caption", "")})
                
                fig_paths = [v["path"] for v in slide_visuals]
                gen.add_content_slide(s_data["title"], s_data.get("points", []), fig_paths=fig_paths)
                export_data["slides"].append({
                    "type": "content", "title": s_data["title"], "points": s_data.get("points", []),
                    "layout_hint": s_data.get("layout_hint"),
                    "review": s_data.get("review", {}),
                    "visual_id": slide_visuals[0]["id"] if slide_visuals else None,
                    "visuals": slide_visuals
                })
                flat_idx += 1

        equations = [eq for eq in (mineru_context.get("equations") or []) if isinstance(eq, dict) and (eq.get("latex") or eq.get("text"))]
        if equations:
            top_equations = equations[:4]
            gen.add_section_slide("Equations")
            export_data["slides"].append({
                "type": "section",
                "title": "Equations",
                "summary": "Reference formulas extracted from the source document",
            })
            equation_points = [
                {
                    "heading": str(eq.get("label") or f"Equation {idx + 1}"),
                    "content": [_truncate_words(str(eq.get("text") or eq.get("latex") or ""), 22)],
                }
                for idx, eq in enumerate(top_equations)
            ]
            gen.add_content_slide("Key Equations", equation_points)
            export_data["slides"].append({
                "type": "content",
                "title": "Key Equations",
                "points": equation_points,
                "equations": [_serialize_equation(eq) for eq in top_equations],
                "equation_slide": True,
            })

        if isinstance(llm_trace, dict):
            export_data["llm_trace"] = self._llm_trace_snapshot(**llm_trace)

        if pptx_output: gen.save(pptx_output)
        with open(json_output, "w", encoding="utf-8") as f: json.dump(export_data, f, indent=2, ensure_ascii=False)
        emit("done", "Conversion complete", {"percent": 100})
        return export_data

def main():
    # Run as `python -m slideforge.bridge.pdf_bridge` (from backend/). The Django apps load .env through their
    # settings; the command-line tool loads it here.
    from dotenv import find_dotenv, load_dotenv

    load_dotenv(find_dotenv(usecwd=True), override=False)
    parser = argparse.ArgumentParser(description="PPTMaker ↔ PDF2PPT Bridge: Convert a PDF into PPTMaker JSON")
    parser.add_argument("-i", "--input", required=True, help="Path to the input PDF")
    parser.add_argument("-o", "--output", default="presentation_export.json", help="Path for the output JSON")
    parser.add_argument("--pptx", default=None, help="Also save a traditional .pptx")
    parser.add_argument("--start", type=int, default=0, help="Start page (0-indexed)")
    parser.add_argument("--end", type=int, default=-1, help="End page (-1 = all)")
    parser.add_argument("--slides", type=int, default=0, help="Cap total content slides (0=unlimited)")
    parser.add_argument("--sections", type=int, default=0, help="Cap sections processed (0=unlimited)")
    parser.add_argument("--json-progress", action="store_true", help="Emit JSON events on stdout")
    parser.add_argument(
        "--allow-remote-llm",
        action="store_true",
        help="Try configured API LLMs first, then fall back to local Ollama for text generation",
    )
    args = parser.parse_args()

    if not args.allow_remote_llm:
        _validate_local_models()
    
    provider = build_provider(allow_remote=args.allow_remote_llm)
    bridge = PDF2PPTxBridge(provider)
    bridge.convert_to_json(
        pdf_path=args.input,
        json_output=args.output,
        pptx_output=args.pptx,
        start=args.start,
        end=args.end,
        max_slides=args.slides,
        max_sections=args.sections,
        json_progress=args.json_progress,
    )

if __name__ == "__main__":
    main()
