const BULLET_STYLE_THEMES = {
  default: {
    levels: [
      {
        type: "symbol",
        value: "•",
        fontSize: 1.0,
        color: "inherit",
        indent: 0,
      },
      {
        type: "symbol",
        value: "◦",
        fontSize: 0.9,
        color: "inherit",
        indent: 20,
      },
      {
        type: "symbol",
        value: "▪",
        fontSize: 0.85,
        color: "inherit",
        indent: 40,
      },
    ],
  },
  square: {
    levels: [
      {
        type: "symbol",
        value: "■",
        fontSize: 0.9,
        color: "inherit",
        indent: 0,
      },
      {
        type: "symbol",
        value: "□",
        fontSize: 0.9,
        color: "inherit",
        indent: 20,
      },
      {
        type: "symbol",
        value: "▪",
        fontSize: 0.85,
        color: "inherit",
        indent: 40,
      },
    ],
  },
  diamond: {
    levels: [
      {
        type: "symbol",
        value: "◆",
        fontSize: 0.9,
        color: "#f59e0b",
        indent: 0,
      },
      {
        type: "symbol",
        value: "◇",
        fontSize: 0.9,
        color: "inherit",
        indent: 20,
      },
      {
        type: "symbol",
        value: "◈",
        fontSize: 0.85,
        color: "inherit",
        indent: 40,
      },
    ],
  },
  modern: {
    levels: [
      { type: "icon", value: "arrow-right", color: "#60a5fa", indent: 0 },
      { type: "symbol", value: "–", color: "inherit", indent: 20 },
    ],
  },
  chevron: {
    levels: [
      {
        type: "symbol",
        value: "»",
        fontSize: 1.0,
        color: "#38bdf8",
        indent: 0,
      },
      {
        type: "symbol",
        value: "›",
        fontSize: 1.0,
        color: "inherit",
        indent: 20,
      },
      {
        type: "symbol",
        value: "–",
        fontSize: 0.9,
        color: "inherit",
        indent: 40,
      },
    ],
  },
  dash: {
    levels: [
      {
        type: "symbol",
        value: "–",
        fontSize: 1.0,
        color: "inherit",
        indent: 0,
      },
      {
        type: "symbol",
        value: "—",
        fontSize: 1.0,
        color: "inherit",
        indent: 20,
      },
      {
        type: "symbol",
        value: "·",
        fontSize: 1.0,
        color: "inherit",
        indent: 40,
      },
    ],
  },
  checklist: {
    levels: [{ type: "icon", value: "check", color: "#22c55e", indent: 0 }],
  },
  star: {
    levels: [
      {
        type: "symbol",
        value: "✦",
        fontSize: 0.95,
        color: "#f472b6",
        indent: 0,
      },
      {
        type: "symbol",
        value: "✧",
        fontSize: 0.95,
        color: "inherit",
        indent: 20,
      },
      {
        type: "symbol",
        value: "•",
        fontSize: 0.9,
        color: "inherit",
        indent: 40,
      },
    ],
  },
};

const ICON_MAP = {
  "arrow-right": "→",
  check: "✓",
  circle: "●",
  square: "■",
  star: "★",
  diamond: "◆",
  chevron: "»",
};

const NUMBERED_STYLE_THEMES = {
  decimal: "1, 2, 3...",
  "decimal-leading-zero": "01, 02, 03...",
  "lower-roman": "i, ii, iii...",
  "upper-roman": "I, II, III...",
  "lower-alpha": "a, b, c...",
  "upper-alpha": "A, B, C...",
  "lower-greek": "α, β, γ...",
};

const BULLETED_LIST_STYLE_TYPES = {
  default: "disc",
  square: "square",
  diamond: "disc",
  modern: "disc",
  chevron: "disc",
  dash: "disc",
  checklist: "disc",
  star: "disc",
};

function getBulletedListStyleType(style = "default") {
  return BULLETED_LIST_STYLE_TYPES[style] || BULLETED_LIST_STYLE_TYPES.default;
}

