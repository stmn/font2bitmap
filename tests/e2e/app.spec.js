import {test, expect} from '@playwright/test';
import path from 'path';

const FIXTURE_PATH = path.join(__dirname, '..', '..', 'public', 'fonts', 'PressStart2P-Regular.woff2');
const FIXTURE_URL = 'http://localhost:5199/fonts/PressStart2P-Regular.woff2';
const ASCII_COUNT = 95;

/**
 * A stylesheet naming one variant of the fixture font, so a served URL can be
 * told apart by the name the app ends up with
 */
const cssFace = (name, {style = 'normal', weight = 400} = {}) =>
    `@font-face { font-family: '${name}'; font-style: ${style}; font-weight: ${weight}; src: url(${FIXTURE_URL}); }`;

/**
 * The same, with both optional descriptors left out - the browser defaults them
 * to normal/400 and the app has nothing to read
 */
const bareCssFace = (name) => `@font-face { font-family: '${name}'; src: url(${FIXTURE_URL}); }`;

/**
 * Serve a stylesheet, optionally after a delay, so a slow load can be raced
 * against a newer one
 */
const routeCssFont = (page, url, name, delay = 0) => page.route(url, async (route) => {
    if (delay) {
        await new Promise((resolve) => setTimeout(resolve, delay));
    }

    await route.fulfill({contentType: 'text/css', body: cssFace(name)});
});

const loadedFontName = (page) => page.evaluate(() => document.body._x_dataStack[0].font()?.name);

/**
 * The app loads a remote font on every page load. Serve the committed fixture
 * instead, so no test depends on the network and every page starts in the same
 * loaded, error free state.
 */
test.beforeEach(async ({page}) => {
    await page.route('https://fonts.gstatic.com/**', (route) => route.fulfill({
        path: FIXTURE_PATH,
        contentType: 'font/woff2',
    }));
});

/**
 * Load the fixture through the dev server, waiting for the response so the
 * preview is known to come from the font just typed in
 */
const loadFixtureFont = async (page) => {
    await page.goto('/');
    const fixtureResponse = page.waitForResponse(FIXTURE_URL);
    await page.fill('#font', FIXTURE_URL);
    await fixtureResponse;
    await expect(page.locator('#preview .cell').first()).toBeVisible({timeout: 10000});
};

/**
 * persistState is debounced and writes every key on every write, so wait for
 * fragments only the expected state can produce instead of racing the timer.
 * Each group holds the accepted spellings of one value.
 */
const waitForPersistedState = async (page, groups) => {
    await page.waitForFunction((expected) => {
        const state = new URLSearchParams(location.search).get('s');
        return Boolean(state) && expected.every((alternatives) => alternatives.some((fragment) => state.includes(fragment)));
    }, groups);
};

test('renders the full character grid from a local font', async ({page}) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error));

    await loadFixtureFont(page);
    await expect(page.locator('#preview .cell')).toHaveCount(ASCII_COUNT);
    // the @font-face is bound with x-text, so make sure it still reaches the CSSOM
    expect(await page.evaluate(() => [...document.fonts].map((font) => font.family))).toContain('font2bitmap');
    expect(errors).toEqual([]);
});

test('a hostile shared link cannot freeze or script the page', async ({page}) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    // the hostile font URL has to resolve, otherwise the error banner replaces the grid
    await page.route('https://example.com/**', (route) => route.fulfill({
        path: FIXTURE_PATH,
        contentType: 'font/woff2',
    }));

    const state = encodeURIComponent(JSON.stringify({
        perRow: 0,
        outlineWidth: 500,
        fontUrl: 'https://example.com/</style><img src=x onerror=window.__xss=1>',
        options: {outline: true},
    }));

    await page.goto('/?s=' + state);

    // perRow 0 used to loop forever - clamped to 1, so every character gets its own line
    await expect(page.locator('#preview .cell')).toHaveCount(ASCII_COUNT, {timeout: 10000});
    await expect(page.locator('#preview .line')).toHaveCount(ASCII_COUNT);
    await expect(page.locator('#outlineWidth')).toHaveValue('4');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(errors).toEqual([]);
});

