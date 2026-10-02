// Properties panel: load-time setup and remaining global exports. Must load after the other properties/*.js files.

document.addEventListener("selectionchange", () => {
  if (_selectionSyncTimeout) return;
  _selectionSyncTimeout = setTimeout(() => {
    updateUIFromSelection();
    _selectionSyncTimeout = null;
  }, 100);
});