function escapeCssString(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

function normalizeStructuredBulletItem(item) {
  const safeItem = item || {};
  const html =
    typeof safeItem.html === "string"
      ? String(safeItem.html || "")
      : typeof safeItem.text === "string"
        ? escapeHtml(String(safeItem.text || ""))
        : "";
  return {
    html:
      typeof sanitizeTextHtml === "function" ? sanitizeTextHtml(html) : html,
    level: Math.max(0, Number(safeItem.level) || 0),
  };
}

function parseStringifiedStructuredBulletContent(content) {
  if (typeof content !== "string") return null;
  const value = content.trim();
  if (!value.startsWith("[") || !value.includes('"level"')) return null;
  try {
    const parsed = JSON.parse(value);
    const isStructuredArray =
      Array.isArray(parsed) &&
      parsed.every(
        (item) =>
          item &&
          (typeof item.text === "string" || typeof item.html === "string") &&
          Number.isFinite(Number(item.level ?? 0)),
      );
    return isStructuredArray ? parsed : null;
  } catch (error) {
    return null;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getLevelStyle(bulletStyle, level) {
  const theme = BULLET_STYLE_THEMES[bulletStyle] || BULLET_STYLE_THEMES.default;
  return (
    theme.levels[Math.min(level, theme.levels.length - 1)] ||
    BULLET_STYLE_THEMES.default.levels[0]
  );
}

function getBulletIndent(level, levelStyle) {
  const themeIndent = Number(levelStyle.indent) || 0;
  const structuralIndent = Math.max(0, Number(level) || 0) * 20;
  return Math.max(themeIndent, structuralIndent);
}

function getBulletGlyph(levelStyle) {
  if (levelStyle.type === "icon") {
    return ICON_MAP[levelStyle.value] || "•";
  }
  return levelStyle.value || "•";
}

function parseTextFromHtml(content) {
  return extractHtmlLines(content).join("\n");
}

// Parse untrusted markup in a document without a browsing context so that
// handlers like <img onerror> never fire while we inspect it.
let _inertHtmlProbeDoc = null;
function _createInertHtmlProbe() {
  if (!_inertHtmlProbeDoc) {
    _inertHtmlProbeDoc = document.implementation.createHTMLDocument("");
  }
  return _inertHtmlProbeDoc.createElement("div");
}

function plainTextFromHtmlSnippet(content) {
  const probe = _createInertHtmlProbe();
  probe.innerHTML = String(content || "");
  return probe.innerText || probe.textContent || "";
}

function extractHtmlLinePayloads(content) {
  const probe = _createInertHtmlProbe();
  probe.innerHTML = String(content || "");
  const lines = [];
  let currentHtml = "";
  const BLOCK_TAGS = new Set([
    "DIV",
    "P",
    "LI",
    "SECTION",
    "ARTICLE",
    "BLOCKQUOTE",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
  ]);

  const flushLine = () => {
    const textOnly = plainTextFromHtmlSnippet(currentHtml)
      .replace(/\u00a0/g, " ")
      .trim();
    if (textOnly) {
      lines.push(currentHtml);
    }
    currentHtml = "";
  };

  Array.from(probe.childNodes || []).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      // The inline editor stores Enter as a newline character, so a newline ends a line too.
      String(node.textContent || "")
        .split(/\r?\n/)
        .forEach((part, index) => {
          if (index > 0) flushLine();
          currentHtml += escapeHtml(part);
        });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName;
    if (node.classList?.contains("ppt-bullet-block")) {
      flushLine();
      Array.from(node.querySelectorAll(".ppt-bullet-row")).forEach((row) => {
        const textNode = row.querySelector(".ppt-bullet-text");
        currentHtml = textNode ? textNode.innerHTML : row.innerHTML;
        flushLine();
      });
      return;
    }

    if (node.classList?.contains("ppt-bullet-row")) {
      flushLine();
      const textNode = node.querySelector(".ppt-bullet-text");
      currentHtml = textNode ? textNode.innerHTML : node.innerHTML;
      flushLine();
      return;
    }

    if (tag === "BR") {
      flushLine();
      return;
    }

    if (tag === "OL" || tag === "UL") {
      flushLine();
      const listItems = _extractStructuredListFromHtml(node);
      listItems.forEach((item) => {
        const indent = " ".repeat(item.level * 2);
        currentHtml = `${indent}${escapeHtml(item.text)}`;
        flushLine();
      });
      return;
    }

    if (BLOCK_TAGS.has(tag)) {
      flushLine();
      currentHtml = node.innerHTML;
      flushLine();
      return;
    }

    currentHtml += node.outerHTML || "";
  });

  flushLine();
  return lines;
}

function _extractStructuredListFromHtml(listElement, baseLevel = 0) {
  const items = [];
  const isOrdered = listElement.tagName === "OL";
  let ordinalCounter = 1;

  Array.from(listElement.children || []).forEach((child) => {
    if (child.tagName !== "LI") return;

    // Extract text content (exclude nested lists)
    let textContent = "";
    Array.from(child.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        textContent += node.textContent;
      } else if (
        node.nodeType === Node.ELEMENT_NODE &&
        node.tagName !== "OL" &&
        node.tagName !== "UL"
      ) {
        textContent += plainTextFromHtmlSnippet(node.innerHTML);
      }
    });

    items.push({
      level: baseLevel,
      text: textContent.trim(),
      ordinal: isOrdered ? ordinalCounter++ : 0,
    });

    // Process nested lists
    const nestedList = child.querySelector("ol, ul");
    if (nestedList) {
      items.push(..._extractStructuredListFromHtml(nestedList, baseLevel + 1));
    }
  });

  return items;
}