test('toggling every option keeps the preview alive', async ({page}) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error));

    await loadFixtureFont(page);
    for (const id of ['outline', 'antialiasing', 'subpixel', 'italic', 'centered', 'showGrid']) {
        await page.check(`#${id}`);
    }
    await expect(page.locator('#preview .cell').first()).toBeVisible();
    for (const id of ['showGrid', 'subpixel', 'antialiasing', 'outline']) {
        await page.uncheck(`#${id}`);
    }
    await expect(page.locator('#preview .cell')).toHaveCount(ASCII_COUNT);
    expect(errors).toEqual([]);
});

test('the remove duplicates button dedupes the character set', async ({page}) => {
    await loadFixtureFont(page);
    await page.fill('#characters', 'AAB');
    await expect(page.locator('#preview .cell')).toHaveCount(3);
    await page.click('#removeDuplicates');
    await expect(page.locator('#characters')).toHaveValue('AB');
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

test('kaplay export copies code and shows a toast', async ({page}) => {
    await loadFixtureFont(page);
    await page.click('#dropdownMenuButton1');
    await page.click('a:has-text("KaPlay")');
    await expect(page.locator('.toastify')).toBeVisible();
});

/**
 * The presets used to only append what was missing, so from the default full
 * ASCII set every ASCII preset was a silent no-op. They replace now.
 */
test('a preset replaces the characters, even from the default set', async ({page}) => {
    await loadFixtureFont(page);
    await expect(page.locator('#preview .cell')).toHaveCount(ASCII_COUNT);

    await page.click('#presetsDropdown');
    await page.click('.dropdown-item:has-text("Digits")');
    await expect(page.locator('#characters')).toHaveValue('0123456789');
    await expect(page.locator('#preview .cell')).toHaveCount(10);

    await page.click('#presetsDropdown');
    await page.click('.dropdown-item:has-text("Uppercase")');
    await expect(page.locator('#characters')).toHaveValue('ABCDEFGHIJKLMNOPQRSTUVWXYZ');

    // the entry named after the starting set puts it back
    await page.click('#presetsDropdown');
    await page.click('.dropdown-item:has-text("ASCII (default)")');
    await expect(page.locator('#preview .cell')).toHaveCount(ASCII_COUNT);
});

test('a "+" extension appends to the current set instead of replacing it', async ({page}) => {
    await loadFixtureFont(page);
    const before = await page.inputValue('#characters');

    await page.click('#presetsDropdown');
    await page.click('.dropdown-item:has-text("+ Polish")');

    await expect(page.locator('#characters')).not.toHaveValue(before);
    const after = await page.inputValue('#characters');
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.startsWith(before)).toBe(true);
    expect(after).toContain('ą');
    expect(after).toContain('A');
    await expect(page.locator('#preview .cell')).toHaveCount(Array.from(after).length);

    // only what is missing gets added, so a second click changes nothing
    await page.click('#presetsDropdown');
    await page.click('.dropdown-item:has-text("+ Polish")');
    await expect(page.locator('#characters')).toHaveValue(after);
    expect(new Set(after).size).toBe(after.length);
});

test('all glyphs in font fills the characters from the font cmap', async ({page}) => {
    await loadFixtureFont(page);
    await page.fill('#characters', 'A');

    await page.click('#presetsDropdown');
    await expect(page.locator('#allGlyphs')).not.toHaveClass(/disabled/);
    // reachable by keyboard while it is usable
    await expect(page.locator('#allGlyphs')).not.toHaveAttribute('tabindex', '-1');
    await page.click('#allGlyphs');
    // the toast reports what was loaded, it does not claim an append
    await expect(page.locator('.toastify')).toContainText(/^\d+ glyphs loaded!$/);

    // Press Start 2P covers ASCII and then some
    await expect(page.locator('#characters')).not.toHaveValue('A');
    const characters = await page.inputValue('#characters');
    expect(characters).toContain('A');
    expect(characters).toContain('z');
    expect(characters).toContain('0');
    expect(Array.from(characters).length).toBeGreaterThan(90);
    // control characters from the cmap never reach the grid
    expect(characters).not.toContain('\r');
    // ascending, so the digits come before the letters
    expect(characters.indexOf('0')).toBeLessThan(characters.indexOf('A'));

    await expect(page.locator('#preview .cell')).toHaveCount(Array.from(characters).length);
});

test('the presets dropdown can clear the characters', async ({page}) => {
    await loadFixtureFont(page);
    await page.click('#presetsDropdown');
    await page.click('.dropdown-item:has-text("Clear")');
    await expect(page.locator('#characters')).toHaveValue('');
    await expect(page.locator('#preview .cell')).toHaveCount(0);
});

test('state survives a reload via the URL', async ({page}) => {
    await loadFixtureFont(page);
    await page.fill('#characters', 'ABC');
    await page.fill('#perRow', '5');
    await waitForPersistedState(page, [['"characters":"ABC"'], ['"perRow":5', '"perRow":"5"']]);
    await expect(page).toHaveURL(/\?s=/);
    await page.reload();
    await expect(page.locator('#characters')).toHaveValue('ABC');
    await expect(page.locator('#perRow')).toHaveValue('5');
    await expect(page.locator('#preview .cell')).toHaveCount(3);
});

/**
 * Embedded in an iframe the query string is not ours to keep, so the state is
 * mirrored into localStorage. It is never applied behind the user's back though,
 * the "Last session" link is what brings it back
 */
test('a saved session comes back only when it is asked for', async ({page}) => {
    await loadFixtureFont(page);
    await page.fill('#characters', 'XYZ');
    await page.fill('#perRow', '5');
    await waitForPersistedState(page, [['"characters":"XYZ"'], ['"perRow":5', '"perRow":"5"']]);

    // a plain load, no query string: the defaults, nothing restored silently
    await page.goto('/');
    await expect(page.locator('#preview .cell')).toHaveCount(ASCII_COUNT);
    await expect(page.locator('#perRow')).toHaveValue('19');
    await expect(page.locator('#lastSession')).not.toHaveClass(/disabled/);

    await page.click('#lastSession');
    await expect(page.locator('#characters')).toHaveValue('XYZ');
    await expect(page.locator('#perRow')).toHaveValue('5');
    await expect(page.locator('#font')).toHaveValue(FIXTURE_URL);
    // this session came back on its URL, so that is what the radio says and
    // the URL input stays on screen
    await expect(page.locator('#inputType_fontUrl')).toBeChecked();
    await expect(page.locator('#font')).toBeVisible();
    await expect(page.locator('#preview .cell')).toHaveCount(3);

    await waitForPersistedState(page, [['"characters":"XYZ"'], ['"inputType":"fontUrl"']]);
});

/**
 * Upload the fixture through the file input and wait for the grid it renders
 * from the blob URL
 */
const uploadFixtureFont = async (page) => {
    await page.goto('/');
    await expect(page.locator('#preview .cell').first()).toBeVisible({timeout: 10000});

    await page.check('#inputType_file');
    await page.setInputFiles('#file', FIXTURE_PATH);
    await page.fill('#characters', 'XYZ');
    await expect(page.locator('#preview .cell')).toHaveCount(3);
};

const FIXTURE_FILE_NAME = 'PressStart2P-Regular.woff2';

/**
 * A blob URL dies with the session that made it, so an uploaded font can only
 * come back if its bytes were kept. They go to IndexedDB, the saved state
 * carries nothing but the file name
 */
test('a saved session brings an uploaded font file back', async ({page}) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error));

    await uploadFixtureFont(page);
    await waitForPersistedState(page, [
        ['"inputType":"file"'],
        [`"fontFile":{"name":"${FIXTURE_FILE_NAME}"}`],
        ['"characters":"XYZ"'],
    ]);

    // a plain load, back on the default font
    await page.goto('/');
    await expect(page.locator('#preview .cell')).toHaveCount(ASCII_COUNT);

    await page.click('#lastSession');

    await expect(page.locator('#inputType_file')).toBeChecked();
    // a file input cannot be filled from script, the hint says what is loaded
    await expect(page.locator('#restoredFile')).toHaveText(`Restored: ${FIXTURE_FILE_NAME}`);
    await expect(page.locator('#characters')).toHaveValue('XYZ');
    await expect(page.locator('#preview .cell')).toHaveCount(3);
    // the face is served from a fresh blob, so the bytes did come out of
    // IndexedDB and not from the default font the page had loaded
    await expect
        .poll(() => page.evaluate(() => document.querySelector('style[x-text]').textContent))
        .toContain('url(blob:');

    // a URL font takes over from the restored upload, so the hint has to go
    await page.check('#inputType_fontUrl');
    await page.fill('#font', FIXTURE_URL);
    await page.check('#inputType_file');
    // the row has to be back on screen first, or the hint counts as hidden
    // because its whole row is
    await expect(page.locator('#file')).toBeVisible();
    await expect(page.locator('#restoredFile')).toBeHidden();
    await expect(page.locator('#preview .cell')).toHaveCount(3);

    expect(errors).toEqual([]);
});

