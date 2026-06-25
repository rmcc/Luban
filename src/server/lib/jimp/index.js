import { createJimp } from '@jimp/core';
import { defaultFormats, defaultPlugins } from 'jimp';
import JPEG from 'jpeg-js';

import { greyscalePlugin } from './jimp-plugin-greyscale.js';
import { halftonePlugin } from './jimp-plugin-halftone.js';
import { thresholdPlugin } from './jimp-plugin-threshold.js';
import { alphaToWhitePlugin } from './jimp-plugin-alphaToWhite.js';
import { bwPlugin } from './jimp-plugin-bw.js';

const customJpegDecoder = (data) => JPEG.decode(data, {
    maxMemoryUsageInMB: 6144,
    maxResolutionInMP: 600
});

const configuredFormats = defaultFormats.map(formatFactory => {
    const formatInstance = formatFactory();

    if (formatInstance.mime === 'image/jpeg') {
        return () => ({
            ...formatInstance,
            decoders: {
                ...formatInstance.decoders,
                'image/jpeg': customJpegDecoder
            }
        });
    }

    return formatFactory;
});

const Jimp = createJimp({
    formats: configuredFormats,
    plugins: [
        ...defaultPlugins,
        greyscalePlugin,
        halftonePlugin,
        thresholdPlugin,
        alphaToWhitePlugin,
        bwPlugin
    ]
});

// add jimp plugins here, write processor outside is not recommended
export default Jimp;
