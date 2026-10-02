// Commands: load-time listeners and remaining global exports. Must load after the other core/commands/*.js files.

window.addEventListener("beforeunload", () => {
    _sessionObjectUrls.forEach(url => URL.revokeObjectURL(url));
    _sessionObjectUrls.clear();
});

// Toolbar "Transitions": the slide's properties, on the Layout tab where the transition control is.
window.openTransitionsUI = function() {
    if (typeof clearSelection === "function") {
        clearSelection();
    }
    const panel = document.getElementById("properties-panel");
    if (panel?.classList.contains("hidden") && typeof togglePropertiesPanel === "function") {
        togglePropertiesPanel();
    }
    if (typeof _propertiesPanelActiveTab !== "undefined") _propertiesPanelActiveTab = "layout";
    if (typeof buildPropertiesPanel === "function") buildPropertiesPanel();
    requestAnimationFrame(() => {
        const el = document.getElementById("prop-slide-transition");
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus();
        el.style.boxShadow = "0 0 0 2px #4f46e5";
        setTimeout(() => {
            el.style.boxShadow = "";
        }, 2000);
    });
};
