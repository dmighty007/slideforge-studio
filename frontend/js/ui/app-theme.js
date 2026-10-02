// Light or dark editor (the app around the slides; slides keep their own theme). The choice is remembered on this
// computer (light until dark is chosen). index.html applies it before the page is drawn.

const APP_THEME_KEY = "slideforge.appTheme";

function currentAppTheme() {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function setAppTheme(theme, { remember = true } = {}) {
    const dark = theme === "dark";
    if (dark) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    if (remember) {
        try {
            localStorage.setItem(APP_THEME_KEY, dark ? "dark" : "light");
        } catch (_error) {}
    }
    const button = document.getElementById("toggle-app-theme");
    if (button) {
        button.setAttribute("aria-pressed", dark ? "true" : "false");
        button.title = dark ? "Switch to light mode" : "Switch to dark mode";
        button.setAttribute("aria-label", button.title);
        // Rebuilt rather than re-classed: Font Awesome swaps the <i> for an <svg> once it has drawn it.
        button.innerHTML = `<i class="fa-solid ${dark ? "fa-sun" : "fa-moon"} text-sm"></i>`;
    }
}

function toggleAppTheme() {
    setAppTheme(currentAppTheme() === "dark" ? "light" : "dark");
}

document.addEventListener("DOMContentLoaded", () => setAppTheme(currentAppTheme(), { remember: false }));