/**
 * The marker survives in a share link, the bytes behind it never leave the
 * browser that stored them
 */
test('a session whose uploaded font is gone restores without it', async ({page}) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error));

    await uploadFixtureFont(page);
    await waitForPersistedState(page, [['"inputType":"file"'], ['"characters":"XYZ"']]);

    // what another machine sees: the state is there, the font bytes are not
    await page.evaluate(() => new Promise((resolve) => {
        const request = indexedDB.deleteDatabase('font2bitmap');
        request.onsuccess = request.onerror = request.onblocked = () => resolve();
    }));

    await page.goto('/');
    await expect(page.locator('#preview .cell')).toHaveCount(ASCII_COUNT);

    await page.click('#lastSession');

    await expect(page.locator('.toastify')).toContainText('Saved font file is no longer available');
    // everything but the font still comes back, on the font already loaded,
    // which is the one the URL source points at
    await expect(page.locator('#inputType_fontUrl')).toBeChecked();
    await expect(page.locator('#characters')).toHaveValue('XYZ');
    await expect(page.locator('#preview .cell')).toHaveCount(3);
    await expect(page.locator('#restoredFile')).toBeHidden();
    expect(errors).toEqual([]);
});

/**
 * A write can be skipped, over the size cap, or refused outright, which leaves
 * an earlier upload in store. Loading those bytes under the name of the file
 * this session was working on would be the wrong font, silently
 */
