import Alpine from "alpinejs";
import download from "downloadjs"
import * as htmlToImage from 'html-to-image'
import {deserializeState, isValidURL, outlineShadow, parseFontFaces, serializeState, toast} from "./helpers";
import exports from "./exports";
import "toastify-js/src/toastify.css"


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

const characterPresets = {
    'ASCII': " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~",
    'Digits': "0123456789",
    'Uppercase': "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    'Polish': "ąćęłńóśźżĄĆĘŁŃÓŚŹŻ",
    'Latin-1': "¡¢£¥§©«®°±²³µ¶·»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ",
};

const PERSISTED_KEYS = ['perRow', 'gridWidth', 'gridHeight', 'fontSize', 'exportScale', 'characters', 'sampleText', 'fontUrl', 'inputType', 'options', 'colors', 'outlineWidth', 'fontIndex'];

const PERSIST_DELAY = 300;
const EXPORT_SCALES = [1, 2, 4];
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

const asInt = (value) => {
    const number = parseInt(value);
    return Number.isNaN(number) ? undefined : number;
};

const asString = (value) => typeof value === 'string' ? value : undefined;

const asOneOf = (allowed) => (value) => allowed.includes(value) ? value : undefined;

const asColor = (value) => value === '' || HEX_COLOR.test(String(value)) ? value : undefined;

/**
 * Merge saved values over the current object, keeping only known keys
 * whose value survives the sanitizer
 */
const mergeSanitized = (saved, current, sanitize) => {
    if (typeof saved !== 'object' || saved === null) {
        return undefined;
    }

    const merged = {...current};
    Object.keys(current).forEach((key) => {
        const value = sanitize(saved[key]);
        if (saved[key] !== undefined && value !== undefined) {
            merged[key] = value;
        }
    });

    return merged;
};

/**
 * URL state is attacker controlled and ends up inside x-html style attributes,
 * so every restored value has to be validated before it is assigned
 */
const STATE_SANITIZERS = {
    perRow: asInt,
    gridWidth: asInt,
    gridHeight: asInt,
    fontSize: asInt,
    outlineWidth: asInt,
    fontIndex: asInt,
    exportScale: (value) => asOneOf(EXPORT_SCALES)(asInt(value)),
    characters: asString,
    sampleText: asString,
    inputType: asOneOf(['fontUrl', 'file']),
    fontUrl: (value) => isValidURL(value) ? value : undefined,
    options: (value, current) => mergeSanitized(value, current, (option) => Boolean(option)),
    colors: (value, current) => mergeSanitized(value, current, asColor),
};

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
    characters: characterPresets['ASCII'],
    sampleText: '',

    inputType: 'fontUrl', // fontUrl or file
    fontUrl: 'https://fonts.gstatic.com/s/pressstart2p/v14/e3t4euO8T-267oIAQAu6jDQyK3nVivNm4I81.woff2',
    file: null,

    options: {
        outline: false,
        antialiasing: false,
        subpixel: false,
        italic: false,
        centered: true,
        showGrid: false,
        removeDuplicates: false,
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

    fontsList() {
        return googleFonts.items.map((font) => {
            return {
                name: font.family,
                url: 'https://fonts.googleapis.com/css2?family=' + (font.family.replace(/ /g, '+')) + ':wght@100;200;300;400;600;700;800;900',
            };
        })
    },

    init() {
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

        PERSISTED_KEYS.forEach((key) => {
            this.$watch(key, () => this.persistState());
        });
    },

    /**
     * Restore persisted configuration from the query string
     */
    restoreState() {
        const raw = new URLSearchParams(window.location.search).get('s');
        const saved = raw ? deserializeState(raw) : null;
        if (!saved || typeof saved !== 'object') {
            return;
        }

        PERSISTED_KEYS.forEach((key) => {
            if (saved[key] === undefined) {
                return;
            }

            const value = STATE_SANITIZERS[key](saved[key], this[key]);
            if (value === undefined) {
                return;
            }

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
     * Queue a query string update, coalescing bursts of changes
     */
    persistState() {
        clearTimeout(this.persistTimeout);
        this.persistTimeout = setTimeout(() => this.writeState(), PERSIST_DELAY);
    },

    /**
     * Write the current configuration into the query string
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

        try {
            window.history.replaceState(null, '', '?s=' + serializeState(state));
        } catch (e) {
            // browsers throttle replaceState, dropping one update is harmless
        }
    },

    /**
     * Load font from a local File object
     * @param file
     */
    loadFile(file) {
        return this.loadURL(URL.createObjectURL(file));
    },

    onFile(event) {
        this.loadFile(event.target.files[0]);
    },

    onDrop(event) {
        const file = event.dataTransfer.files[0];
        if (!file) {
            return;
        }
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
     * Characters actually rendered on the grid
     * @returns {string}
     */
    effectiveCharacters() {
        return this.options.removeDuplicates ? this.uniqueCharacters() : this.characters;
    },

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
     * Return bitmap styles
     * @returns {string}
     */
    css() {
        if (!this.font()) {
            return ''
        }

        let css = '';
        this.fonts.forEach((font, index) => {
            css += font.css;
        });

        return `<style>${css}</style>`;
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
        let letters = Array.from(this.effectiveCharacters());
        while (letters.length) {
            html += `<div class="line" style="${rowStyles}">`;
            for (let i = 0; i < this.perRow && letters.length; i++) {
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

    exportCode(name) {
        exports[name](this);
    },
}))

Alpine.start()
