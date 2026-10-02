// Properties panel: pushing panel edits into slide DOM (text content, bullets, embeds, fragments).

const PROPERTY_PANEL_REVEAL_FRAGMENT_CLASSES = [
  "fade-in",
  "fade-in-then-out",
  "fade-in-then-semi-out",
  "fade-up",
  "fade-down",
  "fade-left",
  "fade-right",
  "grow",
  "fade-out",
  "shrink",
  "semi-fade-out",
  "highlight-red",
  "highlight-green",
  "highlight-blue",
  "highlight-current-red",
  "highlight-current-green",
  "highlight-current-blue",
  "current-visible",
];

function syncHtmlEmbedDom(data) {
  const dom = document.getElementById(data.id);
  if (!dom) return;

  dom.classList.toggle("html-interactive", Boolean(data.htmlInteractive));
  dom.setAttribute("data-html-mode", normalizeHtmlMode(data));

  const frame = dom.querySelector(".html-embed-frame");
  if (frame) {
    frame.srcdoc = buildHtmlEmbedSrcdoc(data.content || "", data);
    applyHtmlEmbedSandbox(frame);
  }

  const badge = dom.querySelector(".html-embed-badge");
  if (badge) {
    badge.innerText =
      normalizeHtmlMode(data) === "autofit"
        ? "HTML Autofit"
        : "HTML Responsive";
  }
}

function syncPdfEmbedDom(data) {
  // The element on the canvas (its thumbnail copy has the same id).
  const dom = [...document.querySelectorAll(`[id="${data.id}"]`)].find((node) => !node.closest("#slide-previews"));
  if (!dom) return;

  const mode = data.pdfEditorMode || "navigate";
  dom.classList.toggle("pdf-interactive", Boolean(data.pdfInteractive));
  dom.setAttribute("data-pdf-mode", mode);
  // The annotation layer takes the pointer in highlight and note modes. Without this the tools did nothing until
  // something else redrew the slide.
  dom.querySelector(".pdf-annotation-layer")?.classList.toggle("pdf-annotation-layer-active", mode !== "navigate");

  // Reloaded only when the document itself changed: reloading on every mode change jumped back to page 1.
  const frame = dom.querySelector(".pdf-embed-frame");
  const nextSrc = buildPdfEmbedSrc(data.content || "");
  if (frame && frame.getAttribute("src") !== nextSrc) {
    frame.src = nextSrc;
  }

  const badge = dom.querySelector(".pdf-embed-badge");
  if (badge) {
    const mode =
      data.pdfEditorMode === "highlight"
        ? "PDF Highlight"
        : data.pdfEditorMode === "note"
          ? "PDF Note"
          : "PDF Navigate";
    badge.innerText = mode;
  }
}

function syncTextDomContent(data) {
  const dom = document.getElementById(data.id);
  if (!dom) return;
  if (!data.iconMode && typeof ensureElementTextDocument === "function") {
    ensureElementTextDocument(data);
  }
  const contentHost = dom.querySelector(".text-element-content");
  if (contentHost) {
    contentHost.innerHTML = renderTextContent(data);
    const layout = syncTextBoxLayout(dom, data);
    if (layout?.autoHeight && Number.isFinite(layout.height)) {
      updateElementState(data.id, { height: `${layout.height}px` });
      data.height = `${layout.height}px`;
    }
    return;
  }
  dom.innerHTML = renderTextContent(data);
}

function getTextPanelEditableValue(data) {
  if (!data || data.type !== "text") return "";
  if (isStructuredBulletContent(data.content)) {
    return normalizeBulletedListLines(extractPlainLines(data.content)).join(
      "\n",
    );
  }
  const listState = getTextListState(data.content, data.bulletStyle);
  if (listState.kind === "bulleted") {
    return normalizeBulletedListLines(extractPlainLines(data.content)).join(
      "\n",
    );
  }
  return parseTextFromHtml(data.content || "");
}

function buildTextContentFromSidebarValue(data, value) {
  const rawValue = String(value || "").replace(/\r/g, "");
  const lines = rawValue.split("\n");
  const listState = getTextListState(data.content, data.bulletStyle);

  if (isStructuredBulletContent(data.content)) {
    const style = data.bulletStyle || "default";
    const parsedContent =
      typeof parseEditableStructuredText === "function"
        ? parseEditableStructuredText(rawValue, data.content)
        : buildStructuredBulletContent(
            normalizeBulletedListLines(lines),
            style,
          );
    return {
      content: parsedContent,
      bulletStyle: style,
    };
  }

  if (listState.kind === "bulleted") {
    const parsedContent =
      typeof parseEditableStructuredText === "function"
        ? parseEditableStructuredText(rawValue, data.content)
        : buildStructuredBulletContent(
            normalizeBulletedListLines(lines),
            listState.style || "default",
          );
    return {
      content: parsedContent,
      bulletStyle: listState.style || "default",
    };
  }

  if (listState.kind === "numbered") {
    const populatedLines = lines.map((line) => line.trim()).filter(Boolean);
    return {
      content: buildNumberedListMarkup(
        listState.style || "decimal",
        populatedLines.length ? populatedLines : ["List item"],
      ),
      bulletStyle: "",
    };
  }

  const html = lines
    .map((line) => escapeHtml(line))
    .join("<br>")
    .trim();
  return {
    content: html || "Double click to edit text",
    bulletStyle: "",
  };
}