test('a stored font from another upload is not restored in its place', async ({page}) => {
    await uploadFixtureFont(page);
    await waitForPersistedState(page, [['"inputType":"file"'], ['"characters":"XYZ"']]);

    await page.evaluate(() => new Promise((resolve, reject) => {
        const open = indexedDB.open('font2bitmap', 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const put = db.transaction('files', 'readwrite').objectStore('files')
                .put({name: 'other.ttf', type: 'font/ttf', data: new ArrayBuffer(8)}, 'lastFont');
            put.onerror = () => reject(put.error);
            put.onsuccess = () => {
                db.close();
                resolve();
            };
        };
    }));

    await page.goto('/');
    await expect(page.locator('#preview .cell')).toHaveCount(ASCII_COUNT);

    await page.click('#lastSession');

    await expect(page.locator('.toastify')).toContainText('Saved font file is no longer available');
    await expect(page.locator('#characters')).toHaveValue('XYZ');
    await expect(page.locator('#restoredFile')).toBeHidden();
});

/**
 * The snapshot used to be handed to the component by reference, so the nested
 * options and colors objects were the very same ones the app then mutated
 */
test('restoring a session twice is not poisoned by the first restore', async ({page}) => {
    await loadFixtureFont(page);
    await page.fill('#characters', 'XYZ');
    await waitForPersistedState(page, [['"characters":"XYZ"'], ['"showGrid":false']]);

    await page.goto('/');
    await page.click('#lastSession');
    await expect(page.locator('#characters')).toHaveValue('XYZ');
    await expect(page.locator('#showGrid')).not.toBeChecked();

    await page.check('#showGrid');
    await page.fill('#characters', 'Q');

    // back to the very same snapshot, which the toggle must not have changed.
    // The link restores on every click, there is no mode to leave first
    await page.click('#lastSession');
    await expect(page.locator('#characters')).toHaveValue('XYZ');
    await expect(page.locator('#showGrid')).not.toBeChecked();
});

/**
 * A CSS font URL is never the URL of the binary the font ends up loaded from,
 * so the stashed variant used to be dropped whenever the restored session kept
 * the CSS URL that was already in the input
 */
