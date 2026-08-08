import {describe, it, expect} from 'vitest';
import {buildBMFontData, serializeBMFontText, normalizeFontWeight} from '../../src/exports.js';

const charWidth = 10;
const measure = (text) => Array.from(text).length * charWidth;

const baseInput = () => ({
    font: {name: 'Test', weight: '400', style: 'normal'},
    characters: 'AB',
    perRow: 2,
    gridWidth: 20,
    gridHeight: 20,
    fontSize: 16,
    centered: false,
    options: {antialiasing: false, italic: false},
    measureText: measure,
    ascent: 12,
    descent: 4,
});

describe('buildBMFontData', () => {
    it('lays out glyphs on the grid', () => {
        const bmfont = buildBMFontData(baseInput());
        expect(bmfont.chars).toHaveLength(2);
        expect(bmfont.chars[0]).toMatchObject({id: 65, x: 0, y: 0, width: 20, height: 20, xadvance: 10, xoffset: 0, yoffset: 0, page: 0});
        expect(bmfont.chars[1]).toMatchObject({id: 66, x: 20, y: 0});
        expect(bmfont.common.scaleW).toBe(40);
        expect(bmfont.common.scaleH).toBe(20);
        expect(bmfont.common.base).toBe(16);
        expect(bmfont.info.face).toBe('Test');
        expect(bmfont.pages).toEqual(['Test.png']);
    });

    it('wraps rows by perRow', () => {
        const input = {...baseInput(), characters: 'ABC', perRow: 2};
        const bmfont = buildBMFontData(input);
        expect(bmfont.chars[2]).toMatchObject({id: 67, x: 0, y: 20});
        expect(bmfont.common.scaleH).toBe(40);
    });

    it('centers glyphs when centered is on', () => {
        const bmfont = buildBMFontData({...baseInput(), centered: true});
        expect(bmfont.common.base).toBe(14);
        expect(bmfont.chars[0].xoffset).toBe(-5);
    });

    it('skips duplicate characters, first occurrence wins', () => {
        const bmfont = buildBMFontData({...baseInput(), characters: 'AA'});
        expect(bmfont.chars).toHaveLength(1);
        expect(bmfont.chars[0].x).toBe(0);
    });

    it('emits kerning pairs when pair width differs from sum of widths', () => {
        const kerningMeasure = (text) => text === 'AV' ? 18 : measure(text);
        const bmfont = buildBMFontData({...baseInput(), characters: 'AV', measureText: kerningMeasure});
        expect(bmfont.kernings).toEqual([{first: 65, second: 86, amount: -2}]);
    });

    it('emits no kernings for additive widths', () => {
        const bmfont = buildBMFontData(baseInput());
        expect(bmfont.kernings).toEqual([]);
    });

    it('derives info.bold from the weight it is given', () => {
        const withWeight = (weight) => buildBMFontData({
            ...baseInput(),
            font: {name: 'Test', weight: weight, style: 'normal'},
        }).info.bold;

        expect(withWeight(400)).toBe(0);
        expect(withWeight('700')).toBe(1);
    });

    it('reports a variable weight range as not bold once normalized', () => {
        const withWeight = (weight) => buildBMFontData({
            ...baseInput(),
            font: {name: 'Test', weight: weight, style: 'normal'},
        }).info.bold;

        // A raw range would be misread as bold, which is why callers must normalize first
        expect(withWeight('700 900')).toBe(1);
        expect(withWeight(normalizeFontWeight('700 900'))).toBe(0);
    });
});

describe('serializeBMFontText', () => {
    it('serializes to the AngelCode text format', () => {
        const text = serializeBMFontText(buildBMFontData(baseInput()));
        const lines = text.split('\n');
        expect(lines[0]).toContain('info face="Test"');
        expect(lines[0]).toContain('padding=0,0,0,0');
        expect(lines[1]).toContain('common lineHeight=20');
        expect(text).toContain('page id=0 file="Test.png"');
        expect(text).toContain('chars count=2');
        expect(text).toMatch(/char id=65 /);
        expect(text).not.toContain('char="');
        expect(text).toContain('kernings count=0');
    });
});

describe('normalizeFontWeight', () => {
    it('keeps a single numeric weight', () => {
        expect(normalizeFontWeight('700')).toBe(700);
        expect(normalizeFontWeight(500)).toBe(500);
    });

    it('falls back to 400 for a variable font weight range', () => {
        expect(normalizeFontWeight('100 900')).toBe(400);
        expect(normalizeFontWeight('700 900')).toBe(400);
    });

    it('maps keywords and missing values', () => {
        expect(normalizeFontWeight('bold')).toBe(700);
        expect(normalizeFontWeight('normal')).toBe(400);
        expect(normalizeFontWeight(undefined)).toBe(400);
    });
});