function extractHtmlLines(content) {
  return extractHtmlLinePayloads(content)
    .map((line) => {
      return plainTextFromHtmlSnippet(line)
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+/g, " ")
        .trim();
    })
    .filter(Boolean);
}

function isStructuredBulletContent(content) {
  const parsed = parseStringifiedStructuredBulletContent(content);
  if (parsed) return true;
  return (
    Array.isArray(content) &&
    content.every(
      (item) =>
        item &&
        (typeof item.text === "string" || typeof item.html === "string") &&
        Number.isFinite(Number(item.level ?? 0)),
    )
  );
}

function normalizeTextElementContent(content) {
  const parsedStructured = parseStringifiedStructuredBulletContent(content);
  if (parsedStructured) {
    return parsedStructured.map(normalizeStructuredBulletItem);
  }
  if (isStructuredBulletContent(content)) {
    return content.map(normalizeStructuredBulletItem);
  }
  const value =
    typeof content === "string" ? content : "Double click to edit text";
  return typeof sanitizeTextHtml === "function"
    ? sanitizeTextHtml(value)
    : value;
}

function getTextListState(content, bulletStyle = "default") {
  const isBullet = isStructuredBulletContent(content);

  // Check if it's already a structured bullet list
  if (isBullet) {
    return { kind: "bulleted", style: bulletStyle || "default" };
  }

  // Check if it's a native HTML list (e.g. pasted or from old state)
  const str = String(content || "");
  if (str.includes("<ol")) {
    const probe = _createInertHtmlProbe();
    probe.innerHTML = str;
    const ol = probe.querySelector("ol");
    if (ol) {
      return {
        kind: "numbered",
        style: ol.style.listStyleType || "decimal",
      };
    }
  }

  if (str.includes("<ul")) {
    return { kind: "bulleted", style: bulletStyle || "default" };
  }

  // If it's plain text but has bullet-like markers (experimental detection)
  if (str.includes("ppt-bullet-row")) {
    return { kind: "bulleted", style: bulletStyle || "default" };
  }

  return { kind: "none", style: "" };
}

function extractPlainLines(content) {
  if (isStructuredBulletContent(content)) {
    return content
      .map((item) =>
        parseTextFromHtml(normalizeStructuredBulletItem(item).html),
      )
      .filter(Boolean);
  }

  return extractHtmlLines(content);
}

function extractStyledLines(content) {
  if (isStructuredBulletContent(content)) {
    return content
      .map((item) => normalizeStructuredBulletItem(item).html)
      .filter((line) => parseTextFromHtml(line).trim());
  }
  return extractHtmlLinePayloads(content);
}

