import {describe, it, expect} from 'vitest';
import fs from 'fs';
import path from 'path';
import {create} from 'fontkit';
import {codepointsToCharacters} from '../../src/helpers.js';

const FIXTURE_PATH = path.join(__dirname, '..', '..', 'public', 'fonts', 'PressStart2P-Regular.woff2');

/**
 * "All glyphs in font" stands on fontkit reading a woff2 cmap, which needs the
 * brotli decoder its browser build ships. Node resolves the node build here, so
 * this only proves the parsing contract - the browser path is covered by the
 * "all glyphs in font" e2e test.
 */
describe('reading a woff2 cmap with fontkit', () => {
    const font = () => create(new Uint8Array(fs.readFileSync(FIXTURE_PATH)));

    it('parses the committed woff2 fixture', () => {
        expect(font().characterSet.length).toBeGreaterThan(90);
    });

    it('produces a character set covering ASCII', () => {
        const characters = codepointsToCharacters(font().characterSet);

        expect(characters).toContain('A');
        expect(characters).toContain('z');
        expect(characters).toContain('0');
        expect(characters).toContain(' ');
        // the cmap maps a carriage return, which can never be a glyph on the grid
        expect(font().characterSet).toContain(0x0d);
        expect(characters).not.toContain('\r');
    });
});
