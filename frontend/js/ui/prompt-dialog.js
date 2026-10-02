// A small in-app dialog that asks for one piece of text, in place of the browser's window.prompt(): that box
// looked foreign, could not be styled for dark mode, and blocked the page (and any automation) while open.
// sfPrompt({ title, label, value, placeholder, okLabel, multiline, hint }) resolves to the text, or null if cancelled.

let _sfPromptOpen = null;

function sfPrompt({ title = "", label = "", value = "", placeholder = "", okLabel = "OK", multiline = false, hint = "" } = {}) {
    if (_sfPromptOpen) _sfPromptOpen.finish(null);
    return new Promise(resolve => {
        const overlay = document.createElement("div");
        overlay.className = "sf-prompt-overlay";
        overlay.setAttribute("role", "presentation");
        const dialog = document.createElement("div");
        dialog.className = "sf-prompt";
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        const titleId = `sf-prompt-title-${Date.now().toString(36)}`;
        dialog.setAttribute("aria-labelledby", titleId);

        const heading = document.createElement("h3");
        heading.id = titleId;
        heading.className = "sf-prompt__title";
        heading.textContent = title || label;
        dialog.appendChild(heading);

        const field = document.createElement(multiline ? "textarea" : "input");
        field.className = "sf-prompt__field";
        if (!multiline) field.type = "text";
        if (multiline) field.rows = 4;
        field.value = String(value ?? "");
        field.placeholder = placeholder;
        field.setAttribute("aria-label", label || title);
        if (label && title) {
            const fieldLabel = document.createElement("label");
            fieldLabel.className = "sf-prompt__label";
            fieldLabel.textContent = label;
            dialog.appendChild(fieldLabel);
        }
        dialog.appendChild(field);
        if (hint) {
            const hintNode = document.createElement("p");
            hintNode.className = "sf-prompt__hint";
            hintNode.textContent = hint;
            dialog.appendChild(hintNode);
        }

        const actions = document.createElement("div");
        actions.className = "sf-prompt__actions";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "sf-prompt__btn";
        cancel.textContent = "Cancel";
        const ok = document.createElement("button");
        ok.type = "button";
        ok.className = "sf-prompt__btn sf-prompt__btn--primary";
        ok.textContent = okLabel;
        actions.append(cancel, ok);
        dialog.appendChild(actions);
        overlay.appendChild(dialog);

        const previousFocus = document.activeElement;
        const finish = result => {
            if (!overlay.isConnected) return;
            overlay.remove();
            document.removeEventListener("keydown", onKey, true);
            _sfPromptOpen = null;
            previousFocus?.focus?.({ preventScroll: true });
            resolve(result);
        };
        const onKey = event => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                finish(null);
            } else if (event.key === "Enter" && (!multiline || event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                event.stopPropagation();
                finish(field.value);
            } else if (event.key === "Tab") {
                // Keep focus in the dialog.
                const focusable = [field, cancel, ok];
                const index = focusable.indexOf(document.activeElement);
                event.preventDefault();
                focusable[(index + (event.shiftKey ? focusable.length - 1 : 1)) % focusable.length].focus();
            } else {
                // Typing goes to the field, never to the editor's shortcuts underneath.
                event.stopPropagation();
            }
        };
        cancel.addEventListener("click", () => finish(null));
        ok.addEventListener("click", () => finish(field.value));
        overlay.addEventListener("mousedown", event => {
            if (event.target === overlay) finish(null);
        });
        document.addEventListener("keydown", onKey, true);
        document.body.appendChild(overlay);
        _sfPromptOpen = { finish };
        requestAnimationFrame(() => {
            field.focus();
            field.select?.();
        });
    });
}

window.sfPrompt = sfPrompt;