test('a restored session keeps the selected font variant of a CSS URL', async ({page}) => {
    const cssUrl = 'http://localhost:5199/multi.css';
    await page.route(cssUrl, (route) => route.fulfill({
        contentType: 'text/css',
        body: cssFace('Multi') + cssFace('Multi', {style: 'italic', weight: 700}),
    }));

    /**
     * The page starts loading its default font on its own, so that one has to
     * be done before the CSS URL is typed - two loads in flight race each other
     */
    const loadTwoVariants = async () => {
        await page.goto('/');
        await expect(page.locator('#preview .cell').first()).toBeVisible({timeout: 10000});

        const css = page.waitForResponse(cssUrl);
        await page.fill('#font', cssUrl);
        await css;
        await expect(page.locator('#floatingSelect')).toHaveValue('0');
    };

    await loadTwoVariants();
    await page.selectOption('#floatingSelect', '1');
    await page.fill('#characters', 'XYZ');
    await waitForPersistedState(page, [['"fontIndex":1', '"fontIndex":"1"'], ['"characters":"XYZ"']]);

    // same CSS URL as the one already in the input, so nothing reloads
    await loadTwoVariants();

    await page.click('#lastSession');
    // the restore is one synchronous step, so the variant is settled as soon
    // as the characters are - read it once, retrying would hide a late reload
    await expect(page.locator('#characters')).toHaveValue('XYZ');
    expect(await page.inputValue('#floatingSelect')).toBe('1');
});

/**
 * A @font-face may declare neither weight nor style, and the preview binds both
 * as a style object. Whatever the previous font asked for has to go with it,
 * or the preview would stay synthetically bold and italic while the export,
 * which reads the descriptors themselves, would not
 */
test('a face without weight and style descriptors resets the preview', async ({page}) => {
    const boldUrl = 'http://localhost:5199/bold.css';
    const bareUrl = 'http://localhost:5199/bare.css';

    await page.route(boldUrl, (route) => route.fulfill({
        contentType: 'text/css',
        body: cssFace('BoldFace', {style: 'italic', weight: 700}),
    }));
    await page.route(bareUrl, (route) => route.fulfill({
        contentType: 'text/css',
        body: bareCssFace('BareFace'),
    }));

    await page.goto('/');
    await expect(page.locator('#preview .cell').first()).toBeVisible({timeout: 10000});

    const cell = page.locator('#preview .cell').first();

    const bold = page.waitForResponse(boldUrl);
    await page.fill('#font', boldUrl);
    await bold;
    await expect.poll(() => loadedFontName(page)).toBe('BoldFace');
    await expect(cell).toHaveCSS('font-weight', '700');
    await expect(cell).toHaveCSS('font-style', 'italic');

    const bare = page.waitForResponse(bareUrl);
    await page.fill('#font', bareUrl);
    await bare;
    await expect.poll(() => loadedFontName(page)).toBe('BareFace');
    await expect(cell).toHaveCSS('font-weight', '400');
    await expect(cell).toHaveCSS('font-style', 'normal');
});

/**
 * Every URL typed starts its own load and they are not cancelled, so a slow
 * early one used to land last and win
 */
test('a slow font request cannot overwrite a newer one', async ({page}) => {
    const slowUrl = 'http://localhost:5199/slow.css';
    const fastUrl = 'http://localhost:5199/fast.css';

    await routeCssFont(page, slowUrl, 'SlowFont', 1500);
    await routeCssFont(page, fastUrl, 'FastFont');

    await page.goto('/');
    await expect(page.locator('#preview .cell').first()).toBeVisible({timeout: 10000});

    // past the input debounce, so the slow request is really in flight
    await page.fill('#font', slowUrl);
    await page.waitForTimeout(300);

    const fast = page.waitForResponse(fastUrl);
    const slow = page.waitForResponse(slowUrl);
    await page.fill('#font', fastUrl);
    await fast;
    await expect.poll(() => loadedFontName(page)).toBe('FastFont');

    // the slow response has to be dropped when it finally lands
    await slow;
    expect(await loadedFontName(page)).toBe('FastFont');
    expect(await page.evaluate(() => document.body._x_dataStack[0].loading)).toBe(false);
    await expect(page.locator('.alert-danger')).toHaveCount(0);
    await expect(page.locator('#preview .cell')).toHaveCount(ASCII_COUNT);
});

/**
 * Asking for the font that is already loaded is still a newer intent than a
 * load in flight, so it has to invalidate it
 */
test('going back to the loaded font drops a slow request', async ({page}) => {
    const slowUrl = 'http://localhost:5199/slow-back.css';
    await routeCssFont(page, slowUrl, 'SlowFont', 1500);

    // a bare font binary is loaded under its own URL, which is what makes
    // retyping it hit the "already loaded" shortcut
    await loadFixtureFont(page);
    expect(await loadedFontName(page)).toBe('font2bitmap');

    const slow = page.waitForResponse(slowUrl);
    await page.fill('#font', slowUrl);
    await page.waitForTimeout(300);
    await page.fill('#font', FIXTURE_URL);

    await slow;
    expect(await loadedFontName(page)).toBe('font2bitmap');
    // the invalidated load will not clear the spinner it turned on
    expect(await page.evaluate(() => document.body._x_dataStack[0].loading)).toBe(false);
    await expect(page.locator('#preview .cell')).toHaveCount(ASCII_COUNT);
});

