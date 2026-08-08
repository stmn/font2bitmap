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

/**
 * Integer of at least 1, used wherever a zero or negative count would
 * turn a loop into an infinite one
 * @returns {number}
 */
export const positiveInt = (value, fallback = 1) => Math.max(1, parseInt(value) || fallback);

/**
 * Integer forced into the [min, max] range
 * @returns {number}
 */
export const clampInt = (value, min, max, fallback = min) => Math.min(max, Math.max(min, parseInt(value) || fallback));

export const OUTLINE_WIDTH_MIN = 1;
export const OUTLINE_WIDTH_MAX = 4;

/**
 * Outline width is squared into text-shadows, so an unbounded value
 * would generate millions of them
 * @returns {number}
 */
export const clampOutlineWidth = (value) => clampInt(value, OUTLINE_WIDTH_MIN, OUTLINE_WIDTH_MAX);

/**
 * Configuration keys kept in the query string
 */
export const PERSISTED_KEYS = ['perRow', 'gridWidth', 'gridHeight', 'fontSize', 'exportScale', 'characters', 'sampleText', 'fontUrl', 'inputType', 'options', 'colors', 'outlineWidth', 'fontIndex'];

const EXPORT_SCALES = [1, 2, 4];
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

const asInt = (value) => {
    const number = parseInt(value);
    return Number.isNaN(number) ? undefined : number;
};

const asString = (value) => typeof value === 'string' ? value : undefined;

const asOneOf = (allowed) => (value) => allowed.includes(value) ? value : undefined;

const asColor = (value) => value === '' || HEX_COLOR.test(String(value)) ? value : undefined;

/**
 * Merge saved values over the current object, keeping only known keys
 * whose value survives the sanitizer
 */
const mergeSanitized = (saved, current, sanitize) => {
    if (typeof saved !== 'object' || saved === null || typeof current !== 'object' || current === null) {
        return undefined;
    }

    const merged = {...current};
    Object.keys(current).forEach((key) => {
        const value = sanitize(saved[key]);
        if (saved[key] !== undefined && value !== undefined) {
            merged[key] = value;
        }
    });

    return merged;
};

/**
 * URL state is attacker controlled and ends up inside style attributes and a
 * style element, so every restored value has to be validated before it is used
 */
const STATE_SANITIZERS = {
    perRow: (value) => positiveInt(value),
    gridWidth: asInt,
    gridHeight: asInt,
    fontSize: asInt,
    outlineWidth: clampOutlineWidth,
    fontIndex: asInt,
    exportScale: (value) => asOneOf(EXPORT_SCALES)(asInt(value)),
    characters: asString,
    sampleText: asString,
    inputType: asOneOf(['fontUrl', 'file']),
    // href percent-encodes the characters that could break out of a CSS url()
    fontUrl: (value) => isValidURL(value) ? new URL(value).href : undefined,
    options: (value, current) => mergeSanitized(value, current, (option) => Boolean(option)),
    colors: (value, current) => mergeSanitized(value, current, asColor),
};

/**
 * Clean partial state built from an untrusted saved object: unknown keys are
 * dropped and every known key has to survive its sanitizer
 * @param saved parsed query string state, anything at all
 * @param defaults current/default values, used to merge nested objects
 * @returns {Object}
 */
export const sanitizeState = (saved, defaults = {}) => {
    const clean = {};

    if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) {
        return clean;
    }

    PERSISTED_KEYS.forEach((key) => {
        const sanitize = STATE_SANITIZERS[key];
        if (!sanitize || saved[key] === undefined) {
            return;
        }

        const value = sanitize(saved[key], defaults[key]);
        if (value !== undefined) {
            clean[key] = value;
        }
    });

    return clean;
}
