export function stripHtmlToText(html = "") {
    const text = String(html || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"');
    return text
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean)
        .join("\n");
}

export function layoutTextBlock(node = {}) {
    const fontSize = Number.parseFloat(String(node.style?.fontSize || "24").replace("px", "")) || 24;
    const lineHeight = Number.parseFloat(String(node.style?.lineHeight || "")) || 1.2;
    const maxChars = Math.max(4, Math.floor((node.bounds.width || 200) / (fontSize * 0.56)));
    const lines = [];
    stripHtmlToText(node.content || node.text || "")
        .split("\n")
        .forEach(rawLine => {
            const words = rawLine.split(/\s+/).filter(Boolean);
            let current = "";
            words.forEach(word => {
                const next = `${current} ${word}`.trim();
                if (next.length > maxChars && current) {
                    lines.push(current);
                    current = word;
                } else {
                    current = next;
                }
            });
            if (current || !words.length) lines.push(current);
        });
    return {
        fontSize,
        lineHeightPx: fontSize * lineHeight,
        lines: lines.length ? lines : [""],
    };
}
