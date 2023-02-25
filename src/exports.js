import {toClipboard} from "./helpers";

export default {
    'construct': async (data) => {
        let spacingData = [];
        let biggestWidth = 0;

        data.disabledGridSize = true;

        await data.$nextTick()

        document.querySelectorAll('.cell').forEach(cell => {
            let found = false;
            for (let i = 0; i < spacingData.length; i++) {
                let width = spacingData[i][0];

                if (width === (Math.ceil(cell.offsetWidth))) {
                    found = i;
                    break;
                }
            }

            if (!found) {
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
            `loadFont("${data.font().name}", "${data.font().name.replace(' ', '_') + '.png'}", ${data.gridWidth}, ${data.gridHeight}, {chars: "${data.characters.replace('\\', '\\\\').replace('"', '\\"')}"})`
        );
    },
}
