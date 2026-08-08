import {describe, it, expect, afterEach} from 'vitest';
import {
    glyphsLoadedMessage,
    MAX_STORED_FONT_BYTES,
    readStoredFontFile,
    readStoredState,
    STATE_STORAGE_KEY,
    SLOW_CHARACTERS,
    writeStoredFontFile,
    writeStoredState,
    parseFontFaces,
    isValidURL,
    outlineShadow,
    serializeState,
    deserializeState,
    positiveInt,
    clampOutlineWidth,
    sanitizeState,
    codepointsToCharacters,
} from '../../src/helpers.js';

describe('parseFontFaces', () => {
    it('parses @font-face blocks', () => {
        const css = `@font-face { font-family: 'My Font'; font-style: italic; font-weight: 700; src: url(https://example.com/f.woff2) format('woff2'); }`;
        expect(parseFontFaces(css)).toEqual([{
            url: 'https://example.com/f.woff2',
            name: 'My Font',
            weight: '700',
            style: 'italic',
            css: `@font-face { font-family: 'My Font'; font-style: italic; font-weight: 700; src: url(https://example.com/f.woff2) format('woff2'); }`,
        }]);
    });

    it('parses multiple blocks', () => {
        const css = `@font-face { font-family: A; src: url(a.woff); } @font-face { font-family: B; src: url(b.woff); }`;
        expect(parseFontFaces(css).map(f => f.name)).toEqual(['A', 'B']);
    });

    it('returns empty array for binary garbage', () => {
        expect(parseFontFaces('\x00\x01wOF2 not css')).toEqual([]);
    });
});

describe('isValidURL', () => {
    it('accepts http and https', () => {
        expect(isValidURL('https://a.b/c')).toBe(true);
        expect(isValidURL('http://a.b/c')).toBe(true);
    });
    it('rejects other input', () => {
        expect(isValidURL('not a url')).toBe(false);
        expect(isValidURL('ftp://a.b')).toBe(false);
    });
});

describe('outlineShadow', () => {
    it('generates a full square of shadows', () => {
        const value = outlineShadow(1, '#ff0000');
        const parts = value.split(', ');
        expect(parts).toHaveLength(9);
        expect(parts).toContain('-1px -1px 0 #ff0000');
        expect(parts).toContain('0px 0px 0 #ff0000');
        expect(parts).toContain('1px 1px 0 #ff0000');
    });

    it('scales with width', () => {
        expect(outlineShadow(2, '#000').split(', ')).toHaveLength(25);
    });
});

describe('state serialization', () => {
    it('round-trips a state object', () => {
        const state = {perRow: 19, characters: 'ą"\\ć', options: {outline: true}};
        expect(deserializeState(serializeState(state))).toEqual(state);
    });

    it('survives the full query string cycle with percent signs', () => {
        const state = {characters: ' !"#$%&\'()*+,-./', colors: {background: '#000000'}, perRow: 19};
        const raw = new URLSearchParams('?s=' + serializeState(state)).get('s');
        expect(deserializeState(raw)).toEqual(state);
    });

    it('reads percent-encoded payloads too', () => {
        const state = {characters: 'a%41b'};
        expect(deserializeState(serializeState(state))).toEqual(state);
    });

    it('returns null for garbage', () => {
        expect(deserializeState('not%valid%json')).toBeNull();
        expect(deserializeState('')).toBeNull();
    });
});

describe('positiveInt', () => {
    it('never returns a value below 1', () => {
        expect(positiveInt(0)).toBe(1);
        expect(positiveInt('')).toBe(1);
        expect(positiveInt('-5')).toBe(1);
        expect(positiveInt(undefined)).toBe(1);
        expect(positiveInt('abc')).toBe(1);
    });

    it('keeps valid counts', () => {
        expect(positiveInt('19')).toBe(19);
        expect(positiveInt(7)).toBe(7);
    });
});

describe('clampOutlineWidth', () => {
    it('clamps into [1, 4]', () => {
        expect(clampOutlineWidth(500)).toBe(4);
        expect(clampOutlineWidth(0)).toBe(1);
        expect(clampOutlineWidth(-10)).toBe(1);
        expect(clampOutlineWidth('')).toBe(1);
        expect(clampOutlineWidth('3')).toBe(3);
    });
});

