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

/**
 * Codepoints that a font may map but that can never be drawn as a glyph on the
 * grid: controls, formatting marks, surrogate halves and noncharacters
 */
const NON_PRINTABLE_RANGES = [
    [0x0000, 0x001f], // C0 controls
    [0x007f, 0x009f], // delete and C1 controls
    [0x00ad, 0x00ad], // soft hyphen
    [0x0600, 0x0605], // arabic number signs
    [0x061c, 0x061c], // arabic letter mark
    [0x180e, 0x180e], // mongolian vowel separator
    [0x200b, 0x200f], // zero width characters and bidi marks
    [0x2028, 0x202e], // line and paragraph separators, bidi overrides
    [0x2060, 0x206f], // word joiner, invisible operators, deprecated formats
    [0xd800, 0xdfff], // surrogate halves, not characters on their own
    [0xfdd0, 0xfdef], // noncharacters
    [0xfe00, 0xfe0f], // variation selectors
    [0xfeff, 0xfeff], // byte order mark
    [0xfff9, 0xfffb], // interlinear annotation
    [0xe0000, 0xe007f], // tags
    [0xe0100, 0xe01ef], // variation selectors supplement
];

const MAX_CODEPOINT = 0x10ffff;

const isPrintableCodepoint = (codepoint) => {
    if (!Number.isInteger(codepoint) || codepoint < 0 || codepoint > MAX_CODEPOINT) {
        return false;
    }

    // every plane ends with two noncharacters
    if ((codepoint & 0xfffe) === 0xfffe) {
        return false;
    }

    return !NON_PRINTABLE_RANGES.some(([from, to]) => codepoint >= from && codepoint <= to);
}

/**
 * Turn the codepoints of a font cmap into a character set for the grid:
 * unique, printable, ascending
 * @param codepoints iterable of numbers, in any order
 * @returns {string}
 */
export const codepointsToCharacters = (codepoints) => [...new Set(codepoints ?? [])]
    .filter(isPrintableCodepoint)
    .sort((a, b) => a - b)
    .map((codepoint) => String.fromCodePoint(codepoint))
    .join('');

/**
 * Past this many characters the grid and the exports get slow enough
 * that the user deserves a warning
 */
export const SLOW_CHARACTERS = 2000;

/**
 * What to tell the user after reading a font. Counted by codepoint, so a glyph
 * made of a surrogate pair counts once
 * @param characters the character set just loaded
 * @returns {string}
 */
export const glyphsLoadedMessage = (characters) => {
    const glyphs = Array.from(characters).length;

    return glyphs > SLOW_CHARACTERS
        ? `${glyphs} glyphs loaded, exporting will be slow!`
        : `${glyphs} glyphs loaded!`;
}

/**
 * Every codepoint the font binary maps, read from its cmap.
 * fontkit is imported lazily: it is bigger than the whole app and only needed
 * when this runs. Its browser build carries the brotli decoder woff2 needs
 * @param url font binary, http(s) or a blob: URL of an uploaded file
 * @returns {Promise<number[]>}
 */
