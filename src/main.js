import Alpine from "alpinejs";
import download from "downloadjs"
import * as htmlToImage from 'html-to-image'
import {
    clampOutlineWidth,
    codepointsToCharacters,
    deserializeState,
    fontFileTooLarge,
    glyphsLoadedMessage,
    isValidURL,
    loadFontCodepoints,
    outlineShadow,
    parseFontFaces,
    PERSISTED_KEYS,
    positiveInt,
    readStoredFontFile,
    readStoredState,
    sanitizeState,
    serializeState,
    storedFontFileToFile,
    toast,
    writeStoredFontFile,
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

    inputType: 'fontUrl', // fontUrl or file
    fontUrl: 'https://fonts.gstatic.com/s/pressstart2p/v14/e3t4euO8T-267oIAQAu6jDQyK3nVivNm4I81.woff2',
    file: null,

    // marker of an uploaded font session: the bytes are in IndexedDB, a blob
    // URL would be dead by the time the state is read back
    fontFile: null,

    // view only, the name a restored upload came back under. A file input
    // cannot be filled programmatically, so the hint says what is loaded
    restoredFontName: null,

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
    savedFontFile: null,
    loadGeneration: 0,

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

        // the bytes of the previous upload, kept as the promise itself: every
        // write of this session is chained onto it, so a fast upload can never
        // land before the read that has to see what came before it
        this.savedFontFile = readStoredFontFile();

        this.restoreState();

        this.loadURL(this.fontUrl);

        this.$watch('fontUrl', async () => {
            if (isValidURL(this.fontUrl)) {
                // whatever upload was restored is not what is loaded any more
                this.restoredFontName = null;
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
     * Bring the previous session back. The radio ends up on the source the
     * font came back from: the upload of that session if its bytes are still
     * around, the URL that is loaded in every other case
     * @returns {Promise<void>}
     */
    async restoreSavedSession() {
        if (!this.savedSession) {
            return;
        }

        const {inputType, fontFile, ...state} = this.savedSession;
        const previousUrl = this.fontUrl;

        this.applyState(state);
        this.inputType = 'fontUrl';

        // an upload only comes back if the session really had one: the radio
        // can be moved to "From File" without ever picking a file
        if (inputType === 'file' && fontFile) {
            await this.restoreSavedFontFile(fontFile);
            return;
        }

        // a changed URL reloads the font and takes the stashed variant with it.
        // An unchanged one never does, so hand it over here. Comparing the two
        // fontUrl values is what decides it: a CSS URL and the binary the font
        // ends up loaded from are never the same string
        if (this.fontUrl === previousUrl) {
            this.fontIndex = this.takeRestoredFontIndex();
        }
    },

    /**
     * Load the font the previous session uploaded, from the bytes read in init.
     * They can be gone for good: storage cleared, or a share link carrying the
     * marker opened on another machine. The current font stays in that case
     * @param marker the {name} of the file that session was working on
     * @returns {Promise<void>}
     */
    async restoreSavedFontFile(marker) {
        const record = await this.savedFontFile;

        // the names have to line up, or what is in store belongs to an earlier
        // upload: a write can be skipped over the size cap or refused outright
        const file = record?.name === marker.name ? storedFontFileToFile(record) : null;

        if (!file) {
            // the stashed variant belongs to the session that cannot come back
            this.takeRestoredFontIndex();
            toast("Saved font file is no longer available");
            return;
        }

        this.inputType = 'file';
        await this.loadFile(file, {remember: false});
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

            // options and colors have to be copied, or the saved session ends
            // up being the live object every later toggle writes into
            this[key] = value && typeof value === 'object' ? {...value} : value;
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

        // the blob URL of an uploaded font dies with the session, so only the
        // marker is kept - the bytes behind it are in IndexedDB. Without a
        // marker there is no upload to come back to, so the URL source stays
        if (state.inputType === 'file' && state.fontFile) {
            delete state.fontUrl;
        } else {
            delete state.fontFile;
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
     * @param remember keep the bytes for the next session. Off for the restore
     * of a session, which is reading those very bytes back
     */
    loadFile(file, {remember = true} = {}) {
        if (!file) {
            return;
        }

        this.fontFile = {name: file.name};
        this.restoredFontName = remember ? null : file.name;

        if (remember) {
            if (fontFileTooLarge(file)) {
                toast("Font file too large to remember");
            }

            // chained onto the read of init, which must not see this write
            this.savedFontFile = this.savedFontFile
                .then(async (previous) => {
                    await writeStoredFontFile(file);
                    return previous;
                });
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
            toast(glyphsLoadedMessage(characters));
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
        // Typing in the URL field starts a load per URL and a slow one can land
        // after a newer one. Every load takes a ticket and drops out silently
        // once it is no longer the newest, so only the last one touches
        // loading, error, fonts and the stashed font variant. The ticket is
        // taken first: asking for the font that is already loaded is still a
        // newer intent than whatever is in flight
        const generation = ++this.loadGeneration;
        const stale = () => generation !== this.loadGeneration;

        if (this.font()?.url === url) {
            // the load just invalidated will bail out silently, so the spinner
            // it turned on has to be cleared here
            this.loading = false;
            return;
        }

        this.loading = true;
        this.error = false;

        let response;
        try {
            response = await fetch(url);
        } catch (e) {
            if (stale()) {
                return;
            }

            this.error = true;
            this.loading = false;
            return;
        }

        if (stale()) {
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

        if (stale()) {
            return;
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
     * Font of the current variant, as a style object. Both previews bind it,
     * and the object form only ever touches the properties it names
     * @returns {Object}
     */
    previewFont() {
        const font = this.font();

        // a @font-face may omit weight and style. An empty string removes the
        // property, undefined would be written out as the invalid value
        // "undefined" and only ever cleared by Alpine undoing the last binding
        return {
            'font-family': `'${font?.name}'`,
            'font-weight': font?.weight ?? '',
            'font-style': font?.style ?? '',
        };
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