describe('stored state', () => {
    afterEach(() => {
        delete globalThis.window;
    });

    const withStorage = (localStorage) => {
        globalThis.window = {localStorage};
    };

    it('round-trips a state object as plain JSON', () => {
        const store = {};
        withStorage({
            getItem: (key) => store[key] ?? null,
            setItem: (key, value) => {
                store[key] = value;
            },
        });

        writeStoredState({characters: 'AB', options: {outline: true}});

        // plain JSON, the form deserializeState parses first
        expect(store[STATE_STORAGE_KEY]).toBe('{"characters":"AB","options":{"outline":true}}');
        expect(JSON.parse(readStoredState())).toEqual({characters: 'AB', options: {outline: true}});
    });

    it('returns null instead of throwing when storage is denied', () => {
        withStorage({
            getItem: () => {
                throw new Error('SecurityError');
            },
            setItem: () => {
                throw new Error('SecurityError');
            },
        });

        expect(readStoredState()).toBeNull();
        expect(() => writeStoredState({characters: 'AB'})).not.toThrow();
    });

    it('survives having no storage at all', () => {
        expect(readStoredState()).toBeNull();
        expect(() => writeStoredState({characters: 'AB'})).not.toThrow();
    });
});

/**
 * The real roundtrip needs a browser, it is covered by the e2e suite. What has
 * to hold here is that a missing or refused IndexedDB never escapes as an error
 */
describe('stored font file', () => {
    afterEach(() => {
        delete globalThis.window;
    });

    const fileStub = ({size = 4, arrayBuffer = async () => new ArrayBuffer(size)} = {}) =>
        ({name: 'font.ttf', type: 'font/ttf', size, arrayBuffer});

    it('reads null when there is no IndexedDB at all', async () => {
        await expect(readStoredFontFile()).resolves.toBeNull();
    });

    it('swallows a write when there is no IndexedDB at all', async () => {
        await expect(writeStoredFontFile(fileStub())).resolves.toBeUndefined();
    });

    it('swallows a database the browser refuses to open', async () => {
        globalThis.window = {
            indexedDB: {
                open: () => {
                    throw new Error('SecurityError');
                },
            },
        };

        await expect(readStoredFontFile()).resolves.toBeNull();
        await expect(writeStoredFontFile(fileStub())).resolves.toBeUndefined();
    });

    it('skips a file too big to be worth keeping, without reading it', async () => {
        const tooBig = fileStub({
            size: MAX_STORED_FONT_BYTES + 1,
            arrayBuffer: () => {
                throw new Error('should never be read');
            },
        });

        await expect(writeStoredFontFile(tooBig)).resolves.toBeUndefined();
        await expect(writeStoredFontFile(null)).resolves.toBeUndefined();
    });
});

describe('glyphsLoadedMessage', () => {
    it('formats the glyph count message', () => {
        expect(glyphsLoadedMessage('ABC')).toBe('3 glyphs loaded!');
    });

    it('counts a surrogate pair as one glyph', () => {
        expect(glyphsLoadedMessage('a\u{1f600}')).toBe('2 glyphs loaded!');
    });

    it('stays quiet right up to the threshold', () => {
        const characters = 'x'.repeat(SLOW_CHARACTERS);
        expect(glyphsLoadedMessage(characters)).toBe(`${SLOW_CHARACTERS} glyphs loaded!`);
    });

    it('warns about a set big enough to slow the export down', () => {
        const characters = 'x'.repeat(SLOW_CHARACTERS + 1);
        expect(glyphsLoadedMessage(characters)).toBe(`${SLOW_CHARACTERS + 1} glyphs loaded, exporting will be slow!`);
    });

    it('counts astral glyphs against the threshold once each', () => {
        // twice the UTF-16 length of the threshold, still only threshold glyphs
        const characters = '\u{1f600}'.repeat(SLOW_CHARACTERS);
        expect(characters.length).toBe(SLOW_CHARACTERS * 2);
        expect(glyphsLoadedMessage(characters)).toBe(`${SLOW_CHARACTERS} glyphs loaded!`);
    });
});