function buildStructuredBulletContent(lines, bulletStyle = "default") {
  const normalized =
    typeof normalizeBulletedListLines === "function"
      ? normalizeBulletedListLines(lines)
      : lines;
  const safeLines =
    Array.isArray(normalized) && normalized.length ? normalized : [""];
  return safeLines.map((line) =>
    normalizeStructuredBulletItem({
      html: String(line || "").trim(),
      level: 0,
    }),
  );
}

function stripInlineColorFromHtml(html) {
  return stripInlineTextStylesFromHtml(html, ["color"]);
}

function stripInlineTextStylesFromHtml(html, props = []) {
  const removeAll =
    props === true ||
    props === "all" ||
    (Array.isArray(props) && props.includes("all"));
  const propSet = new Set(Array.isArray(props) ? props : []);
  const probe = _createInertHtmlProbe();
  probe.innerHTML = String(html || "");

  Array.from(probe.querySelectorAll("*")).forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    if (removeAll) {
      node.removeAttribute("style");
      node.removeAttribute("class");
    } else {
      if (propSet.has("color")) node.style.removeProperty("color");
      if (propSet.has("fontFamily")) node.style.removeProperty("font-family");
      if (propSet.has("fontSize")) node.style.removeProperty("font-size");
      if (propSet.has("fontWeight")) node.style.removeProperty("font-weight");
      if (propSet.has("fontStyle")) node.style.removeProperty("font-style");
      if (propSet.has("textDecoration")) {
        node.style.removeProperty("text-decoration");
        node.style.removeProperty("text-decoration-line");
      }
    }
    if (node.tagName === "FONT") {
      if (removeAll || propSet.has("color")) node.removeAttribute("color");
      if (removeAll || propSet.has("fontFamily")) node.removeAttribute("face");
      if (removeAll || propSet.has("fontSize")) node.removeAttribute("size");
    }
    if (!node.getAttribute("style") || !node.getAttribute("style").trim()) {
      node.removeAttribute("style");
    }
  });

  Array.from(probe.querySelectorAll("span"))
    .reverse()
    .forEach((node) => {
      if (node.attributes.length === 0) {
        node.replaceWith(...Array.from(node.childNodes));
      }
    });

  return probe.innerHTML;
}

function stripInlineColorFromTextContent(content) {
  return stripInlineTextStylesFromTextContent(content, ["color"]);
}

function stripInlineTextStylesFromTextContent(content, props = []) {
  if (isStructuredBulletContent(content)) {
    return content.map((rawItem) => {
      const item = normalizeStructuredBulletItem(rawItem);
      return normalizeStructuredBulletItem({
        ...item,
        html: stripInlineTextStylesFromHtml(item.html, props),
      });
    });
  }

  return stripInlineTextStylesFromHtml(content, props);
}

function stripAllInlineTextFormattingFromHtml(html) {
  const probe = _createInertHtmlProbe();
  probe.innerHTML = stripInlineTextStylesFromHtml(html, "all");
  Array.from(probe.querySelectorAll("b,strong,i,em,u,s,sub,sup,font"))
    .reverse()
    .forEach((node) => {
      node.replaceWith(...Array.from(node.childNodes));
    });
  return probe.innerHTML;
}

function stripAllInlineTextFormattingFromTextContent(content) {
  if (isStructuredBulletContent(content)) {
    return content.map((rawItem) => {
      const item = normalizeStructuredBulletItem(rawItem);
      return normalizeStructuredBulletItem({
        ...item,
        html: stripAllInlineTextFormattingFromHtml(item.html),
      });
    });
  }
  return stripAllInlineTextFormattingFromHtml(content);
}

