import Alpine from "alpinejs";
import download from "downloadjs"
import * as htmlToImage from 'html-to-image'
import {
    clampOutlineWidth,
    codepointsToCharacters,
    deserializeState,
    isValidURL,
    loadFontCodepoints,
    outlineShadow,
    parseFontFaces,
    PERSISTED_KEYS,
    positiveInt,
    readStoredState,
    sanitizeState,
    serializeState,
    toast,
    writeStoredState
} from "./helpers";
import exports from "./exports";
import "toastify-js/src/toastify.css"


const optionsStyles = {
    italic: {
        cellStyles: () => `font-style: italic;`
    },
    outline: {
        rowStyles: (data) => `text-shadow: ${outlineShadow(clampOutlineWidth(data.outlineWidth), data.colors.outline)};`
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

/**
 * Preset the app starts with, so its menu entry says so
 */
const DEFAULT_PRESET = 'ASCII (default)';

/**
 * A base set is the whole character set and replaces what is there, an
 * extension only tops the current set up with what it is missing. The dropdown
 * marks the second kind with a leading "+"
 */
const characterPresets = {
    base: {
        [DEFAULT_PRESET]: " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~",
        'Digits': "0123456789",
        'Uppercase': "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    },
    extension: {
        'Polish': "ąćęłńóśźżĄĆĘŁŃÓŚŹŻ",
        'Latin-1': "¡¢£¥§©«®°±²³µ¶·»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ",
    },
};

const PERSIST_DELAY = 300;

/**
 * Past this many characters the grid and the exports get slow enough
 * that the user deserves a warning
 */
const SLOW_CHARACTERS = 2000;

window.googleFonts = Alpine.reactive({items: []})

Alpine.data('converter', (a) => ({
    loading: false,
    error: false,

    perRow: 19,
    gridWidth: 30,
    gridHeight: 30,
    disabledGridSize: false,
    fontSize: 24,
    exportScale: 1,
    characters: characterPresets.base[DEFAULT_PRESET],
    sampleText: 'The quick brown fox jumps over the lazy dog 0123456789',

    // view only, never persisted
    advanced: false,
    previewMode: 'bitmap', // bitmap or sample
    glyphsLoading: false,

    inputType: 'fontUrl', // fontUrl, file or lastSession
    fontUrl: 'https://fonts.gstatic.com/s/pressstart2p/v14/e3t4euO8T-267oIAQAu6jDQyK3nVivNm4I81.woff2',
    file: null,

    options: {
        outline: false,
        antialiasing: false,
        subpixel: false,
        italic: false,
        centered: true,
        showGrid: false,
    },

    colors: {
        text: '#ffffff',
        outline: '#000000',
        background: '',
    },
    outlineWidth: 2,

    fontIndex: 0,
    fonts: [],

    restoredFontIndex: null,
    persistTimeout: null,
    savedSession: null,

    fontsList() {
        return googleFonts.items.map((font) => {
            return {
                name: font.family,
                url: 'https://fonts.googleapis.com/css2?family=' + (font.family.replace(/ /g, '+')) + ':wght@100;200;300;400;600;700;800;900',
            };
        })
    },

    init() {
        // read before anything of this session can overwrite it
        this.savedSession = this.readSavedSession();

        this.restoreState();

        this.loadURL(this.fontUrl);

        this.$watch('fontUrl', async () => {
            if (isValidURL(this.fontUrl)) {
                await this.loadURL(this.fontUrl);
            }
        })

        this.$watch('options', async () => {
            if (!this.options.antialiasing) {
                this.options.subpixel = false;
            }
        })

        // the mode toggle lives in the advanced section, so closing it would
        // strand the user on a sample preview they can no longer switch back
        this.$watch('advanced', (advanced) => {
            if (!advanced) {
                this.previewMode = 'bitmap';
            }
        })

        PERSISTED_KEYS.forEach((key) => {
            this.$watch(key, () => this.persistState());
        });
    },

    /**
     * Configuration from a share link. Storage is deliberately not read here,
     * a previous session only comes back when the user asks for it
     */
    restoreState() {
        const raw = new URLSearchParams(window.location.search).get('s');

        this.applyState(sanitizeState(raw ? deserializeState(raw) : null, this));
    },

    /**
     * Snapshot the previous session left in storage, or null. It has to be read
     * before the first write of this session, which would overwrite it
     * @returns {Object|null}
     */
    readSavedSession() {
        const raw = readStoredState();
        const saved = sanitizeState(raw ? deserializeState(raw) : null, this);

        return Object.keys(saved).length ? saved : null;
    },

    hasSavedSession() {
        return Boolean(this.savedSession);
    },

    /**
     * Bring the previous session back. The radio stays on "Last session": the
     * snapshot of a file upload carries no source at all, and any other
     * snapshot would only put the radio back on "From URL"
     */
    restoreSavedSession() {
        if (!this.savedSession) {
            return;
        }

        const {inputType, ...state} = this.savedSession;
        this.applyState(state);

        // a changed URL reloads the font and takes the stashed variant with it,
        // an unchanged one never does, so hand it over here
        if (this.font()?.url === this.fontUrl) {
            this.fontIndex = this.takeRestoredFontIndex();
        }
    },

    /**
     * Copy an already sanitized state object onto the component
     */
    applyState(state) {
        Object.entries(state).forEach(([key, value]) => {
            if (key === 'fontIndex') {
                // loadURL resets fontIndex once the fonts are fetched, so stash it
                this.restoredFontIndex = value;
                return;
            }

            this[key] = value;
        });
    },

    /**
     * Font variant to select after a load, honouring a restored URL state once
     * @returns {number}
     */
    takeRestoredFontIndex() {
        const index = this.restoredFontIndex;
        this.restoredFontIndex = null;
        return index !== null && index >= 0 && index < this.uniqueFonts().length ? index : 0;
    },

    /**
     * Queue a state write, coalescing bursts of changes
     */
    persistState() {
        clearTimeout(this.persistTimeout);
        this.persistTimeout = setTimeout(() => this.writeState(), PERSIST_DELAY);
    },

    /**
     * Write the current configuration into the query string and into storage
     */
    writeState() {
        const state = {};
        PERSISTED_KEYS.forEach((key) => {
            state[key] = this.unproxy(this[key]);
        });

        // a locally uploaded font cannot be shared, so do not persist a stale source
        if (state.inputType === 'file') {
            delete state.fontUrl;
            delete state.inputType;
        }

        // "Last session" is a restore action, never a source to restore into
        if (state.inputType === 'lastSession') {
            state.inputType = 'fontUrl';
        }

        try {
            window.history.replaceState(null, '', '?s=' + serializeState(state));
        } catch (e) {
            // browsers throttle replaceState, dropping one update is harmless
        }

        writeStoredState(state);
    },

    /**
     * Load font from a local File object
     * @param file
     */
    loadFile(file) {
        if (!file) {
            return;
        }
        return this.loadURL(URL.createObjectURL(file));
    },

    onFile(event) {
        this.loadFile(event.target.files[0]);
    },

    /**
     * Only a dropped file is handled here - text drops have to keep their
     * default behaviour, otherwise dragging text into an input does nothing
     */
    onDrop(event) {
        const file = event.dataTransfer?.files[0];
        if (!file) {
            return;
        }
        event.preventDefault();
        this.inputType = 'file';
        this.loadFile(file);
    },

    /**
     * Get current selected font
     * @returns {*}
     */
    font() {
        return this.uniqueFonts()[this.fontIndex];
    },

    /**
     * Get unique fonts variants
     * @returns {*[]}
     */
    uniqueFonts() {
        return this.fonts.filter((font, index) => {
            return this.fonts.findIndex((f) => f.name === font.name && f.weight === font.weight && f.style === font.style) === index;
        });
    },

    /**
     * Get unique Characters
     * @returns {string}
     */
    uniqueCharacters() {
        return [...new Set(this.characters)].join("");
    },

    /**
     * Drop every repeated character from the current set, once
     */
    removeDuplicates() {
        this.characters = this.uniqueCharacters();
    },

    /**
     * @param group base or extension
     * @returns {string[]}
     */
    presetNames(group) {
        return Object.keys(characterPresets[group]);
    },

    /**
     * Replace the current set with a base preset
     */
    setPreset(name) {
        this.characters = characterPresets.base[name];
    },

    /**
     * Top the current set up with the characters of an extension it is missing
     */
    addPreset(name) {
        const missing = Array.from(characterPresets.extension[name])
            .filter((char) => !this.characters.includes(char));

        this.characters += missing.join("");
    },

    clearCharacters() {
        this.characters = "";
    },

    /**
     * The font binary has to be fetched and parsed to know its glyphs, so the
     * menu entry has to wait for a font to be there
     * @returns {boolean}
     */
    glyphsAvailable() {
        // a failed load leaves the previous font in place, so error has to be
        // checked as well - the same condition the preview itself uses
        return Boolean(this.font()) && !this.error && !this.loading && !this.glyphsLoading;
    },

    /**
     * Replace the current set with every printable character the loaded font
     * actually maps
     */
    async useAllGlyphs() {
        if (!this.glyphsAvailable()) {
            return;
        }

        this.glyphsLoading = true;

        try {
            const characters = codepointsToCharacters(await loadFontCodepoints(this.font().url));

            if (!characters) {
                toast("No glyphs found in this font!");
                return;
            }

            this.characters = characters;

            // one glyph can be a surrogate pair, so codepoints are what counts
            const glyphs = Array.from(characters).length;

            toast(glyphs > SLOW_CHARACTERS
                ? `${glyphs} glyphs loaded, exporting will be slow!`
                : `${glyphs} glyphs loaded!`);
        } catch (e) {
            console.error(e);
            toast("Could not read the glyphs of this font!");
        } finally {
            this.glyphsLoading = false;
        }
    },

    /**
     * Loading font from provided URL
     * @param url
     * @returns {Promise<void>}
     */
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
        this.fontIndex = this.takeRestoredFontIndex();
        this.loading = false;
    },

    /**
     * Return bitmap styles as bare CSS. It is bound with x-text into a style
     * element, so remote stylesheet text is never parsed as HTML
     * @returns {string}
     */
    css() {
        if (!this.font()) {
            return ''
        }

        let css = '';
        this.fonts.forEach((font) => {
            css += font.css;
        });

        return css;
    },

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

    /**
     * Return bitmap HTML
     * @returns {string}
     */
    html() {
        let html = '';
        const {rowStyles, cellStyles} = this.buildStyles();

        // Prepare HTML
        const perRow = positiveInt(this.perRow);
        let letters = Array.from(this.characters);
        while (letters.length) {
            html += `<div class="line" style="${rowStyles}">`;
            for (let i = 0; i < perRow && letters.length; i++) {
                html += `<span class="cell" style="${cellStyles}">${letters.shift()}</span>`;
            }
            html += `</div>`;
        }

        return `<div id="preview" style="${this.colors.background ? 'background: ' + this.colors.background + ';' : ''}">${html}</div>`;
    },

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

    /**
     * Remove object reactivity
     */
    unproxy(data) {
        return JSON.parse(JSON.stringify(data));
    },

    /**
     * Run a callback with the character grid on screen, then put the preview
     * back the way the user left it. Anything measuring or capturing #preview
     * needs this, a hidden element has no size and captures blank
     * @returns {Promise<*>}
     */
    async withBitmapPreview(callback) {
        const previewMode = this.previewMode;
        this.previewMode = 'bitmap';

        await this.$nextTick();

        try {
            return await callback();
        } finally {
            this.previewMode = previewMode;
        }
    },

    /**
     * Render the preview to a PNG data URL (grid hidden, page chrome stripped)
     * @returns {Promise<string>}
     */
    async renderPng() {
        const body = document.querySelector('body');
        const options = this.unproxy(this.options);

        this.options.showGrid = false;
        body.classList.add('downloading');

        try {
            return await this.withBitmapPreview(() => htmlToImage.toPng(
                document.getElementById('preview'),
                {pixelRatio: parseInt(this.exportScale) || 1}
            ));
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

    async exportCode(name) {
        try {
            await exports[name](this);
        } catch (e) {
            console.error(e);
            toast("Export failed!");
        }
    },
}))

Alpine.start()
