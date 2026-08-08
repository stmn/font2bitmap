# font2bitmap Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the BMFont export, fix known bugs, and add quality-of-life features (ZIP bundle, export scale, colors/outline, character presets, sample text preview, drag & drop, shareable URL state) with unit and e2e test coverage.

**Architecture:** The app is a single Alpine.js component (`src/main.js`) rendering the character grid as inline-styled HTML, converted to PNG via `html-to-image`. Export formats live in `src/exports.js`, small utilities in `src/helpers.js`. We extract pure functions (BMFont building, CSS parsing, state serialization, outline generation) so they are unit-testable with Vitest, keep DOM-dependent code as thin wrappers, and verify the full UI with a Playwright e2e suite using a locally committed font fixture (no network dependency).

**Tech Stack:** Vite, Alpine.js 3, html-to-image, downloadjs, toastify-js. New dev deps: vitest, @playwright/test. New runtime dep: jszip.

## Global Constraints

- Never use em dash or en dash anywhere (code, docs, commits). Only the short hyphen "-".
- No duplicated code: when adding a variant of an existing function, extract shared logic; variants are wrappers, not copies.
- Node is v22. If `npm run dev` or `npm run build` fails because Vite 2 is too old for Node 22, upgrade `vite` to `^5.4.0` in a separate commit and re-verify the app boots before continuing.
- All UI text stays in English (existing convention).
- Every task ends with `npm run build` passing and a commit.
- Existing export behavior (Construct 3, KaboomJS) must keep working unchanged.

## File Structure

- `src/main.js` - Alpine component: state, rendering, download (modified)
- `src/exports.js` - export formats; pure BMFont builders exported for tests (modified)
- `src/helpers.js` - pure utilities: toast, clipboard, URL validation, CSS parsing, outline shadow, state serialization (modified)
- `index.html` - UI (modified)
- `tests/unit/*.test.js` - Vitest unit tests (new)
- `tests/e2e/app.spec.js` - Playwright e2e suite (new)
- `playwright.config.js`, `vitest.config.js` (new)
- `public/fonts/PressStart2P-Regular.woff2` - committed test fixture, OFL licensed (new)

---

### Task 1: Commit pending BMFont export work

The working tree already contains an implemented BMFont (JSON + .fnt) export in `src/exports.js`, `src/helpers.js`, `src/main.js`, `index.html`. It is unfinished only in the sense that it was never committed.

**Files:**
- Modify: none (commit existing changes)

- [ ] **Step 1: Install deps and verify build**

Run: `npm install && npm run build`
Expected: build succeeds. If Vite 2 fails under Node 22, apply the Global Constraints contingency (upgrade vite to ^5.4.0, commit that first as `chore: upgrade vite for node 22`).

- [ ] **Step 2: Smoke-check dev server**

Run: `npm run dev -- --port 5199` in background, then `curl -s http://localhost:5199 | head -5`, then kill the server.
Expected: HTML served.

- [ ] **Step 3: Commit pending work**

```bash
git add index.html src/exports.js src/helpers.js src/main.js
git commit -m "feat: add BMFont (JSON and .fnt) export with measured metrics and kerning"
```

---

### Task 2: Vitest setup and pure BMFont refactor with unit tests

Split `buildBMFont` into a pure, injectable-measurement function plus a thin DOM wrapper, export the pure pieces, and cover them with tests.

**Files:**
- Modify: `src/exports.js`
- Create: `vitest.config.js`, `tests/unit/bmfont.test.js`
- Modify: `package.json` (add vitest, test script)

**Interfaces:**
- Produces: `buildBMFontData(input)` and `serializeBMFontText(bmfont)` as named exports of `src/exports.js`.
  - `buildBMFontData({font, characters, perRow, gridWidth, gridHeight, fontSize, centered, options, measureText, ascent, descent})` returns the bmfont object `{info, common, pages, chars, kernings}`.
  - `measureText` is `(text: string) => number` (pixel width).
  - `options` needs `{antialiasing, italic}` booleans.
- Consumes: existing `buildBMFont(data)` internals from Task 1.

- [ ] **Step 1: Install vitest and add script**

Run: `npm install -D vitest`
In `package.json` scripts add: `"test": "vitest run"`.

Create `vitest.config.js`:

```js
import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/unit/**/*.test.js'],
        environment: 'node',
    },
});
```

- [ ] **Step 2: Write failing tests**

Create `tests/unit/bmfont.test.js`:

