// Renderer: load-time listeners. Must load after the other editor/render/*.js files.

window.addEventListener("message", (event) => {
  const message = event.data || {};
  if (message?.type === "pptmaker:molecule:drawn") {
    scheduleMoleculeThumbnail(message.elementId);
    return;
  }
  if (message?.type === "pptmaker:molecule:keydown") {
    replayMoleculeFrameKey(event.source, message);
    return;
  }
  if (message?.type === "pptmaker:molecule:trajectory-rejected") {
    detachRejectedMoleculeTrajectory(event.source, message);
    return;
  }
  if (!message || message.type !== "pptmaker:molecule:view-state-changed")
    return;
  updateMoleculeViewStateInState(message.elementId, message.viewState, {
    autosave: true,
  });
  scheduleMoleculeThumbnail(message.elementId);
});

// A trajectory the viewer could not use (other atoms than the structure): it is detached, so the slide shows the
// structure and the panel offers "Add trajectory" again, and the reason is shown once.
function detachRejectedMoleculeTrajectory(source, message) {
  const frame = [...document.querySelectorAll(".molecule-embed-frame")].find((iframe) => iframe.contentWindow === source);
  const elementId = frame?.closest(".canvas-element")?.id || "";
  if (!elementId || elementId !== message.elementId) return;
  const el = (state.slides || []).flatMap((slide) => slide.elements || []).find((item) => item.id === elementId);
  if (!el?.moleculeTrajectory) return;
  delete el.moleculeTrajectory;
  el.moleculeIsTrajectory = typeof isMoleculeTrajectoryData === "function" ? isMoleculeTrajectoryData(el.content) : false;
  renderSlidesFromState();
  if (typeof buildPropertiesPanel === "function") buildPropertiesPanel();
  schedulePresentationAutosave?.(150);
  if (typeof showNotification === "function") showNotification(String(message.message || "Trajectory not used"), "error");
}

// A key pressed in a molecule viewer while presenting (moleculeEmbed.js): focus comes back to the page, so the next
// keys reach the slideshow directly, and this one is handled as if pressed here (Escape ends the presentation).
function replayMoleculeFrameKey(source, message) {
  if (!document.body.classList.contains("play-mode-active")) return;
  const frame = [...document.querySelectorAll(".molecule-embed-frame")].find((iframe) => iframe.contentWindow === source);
  if (!frame || typeof message.key !== "string") return;
  frame.blur();
  window.focus();
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: message.key,
      ctrlKey: !!message.ctrlKey,
      metaKey: !!message.metaKey,
      shiftKey: !!message.shiftKey,
      altKey: !!message.altKey,
      bubbles: true,
      cancelable: true,
    }),
  );
}

document.addEventListener("visibilitychange", () =>
  requestAnimationFrame(syncActiveSlideMedia),
);

window.addEventListener("focus", () =>
  requestAnimationFrame(syncActiveSlideMedia),
);

window.addEventListener("blur", () =>
  requestAnimationFrame(syncActiveSlideMedia),
);