// Lines are strings (level 0) or { html, level } items; deeper levels become nested lists, so indentation survives.
function buildNumberedListMarkup(style, lines) {
  const items = (Array.isArray(lines) && lines.length ? lines : [""]).map(
    (line) => {
      const isItem = line && typeof line === "object";
      const raw = String((isItem ? line.html : line) || "").trim();
      return {
        html: /<[^>]+>/.test(raw) ? raw : escapeHtml(raw),
        level: isItem ? Math.max(0, Number(line.level) || 0) : 0,
      };
    },
  );
  const listStyle = `list-style-type:${style || "decimal"};margin:0;padding-left:1.5em;line-height:inherit;`;
  const itemStyle = "margin:0;padding:0;line-height:inherit;";
  let html = `<ol class="ppt-numbered-block" style="${listStyle}width:100%;text-align:inherit;">`;
  let depth = 0;
  items.forEach((item, index) => {
    const level = Math.min(item.level, depth + 1);
    if (index > 0 && level > depth) {
      html += `<ol style="${listStyle}">`;
    } else {
      if (index > 0) html += "</li>";
      for (; depth > level; depth--) html += "</ol></li>";
    }
    depth = level;
    html += `<li style="${itemStyle}">${item.html}`;
  });
  html += "</li>";
  for (; depth > 0; depth--) html += "</ol></li>";
  return `${html}</ol>`;
}

// The items of any text content as { html, level }: structured bullets, HTML lists (nesting gives the level) or lines.
function extractStyledListItems(content) {
  if (isStructuredBulletContent(content)) {
    return content
      .map((item) => normalizeStructuredBulletItem(item))
      .filter((item) => parseTextFromHtml(item.html).trim());
  }
  const str = String(content || "");
  if (/<(ol|ul)[\s>]/i.test(str)) {
    const probe = _createInertHtmlProbe();
    probe.innerHTML = str;
    const list = probe.querySelector("ol, ul");
    if (list && !plainTextFromHtmlSnippet(str.replace(list.outerHTML, "")).trim()) {
      const items = [];
      const walk = (listElement, level) => {
        Array.from(listElement.children).forEach((li) => {
          if (li.tagName !== "LI") return;
          const clone = li.cloneNode(true);
          clone.querySelectorAll("ol, ul").forEach((nested) => nested.remove());
          if (plainTextFromHtmlSnippet(clone.innerHTML).trim()) {
            items.push({ html: clone.innerHTML.trim(), level });
          }
          li.querySelectorAll(":scope > ol, :scope > ul").forEach((nested) =>
            walk(nested, level + 1),
          );
        });
      };
      walk(list, 0);
      return items;
    }
  }
  return extractHtmlLinePayloads(content).map((html) => ({ html, level: 0 }));
}

function buildBulletedListMarkup(style, lines) {
  const safeStyle = BULLET_STYLE_THEMES[style] ? style : "default";
  const levelStyle = getLevelStyle(safeStyle, 0);
  const marker = getBulletGlyph(levelStyle);
  const markerColor = levelStyle.color || "currentColor";
  const markerScale = Number(levelStyle.fontSize) || 1;
  const normalizedLines = normalizeBulletedListLines(lines);
  const safeLines = (
    normalizedLines.length ? normalizedLines : ["List item"]
  ).map((line) => {
    const raw = String(line || "").trim();
    if (!raw) return "List item";
    return /<[^>]+>/.test(raw) ? raw : escapeHtml(raw);
  });
  return `<ul class="ppt-bulleted-block" data-bullet-style="${escapeHtml(safeStyle)}" style="--bullet-marker:'${escapeCssString(marker)}';--bullet-color:${markerColor};--bullet-font-scale:${markerScale};">${safeLines.map((line) => `<li class="ppt-bulleted-item">${line}</li>`).join("")}</ul>`;
}

function applyTextNumberedState(elData, style = "decimal") {
  elData.content = buildNumberedListMarkup(style, extractStyledListItems(elData.content));
  elData.bulletStyle = ""; // Clear bullet style if switching to numbered
  invalidateTextDocument(elData);
}

function invalidateTextDocument(elData) {
  if (!elData || typeof elData !== "object") return;
  delete elData.textDocument;
  delete elData._textDocumentSourceContent;
}

