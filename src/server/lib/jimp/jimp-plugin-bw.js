/**
 * Applies a bwThreshold  to a greyscale image.
  * @param {number} options object
 *  threshold: A number auto limited between 0 - 255. value > threshold => 255, else 0
 *  autoGreyscale: (optional) A boolean whether to apply greyscale beforehand (default true)
 * @return {this} this for chaining of methods
 */
export const bwPlugin = {
    bw(threshold, image) {
        const activeImage = typeof threshold === 'object' && threshold.bitmap ? threshold : (image || this);
        let actualThreshold = typeof threshold === 'number' ? threshold : 128;

        if (typeof threshold !== 'number' && !(typeof threshold === 'object' && threshold.bitmap)) {
            throw new Error('threshold must be a number');
        }

        const limit255 = (val) => Math.max(0, Math.min(255, val));
        actualThreshold = limit255(actualThreshold);

        const w = activeImage.width || activeImage.bitmap?.width;
        const h = activeImage.height || activeImage.bitmap?.height;

        activeImage.scan(0, 0, w, h, (x, y, idx) => {
            const value = activeImage.bitmap.data[idx] < actualThreshold ? 0 : 255;
            activeImage.bitmap.data[idx] = value;
            activeImage.bitmap.data[idx + 1] = value;
            activeImage.bitmap.data[idx + 2] = value;
        });

        return activeImage;
    }
};