```js
import {describe, it, expect} from 'vitest';
import {buildBMFontData, serializeBMFontText} from '../../src/exports.js';

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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run`
Expected: FAIL - `buildBMFontData` is not exported.

- [ ] **Step 4: Refactor exports.js**

In `src/exports.js`, split the current `buildBMFont` so all measurement-independent logic moves into an exported pure function. The wrapper keeps identical output to the current implementation:

```js
export const buildBMFontData = ({font, characters, perRow, gridWidth, gridHeight, fontSize, centered, options, measureText, ascent, descent}) => {
    const chars = Array.from(characters);

    const base = Math.round(centered
        ? gridHeight / 2 + (ascent - descent) / 2
        : gridHeight - descent);

    const advances = new Map();
    chars.forEach((char) => {
        if (!advances.has(char)) {
            advances.set(char, measureText(char));
        }
    });

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
```

The DOM wrapper becomes:

```js
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
```

Change `const serializeBMFontText = ...` to `export const serializeBMFontText = ...`. Delete the old inline implementation of the removed logic; do not keep both copies.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS (all tests).

- [ ] **Step 6: Build and commit**

Run: `npm run build`

```bash
git add package.json package-lock.json vitest.config.js tests/unit/bmfont.test.js src/exports.js
git commit -m "test: add vitest and extract pure buildBMFontData with unit tests"
```

---

### Task 3: Extract parseFontFaces and fix loadURL error handling

`loadURL` crashes when `fetch` rejects (CORS/network): the `.catch` returns `undefined` and `response.ok` throws TypeError, and the catch block then fabricates a bogus fallback font. Extract CSS parsing into a pure helper and make error handling explicit.

**Files:**
- Modify: `src/helpers.js`, `src/main.js`
- Create: `tests/unit/helpers.test.js`

**Interfaces:**
- Produces: `parseFontFaces(cssText)` named export of `src/helpers.js`, returns `[{url, name, weight, style, css}]`.

- [ ] **Step 1: Write failing tests**

Create `tests/unit/helpers.test.js`:

```js
import {describe, it, expect} from 'vitest';
import {parseFontFaces, isValidURL} from '../../src/helpers.js';

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
```

- [ ] **Step 2: Run tests to verify parseFontFaces tests fail**

Run: `npx vitest run`
Expected: FAIL - `parseFontFaces` is not exported.

- [ ] **Step 3: Implement parseFontFaces in helpers.js**

```js
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
```

- [ ] **Step 4: Rewrite loadURL in main.js to use it**

Replace the body of `loadURL` (keep the early-return guard at the top):

```js
async loadURL(url = null) {
    if (this.font()?.url === url) {
        return;
    }

    this.loading = true;
    this.error = false;

    let response;
    try {
        response = await fetch(url);
    } catch (e) {
        this.error = true;
        this.loading = false;
        return;
    }

    if (!response.ok) {
        this.error = true;
        this.loading = false;
        return;
    }

    let fonts = [];
    try {
        fonts = parseFontFaces(await response.text());
    } catch (e) {
        fonts = [];
    }

    if (!fonts.length) {
        fonts = [{
            url: url,
            weight: 400,
            style: 'normal',
            name: 'font2bitmap',
            css: `@font-face { font-family: 'font2bitmap'; src: url(${url}); }`
        }];
    }

    this.fonts = fonts;
    this.fontIndex = 0;
    this.loading = false;
},
```

Add `parseFontFaces` to the existing import from `./helpers` in `src/main.js`.

- [ ] **Step 5: Run tests, build, manual smoke**

Run: `npx vitest run && npm run build`
Expected: PASS + build OK.

- [ ] **Step 6: Commit**

```bash
git add src/helpers.js src/main.js tests/unit/helpers.test.js
git commit -m "fix: robust loadURL error handling, extract parseFontFaces helper"
```

---

### Task 4: Remove the render side effect of removeDuplicates

`html()` currently mutates `this.characters` when `options.removeDuplicates` is on (state mutation inside a render getter). Introduce `effectiveCharacters()` used by both rendering and BMFont exports so the exported metrics always match the rendered grid.

**Files:**
- Modify: `src/main.js`, `src/exports.js`

**Interfaces:**
- Produces: `data.effectiveCharacters()` on the Alpine component, returns the string actually rendered (deduplicated when the option is on).

- [ ] **Step 1: Add effectiveCharacters and fix html()**

In `src/main.js`, next to `uniqueCharacters()` add:

```js
/**
 * Characters actually rendered on the grid
 * @returns {string}
 */
effectiveCharacters() {
    return this.options.removeDuplicates ? this.uniqueCharacters() : this.characters;
},
```

