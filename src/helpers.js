import Toastify from "toastify-js";

export const toast = (text) => {
    Toastify({
        text: text,
        duration: 2000,
        gravity: "bottom",
        position: "right",
    }).showToast();
}

export const toClipboard = (text) => {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);

    toast("Copied to clipboard!");
}

export const parseFontFaces = (cssText) => {
    const fonts = [];
    cssText.replace(/@font-face\s*{[^}]*}/g, (css) => {
        fonts.push({
            url: css.match(/url\(([^)]+)\)/)?.[1],
            name: css.match(/font-family:\s*['"]?([^'";]+)['"]?/)?.[1],
            weight: css.match(/font-weight:\s*['"]?([^'";]+)['"]?/)?.[1],
            style: css.match(/font-style:\s*['"]?([^'";]+)['"]?/)?.[1],
            css: css,
        });
    });
    return fonts;
}

export const outlineShadow = (width, color) => {
    const shadows = [];
    for (let x = -width; x <= width; x++) {
        for (let y = -width; y <= width; y++) {
            shadows.push(`${x}px ${y}px 0 ${color}`);
        }
    }
    return shadows.join(', ');
}

export const serializeState = (state) => encodeURIComponent(JSON.stringify(state));

export const deserializeState = (raw) => {
    // URLSearchParams already percent-decodes, so plain JSON is the normal case
    try {
        return JSON.parse(raw);
    } catch (e) {
        // fall through to the still-encoded form
    }

    try {
        return JSON.parse(decodeURIComponent(raw));
    } catch (e) {
        return null;
    }
}

export const isValidURL = (string) => {
    let url;
    try {
        url = new URL(string);
    } catch (_) {
        return false;
    }
    return url.protocol === "http:" || url.protocol === "https:";
}
