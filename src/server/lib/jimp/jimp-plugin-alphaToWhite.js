/**
 * justify opacity to img, just like put img before white paper
 * @return {this} this for chaining of methods
 */
export const alphaToWhitePlugin = {
    alphaToWhite(image) {
        const activeImage = image || this;

        const w = activeImage.width || activeImage.bitmap?.width;
        const h = activeImage.height || activeImage.bitmap?.height;

        activeImage.scan(0, 0, w, h, (x, y, idx) => {
            const opacity = 1 - activeImage.bitmap.data[idx + 3] / 255;
            for (let i = 0; i < 3; i++) {
                activeImage.bitmap.data[idx + i] += (255 - activeImage.bitmap.data[idx + i]) * opacity;
            }

            activeImage.bitmap.data[idx + 3] = 255;
        });

        return activeImage;
    }
};