In `html()` delete this block:

```js
// Remove duplicate characters
if (this.options.removeDuplicates) {
    this.characters = this.uniqueCharacters();
}
```

and change `let letters = Array.from(this.characters);` to `let letters = Array.from(this.effectiveCharacters());`.

- [ ] **Step 2: Use it in BMFont wrapper**

In `src/exports.js` `buildBMFont`, change `characters: data.characters` to `characters: data.effectiveCharacters()` and in `measureContext` change `await document.fonts.load(fontSpec, data.characters);` to `await document.fonts.load(fontSpec, data.effectiveCharacters());`.

- [ ] **Step 3: Verify, build, commit**

Run: `npx vitest run && npm run build`

```bash
git add src/main.js src/exports.js
git commit -m "fix: stop mutating characters during render, share effectiveCharacters"
```

---

### Task 5: Export scale (1x/2x/4x)

**Files:**
- Modify: `src/main.js`, `src/exports.js`, `index.html`
- Modify: `tests/unit/bmfont.test.js`

**Interfaces:**
- Produces: `data.exportScale` (number 1|2|4) on the component; `scaleBMFont(bmfont, scale)` named export of `src/exports.js` returning a new bmfont with all pixel fields multiplied.

- [ ] **Step 1: Write failing test for scaleBMFont**

Append to `tests/unit/bmfont.test.js`:

```js
import {scaleBMFont} from '../../src/exports.js';

describe('scaleBMFont', () => {
    it('multiplies all pixel fields', () => {
        const scaled = scaleBMFont(buildBMFontData({...baseInput(), characters: 'AV', measureText: (t) => t === 'AV' ? 18 : measure(t)}), 2);
        expect(scaled.info.size).toBe(32);
        expect(scaled.common).toMatchObject({lineHeight: 40, base: 32, scaleW: 80, scaleH: 40});
        expect(scaled.chars[1]).toMatchObject({x: 40, y: 0, width: 40, height: 40, xadvance: 20});
        expect(scaled.kernings[0].amount).toBe(-4);
    });

    it('returns an identical copy for scale 1', () => {
        const bmfont = buildBMFontData(baseInput());
        expect(scaleBMFont(bmfont, 1)).toEqual(bmfont);
    });
});
```

(Merge the import with the existing import statement from `../../src/exports.js`.)

Run: `npx vitest run` - expected FAIL.

- [ ] **Step 2: Implement scaleBMFont in exports.js**

```js
export const scaleBMFont = (bmfont, scale) => ({
    ...bmfont,
    info: {...bmfont.info, size: bmfont.info.size * scale},
    common: {
        ...bmfont.common,
        lineHeight: bmfont.common.lineHeight * scale,
        base: bmfont.common.base * scale,
        scaleW: bmfont.common.scaleW * scale,
        scaleH: bmfont.common.scaleH * scale,
    },
    chars: bmfont.chars.map((char) => ({
        ...char,
        x: char.x * scale,
        y: char.y * scale,
        width: char.width * scale,
        height: char.height * scale,
        xoffset: char.xoffset * scale,
        yoffset: char.yoffset * scale,
        xadvance: char.xadvance * scale,
    })),
    kernings: bmfont.kernings.map((kerning) => ({...kerning, amount: kerning.amount * scale})),
});
```

Make `buildBMFont` apply it before returning: `return scaleBMFont(buildBMFontData({...}), parseInt(data.exportScale) || 1);`

Run: `npx vitest run` - expected PASS.

- [ ] **Step 3: Wire scale into state and download**

In `src/main.js` add state `exportScale: 1,` (next to `fontSize`). In `download()` change `{pixelRatio: 1}` to `{pixelRatio: parseInt(this.exportScale) || 1}`.

- [ ] **Step 4: Add UI select**

In `index.html`, inside the row of number inputs (after the Font size column) add:

```html
<div class="col">
    <div class="form-floating mb-3">
        <select class="form-select" id="exportScale" x-model.number="exportScale">
            <option value="1">1x</option>
            <option value="2">2x</option>
            <option value="4">4x</option>
        </select>
        <label for="exportScale">Export scale</label>
    </div>
</div>
```

- [ ] **Step 5: Verify, build, commit**

Run: `npx vitest run && npm run build`

```bash
git add src/main.js src/exports.js index.html tests/unit/bmfont.test.js
git commit -m "feat: export scale 1x/2x/4x for PNG and BMFont metrics"
```

---