function applySidebarTextContent(data, value) {
  if (!data || data.type !== "text") return;
  const next = buildTextContentFromSidebarValue(data, value);
  const contentChanged =
    JSON.stringify(next.content) !== JSON.stringify(data.content);
  const bulletStyleChanged = next.bulletStyle !== (data.bulletStyle || "");
  if (!contentChanged && !bulletStyleChanged) return;

  const nextTextDocument =
    typeof createTextDocumentFromLegacyContent === "function"
      ? createTextDocumentFromLegacyContent(next.content, {
          bulletStyle: next.bulletStyle || data.bulletStyle || "default",
        })
      : data.textDocument;
  updateElementState(data.id, { ...next, textDocument: nextTextDocument });
  data.content = next.content;
  data.bulletStyle = next.bulletStyle;
  data.textDocument = nextTextDocument;

  const dom = document.getElementById(data.id);
  const contentHost = dom?.querySelector(".text-element-content");
  if (contentHost?.contentEditable === "true") {
    if (isStructuredBulletContent(next.content)) {
      contentHost.dataset.structuredEdit = "true";
      contentHost.dataset.structuredEditMode = "list";
      contentHost.dataset.structuredEditBulletStyle =
        next.bulletStyle || "default";
      if (!contentHost.dataset.structuredEditPreviousTextAlign) {
        contentHost.dataset.structuredEditPreviousTextAlign =
          contentHost.style.textAlign || "";
      }
      contentHost.style.setProperty("text-align", structuredEditTextAlign(data), "important");
      contentHost.innerHTML = buildStructuredBulletEditorHtml(
        next.content,
        next.bulletStyle || "default",
      );
      if (typeof setActiveInlineEditor === "function")
        setActiveInlineEditor(null);
      if (typeof _focusEditableHost === "function")
        _focusEditableHost(contentHost);
    } else {
      delete contentHost.dataset.structuredEdit;
      delete contentHost.dataset.structuredEditMode;
      delete contentHost.dataset.structuredEditBulletStyle;
      const previousTextAlign =
        contentHost.dataset.structuredEditPreviousTextAlign || "";
      delete contentHost.dataset.structuredEditPreviousTextAlign;
      if (previousTextAlign) {
        contentHost.style.setProperty("text-align", previousTextAlign);
      } else {
        contentHost.style.removeProperty("text-align");
      }
      contentHost.innerHTML = renderTextContent(data);
      if (typeof setActiveInlineEditor === "function")
        setActiveInlineEditor(contentHost);
      if (typeof captureInlineSelection === "function")
        captureInlineSelection();
    }
  } else {
    syncTextDomContent(data);
  }

  const layout = dom ? syncTextBoxLayout(dom, data) : null;
  if (layout?.autoHeight && Number.isFinite(layout.height)) {
    updateElementState(data.id, { height: `${layout.height}px` });
    data.height = `${layout.height}px`;
  }
  if (window.refreshPreviews) window.refreshPreviews();
}

