export function escapeXml(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

export function escapeAttr(value = "") {
    return escapeXml(value).replaceAll("'", "&#39;");
}

export function styleToString(style = {}) {
    return Object.entries(style)
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([key, value]) => `${key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)}:${value}`)
        .join(";");
}

export function attrsToString(attrs = {}) {
    return Object.entries(attrs)
        .filter(([, value]) => value !== undefined && value !== null && value !== false)
        .map(([key, value]) => (value === true ? key : `${key}="${escapeAttr(value)}"`))
        .join(" ");
}

export function sanitizeSvgFragment(svg = "") {
    const text = String(svg || "").trim();
    if (!text) return "";
    return text
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/\son\w+="[^"]*"/gi, "")
        .replace(/\son\w+='[^']*'/gi, "")
        .replace(/javascript:/gi, "");
}
