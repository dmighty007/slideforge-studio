// Applying style changes to the selected elements.

function applyStyle(prop, value) {
  if (state.selectedIds.length === 0) return;

  saveStateToUndo();

  state.selectedIds.forEach((id) => {
    const data = state.slides[currentSlideIndex].elements.find(
      (e) => e.id === id,
    );
    if (!data) return;

    const dom = document.getElementById(id);
    const contentHost =
      data.type === "text" ? dom?.querySelector(".text-element-content") : null;

    if (
      data.type === "text" &&
      [
        "color",
        "fontSize",
        "fontFamily",
        "fontWeight",
        "fontStyle",
        "textDecoration",
      ].includes(prop)
    ) {
      let nextContent = contentHost?.isContentEditable
        ? contentHost.innerHTML
        : data.content;
      let contentChanged = false;
      if (
        contentHost?.dataset.structuredEdit === "true" &&
        _getStructuredEditorMode(contentHost) === "list"
      ) {
        nextContent = data.content;
      } else {
        nextContent = stripInlineTextStylesFromTextContent(nextContent, [prop]);
        if (contentHost?.isContentEditable) {
          contentHost.innerHTML = nextContent;
          captureInlineSelection();
        }
      }

      if (nextContent !== data.content) {
        const nextTextDocument =
          typeof createTextDocumentFromLegacyContent === "function"
            ? createTextDocumentFromLegacyContent(nextContent, {
                bulletStyle: data.bulletStyle || "default",
              })
            : data.textDocument;
        updateElementState(id, {
          content: nextContent,
          textDocument: nextTextDocument,
        });
        data.content = nextContent;
        data.textDocument = nextTextDocument;
        contentChanged = true;
      }

      if (contentChanged && contentHost && !contentHost.isContentEditable) {
        contentHost.innerHTML = renderTextContent(data);
      }
    }

    updateElementStyleState(id, { [prop]: value });
    markTextElementStyleAsLocal(data, prop);
    if (!dom) return;

    const cssProp = prop.replace(/([A-Z])/g, "-$1").toLowerCase();
    // Force important for text styles to override Reveal.js and theme defaults
    const textProps = [
      "color",
      "fontSize",
      "fontFamily",
      "fontWeight",
      "fontStyle",
      "textDecoration",
      "textAlign",
      "lineHeight",
      "textShadow",
    ];
    const priority = textProps.includes(prop) ? "important" : "";

    _setElementDomStyleProperty(dom, prop, value, priority);

    if (data.type === "text") {
      if (contentHost) {
        _setElementDomStyleProperty(contentHost, prop, value, priority);
        if (
          [
            "color",
            "fontSize",
            "fontFamily",
            "fontWeight",
            "fontStyle",
            "textDecoration",
          ].includes(prop) &&
          contentHost.dataset.structuredEdit !== "true" &&
          !contentHost.isContentEditable
        ) {
          contentHost.innerHTML = renderTextContent(data);
        }
      }
      const layout = syncTextBoxLayout(dom, data);
      if (layout?.autoHeight && Number.isFinite(layout.height)) {
        updateElementState(id, { height: `${layout.height}px` });
        data.height = `${layout.height}px`;
      }
    }
  });

  if (window.refreshPreviews) window.refreshPreviews();
  updateGroupBound();
  schedulePresentationAutosave?.(150);
}

function applyStyleAndRefresh(prop, value) {
  applyStyle(prop, value);
  buildPropertiesPanel();
}