### Task 6: Colors and configurable outline

Replace the hardcoded white text and the hardcoded 2px black "Shadow" with color pickers (text, outline, background) and an outline width input. The old `shadow` option key is renamed to `outline`.

**Files:**
- Modify: `src/helpers.js`, `src/main.js`, `index.html`
- Modify: `tests/unit/helpers.test.js`

**Interfaces:**
- Produces: `outlineShadow(width, color)` named export of `src/helpers.js` returning a CSS `text-shadow` value; component state `colors: {text, outline, background}` and `outlineWidth`.

- [ ] **Step 1: Write failing test**

Append to `tests/unit/helpers.test.js`:

```js
import {outlineShadow} from '../../src/helpers.js';

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
```

(Merge imports.) Run: `npx vitest run` - expected FAIL.

- [ ] **Step 2: Implement outlineShadow in helpers.js**

```js
export const outlineShadow = (width, color) => {
    const shadows = [];
    for (let x = -width; x <= width; x++) {
        for (let y = -width; y <= width; y++) {
            shadows.push(`${x}px ${y}px 0 ${color}`);
        }
    }
    return shadows.join(', ');
}
```

Run: `npx vitest run` - expected PASS.

- [ ] **Step 3: Rework option styles in main.js**

Import `outlineShadow` from `./helpers`. Change `optionsStyles` entries from plain strings to functions of the component, and rename `shadow` to `outline`:

```js
const optionsStyles = {
    italic: {
        cellStyles: () => `font-style: italic;`
    },
    outline: {
        rowStyles: (data) => `text-shadow: ${outlineShadow(parseInt(data.outlineWidth) || 1, data.colors.outline)};`
    },
    antialiasing: {
        cellStyles: () => `-webkit-font-smoothing: antialiased;`
    },
    subpixel: {
        cellStyles: () => `-webkit-font-smoothing: subpixel-antialiased;`
    },
    showGrid: {
        cellStyles: () => `border: 1px solid #fff`,
    },
    centered: {
        cellStyles: () => `justify-content: center !important; align-items: center !important;`
    }
}
```

In component state: rename `shadow: false` to `outline: false` inside `options`, and add:

```js
colors: {
    text: '#ffffff',
    outline: '#000000',
    background: '',
},
outlineWidth: 2,
```

In `html()`:
- change rowStyles to `let rowStyles = \`display:flex; font-size: ${this.fontSize}px; color: ${this.colors.text};\`;`
- update the style loop to call the functions: `const {cellStyles: cs, rowStyles: rs} = optionsStyles[key] ?? {};` then `if (cs) { cellStyles += cs(this); }` and `if (rs) { rowStyles += rs(this); }`
- change the returned wrapper to `return \`<div id="preview" style="${this.colors.background ? 'background: ' + this.colors.background + ';' : ''}">${html}</div>\`;`

- [ ] **Step 4: Update index.html controls**

Rename the Shadow switch binding and label:

```html
<input class="form-check-input" x-model="options.outline" type="checkbox" role="switch" id="outline">
<label class="form-check-label" for="outline">Outline</label>
```

After the switches card, add a color controls card:

```html
<div class="card p-2 px-3 border-0 mt-2">
    <div class="d-flex align-items-center gap-3 flex-wrap form-control-sm">
        <div class="d-flex align-items-center gap-1">
            <label for="colorText">Text</label>
            <input type="color" class="form-control form-control-color" id="colorText" x-model="colors.text">
        </div>
        <div class="d-flex align-items-center gap-1" x-show="options.outline">
            <label for="colorOutline">Outline</label>
            <input type="color" class="form-control form-control-color" id="colorOutline" x-model="colors.outline">
        </div>
        <div class="d-flex align-items-center gap-1" x-show="options.outline">
            <label for="outlineWidth">Outline width</label>
            <input type="number" min="1" max="4" style="width: 70px;" class="form-control" id="outlineWidth" x-model="outlineWidth">
        </div>
        <div class="d-flex align-items-center gap-1">
            <label for="colorBackground">Background</label>
            <input type="color" class="form-control form-control-color" id="colorBackground" x-model="colors.background">
            <button class="btn btn-sm btn-outline-secondary" @click="colors.background = ''">Transparent</button>
        </div>
    </div>
</div>
```

- [ ] **Step 5: Verify, build, commit**

Run: `npx vitest run && npm run build`

```bash
git add src/helpers.js src/main.js index.html tests/unit/helpers.test.js
git commit -m "feat: text/outline/background colors and configurable outline width"
```

---

