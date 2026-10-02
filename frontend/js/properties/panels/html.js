// Properties panel section for HTML embed elements.

function bindHtmlPanel(data, onCommit) {
  const toggleBtn = document.getElementById("prop-html-toggle");
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      onCommit(() => {
        const next = !data.htmlInteractive;
        updateElementState(data.id, { htmlInteractive: next });
        syncHtmlEmbedDom({ ...data, htmlInteractive: next });
        buildPropertiesPanel();
      });
    };
  }

  const modeField = document.getElementById("prop-html-mode");
  if (modeField) {
    modeField.onchange = (e) => {
      onCommit(() => {
        const nextMode =
          e.target.value === "autofit" ? "autofit" : "responsive";
        updateElementState(data.id, { htmlMode: nextMode });
        syncHtmlEmbedDom({ ...data, htmlMode: nextMode });
        buildPropertiesPanel();
      });
    };
  }
  const fitBtn = document.getElementById("prop-html-fit");
  if (fitBtn) {
    fitBtn.onclick = () => {
      onCommit(() => {
        const { width, height } = getSlideDimensions();
        updateElementState(data.id, {
          x: 0,
          y: 0,
          width: `${width}px`,
          height: `${height}px`,
          htmlMode: "autofit",
        });
        const dom = document.getElementById(data.id);
        if (dom) {
          dom.style.transform = `translate(0px, 0px)`;
          dom.setAttribute("data-x", 0);
          dom.setAttribute("data-y", 0);
          dom.style.width = `${width}px`;
          dom.style.height = `${height}px`;
        }
        syncHtmlEmbedDom({
          ...data,
          x: 0,
          y: 0,
          width: `${width}px`,
          height: `${height}px`,
          htmlMode: "autofit",
        });
        buildPropertiesPanel();
      });
    };
  }
}
