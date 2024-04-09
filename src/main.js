import Alpine from "alpinejs";
import download from "downloadjs"
import * as htmlToImage from 'html-to-image'
import {isValidURL} from "./helpers";
import exports from "./exports";
import Toastify from 'toastify-js'
import "toastify-js/src/toastify.css"


const optionsStyles = {
    italic: {
        cellStyles: `font-style: italic;`
    },
    shadow: {
        rowStyles: `text-shadow: -2px -2px 0 black, -2px -1px 0 black, -2px 0px 0 black, -2px 1px 0 black, -2px 2px 0 black, -1px -2px 0 black, -1px -1px 0 black, -1px 0px 0 black, -1px 1px 0 black, -1px 2px 0 black, 0px -2px 0 black, 0px -1px 0 black, 0px 0px 0 black, 0px 1px 0 black, 0px 2px 0 black, 1px -2px 0 black, 1px -1px 0 black, 1px 0px 0 black, 1px 1px 0 black, 1px 2px 0 black, 2px -2px 0 black, 2px -1px 0 black, 2px 0px 0 black, 2px 1px 0 black, 2px 2px 0 black`
    },
    antialiasing: {
        cellStyles: `-webkit-font-smoothing: antialiased;`
    },
    subpixel: {
        cellStyles: `-webkit-font-smoothing: subpixel-antialiased;`
    },
    showGrid: {
        cellStyles: `border: 1px solid #fff`,
    },
    centered: {
        cellStyles: `justify-content: center !important; align-items: center !important;`
    }
}

window.googleFonts = Alpine.reactive({items: []})

Alpine.data('converter', (a) => ({
    loading: false,
    error: false,

    perRow: 19,
    gridWidth: 30,
    gridHeight: 30,
    disabledGridSize: false,
    fontSize: 24,
    characters: " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~",

    inputType: 'fontUrl', // fontUrl or file
    fontUrl: 'https://fonts.gstatic.com/s/pressstart2p/v14/e3t4euO8T-267oIAQAu6jDQyK3nVivNm4I81.woff2',
    file: null,

    options: {
        shadow: false,
        antialiasing: false,
        subpixel: false,
        italic: false,
        centered: true,
        showGrid: false,
    },

    fontIndex: 0,
    fonts: [],

    fontsList() {
        return googleFonts.items.map((font) => {
            return {
                name: font.family,
                url: 'https://fonts.googleapis.com/css2?family=' + (font.family.replace(/ /g, '+')) + ':wght@100;200;300;400;600;700;800;900',
            };
        })
    },

    init() {
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
    },

    onFile(event) {
        let url = URL.createObjectURL(event.target.files[0]);
        this.loadURL(url)
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

        let fonts = []

        try {
            let response = (await fetch(url).catch((e) => {
                this.error = true;
                this.loading = false;
            }));

            if (!response.ok) {
                this.error = true;
                this.loading = false;
                return;
            }

            (await response.text()).replace(/@font-face\s*{[^}]*}/g, (css) => {
                const url = css.match(/url\(([^)]+)\)/)?.[1];
                const name = css.match(/font-family:\s*['"]?([^'";]+)['"]?/)?.[1];
                const weight = css.match(/font-weight:\s*['"]?([^'";]+)['"]?/)?.[1];
                const style = css.match(/font-style:\s*['"]?([^'";]+)['"]?/)?.[1];

                fonts.push({url, name, weight, style, css})
            });

            if (!fonts.length) {
                throw new Error('No fonts found');
            }
        } catch (e) {
            fonts = [{
                url: url,
                weight: 400,
                style: 'normal',
                name: 'font2bitmap',
                css: `@font-face { font-family: 'font2bitmap'; src: url(${url}); }`
            }];
        }

        this.fonts = fonts;
        this.fontIndex = fonts.length > 0 ? 0 : null;
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
     * Return bitmap HTML
     * @returns {string}
     */
    html() {
        let html = '';
        let rowStyles = `display:flex; font-size: ${this.fontSize}px;`;
        let cellStyles = `display:flex; align-items: flex-end;`;

        if (!this.disabledGridSize) {
            cellStyles += `width: ${this.gridWidth}px; height: ${this.gridHeight}px;`;
        }

        // Prepare styles
        for (const [key] of Object.entries(this.options).filter(([key, value]) => value)) {
            const {cellStyles: cs, rowStyles: rs} = optionsStyles[key] ?? {};
            if (cs) {
                cellStyles += cs;
            }
            if (rs) {
                rowStyles += rs;
            }
        }

        // Prepare HTML
        this.characters = [...new Set(this.characters)];
        let letters = this.characters;
        while (letters.length) {
            html += `<div class="line" style="${rowStyles}">`;
            for (let i = 0; i < this.perRow && letters.length; i++) {
                html += `<span class="cell" style="${cellStyles}">${letters.shift()}</span>`;
            }
            html += `</div>`;
        }

        return `<div id="preview">${html}</div>`;
    },

    /**
     * Remove object reactivity
     */
    unproxy(data) {
        return JSON.parse(JSON.stringify(data));
    },

    /**
     * Download bitmap image
     */
    download() {
        const body = document.querySelector('body');
        const options = this.unproxy(this.options);

        this.options.showGrid = false;
        body.classList.add('downloading');

        setTimeout(() => {
            htmlToImage.toPng(
                document.getElementById('preview'), {pixelRatio: 1}
            )
                .then((dataUrl) => {
                    download(dataUrl, this.font().name + '.png');
                    body.classList.remove('downloading');
                    this.options = options;
                })
                .catch((error) => {
                    console.error('oops, something went wrong!', error)
                    body.classList.remove('downloading');
                    this.options = options;
                });
        }, 1);

        Toastify({
            text: "Downloading!",
            duration: 2000,
            gravity: "bottom",
            position: "right",
        }).showToast();
    },

    exportCode(name) {
        exports[name](this);
    },
}))

Alpine.start()