function applyTextBulletState(data, nextKind, nextStyle = "default") {
  let nextContent = data.content;
  let nextBulletStyle = data.bulletStyle || "default";

  // Items keep their indent level through every conversion (bullets <-> numbers <-> plain lines).
  const items = extractStyledListItems(data.content);
  if (nextKind === "none") {
    nextContent = items.length
      ? items.map((item) => item.html).join("<br>")
      : data.placeholder
        ? ""
        : "Double click to edit text";
    nextBulletStyle = "";
  } else if (nextKind === "numbered") {
    const numberedStyle = NUMBERED_STYLE_THEMES[nextStyle]
      ? nextStyle
      : "decimal";
    nextContent = buildNumberedListMarkup(numberedStyle, items);
    nextBulletStyle = "";
  } else {
    nextBulletStyle = BULLET_STYLE_THEMES[nextStyle] ? nextStyle : "default";
    if (isStructuredBulletContent(data.content)) {
      nextContent = data.content;
    } else if (items.length) {
      // Typed markers ("- ", "• ") become the bullet rather than staying in the text.
      nextContent = items.map((item) =>
        normalizeStructuredBulletItem({
          html: normalizeBulletedListLines([item.html])[0] ?? item.html,
          level: item.level,
        }),
      );
    } else {
      nextContent = buildStructuredBulletContent([], nextBulletStyle);
    }
  }

  const nextTextDocument =
    typeof createTextDocumentFromLegacyContent === "function"
      ? createTextDocumentFromLegacyContent(nextContent, {
          bulletStyle: nextBulletStyle || "default",
        })
      : data.textDocument;
  updateElementState(data.id, {
    content: nextContent,
    bulletStyle: nextBulletStyle,
    textDocument: nextTextDocument,
  });
  data.content = nextContent;
  data.bulletStyle = nextBulletStyle;
  data.textDocument = nextTextDocument;

  const dom = document.getElementById(data.id);
  const contentHost = dom?.querySelector(".text-element-content");
  const isEditing =
    contentHost &&
    (contentHost.contentEditable === "true" ||
      dom?.classList?.contains("editing-text"));

  if (isEditing) {
    if (isStructuredBulletContent(nextContent)) {
      contentHost.dataset.structuredEdit = "true";
      contentHost.dataset.structuredEditMode = "list";
      contentHost.dataset.structuredEditBulletStyle =
        nextBulletStyle || "default";
      if (!contentHost.dataset.structuredEditPreviousTextAlign) {
        contentHost.dataset.structuredEditPreviousTextAlign =
          contentHost.style.textAlign || "";
      }
      contentHost.style.setProperty("text-align", structuredEditTextAlign(data), "important");
      contentHost.innerHTML = buildStructuredBulletEditorHtml(
        nextContent,
        nextBulletStyle || "default",
      );
      contentHost.contentEditable = "true";
      if (typeof setActiveInlineEditor === "function")
        setActiveInlineEditor(null);
      if (typeof _focusEditableHost === "function")
        _focusEditableHost(contentHost);
    } else {
      delete contentHost.dataset.structuredEdit;
      delete contentHost.dataset.structuredEditMode;
      delete contentHost.dataset.structuredEditBulletStyle;
      const previousTextAlign =
        contentHost.dataset.structuredEditPreviousTextAlign || "";
      delete contentHost.dataset.structuredEditPreviousTextAlign;
      if (previousTextAlign) {
        contentHost.style.setProperty("text-align", previousTextAlign);
      } else {
        contentHost.style.removeProperty("text-align");
      }
      contentHost.innerHTML = renderTextContent(data);
      contentHost.contentEditable = "true";
      if (typeof setActiveInlineEditor === "function")
        setActiveInlineEditor(contentHost);
      contentHost.focus();
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(contentHost);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      if (typeof captureInlineSelection === "function")
        captureInlineSelection();
    }
  } else {
    syncTextDomContent(data);
  }
  const layout = dom ? syncTextBoxLayout(dom, data) : null;
  if (layout?.autoHeight && Number.isFinite(layout.height)) {
    updateElementState(data.id, { height: `${layout.height}px` });
    data.height = `${layout.height}px`;
  }
  requestAnimationFrame(updateFloatingToolbars);
}

function syncFragmentDomState(dom, fragmentAnimation, fragmentIndex) {
  if (!dom) return;

  dom.classList.remove("fragment");
  PROPERTY_PANEL_REVEAL_FRAGMENT_CLASSES.forEach((c) =>
    dom.classList.remove(c),
  );
  dom.removeAttribute("data-fragment-index");

  if (!fragmentAnimation || fragmentAnimation === "none") {
    dom.querySelector(".anim-badge")?.remove();
    return;
  }

  if (document.body.classList.contains("play-mode-active")) {
    dom.classList.add("fragment", fragmentAnimation);
    if (fragmentIndex != null) {
      dom.setAttribute("data-fragment-index", fragmentIndex);
    }
  }

  const badgeText = `<i class="fa-solid fa-wand-sparkles"></i> ${escapeHtml(String(fragmentIndex ?? 0))}`;
  const existingBadge = dom.querySelector(".anim-badge");
  if (existingBadge) {
    existingBadge.innerHTML = badgeText;
  } else {
    const badge = document.createElement("div");
    badge.className = "anim-badge";
    badge.innerHTML = badgeText;
    dom.appendChild(badge);
  }
}

function shiftTextBulletLevels(data, delta) {
  if (!isStructuredBulletContent(data.content)) return;
  const nextContent = data.content.map((item) => ({
    ...item,
    level: Math.max(0, Math.min(8, (Number(item.level) || 0) + delta)),
  }));
  updateElementState(data.id, { content: nextContent });
  data.content = nextContent;
  syncTextDomContent(data);
  requestAnimationFrame(updateFloatingToolbars);
}
