import download from "downloadjs";
import {toClipboard, toast} from "./helpers";

/**
 * Reduce a CSS font-weight value to a single number usable in the
 * canvas font shorthand. Variable fonts declare a range like
 * "100 900", which is invalid in the shorthand - such a family is
 * rendered at the default weight, so 400 is used for measuring too.
 */
export const normalizeFontWeight = (weight) => {
    const numbers = String(weight ?? '').match(/\d+/g);

    if (!numbers) {
        return String(weight ?? '').trim().toLowerCase() === 'bold' ? 700 : 400;
    }

    return numbers.length > 1 ? 400 : parseInt(numbers[0]);
}

/**
 * Create a canvas 2d context with the current font set,
 * making sure the font is loaded before measuring.
 */
const measureContext = async (data) => {
    const font = data.font();
    // Italic is applied to the bitmap through CSS, so it has to be measured italic as well
    const style = (font.style && font.style !== 'normal')
        ? font.style
        : (data.options.italic ? 'italic' : 'normal');
    const fontSpec = `${style} ${normalizeFontWeight(font.weight)} ${data.fontSize}px "${font.name}"`;

    try {
        await document.fonts.load(fontSpec, data.characters);
    } catch (e) {
        // keep going - measurement will use a fallback font at worst
    }

    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = fontSpec;

    // An invalid shorthand is ignored silently and leaves the default 10px sans-serif
    if (!ctx.font.includes(font.name)) {
        ctx.font = `normal 400 ${data.fontSize}px "${font.name}"`;
    }

    return ctx;
}

/**
 * Build BMFont data (info, common, pages, chars, kernings) describing
 * the bitmap that "Download" produces: glyph positions on the grid,
 * spacing (xadvance) and kerning pairs measured from the font itself.
 *
 * Pure: every measurement comes from the injected measureText/ascent/descent.
 */
export const buildBMFontData = ({font, characters, perRow, gridWidth, gridHeight, fontSize, centered, options, measureText, ascent, descent}) => {
    const chars = Array.from(characters);

    const base = Math.round(centered
        ? gridHeight / 2 + (ascent - descent) / 2
        : gridHeight - descent);

    // Advance width of every unique character
    const advances = new Map();
    chars.forEach((char) => {
        if (!advances.has(char)) {
            advances.set(char, measureText(char));
        }
    });

    // Glyph positions on the grid (first occurrence wins for duplicates)
    const glyphs = [];
    const seen = new Set();
    chars.forEach((char, index) => {
        const id = char.codePointAt(0);
        if (seen.has(id)) {
            return;
        }
        seen.add(id);

        const advance = advances.get(char);
        glyphs.push({
            id: id,
            char: char,
            x: (index % perRow) * gridWidth,
            y: Math.floor(index / perRow) * gridHeight,
            width: gridWidth,
            height: gridHeight,
            xoffset: centered ? -Math.round((gridWidth - advance) / 2) : 0,
            yoffset: 0,
            xadvance: Math.round(advance),
            page: 0,
            chnl: 15,
        });
    });

    // Kerning pairs: width of the pair minus widths of both characters
    const kernings = [];
    glyphs.forEach((first) => {
        glyphs.forEach((second) => {
            const pairWidth = measureText(first.char + second.char);
            const amount = Math.round(pairWidth - advances.get(first.char) - advances.get(second.char));
            if (amount !== 0) {
                kernings.push({first: first.id, second: second.id, amount});
            }
        });
    });

    return {
        info: {
            face: font.name,
            size: fontSize,
            bold: parseInt(font.weight) >= 600 ? 1 : 0,
            italic: (font.style === 'italic' || options.italic) ? 1 : 0,
            charset: "",
            unicode: 1,
            stretchH: 100,
            smooth: options.antialiasing ? 1 : 0,
            aa: options.antialiasing ? 1 : 0,
            padding: [0, 0, 0, 0],
            spacing: [0, 0],
            outline: 0,
        },
        common: {
            lineHeight: gridHeight,
            base: base,
            scaleW: Math.min(chars.length, perRow) * gridWidth,
            scaleH: Math.ceil(chars.length / perRow) * gridHeight,
            pages: 1,
            packed: 0,
        },
        pages: [font.name + '.png'],
        chars: glyphs,
        kernings: kernings,
    };
}