function getSafeIconHtml(elData) {
  const raw = String(elData?.iconClass || elData?.content || "");
  const classMatch =
    raw.match(/class\s*=\s*["']([^"']+)["']/i) ||
    raw.match(/class\s*=\s*&quot;([^&]+)&quot;/i);
  const classSource = classMatch ? classMatch[1] : raw;
  const safeClasses = classSource
    .split(/\s+/)
    .map((cls) => cls.trim())
    .filter((cls) => /^fa-/.test(cls) || /^fa[srltdbk]?$/.test(cls));
  const iconClass = safeClasses.length
    ? safeClasses.join(" ")
    : "fa-solid fa-icons";
  return `<i class="${iconClass}"></i>`;
}

function renderTextContent(elData) {
  if (elData?.iconMode) {
    return getSafeIconHtml(elData);
  }

  if (
    elData?.textDocument &&
    typeof renderSemanticTextDocumentToHtml === "function"
  ) {
    return renderSemanticTextDocumentToHtml(elData.textDocument, {
      bulletStyle: elData.bulletStyle || "default",
    });
  }

  if (elData?.textDocument && Array.isArray(elData.textDocument.blocks)) {
    const blocks = elData.textDocument.blocks;
    const bulletStyle = elData.bulletStyle || "default";
    let listHtml = "";
    const flushList = () => {
      if (!listHtml) return "";
      const wrapped = `<div class="ppt-bullet-block" data-bullet-style="${escapeHtml(bulletStyle)}">${listHtml}</div>`;
      listHtml = "";
      return wrapped;
    };

    const html = blocks
      .map((block) => {
        const children = Array.isArray(block?.children) ? block.children : [];
        const inner =
          typeof renderSemanticTextRunsToHtml === "function"
            ? renderSemanticTextRunsToHtml(children)
            : children
                .map((run) =>
                  escapeHtml(run?.text || run?.altText || run?.latex || ""),
                )
                .join("") || "<br>";
        if (block?.type === "listItem") {
          const level = Math.max(0, Number(block?.list?.level) || 0);
          const kind = block?.list?.kind === "numbered" ? "numbered" : "bullet";
          const levelStyle = getLevelStyle(bulletStyle, level);
          const glyph =
            kind === "numbered"
              ? escapeHtml(`${Number(block?.list?.ordinal) || 1}.`)
              : escapeHtml(getBulletGlyph(levelStyle));
          const color = levelStyle.color || "inherit";
          const fontSizeScale =
            kind === "numbered" ? 1 : Number(levelStyle.fontSize) || 1;
          const indent = getBulletIndent(level, levelStyle);
          listHtml += `
                        <div class="ppt-bullet-row" data-list-kind="${kind}" style="--bullet-indent:${indent}px;--bullet-color:${color};--bullet-font-scale:${fontSizeScale};">
                            <span class="ppt-bullet-marker">${glyph}</span>
                            <span class="ppt-bullet-text">${inner || "<br>"}</span>
                        </div>
                    `;
          return "";
        }
        const flushed = flushList();
        if (block?.type === "heading") {
          const headingLevel = Math.max(
            1,
            Math.min(6, Number(block.level) || 1),
          );
          return `${flushed}<h${headingLevel}>${inner || "<br>"}</h${headingLevel}>`;
        }
        return `${flushed}${inner || "<br>"}`;
      })
      .join("");

    return `${html}${flushList()}`;
  }

  if (!isStructuredBulletContent(elData.content)) {
    return typeof sanitizeTextHtml === "function"
      ? sanitizeTextHtml(elData.content || "")
      : String(elData.content || "");
  }

  const bulletStyle = elData.bulletStyle || "default";
  const rows = elData.content
    .map((rawItem) => {
      const item = normalizeStructuredBulletItem(rawItem);
      const html = item.html;
      const text = parseTextFromHtml(html);
      if (!text.trim()) {
        return `<div class="ppt-bullet-spacer"></div>`;
      }
      const level = item.level;
      const levelStyle = getLevelStyle(bulletStyle, level);
      const glyph = escapeHtml(getBulletGlyph(levelStyle));
      const color = levelStyle.color || "inherit";
      const fontSizeScale = Number(levelStyle.fontSize) || 1;
      const indent = getBulletIndent(level, levelStyle);
      return `
                <div class="ppt-bullet-row" data-list-kind="bullet" style="--bullet-indent:${indent}px;--bullet-color:${color};--bullet-font-scale:${fontSizeScale};">
                    <span class="ppt-bullet-marker">${glyph}</span>
                    <span class="ppt-bullet-text">${html || escapeHtml(text)}</span>
                </div>
            `;
    })
    .join("");

  return `<div class="ppt-bullet-block" data-bullet-style="${escapeHtml(bulletStyle)}">${rows}</div>`;
}