### Task 7: Character presets and counter

**Files:**
- Modify: `src/main.js`, `index.html`

**Interfaces:**
- Produces: `characterPresets` const and `addPreset(name)` / `clearCharacters()` methods on the component.

- [ ] **Step 1: Add presets to main.js**

Above the Alpine component definition:

```js
const characterPresets = {
    'ASCII': " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~",
    'Digits': "0123456789",
    'Uppercase': "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    'Polish': "ąćęłńóśźżĄĆĘŁŃÓŚŹŻ",
    'Latin-1': "¡¢£¥§©«®°±²³µ¶·»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ",
};
```

Component methods (next to `uniqueCharacters`):

```js
presetNames() {
    return Object.keys(characterPresets);
},

/**
 * Append preset characters that are not present yet
 */
addPreset(name) {
    const missing = Array.from(characterPresets[name]).filter((char) => !this.characters.includes(char));
    this.characters += missing.join("");
},

clearCharacters() {
    this.characters = "";
},
```

- [ ] **Step 2: Add UI under the characters textarea**

Right after the characters `form-floating` div in `index.html`:

```html
<div class="mb-3 d-flex align-items-center gap-2 flex-wrap" style="color: #fff; font-size: 12px;">
    <span>Presets:</span>
    <template x-for="name in presetNames()">
        <button class="btn btn-sm btn-outline-light" @click="addPreset(name)" x-text="name"></button>
    </template>
    <button class="btn btn-sm btn-outline-danger" @click="clearCharacters()">Clear</button>
    <span class="ms-auto" x-text="`${uniqueCharacters().length} unique / ${characters.length} total`"></span>
</div>
```

- [ ] **Step 3: Verify, build, commit**

Run: `npm run build`

```bash
git add src/main.js index.html
git commit -m "feat: character set presets with append semantics and counter"
```

---

### Task 8: ZIP bundle export (PNG + .fnt + .json)

One download containing the PNG atlas plus matching BMFont files, with consistent file names, honoring export scale.

**Files:**
- Modify: `src/main.js`, `src/exports.js`, `index.html`
- Modify: `package.json` (add jszip)

**Interfaces:**
- Consumes: `buildBMFont(data)`, `serializeBMFontText(bmfont)` from Task 2, `data.exportScale` from Task 5.
- Produces: `data.renderPng()` on the component returning `Promise<string>` (PNG data URL, grid hidden, transparent chrome); export entry `bundle` in `src/exports.js`.

- [ ] **Step 1: Install jszip**

Run: `npm install jszip`

- [ ] **Step 2: Extract renderPng from download() in main.js**

Replace the current `download()` with:

```js
/**
 * Render the preview to a PNG data URL (grid hidden, page chrome stripped)
 * @returns {Promise<string>}
 */
async renderPng() {
    const body = document.querySelector('body');
    const options = this.unproxy(this.options);

    this.options.showGrid = false;
    body.classList.add('downloading');

    await this.$nextTick();

    try {
        return await htmlToImage.toPng(
            document.getElementById('preview'),
            {pixelRatio: parseInt(this.exportScale) || 1}
        );
    } finally {
        body.classList.remove('downloading');
        this.options = options;
    }
},

/**
 * Download bitmap image
 */
async download() {
    try {
        const dataUrl = await this.renderPng();
        download(dataUrl, this.font().name + '.png');
        toast("Downloading!");
    } catch (error) {
        console.error('oops, something went wrong!', error);
        toast("Export failed!");
    }
},
```

Replace the direct `Toastify(...)` call with the shared `toast` helper: add `toast` to the import from `./helpers` and remove the now-unused `Toastify` import and its CSS import only if nothing else uses it (`toastify-js/src/toastify.css` must stay imported - keep the CSS import in main.js).

- [ ] **Step 3: Add bundle export in exports.js**

```js
import JSZip from "jszip";
```

New entry in the default export object:

```js
'bundle': async (data) => {
    const bmfont = await buildBMFont(data);
    const name = data.font().name;
    const dataUrl = await data.renderPng();

    const zip = new JSZip();
    zip.file(name + '.png', dataUrl.split(',')[1], {base64: true});
    zip.file(name + '.fnt', serializeBMFontText(bmfont));
    zip.file(name + '.json', JSON.stringify(bmfont, null, 2));

    download(await zip.generateAsync({type: 'blob'}), name + '.zip', 'application/zip');
    toast("Bundle downloaded!");
},
```

- [ ] **Step 4: Add menu item in index.html**

At the top of the export dropdown list:

