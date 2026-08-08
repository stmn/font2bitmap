import {describe, it, expect} from 'vitest';
import {parseFontFaces, isValidURL, outlineShadow} from '../../src/helpers.js';

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