const EDITABLE_BULLET_MARKERS = Array.from(
  new Set(
    Object.values(BULLET_STYLE_THEMES)
      .flatMap((theme) =>
        (theme.levels || []).map((levelStyle) => getBulletGlyph(levelStyle)),
      )
      .concat([
        "•",
        "◦",
        "▪",
        "■",
        "□",
        "◆",
        "◇",
        "◈",
        "»",
        "›",
        "–",
        "—",
        "·",
        "✦",
        "✧",
        "✓",
        "→",
      ]),
  ),
).sort((a, b) => String(b).length - String(a).length);

function getEditableBulletPrefix(level, bulletStyle = "default") {
  const safeLevel = Math.max(0, Number(level) || 0);
  const marker = getBulletGlyph(getLevelStyle(bulletStyle, safeLevel));
  return `${"  ".repeat(safeLevel)}${marker} `;
}

function getBulletLevelMeta(level, bulletStyle = "default") {
  const safeLevel = Math.max(0, Number(level) || 0);
  const levelStyle = getLevelStyle(bulletStyle, safeLevel);
  return {
    level: safeLevel,
    marker: getBulletGlyph(levelStyle),
    indent: getBulletIndent(safeLevel, levelStyle),
  };
}

function stripEditableBulletPrefix(rawLine) {
  const raw = String(rawLine || "").replace(/\r/g, "");
  const leading = raw.match(/^[\t ]*/)?.[0] || "";
  const tabCount = (leading.match(/\t/g) || []).length;
  const spaceCount = leading.replace(/\t/g, "").length;
  const level = Math.max(0, tabCount + Math.floor(spaceCount / 2));
  let text = raw.slice(leading.length);

  for (const marker of EDITABLE_BULLET_MARKERS) {
    if (text === marker) {
      text = "";
      break;
    }
    if (
      text.startsWith(marker) &&
      /^\s/.test(text.slice(marker.length, marker.length + 1))
    ) {
      text = text.slice(marker.length).replace(/^[\t ]+/, "");
      break;
    }
  }

  return { level, text };
}

function normalizeBulletedListLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => {
      const raw = String(line || "").trim();
      if (!raw) return "";
      if (/<[^>]+>/.test(raw)) {
        const plain = plainTextFromHtmlSnippet(raw)
          .replace(/\u00a0/g, " ")
          .trim();
        const parsedPlain = stripEditableBulletPrefix(plain);
        if (!parsedPlain.text.trim()) return "";

        const probe = _createInertHtmlProbe();
        probe.innerHTML = raw;
        // Only text that starts the line can hold a typed marker ("- ", "• "); text after a styled span
        // keeps its leading space.
        const firstNode = Array.from(probe.childNodes).find(
          (node) => node.nodeType !== Node.TEXT_NODE || node.textContent.trim(),
        );
        const firstText = firstNode?.nodeType === Node.TEXT_NODE ? firstNode : null;
        if (firstText) {
          firstText.textContent = stripEditableBulletPrefix(
            firstText.textContent,
          ).text;
          return probe.innerHTML.trim();
        }
        return raw; // starts with formatted text: keep the formatting
      }
      return stripEditableBulletPrefix(raw).text.trim();
    })
    .filter(Boolean);
}

function structuredContentToEditableText(content, bulletStyle = "default") {
  if (!isStructuredBulletContent(content)) {
    return parseTextFromHtml(content);
  }

  return content
    .map((rawItem) => {
      const item = normalizeStructuredBulletItem(rawItem);
      const level = item.level;
      const plainText = parseTextFromHtml(item.html);
      if (!plainText.trim()) {
        return "";
      }
      return `${getEditableBulletPrefix(level, bulletStyle)}${plainText}`;
    })
    .filter((line, i, arr) => line !== "" || i < arr.length - 1)
    .join("\n");
}