test('the last session link is disabled without a saved session', async ({page}) => {
    await page.goto('/');
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();

    const link = page.locator('#lastSession');
    await expect(link).toHaveClass(/disabled/);
    await expect(link).toHaveAttribute('aria-disabled', 'true');
    await expect(link).toHaveCSS('pointer-events', 'none');
    // a disabled link has to drop out of the tab order too
    await expect(link).toHaveAttribute('tabindex', '-1');
    await expect(link.locator('..')).toHaveAttribute('title', 'No saved session yet');
});

test('the sample text preview replaces the grid and can be edited', async ({page}) => {
    await loadFixtureFont(page);

    // the tabs are always reachable, only the text they render is behind the switch
    await expect(page.locator('#previewModeSample')).toBeVisible();
    await expect(page.locator('#previewModeBitmap')).toHaveClass(/active/);
    await expect(page.locator('#sampleText')).toBeHidden();
    await page.check('#advanced');
    await expect(page.locator('#sampleText')).toHaveValue('The quick brown fox jumps over the lazy dog 0123456789');
    await page.fill('#sampleText', 'Hello');

    await page.click('#previewModeSample');
    await expect(page.locator('#previewModeSample')).toHaveClass(/active/);
    await expect(page.locator('#previewModeBitmap')).not.toHaveClass(/active/);
    await expect(page.locator('#sample-preview .cell')).toHaveCount(5);
    await expect(page.locator('#preview')).toBeHidden();

    await page.click('#previewModeBitmap');
    await expect(page.locator('#previewModeBitmap')).toHaveClass(/active/);
    await expect(page.locator('#preview .cell')).toHaveCount(ASCII_COUNT);
    await expect(page.locator('#sample-preview')).toBeHidden();
});

/**
 * The font bindings used to be a string :style, and Alpine rewrites the whole
 * style attribute for those, so every font change threw away the display:none
 * that x-show had written and the sample preview popped up on its own
 */
test('changing the font leaves the hidden preview hidden', async ({page}) => {
    const otherUrl = 'http://localhost:5199/other.css';
    const thirdUrl = 'http://localhost:5199/third.css';
    await routeCssFont(page, otherUrl, 'OtherFont');
    await routeCssFont(page, thirdUrl, 'ThirdFont');

    await loadFixtureFont(page);
    await expect(page.locator('#sample-preview')).toBeHidden();

    await page.fill('#font', otherUrl);
    await expect.poll(() => loadedFontName(page)).toBe('OtherFont');

    await expect(page.locator('#sample-preview')).toBeHidden();
    await expect(page.locator('#preview .cell')).toHaveCount(ASCII_COUNT);

    // and the other way round, the grid must not come back in sample mode
    await page.click('#previewModeSample');
    await expect(page.locator('#preview')).toBeHidden();

    await page.fill('#font', thirdUrl);
    await expect.poll(() => loadedFontName(page)).toBe('ThirdFont');
    await expect(page.locator('#preview')).toBeHidden();
    await expect(page.locator('#sample-preview')).toBeVisible();
});

test('the PNG still downloads while the sample preview is shown', async ({page}) => {
    await loadFixtureFont(page);
    await page.click('#previewModeSample');
    await expect(page.locator('#preview')).toBeHidden();

    const downloadPromise = page.waitForEvent('download');
    await page.click('button:has-text("DOWNLOAD BITMAP FONT")');
    expect((await downloadPromise).suggestedFilename()).toMatch(/\.png$/);

    // the grid is only forced on screen for the capture
    await expect(page.locator('#preview')).toBeHidden();
});