describe('codepointsToCharacters', () => {
    it('sorts ascending and drops duplicates', () => {
        expect(codepointsToCharacters([0x43, 0x41, 0x42, 0x41])).toBe('ABC');
    });

    it('keeps the space and printable punctuation', () => {
        expect(codepointsToCharacters([0x21, 0x20])).toBe(' !');
    });

    it('drops control characters', () => {
        // null, tab, newline, delete and a C1 control
        expect(codepointsToCharacters([0x00, 0x09, 0x0a, 0x41, 0x7f, 0x85])).toBe('A');
    });

    it('drops invisible formatting characters', () => {
        const invisible = [0xad, 0x200b, 0x200e, 0x2028, 0x202e, 0x2060, 0xfeff, 0xfe0f];
        expect(codepointsToCharacters([0x41, ...invisible])).toBe('A');
    });

    it('drops surrogate halves and noncharacters', () => {
        expect(codepointsToCharacters([0xd800, 0xdfff, 0xfdd0, 0xfffe, 0xffff, 0x1fffe, 0x41])).toBe('A');
    });

    it('keeps characters outside the basic plane', () => {
        expect(codepointsToCharacters([0x1f600])).toBe('\u{1f600}');
    });

    it('ignores values that are not codepoints', () => {
        expect(codepointsToCharacters([1.5, -1, 0x110000, NaN, undefined, null, '65', 0x41])).toBe('A');
    });

    it('handles an empty or missing set', () => {
        expect(codepointsToCharacters([])).toBe('');
        expect(codepointsToCharacters(undefined)).toBe('');
    });

    it('accepts any iterable, a Set included', () => {
        expect(codepointsToCharacters(new Set([0x42, 0x41]))).toBe('AB');
    });
});