function parseEditableStructuredText(value, previousContent = []) {
  const lines = String(value || "")
    .split("\n")
    .map((raw) => raw.replace(/\r/g, ""));

  const preservedHtmlByKey = new Map();
  if (Array.isArray(previousContent)) {
    previousContent.forEach((rawItem) => {
      const item = normalizeStructuredBulletItem(rawItem);
      const plainText = parseTextFromHtml(item.html);
      const key = `${item.level}::${plainText}`;
      if (!preservedHtmlByKey.has(key)) preservedHtmlByKey.set(key, []);
      preservedHtmlByKey.get(key).push(item.html);
    });
  }

  const result = lines.map((raw) => {
    const parsed = stripEditableBulletPrefix(raw);
    const normalizedText = String(parsed.text || "");
    const key = `${parsed.level}::${normalizedText}`;
    const preservedHtml = preservedHtmlByKey.has(key)
      ? preservedHtmlByKey.get(key).shift()
      : null;
    return normalizeStructuredBulletItem({
      html: preservedHtml ?? escapeHtml(normalizedText),
      level: parsed.level,
    });
  });

  // Remove empty trailing items generated by accidental trailing newlines
  while (
    result.length > 1 &&
    !parseTextFromHtml(result[result.length - 1].html).trim()
  ) {
    result.pop();
  }

  if (result.length === 0) {
    return [normalizeStructuredBulletItem({ html: "", level: 0 })];
  }

  return result;
}

// Alignment for a bulleted list while it is edited: the box's own, except justify (which reads as left).
function structuredEditTextAlign(data) {
  const align = data?.styles?.textAlign;
  return align === "center" || align === "right" ? align : "left";
}

function buildStructuredBulletEditorHtml(content, bulletStyle = "default") {
  const parsedStructured = parseStringifiedStructuredBulletContent(content);
  if (parsedStructured) content = parsedStructured;
  if (!isStructuredBulletContent(content)) {
    const value = String(content || "");
    return typeof sanitizeTextHtml === "function"
      ? sanitizeTextHtml(value)
      : value;
  }

  const rows = content
    .map((rawItem) => {
      const item = normalizeStructuredBulletItem(rawItem);
      const meta = getBulletLevelMeta(item.level, bulletStyle);
      const levelStyle = getLevelStyle(bulletStyle, item.level);
      const color = levelStyle.color || "inherit";
      const fontScale = Number(levelStyle.fontSize) || 1;
      const innerHtml = item.html && item.html.trim() ? item.html : "<br>";
      return `<li class="ppt-bullet-edit-item" data-level="${meta.level}" data-marker="${escapeHtml(meta.marker)}" style="--bullet-indent:${meta.indent}px;--bullet-color:${color};--bullet-font-scale:${fontScale};">${innerHtml}</li>`;
    })
    .join("");

  return `<ul class="ppt-bullet-edit-list" data-bullet-style="${escapeHtml(bulletStyle)}">${rows || '<li class="ppt-bullet-edit-item" data-level="0" data-marker="•" style="--bullet-indent:0px;"><br></li>'}</ul>`;
}

function parseStructuredBulletEditorHtml(host, options = {}) {
  if (!host) return [normalizeStructuredBulletItem({ html: "", level: 0 })];
  const preserveTrailingEmpty = Boolean(options.preserveTrailingEmpty);
  const items = Array.from(host.querySelectorAll(".ppt-bullet-edit-item")).map(
    (item) =>
      normalizeStructuredBulletItem({
        html: item.innerHTML === "<br>" ? "" : item.innerHTML,
        level: Number(item.dataset.level) || 0,
      }),
  );

  while (
    !preserveTrailingEmpty &&
    items.length > 1 &&
    !plainTextFromHtmlSnippet(items[items.length - 1].html).trim()
  ) {
    items.pop();
  }

  return items.length
    ? items
    : [normalizeStructuredBulletItem({ html: "", level: 0 })];
}