/**
 * Measure the current font in the DOM and build BMFont data from it.
 */
const buildBMFont = async (data) => {
    const ctx = await measureContext(data);
    const font = data.font();
    const fontSize = parseInt(data.fontSize);
    const metrics = ctx.measureText('Hg');

    return buildBMFontData({
        font,
        characters: data.characters,
        perRow: parseInt(data.perRow),
        gridWidth: parseInt(data.gridWidth),
        gridHeight: parseInt(data.gridHeight),
        fontSize: fontSize,
        centered: data.options.centered,
        options: data.options,
        measureText: (text) => ctx.measureText(text).width,
        ascent: metrics.fontBoundingBoxAscent ?? fontSize * 0.8,
        descent: metrics.fontBoundingBoxDescent ?? fontSize * 0.2,
    });
}

/**
 * Serialize BMFont data to the classic AngelCode .fnt text format
 */
export const serializeBMFontText = (bmfont) => {
    const attrs = (object, skip = []) => Object.entries(object)
        .filter(([key]) => !skip.includes(key))
        .map(([key, value]) => {
            if (typeof value === 'string') {
                return `${key}="${value}"`;
            }
            if (Array.isArray(value)) {
                return `${key}=${value.join(',')}`;
            }
            return `${key}=${value}`;
        })
        .join(' ');

    const lines = [
        `info ${attrs(bmfont.info)}`,
        `common ${attrs(bmfont.common)}`,
    ];

    bmfont.pages.forEach((file, id) => {
        lines.push(`page id=${id} file="${file}"`);
    });

    lines.push(`chars count=${bmfont.chars.length}`);
    bmfont.chars.forEach((char) => {
        lines.push(`char ${attrs(char, ['char'])}`);
    });

    lines.push(`kernings count=${bmfont.kernings.length}`);
    bmfont.kernings.forEach((kerning) => {
        lines.push(`kerning ${attrs(kerning)}`);
    });

    return lines.join('\n');
}

export default {
    'bmfontJson': async (data) => {
        const bmfont = await buildBMFont(data);
        download(JSON.stringify(bmfont, null, 2), data.font().name + '.json', 'application/json');
        toast("BMFont JSON downloaded!");
    },
    'bmfontText': async (data) => {
        const bmfont = await buildBMFont(data);
        download(serializeBMFontText(bmfont), data.font().name + '.fnt', 'text/plain');
        toast("BMFont .fnt downloaded!");
    },
    'construct': async (data) => {
        let spacingData = [];
        let biggestWidth = 0;

        data.disabledGridSize = true;

        await data.$nextTick()

        document.querySelectorAll('.cell').forEach(cell => {
            let found = -1;
            for (let i = 0; i < spacingData.length; i++) {
                let width = spacingData[i][0];

                if (width === (Math.ceil(cell.offsetWidth))) {
                    found = i;
                    break;
                }
            }

            if (found === -1) {
                let width = (Math.ceil(cell.offsetWidth));
                biggestWidth = Math.max(biggestWidth, width);
                spacingData.push([width, cell.textContent]);
            } else {
                spacingData[found][1] = (spacingData[found][1] + cell.textContent);
            }
        });

        // fix null widths
        spacingData = spacingData.map(data => {
            if (data[0] === 0) {
                data[0] = biggestWidth / 2;
            }
            return data;
        })

        data.disabledGridSize = false;

        toClipboard(JSON.stringify(spacingData));
    },
    'kaboom': (data) => {
        toClipboard(
            `loadFont("${data.font().name}", "${data.font().name.replace(/ /g, '_') + '.png'}", ${data.gridWidth}, ${data.gridHeight}, {chars: "${data.characters.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"})`
        );
    },
}