```html
<li><a class="dropdown-item" @click="exportCode('bundle')">ZIP bundle (PNG + BMFont)</a></li>
```

- [ ] **Step 5: Verify, build, commit**

Run: `npx vitest run && npm run build`

```bash
git add package.json package-lock.json src/main.js src/exports.js index.html
git commit -m "feat: ZIP bundle export with PNG atlas and BMFont files"
```

---

### Task 9: Sample text preview

A "Sample text" input rendered below the grid using the same font and styling options, so the user sees real text before downloading. Shares style building with `html()` - no duplicated style logic.

**Files:**
- Modify: `src/main.js`, `index.html`

**Interfaces:**
- Produces: `data.sampleText` state, `buildStyles()` and `sampleHtml()` methods.

- [ ] **Step 1: Extract buildStyles and add sampleHtml in main.js**

Add state: `sampleText: '',`

Refactor `html()` so style assembly lives in one place:

```js
/**
 * Build row/cell styles from current options
 * @returns {{rowStyles: string, cellStyles: string}}
 */
buildStyles({fixedGrid = true} = {}) {
    let rowStyles = `display:flex; font-size: ${this.fontSize}px; color: ${this.colors.text};`;
    let cellStyles = `display:flex; align-items: flex-end;`;

    if (fixedGrid && !this.disabledGridSize) {
        cellStyles += `width: ${this.gridWidth}px; height: ${this.gridHeight}px;`;
    }

    for (const [key] of Object.entries(this.options).filter(([key, value]) => value)) {
        const {cellStyles: cs, rowStyles: rs} = optionsStyles[key] ?? {};
        if (cs) {
            cellStyles += cs(this);
        }
        if (rs) {
            rowStyles += rs(this);
        }
    }

    return {rowStyles, cellStyles};
},
```

`html()` then starts with `const {rowStyles, cellStyles} = this.buildStyles();` and keeps only the letter loop.

Add:

```js
/**
 * Sample text rendered with the same styling as the grid
 * @returns {string}
 */
sampleHtml() {
    if (!this.sampleText) {
        return '';
    }
    const {rowStyles, cellStyles} = this.buildStyles({fixedGrid: false});
    const cells = Array.from(this.sampleText)
        .map((char) => `<span class="cell" style="${cellStyles}">${char === ' ' ? '&nbsp;' : char}</span>`)
        .join('');
    return `<div class="line" style="${rowStyles}">${cells}</div>`;
},
```

- [ ] **Step 2: Add UI in index.html**

After the presets row add:

```html
<div class="form-floating mb-3">
    <input type="text" x-model="sampleText" class="form-control form-control-sm border-0" id="sampleText" placeholder="Sample">
    <label for="sampleText">Sample text (preview only, not exported)</label>
</div>
```

Below the main preview `template x-if="font() && !error"` div (inside the same template wrapper div), append:

```html
<div x-show="sampleText" id="sample-preview" style="margin-top: 10px;" x-html="sampleHtml"
     :style="`font-family: '${font()?.name}'; font-weight: ${font()?.weight}; font-style: ${font()?.style};`"></div>
```

Note: `template x-if` requires a single root element - wrap the existing preview div and this new div in one `<div>` if needed.

Also add CSS so the sample is excluded from PNG export (it is outside `#preview`, so nothing extra is required - verify `#preview` does not contain `#sample-preview`).

- [ ] **Step 3: Verify, build, commit**

Run: `npm run build`

```bash
git add src/main.js index.html
git commit -m "feat: sample text preview under the grid"
```

---

### Task 10: Drag and drop font file

**Files:**
- Modify: `src/main.js`, `index.html`

- [ ] **Step 1: Add onDrop handler in main.js**

Next to `onFile`:

```js
onDrop(event) {
    const file = event.dataTransfer.files[0];
    if (!file) {
        return;
    }
    this.inputType = 'file';
    this.loadURL(URL.createObjectURL(file));
},
```

- [ ] **Step 2: Wire on body in index.html**

Extend the body tag:

```html
<body draggable="false" style="user-select: none;" x-data="converter"
      @dragover.prevent @drop.prevent="onDrop($event)">
```

- [ ] **Step 3: Verify, build, commit**

Run: `npm run build`

```bash
git add src/main.js index.html
git commit -m "feat: drag and drop font files onto the page"
```

---

### Task 11: Shareable URL state

Persist configuration to the query string (debounced, via history.replaceState) and restore it on load. Refreshing keeps the setup; the URL is shareable.