test('the more options switch hides the extra controls', async ({page}) => {
    await loadFixtureFont(page);

    // it is the last switch of the row, right after the rendering options
    await expect(page.locator('label[for=advanced]')).toHaveText('More options');
    expect(await page.locator('#showGrid').evaluate((el) =>
        [...el.closest('.card').querySelectorAll('input[role=switch]')].map((input) => input.id)))
        .toEqual(['outline', 'antialiasing', 'subpixel', 'italic', 'centered', 'showGrid', 'advanced']);

    for (const id of ['colorText', 'colorBackground', 'exportScale', 'sampleText']) {
        await expect(page.locator(`#${id}`)).toBeHidden();
    }
    // the plain switches and the preview tabs stay reachable without them
    await expect(page.locator('#centered')).toBeVisible();
    await expect(page.locator('#previewModeBitmap')).toBeVisible();

    await page.check('#advanced');
    for (const id of ['colorText', 'colorBackground', 'exportScale', 'sampleText']) {
        await expect(page.locator(`#${id}`)).toBeVisible();
    }

    // the outline controls used to ignore the outline switch: Bootstrap's
    // .d-flex is display:flex !important and beat the x-show display:none
    await expect(page.locator('#outlineWidth')).toBeHidden();
    await page.check('#outline');
    await expect(page.locator('#outlineWidth')).toBeVisible();
    await page.uncheck('#outline');
    await expect(page.locator('#outlineWidth')).toBeHidden();
});

/**
 * Bootstrap's small button and select are a few pixels shorter than a colour
 * swatch, which left the row of advanced controls visibly ragged
 */
test('every control in the advanced row is the same height', async ({page}) => {
    await loadFixtureFont(page);
    await page.check('#advanced');
    await page.check('#outline');

    const heights = await page.locator('#advancedControls')
        .evaluate((row) => [...row.querySelectorAll('input, select, button')]
            .map((control) => control.getBoundingClientRect().height));

    // both swatches, the outline width, the background swatch, Transparent and
    // the export scale
    expect(heights).toHaveLength(6);
    expect([...new Set(heights)]).toEqual([38]);
});

/**
 * Switching to the sample only changes what is inside the frame, so both
 * previews have to wear the same one
 */
test('both previews wear the same frame', async ({page}) => {
    await loadFixtureFont(page);
    await page.check('#advanced');

    const frame = (selector) => page.locator(selector).evaluate((el) => {
        const style = getComputedStyle(el);
        return [style.border, style.borderRadius, style.padding].join(' | ');
    });

    const bitmap = await frame('#preview');
    expect(bitmap).toContain('5px solid');

    await page.click('#previewModeSample');
    await expect(page.locator('#sample-preview')).toBeVisible();
    expect(await frame('#sample-preview')).toBe(bitmap);
});

test('rapid x-show toggles do not throw', async ({page}) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await loadFixtureFont(page);

    // Alpine used to throw "i is not a function" when the same x-show element
    // was hidden twice before its hide promise settled
    await page.evaluate(async () => {
        const data = document.body._x_dataStack[0];
        for (let n = 0; n < 20; n++) {
            data.loading = true;
            data.sampleText = 'x';
            data.inputType = 'file';
            await Promise.resolve();
            data.loading = false;
            data.sampleText = '';
            data.inputType = 'fontUrl';
            await Promise.resolve();
        }
    });

    await expect(page.locator('#preview .cell')).toHaveCount(ASCII_COUNT);
    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
});

/**
 * Type a broken font URL from a known good state, so the banner can only be
 * the result of that URL failing
 */
const expectErrorBanner = async (page, brokenUrl) => {
    await loadFixtureFont(page);
    await expect(page.locator('.alert-danger')).toHaveCount(0);

    await page.fill('#font', brokenUrl);
    await expect(page.locator('.alert-danger')).toBeVisible({timeout: 10000});
    await expect(page.locator('#preview')).toHaveCount(0);
    // nothing to preview, so the tabs go away with the grid they switch
    await expect(page.locator('#previewModeBitmap')).toBeHidden();

    // and there is no font binary to read glyphs from
    await page.click('#presetsDropdown');
    await expect(page.locator('#allGlyphs')).toHaveClass(/disabled/);
    // a disabled dropdown item has to drop out of the tab order too
    await expect(page.locator('#allGlyphs')).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('Escape');
};

test('bad font URL shows an error instead of crashing', async ({page}) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error));

    await expectErrorBanner(page, 'http://localhost:5199/does-not-exist.woff2');
    expect(errors).toEqual([]);
});

test('a failed font request shows an error instead of crashing', async ({page}) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error));

    await page.route('**/cors-blocked.css', (route) => route.abort('failed'));
    await expectErrorBanner(page, 'http://localhost:5199/cors-blocked.css');
    expect(errors).toEqual([]);
});