describe('sanitizeState', () => {
    const defaults = () => ({
        perRow: 19,
        gridWidth: 30,
        gridHeight: 30,
        fontSize: 24,
        exportScale: 1,
        characters: 'AB',
        sampleText: '',
        fontUrl: 'https://fonts.gstatic.com/font.woff2',
        inputType: 'fontUrl',
        options: {outline: false, centered: true},
        colors: {text: '#ffffff', outline: '#000000', background: ''},
        outlineWidth: 2,
        fontIndex: 0,
    });

    it('rejects non-object input', () => {
        expect(sanitizeState(null, defaults())).toEqual({});
        expect(sanitizeState('perRow', defaults())).toEqual({});
        expect(sanitizeState(42, defaults())).toEqual({});
        expect(sanitizeState([1, 2], defaults())).toEqual({});
    });

    it('drops unknown keys', () => {
        expect(sanitizeState({evil: '<script>', fonts: [], loading: true}, defaults())).toEqual({});
    });

    it('forces perRow to at least 1', () => {
        expect(sanitizeState({perRow: 0}, defaults()).perRow).toBe(1);
        expect(sanitizeState({perRow: ''}, defaults()).perRow).toBe(1);
        expect(sanitizeState({perRow: -20}, defaults()).perRow).toBe(1);
        expect(sanitizeState({perRow: '8'}, defaults()).perRow).toBe(8);
    });

    it('clamps outlineWidth', () => {
        expect(sanitizeState({outlineWidth: 500}, defaults()).outlineWidth).toBe(4);
        expect(sanitizeState({outlineWidth: -1}, defaults()).outlineWidth).toBe(1);
    });

    it('rejects colors that are not hex', () => {
        const clean = sanitizeState({colors: {text: 'red; background:url(x)'}}, defaults());
        expect(clean.colors.text).toBe('#ffffff');
    });

    it('keeps valid colors and the empty background', () => {
        const clean = sanitizeState({colors: {text: '#ff0000', background: ''}}, defaults());
        expect(clean.colors).toEqual({text: '#ff0000', outline: '#000000', background: ''});
    });

    it('rejects non http(s) font URLs', () => {
        expect(sanitizeState({fontUrl: 'javascript:alert(1)'}, defaults()).fontUrl).toBeUndefined();
        expect(sanitizeState({fontUrl: 'data:text/css,@font-face{}'}, defaults()).fontUrl).toBeUndefined();
        expect(sanitizeState({fontUrl: 'not a url'}, defaults()).fontUrl).toBeUndefined();
    });

    it('percent-encodes a font URL trying to break out of the style element', () => {
        const clean = sanitizeState({
            fontUrl: 'https://example.com/</style><img src=x onerror=alert(1)>',
        }, defaults());
        expect(clean.fontUrl).toBe('https://example.com/%3C/style%3E%3Cimg%20src=x%20onerror=alert(1)%3E');
        expect(clean.fontUrl).not.toContain('<');
        expect(clean.fontUrl).not.toContain('>');
    });

    it('keeps an uploaded font marker as nothing but its name', () => {
        expect(sanitizeState({fontFile: {name: 'x.ttf'}}, defaults()).fontFile).toEqual({name: 'x.ttf'});
        expect(sanitizeState({fontFile: {name: 'x.ttf', data: 'AAAA'}}, defaults()).fontFile).toEqual({name: 'x.ttf'});
    });

    it('rejects an uploaded font marker that is not a named object', () => {
        expect(sanitizeState({fontFile: 42}, defaults()).fontFile).toBeUndefined();
        expect(sanitizeState({fontFile: 'x.ttf'}, defaults()).fontFile).toBeUndefined();
        expect(sanitizeState({fontFile: null}, defaults()).fontFile).toBeUndefined();
        expect(sanitizeState({fontFile: [{name: 'x.ttf'}]}, defaults()).fontFile).toBeUndefined();
        expect(sanitizeState({fontFile: {}}, defaults()).fontFile).toBeUndefined();
        expect(sanitizeState({fontFile: {name: {name: 'x.ttf'}}}, defaults()).fontFile).toBeUndefined();
        expect(sanitizeState({fontFile: {name: 7}}, defaults()).fontFile).toBeUndefined();
    });

    it('rejects an export scale that is not offered', () => {
        expect(sanitizeState({exportScale: 3}, defaults()).exportScale).toBeUndefined();
        expect(sanitizeState({exportScale: 0}, defaults()).exportScale).toBeUndefined();
        expect(sanitizeState({exportScale: 4}, defaults()).exportScale).toBe(4);
    });

    it('coerces options to booleans and keeps unknown options out', () => {
        const clean = sanitizeState({options: {outline: 'yes', nope: true}}, defaults());
        expect(clean.options).toEqual({outline: true, centered: true});
    });

    it('rejects nested values that are not objects', () => {
        expect(sanitizeState({colors: 'red', options: 'all'}, defaults())).toEqual({});
    });

    it('accepts only the known input types', () => {
        expect(sanitizeState({inputType: 'file'}, defaults()).inputType).toBe('file');
        expect(sanitizeState({inputType: 'evil'}, defaults()).inputType).toBeUndefined();
    });

    it('rejects lastSession, which is an action and not a source', () => {
        expect(sanitizeState({inputType: 'lastSession'}, defaults()).inputType).toBeUndefined();
    });

    /**
     * State restored from localStorage goes through the same two steps as a
     * shared link, so anything that can write to storage gets no more trust
     */
    it('cleans a raw stored JSON string exactly like a shared link', () => {
        const hostile = JSON.stringify({
            perRow: 0,
            outlineWidth: 500,
            fontUrl: 'javascript:alert(1)',
            colors: {text: 'red; background:url(x)'},
            options: {outline: 'yes', nope: true},
            evil: '<script>',
        });

        const clean = sanitizeState(deserializeState(hostile), defaults());

        expect(clean.perRow).toBe(1);
        expect(clean.outlineWidth).toBe(4);
        expect(clean.fontUrl).toBeUndefined();
        expect(clean.colors.text).toBe('#ffffff');
        expect(clean.options).toEqual({outline: true, centered: true});
        expect(clean.evil).toBeUndefined();
    });

    it('survives a stored string that is not state at all', () => {
        expect(sanitizeState(deserializeState('not json'), defaults())).toEqual({});
        expect(sanitizeState(deserializeState('"a string"'), defaults())).toEqual({});
    });

    it('works without defaults for the flat keys', () => {
        expect(sanitizeState({perRow: 5, colors: {text: '#000000'}})).toEqual({perRow: 5});
    });
});
