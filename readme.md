# Font To Bitmap Converter

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.png)](https://opensource.org/licenses/MIT)

This simple tool allow you to convert fonts (ttf, woff, otf) into **bitmap fonts**.

You can accomplish it in 4 ways:

1. **Font upload** - you can upload a font file directly from your local files.
2. **Font URL** - you can input the direct URL to the font file.
Example: https://fonts.gstatic.com/s/pressstart2p/v14/e3t4euO8T-267oIAQAu6jDQyK3nVivNm4I81.woff2.
3. **Stylesheet URL** - you can input the URL of the stylesheet (css file) that contains the font you want to convert.
Example: https://fonts.googleapis.com/css2?family=Press+Start+2P.
4. **Input autocomplete** - you can use the input autocomplete feature to search for a font from Google Fonts by its name.

![screenshot.png](screenshot.png)

## Live

- https://stmn.itch.io/font2bitmap
- https://stmn.github.io/font2bitmap

## Limitations

- Disabling antialiasing in browsers is now almost technically impossible. If you need a bitmap without antialiasing, I recommend using non-browser tools. I published one of them here:  https://stmn.itch.io/font2bitmap-standalone


- If you enter URL it will not work if the server has disabled 'cross-domain' requests (CORS); however, all public font providers should have disabled it.

## Technicals

Under the hood project uses: Vite, Bootstrap 5, AlpineJS 

- Dev: `npm run dev`
- Build: `npm run build`
