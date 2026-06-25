// copy from https://github.com/oliver-moran/jimp/blob/master/packages/plugin-threshold/src/index.js

/**
 * Applies a minimum color threshold to a greyscale image.  Converts image to greyscale by default
 * @param {object} options object containing max, replace, autoGreyscale
 * @param {Jimp} image optional Jimp instance passed by v1 engine
 * @return {this} this for chaining of methods
 */
export const thresholdPlugin = {
    threshold(options, image) {
        // If options has a bitmap property, Jimp passed the image context as the first argument
        const activeImage = (options && typeof options === 'object' && options.bitmap) ? options : (image || this);
        const actualOptions = (options && typeof options === 'object' && !options.bitmap) ? options : (image && typeof image === 'object' ? image : {});

        const { max, replace = 255, autoGreyscale = true } = actualOptions;

        if (typeof max !== 'number') {
            throw new Error('max must be a number');
        }

        if (typeof replace !== 'number') {
            throw new Error('replace must be a number');
        }

        if (typeof autoGreyscale !== 'boolean') {
            throw new Error('autoGreyscale must be a boolean');
        }

        const limit255 = (val) => Math.max(0, Math.min(255, val));
        const actualMax = limit255(max);
        const actualReplace = limit255(replace);

        if (autoGreyscale) {
            activeImage.greyscale();
        }

        const w = activeImage.width || activeImage.bitmap?.width;
        const h = activeImage.height || activeImage.bitmap?.height;

        activeImage.scan(0, 0, w, h, (x, y, idx) => {
            const grey = activeImage.bitmap.data[idx] < actualMax ? activeImage.bitmap.data[idx] : actualReplace;

            activeImage.bitmap.data[idx] = grey;
            activeImage.bitmap.data[idx + 1] = grey;
            activeImage.bitmap.data[idx + 2] = grey;
        });

        return activeImage;
    }
};