**Files:**
- Modify: `src/helpers.js`, `src/main.js`
- Modify: `tests/unit/helpers.test.js`

**Interfaces:**
- Produces: `serializeState(object)` / `deserializeState(string)` named exports of `src/helpers.js`.

- [ ] **Step 1: Write failing tests**

Append to `tests/unit/helpers.test.js`:

```js
import {serializeState, deserializeState} from '../../src/helpers.js';

describe('state serialization', () => {
    it('round-trips a state object', () => {
        const state = {perRow: 19, characters: 'ą"\\ć', options: {outline: true}};
        expect(deserializeState(serializeState(state))).toEqual(state);
    });

    it('returns null for garbage', () => {
        expect(deserializeState('not%valid%json')).toBeNull();
        expect(deserializeState('')).toBeNull();
    });
});
```

(Merge imports.) Run: `npx vitest run` - expected FAIL.

- [ ] **Step 2: Implement in helpers.js**

```js
export const serializeState = (state) => encodeURIComponent(JSON.stringify(state));

export const deserializeState = (raw) => {
    try {
        return JSON.parse(decodeURIComponent(raw));
    } catch (e) {
        return null;
    }
}
```

Run: `npx vitest run` - expected PASS.

- [ ] **Step 3: Wire into main.js**

Import both helpers. Above the component add:

```js
const PERSISTED_KEYS = ['perRow', 'gridWidth', 'gridHeight', 'fontSize', 'exportScale', 'characters', 'sampleText', 'fontUrl', 'inputType', 'options', 'colors', 'outlineWidth'];
```

Component methods:

```js
restoreState() {
    const raw = new URLSearchParams(window.location.search).get('s');
    const saved = raw ? deserializeState(raw) : null;
    if (!saved) {
        return;
    }
    PERSISTED_KEYS.forEach((key) => {
        if (saved[key] === undefined) {
            return;
        }
        if (typeof this[key] === 'object' && this[key] !== null) {
            this[key] = {...this[key], ...saved[key]};
        } else {
            this[key] = saved[key];
        }
    });
},

persistState() {
    const state = {};
    PERSISTED_KEYS.forEach((key) => {
        state[key] = this.unproxy(this[key]);
    });
    if (String(state.fontUrl).startsWith('blob:')) {
        delete state.fontUrl;
        delete state.inputType;
    }
    window.history.replaceState(null, '', '?s=' + serializeState(state));
},
```

In `init()`, as the FIRST statement add `this.restoreState();` (before `this.loadURL(this.fontUrl);`), and at the end add:

```js
PERSISTED_KEYS.forEach((key) => {
    this.$watch(key, () => this.persistState());
});
```

- [ ] **Step 4: Verify, build, commit**

Run: `npx vitest run && npm run build`

```bash
git add src/helpers.js src/main.js tests/unit/helpers.test.js
git commit -m "feat: persist configuration in a shareable URL"
```

---

### Task 12: Playwright e2e suite and final verification

Full browser verification with a committed local font fixture, so tests run without network access. This is the gate proving everything works together.

**Files:**
- Create: `playwright.config.js`, `tests/e2e/app.spec.js`, `public/fonts/PressStart2P-Regular.woff2`
- Modify: `package.json` (add @playwright/test, e2e script), `.gitignore` if needed (playwright-report, test-results)

- [ ] **Step 1: Install Playwright and fixture**

```bash
npm install -D @playwright/test
npx playwright install chromium
curl -L -o public/fonts/PressStart2P-Regular.woff2 --create-dirs "https://fonts.gstatic.com/s/pressstart2p/v14/e3t4euO8T-267oIAQAu6jDQyK3nVivNm4I81.woff2"
```

Add to `package.json` scripts: `"test:e2e": "playwright test"`.
Append to `.gitignore` (create if missing): `test-results/`, `playwright-report/`.

- [ ] **Step 2: Create playwright.config.js**

```js
import {defineConfig} from '@playwright/test';

export default defineConfig({
    testDir: 'tests/e2e',
    timeout: 30000,
    use: {
        baseURL: 'http://localhost:5199',
    },
    webServer: {
        command: 'npx vite --port 5199 --strictPort',
        port: 5199,
        reuseExistingServer: true,
    },
});
```

- [ ] **Step 3: Write the e2e suite**

Create `tests/e2e/app.spec.js`:

```js
import {test, expect} from '@playwright/test';

const FIXTURE_URL = 'http://localhost:5199/fonts/PressStart2P-Regular.woff2';
const ASCII_COUNT = 95;

const loadFixtureFont = async (page) => {
    await page.goto('/');
    await page.fill('#font', FIXTURE_URL);
    await expect(page.locator('#preview .cell').first()).toBeVisible({timeout: 10000});
};

test('renders the full character grid from a local font', async ({page}) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error));

    await loadFixtureFont(page);
    await expect(page.locator('#preview .cell')).toHaveCount(ASCII_COUNT);
    expect(errors).toEqual([]);
});

test('toggling every option keeps the preview alive', async ({page}) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error));

    await loadFixtureFont(page);
    for (const id of ['outline', 'antialiasing', 'subpixel', 'italic', 'centered', 'showGrid', 'removeDuplicates']) {
        await page.check(`#${id}`);
    }
    await expect(page.locator('#preview .cell').first()).toBeVisible();
    for (const id of ['removeDuplicates', 'showGrid', 'subpixel', 'antialiasing', 'outline']) {
        await page.uncheck(`#${id}`);
    }
    await expect(page.locator('#preview .cell')).toHaveCount(ASCII_COUNT);
    expect(errors).toEqual([]);
});

test('remove duplicates dedupes the rendered grid', async ({page}) => {
    await loadFixtureFont(page);
    await page.fill('#characters', 'AAB');
    await expect(page.locator('#preview .cell')).toHaveCount(3);
    await page.check('#removeDuplicates');
    await expect(page.locator('#preview .cell')).toHaveCount(2);
});

test('downloads the PNG bitmap', async ({page}) => {
    await loadFixtureFont(page);
    const downloadPromise = page.waitForEvent('download');
    await page.click('button:has-text("DOWNLOAD BITMAP FONT")');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.png$/);
});

test('exports BMFont .fnt and ZIP bundle', async ({page}) => {
    await loadFixtureFont(page);

    await page.click('#dropdownMenuButton1');
    let downloadPromise = page.waitForEvent('download');
    await page.click('a:has-text("BMFont (.fnt)")');
    expect((await downloadPromise).suggestedFilename()).toMatch(/\.fnt$/);

    await page.click('#dropdownMenuButton1');
    downloadPromise = page.waitForEvent('download');
    await page.click('a:has-text("ZIP bundle")');
    expect((await downloadPromise).suggestedFilename()).toMatch(/\.zip$/);
});

test('kaboom export copies code and shows a toast', async ({page}) => {
    await loadFixtureFont(page);
    await page.click('#dropdownMenuButton1');
    await page.click('a:has-text("KaboomJS")');
    await expect(page.locator('.toastify')).toBeVisible();
});

test('character presets append without duplicates', async ({page}) => {
    await loadFixtureFont(page);
    await page.fill('#characters', '012');
    await page.click('button:has-text("Digits")');
    await expect(page.locator('#characters')).toHaveValue('0123456789');
});

test('state survives a reload via the URL', async ({page}) => {
    await loadFixtureFont(page);
    await page.fill('#characters', 'ABC');
    await page.fill('#perRow', '5');
    await expect(page).toHaveURL(/\?s=/);
    await page.reload();
    await expect(page.locator('#characters')).toHaveValue('ABC');
    await expect(page.locator('#perRow')).toHaveValue('5');
    await expect(page.locator('#preview .cell')).toHaveCount(3);
});

test('sample text preview renders', async ({page}) => {
    await loadFixtureFont(page);
    await page.fill('#sampleText', 'Hello');
    await expect(page.locator('#sample-preview .cell')).toHaveCount(5);
});

test('bad font URL shows an error instead of crashing', async ({page}) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error));

    await page.goto('/');
    await page.fill('#font', 'http://localhost:5199/does-not-exist.woff2');
    await expect(page.locator('.alert-danger')).toBeVisible({timeout: 10000});
    expect(errors).toEqual([]);
});
```

- [ ] **Step 4: Run the suite and fix regressions**

Run: `npx vitest run && npx playwright test && npm run build`
Expected: all unit tests and all e2e tests PASS, build OK. If an e2e test exposes a real bug in an earlier task, fix the bug (not the test) and note it in the commit message.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json playwright.config.js tests/e2e/app.spec.js public/fonts/PressStart2P-Regular.woff2 .gitignore
git commit -m "test: add Playwright e2e suite with local font fixture"
```

---

## Final acceptance checklist (run after all tasks)

- [ ] `npx vitest run` - all unit tests pass
- [ ] `npx playwright test` - all e2e tests pass
- [ ] `npm run build` - production build succeeds
- [ ] `git status` - working tree clean, all work committed
