import logging
import os
import re
import sys
import time
import subprocess
import pymupdf as fitz
from PIL import Image, UnidentifiedImageError


from .standalone_pdf2ppt import PDFProcessor
from .llm_utils import _unload_ollama_models
from .pdf_text_extractor import extract_equations_from_pdf, extract_structured_text

logger = logging.getLogger(__name__)

_MINERU_VISUAL_TYPES = {"image", "figure", "chart", "diagram", "plot", "table", "picture"}
_LOW_SIGNAL_CAPTION_RE = re.compile(
    r"\b(aip publishing|all rights reserved|copyright|journal|publisher|view article online|downloaded from|graphical abstract|table of contents)\b",
    re.I,
)
_MIN_VISUAL_WIDTH = 40
_MIN_VISUAL_HEIGHT = 40
_MIN_VISUAL_AREA = 4000
_FIGURE_CAPTION_RE = re.compile(r"^\*?\*?\s*(fig(?:ure)?|table|scheme|chart)\b", re.I)
_CAPTION_SCAN_RE = re.compile(r"\b(fig(?:ure)?|table|scheme|chart)\s*[\dA-Za-z.-]*\b[:.\s-]*(.{8,260})", re.I | re.S)

class LocalVisionPDFProcessor(PDFProcessor):
    def __init__(self, filepath: str, llm_provider=None, status_callback=None):
        super().__init__(filepath, llm_provider)
        self.status_callback = status_callback
        self.marker_markdown = ""

    def _emit_status(self, event: str, message: str, data: dict | None = None):
        if self.status_callback:
            try:
                self.status_callback(event, message, data)
            except (TypeError, ValueError, AttributeError) as e:
                logger.debug(f"Status callback signature mismatch: {e}")
                try:
                    self.status_callback(event, message)
                except Exception as e:
                    logger.warning(f"Status callback failed: {e}")

    def extract_visuals_hybrid(self):
        if self._use_marker_visuals():
            extracted = self._extract_visuals_marker()
            if not extracted:
                self._emit_status("vision_extract", "Marker found no usable figures; extracting embedded PDF images")
                extracted = self._extract_visuals_embedded()
        else:
            self._emit_status("vision_extract", "Extracting embedded PDF images")
            extracted = self._extract_visuals_embedded()
        self._sync_visual_context(extracted)
        return extracted

    def _use_marker_visuals(self):
        return os.getenv("PPTMAKER_USE_MARKER_VISUALS", "0") == "1"

    def _marker_timeout_seconds(self):
        try:
            return max(30, int(os.getenv("PPTMAKER_MARKER_TIMEOUT_SECONDS", "300")))
        except ValueError:
            return 300

    def _extract_visuals_marker(self):
        base_name = os.path.splitext(os.path.basename(self.filepath))[0]
        marker_out_dir = os.path.join(self.figures_dir, "marker_output")
        md_file = os.path.join(marker_out_dir, base_name, f"{base_name}.md")

        if not os.path.exists(md_file):
            self._emit_status("vision", f"Running Marker layout parsing on {base_name}")
            logger.info(f"Starting Marker layout parsing for PDF: {base_name}")
            _unload_ollama_models()
            time.sleep(5)
            marker_bin = os.path.join(os.path.dirname(sys.executable), "marker_single")
            if not os.path.exists(marker_bin): marker_bin = "marker_single"

            cmd = [marker_bin, self.filepath, "--output_dir", marker_out_dir, "--output_format", "markdown", "--PageExtractor_extraction_page_chunk_size", "1"]
            env = os.environ.copy()
            env["PYTORCH_ALLOC_CONF"] = "expandable_segments:True"
            env.setdefault("OMP_NUM_THREADS", "2")
            env.setdefault("MKL_NUM_THREADS", "2")
            env.setdefault("OPENBLAS_NUM_THREADS", "2")
            env.setdefault("NUMEXPR_NUM_THREADS", "2")
            try:
                subprocess.run(cmd, check=True, env=env, timeout=self._marker_timeout_seconds())
                logger.debug(f"Marker layout parsing succeeded for: {base_name}")
            except subprocess.TimeoutExpired:
                logger.warning(f"Marker layout parsing timed out (>{self._marker_timeout_seconds()}s) for: {base_name}")
                self._emit_status("vision", "Marker timed out; using embedded image extraction")
                return []
            except Exception as e:
                logger.exception(f"Marker layout parsing failed for {base_name}: {e}")
                self._emit_status("vision", "Marker failed; using embedded image extraction")
                return []

        if not os.path.exists(md_file):
            logger.warning(f"Marker output file not found after processing: {md_file}")
            return []
        with open(md_file, "r", encoding="utf-8") as f: self.marker_markdown = f.read()
        logger.debug(f"Loaded marker markdown for {base_name}: {len(self.marker_markdown)} chars")

        extracted = []
        pattern = re.compile(r'!\[(.*?)\]\((.*?\.jpeg|.*?\.png)\)')
        lines = self.marker_markdown.split('\n')
        idx = 0
        while idx < len(lines):
            line = lines[idx]
            match = pattern.search(line)
            if not match:
                idx += 1
                continue

            block = []
            block_start = idx
            while idx < len(lines):
                current_line = lines[idx].strip()
                current = pattern.search(lines[idx])
                if current:
                    block.append((current.group(1).strip(), current.group(2)))
                    idx += 1
                    continue
                if not current_line:
                    idx += 1
                    continue
                break

            caption = self._infer_marker_caption(lines, block_start, idx, block)
            if caption and _LOW_SIGNAL_CAPTION_RE.search(caption):
                continue

            valid_items = []
            for _, img_rel_path in block:
                img_path = os.path.join(marker_out_dir, base_name, img_rel_path)
                if not os.path.exists(img_path):
                    continue
                try:
                    with Image.open(img_path) as img:
                        w, h = img.size
                except Exception:
                    w, h = 1000, 1000
                if w < _MIN_VISUAL_WIDTH or h < _MIN_VISUAL_HEIGHT or (w * h) < _MIN_VISUAL_AREA:
                    continue
                valid_items.append({
                    "rel_path": img_rel_path,
                    "path": img_path,
                    "width": w,
                    "height": h,
                })

            if not valid_items:
                continue

            if len(valid_items) > 1 and caption and _FIGURE_CAPTION_RE.search(caption):
                merged = self._merge_marker_panels(marker_out_dir, base_name, valid_items)
                if merged:
                    extracted.append({
                        "id": merged["id"],
                        "path": merged["path"],
                        "caption": caption,
                        "kind": "image",
                        "page": self._guess_page_from_filename(valid_items[0]["rel_path"]),
                        "width": merged["width"],
                        "height": merged["height"],
                        "panel_count": len(valid_items),
                        "source_paths": [os.path.abspath(item["path"]) for item in valid_items],
                    })
                    continue

            for item in valid_items:
                extracted.append({
                    "id": f"marker_{os.path.splitext(os.path.basename(item['path']))[0]}",
                    "path": os.path.abspath(item["path"]),
                    "caption": caption or f"Extracted visual {item['rel_path']}",
                    "kind": "image",
                    "page": self._guess_page_from_filename(item["rel_path"]),
                    "width": item["width"],
                    "height": item["height"],
                })
        self.visual_catalog = extracted
        return extracted

    def _sync_visual_context(self, extracted):
        self.visual_catalog = extracted or []
        self.mineru_context["visuals"] = [
            {
                "id": item.get("id"),
                "page": item.get("page"),
                "caption": item.get("caption", ""),
                "path": item.get("path"),
                "width": item.get("width"),
                "height": item.get("height"),
                "kind": item.get("kind", "image"),
            }
            for item in self.visual_catalog
        ]
        self.mineru_context["captions"] = [
            item.get("caption", "")
            for item in self.visual_catalog
            if item.get("caption")
        ]

    def _extract_visuals_embedded(self):
        base_name = os.path.splitext(os.path.basename(self.filepath))[0]
        output_dir = os.path.join(self.figures_dir, "embedded_output", base_name)
        os.makedirs(output_dir, exist_ok=True)

        extracted = []
        seen_xrefs = set()
        try:
            doc = fitz.open(self.filepath)
        except (FileNotFoundError, ValueError) as e:
            logger.warning(f"Failed to open PDF {self.filepath}: {e}")
            return []
        except Exception as e:
            logger.exception(f"Unexpected error opening PDF {self.filepath}: {e}")
            return []

        with doc:
            for page_index, page in enumerate(doc):
                page_number = page_index + 1
                image_infos = page.get_images(full=True)
                for image_index, image_info in enumerate(image_infos, start=1):
                    xref = image_info[0]
                    if xref in seen_xrefs:
                        continue
                    rects = page.get_image_rects(xref)
                    if not rects:
                        continue

                    rect = max(rects, key=lambda item: item.width * item.height)
                    if rect.width < _MIN_VISUAL_WIDTH or rect.height < _MIN_VISUAL_HEIGHT or (rect.width * rect.height) < _MIN_VISUAL_AREA:
                        continue

                    try:
                        image_data = doc.extract_image(xref)
                    except (ValueError, RuntimeError) as e:
                        logger.debug(f"Failed to extract image xref {xref}: {e}")
                        continue
                    except Exception as e:
                        logger.warning(f"Unexpected error extracting image xref {xref}: {e}")
                        continue
                    image_bytes = image_data.get("image")
                    if not image_bytes:
                        continue
                    ext = (image_data.get("ext") or "png").lower()
                    if ext == "jpx":
                        ext = "jp2"

                    filename = f"_page_{page_number}_Image_{image_index}.{ext}"
                    image_path = os.path.abspath(os.path.join(output_dir, filename))
                    try:
                        with open(image_path, "wb") as handle:
                            handle.write(image_bytes)
                        with Image.open(image_path) as image:
                            width, height = image.size
                            image.verify()
                    except (IOError, UnidentifiedImageError) as e:
                        logger.warning(f"Failed to verify image {image_path}: {e}")
                        try:
                            os.remove(image_path)
                        except OSError:
                            pass
                        continue
                    except Exception as e:
                        logger.exception(f"Unexpected error processing image {image_path}: {e}")
                        try:
                            os.remove(image_path)
                        except OSError:
                            pass
                        continue

                    if width < _MIN_VISUAL_WIDTH or height < _MIN_VISUAL_HEIGHT or (width * height) < _MIN_VISUAL_AREA:
                        try:
                            os.remove(image_path)
                        except OSError:
                            pass
                        continue

                    caption = self._infer_embedded_caption(page, rect)
                    if caption and _LOW_SIGNAL_CAPTION_RE.search(caption):
                        continue

                    seen_xrefs.add(xref)
                    extracted.append({
                        "id": f"embedded_p{page_number}_{xref}",
                        "path": image_path,
                        "caption": caption or f"Extracted figure from page {page_number}",
                        "kind": "image",
                        "page": page_number,
                        "width": width,
                        "height": height,
                        "source": "embedded_pdf",
                    })

        self.visual_catalog = extracted
        return extracted

    def _infer_embedded_caption(self, page, image_rect):
        candidates = []
        try:
            blocks = page.get_text("blocks") or []
        except Exception:
            return ""

        for block in blocks:
            if len(block) < 5:
                continue
            rect = fitz.Rect(block[:4])
            text = " ".join(str(block[4] or "").split())
            if not text:
                continue
            lower_gap = rect.y0 - image_rect.y1
            upper_gap = image_rect.y0 - rect.y1
            horizontal_overlap = max(0, min(rect.x1, image_rect.x1) - max(rect.x0, image_rect.x0))
            overlap_ratio = horizontal_overlap / max(1.0, min(rect.width, image_rect.width))
            if lower_gap >= -6 and lower_gap <= 140 and overlap_ratio >= 0.25:
                candidates.append((0, abs(lower_gap), text))
            elif upper_gap >= -6 and upper_gap <= 90 and overlap_ratio >= 0.25:
                candidates.append((1, abs(upper_gap), text))

        for _, _, text in sorted(candidates, key=lambda item: item[:2]):
            match = _CAPTION_SCAN_RE.search(text)
            if match:
                caption = text[match.start():].strip()
                return caption[:320]

        return ""

    def _infer_marker_caption(self, lines, block_start, block_end, block):
        inline = next((caption for caption, _ in block if caption), "")
        if inline:
            return inline

        for lookahead in range(block_end, min(len(lines), block_end + 8)):
            candidate = lines[lookahead].strip()
            if not candidate:
                continue
            if re.search(r'!\[.*?\]\((.*?\.jpeg|.*?\.png)\)', candidate):
                break
            if candidate.startswith("#") and lookahead > block_end:
                break
            if _FIGURE_CAPTION_RE.search(candidate):
                return candidate
        return ""

    def _merge_marker_panels(self, marker_out_dir, base_name, items):
        gap = 16
        total_width = sum(item["width"] for item in items) + gap * (len(items) - 1)
        max_height = max(item["height"] for item in items)
        canvas = Image.new("RGB", (total_width, max_height), color=(255, 255, 255))
        x_offset = 0
        for item in items:
            try:
                with Image.open(item["path"]) as img:
                    panel = img.convert("RGB")
                y_offset = max(0, (max_height - panel.height) // 2)
                canvas.paste(panel, (x_offset, y_offset))
                x_offset += panel.width + gap
            except Exception:
                return None

        merged_name = "_merged_" + "_".join(os.path.splitext(os.path.basename(item["path"]))[0] for item in items) + ".jpeg"
        merged_path = os.path.join(marker_out_dir, base_name, merged_name)
        canvas.save(merged_path, format="JPEG", quality=92)
        return {
            "id": f"marker_{os.path.splitext(merged_name)[0]}",
            "path": os.path.abspath(merged_path),
            "width": canvas.width,
            "height": canvas.height,
        }

    def _guess_page_from_filename(self, filename: str) -> int:
        match = re.search(r'page_(\d+)', filename)
        return int(match.group(1)) + 1 if match else 1

    def extract_text(self, start: int = 0, end: int = -1) -> str:
        self.mineru_context["equations"] = extract_equations_from_pdf(self.filepath, start, end)
        structured = extract_structured_text(self.filepath, start, end)
        if len(structured.split()) >= 250:
            return structured
        if self.marker_markdown and len(self.marker_markdown.split()) > len(structured.split()):
            return self.marker_markdown
        plain = super().extract_text(start, end)
        return structured or plain
