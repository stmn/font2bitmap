import {describe, it, expect} from 'vitest';
import {
    parseFontFaces,
    isValidURL,
    outlineShadow,
    serializeState,
    deserializeState,
    positiveInt,
    clampOutlineWidth,
    sanitizeState,
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

    it('works without defaults for the flat keys', () => {
        expect(sanitizeState({perRow: 5, colors: {text: '#000000'}})).toEqual({perRow: 5});
    });
});