export const loadFontCodepoints = async (url) => {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Font request failed with ${response.status}`);
    }

    const {create} = await import('fontkit');
    const font = create(new Uint8Array(await response.arrayBuffer()));

    // a collection (ttc/otc) has no cmap of its own, so read the first face
    return [...(font.characterSet ?? font.fonts?.[0]?.characterSet ?? [])];
}

export const serializeState = (state) => encodeURIComponent(JSON.stringify(state));

export const STATE_STORAGE_KEY = 'font2bitmap:state';

/**
 * The query string is not ours to keep when the tool is embedded in an iframe,
 * so the state is mirrored into localStorage. Access to it throws outright in a
 * sandboxed frame, which is no reason to lose the app
 * @returns {string|null} raw JSON, for the same deserializeState the URL uses
 */
export const readStoredState = () => {
    try {
        return window.localStorage.getItem(STATE_STORAGE_KEY);
    } catch (e) {
        return null;
    }
}

export const writeStoredState = (state) => {
    try {
        window.localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        // storage denied or full, the query string still carries the state
    }
}

export const FONT_DB_NAME = 'font2bitmap';
const FONT_STORE_NAME = 'files';
const FONT_RECORD_KEY = 'lastFont';

/**
 * Uploaded fonts bigger than this are not kept: the browser would likely
 * refuse the quota anyway, and a restore of that size is not worth the wait
 */
export const MAX_STORED_FONT_BYTES = 20 * 1024 * 1024;

const openFontDb = () => new Promise((resolve, reject) => {
    const request = window.indexedDB.open(FONT_DB_NAME, 1);

    request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(FONT_STORE_NAME)) {
            db.createObjectStore(FONT_STORE_NAME);
        }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB open blocked'));
});

/**
 * Run one request against the font store and resolve with its result. Every
 * caller wraps this in a try/catch: no IndexedDB at all, a denied database in a
 * sandboxed frame and a full quota all land here as a rejection
 */
const withFontStore = async (mode, run) => {
    const db = await openFontDb();

    try {
        return await new Promise((resolve, reject) => {
            const request = run(db.transaction(FONT_STORE_NAME, mode).objectStore(FONT_STORE_NAME));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } finally {
        db.close();
    }
}

/**
 * The uploaded font of the previous session. localStorage is textual and far
 * too small for a font binary, so the bytes live in IndexedDB instead
 * @returns {Promise<{name: string, type: string, data: ArrayBuffer}|null>}
 */
export const readStoredFontFile = async () => {
    try {
        return (await withFontStore('readonly', (store) => store.get(FONT_RECORD_KEY))) ?? null;
    } catch (e) {
        return null;
    }
}

export const fontFileTooLarge = (file) => Boolean(file) && file.size > MAX_STORED_FONT_BYTES;

/**
 * Forget the stored upload, so nothing is left for the marker of a session
 * whose own bytes were never kept
 * @returns {Promise<void>}
 */
export const clearStoredFontFile = async () => {
    try {
        await withFontStore('readwrite', (store) => store.delete(FONT_RECORD_KEY));
    } catch (e) {
        // nothing to clear if the database cannot even be opened
    }
}

/**
 * Keep the bytes of an uploaded font, so "Last session" can bring it back.
 * Silent on failure, exactly like the localStorage helpers: the session simply
 * comes back without its font
 * @param file the File the user picked or dropped
 * @returns {Promise<void>}
 */
export const writeStoredFontFile = async (file) => {
    if (!file) {
        return;
    }

    // an upload too big to keep has to take the previous one with it, or the
    // next session would restore those older bytes under this file's name
    if (fontFileTooLarge(file)) {
        await clearStoredFontFile();
        return;
    }

    try {
        const record = {name: file.name, type: file.type, data: await file.arrayBuffer()};

        await withFontStore('readwrite', (store) => store.put(record, FONT_RECORD_KEY));
    } catch (e) {
        // storage denied or over quota
    }
}

/**
 * Turn a stored record back into a File, so a restored upload goes through the
 * very same load path a fresh one does
 * @returns {File|null}
 */
export const storedFontFileToFile = (record) => record?.data
    ? new File([record.data], record.name || 'font', {type: record.type || ''})
    : null;

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
export const PERSISTED_KEYS = ['perRow', 'gridWidth', 'gridHeight', 'fontSize', 'exportScale', 'characters', 'sampleText', 'fontUrl', 'fontFile', 'inputType', 'options', 'colors', 'outlineWidth', 'fontIndex'];

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
 * The marker of an uploaded font session. The bytes are in IndexedDB, so this
 * carries the file name and nothing else - anything richer is dropped
 */
const asFileMarker = (value) => {
    const name = typeof value === 'object' && value !== null && !Array.isArray(value)
        ? asString(value.name)
        : undefined;

    return name === undefined ? undefined : {name};
};

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
    fontFile: asFileMarker,
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
