import download from "downloadjs";
import {toClipboard, toast} from "./helpers";

/**
 * Create a canvas 2d context with the current font set,
 * making sure the font is loaded before measuring.
 */
const measureContext = async (data) => {
    const font = data.font();
    const fontSpec = `${font.style ?? 'normal'} ${font.weight ?? 400} ${data.fontSize}px "${font.name}"`;

    try {
        await document.fonts.load(fontSpec, data.characters);
    } catch (e) {
        // keep going - measurement will use a fallback font at worst
    }

    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = fontSpec;
    return ctx;
}

/**
 * Build BMFont data (info, common, pages, chars, kernings) describing
 * the bitmap that "Download" produces: glyph positions on the grid,
 * spacing (xadvance) and kerning pairs measured from the font itself.
 */
const buildBMFont = async (data) => {
    const ctx = await measureContext(data);
    const font = data.font();

    const perRow = parseInt(data.perRow);
    const gridWidth = parseInt(data.gridWidth);
    const gridHeight = parseInt(data.gridHeight);
    const fontSize = parseInt(data.fontSize);
    const centered = data.options.centered;

    const characters = Array.from(data.characters);

    const metrics = ctx.measureText('Hg');
    const ascent = metrics.fontBoundingBoxAscent ?? fontSize * 0.8;
    const descent = metrics.fontBoundingBoxDescent ?? fontSize * 0.2;
    const base = Math.round(centered
        ? gridHeight / 2 + (ascent - descent) / 2
        : gridHeight - descent);

    // Advance width of every unique character
    const advances = new Map();
    characters.forEach((char) => {
        if (!advances.has(char)) {
            advances.set(char, ctx.measureText(char).width);
        }
    });

    // Glyph positions on the grid (first occurrence wins for duplicates)
    const chars = [];
    const seen = new Set();
    characters.forEach((char, index) => {
        const id = char.codePointAt(0);
        if (seen.has(id)) {
            return;
        }
        seen.add(id);

        const advance = advances.get(char);
        chars.push({
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
    chars.forEach((first) => {
        chars.forEach((second) => {
            const pairWidth = ctx.measureText(first.char + second.char).width;
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
            italic: (font.style === 'italic' || data.options.italic) ? 1 : 0,
            charset: "",
            unicode: 1,
            stretchH: 100,
            smooth: data.options.antialiasing ? 1 : 0,
            aa: data.options.antialiasing ? 1 : 0,
            padding: [0, 0, 0, 0],
            spacing: [0, 0],
            outline: 0,
        },
        common: {
            lineHeight: gridHeight,
            base: base,
            scaleW: Math.min(characters.length, perRow) * gridWidth,
            scaleH: Math.ceil(characters.length / perRow) * gridHeight,
            pages: 1,
            packed: 0,
        },
        pages: [font.name + '.png'],
        chars: chars,
        kernings: kernings,
    };
}

/**
 * Serialize BMFont data to the classic AngelCode .fnt text format
 */
const serializeBMFontText = (bmfont) => {
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
