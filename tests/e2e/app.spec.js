import {test, expect} from '@playwright/test';
import path from 'path';

const FIXTURE_PATH = path.join(__dirname, '..', '..', 'public', 'fonts', 'PressStart2P-Regular.woff2');
const FIXTURE_URL = 'http://localhost:5199/fonts/PressStart2P-Regular.woff2';
const ASCII_COUNT = 95;

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
    await waitForPersistedState(page, [['"characters":"ABC"'], ['"perRow":5', '"perRow":"5"']]);
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
