// fix greyscale

const EPS = 1e-6;

const getGrey = (algorithm, R, G, B) => {
    let grey;
    if (algorithm === 'Luster') {
        grey = (Math.max(R, G, B) + Math.min(R, G, B)) * 0.5;
    } else if (algorithm === 'Luminance') {
        grey = 0.3 * R + 0.59 * G + 0.11 * B;
    } else {
        grey = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    }
    return parseInt(grey + EPS, 10);
};

export const greyscalePlugin = {
    greyscale(algorithm, image) {
        // Handle Jimp 1.x vs 0.x argument shifting safely
        const activeImage = typeof algorithm === 'object' && algorithm.bitmap ? algorithm : (image || this);
        const actualAlgorithm = typeof algorithm === 'string' ? algorithm : undefined;

        const data = activeImage.bitmap?.data;
        if (data) {
            const len = data.length;
            for (let idx = 0; idx < len; idx += 4) {
                const grey = getGrey(actualAlgorithm, data[idx], data[idx + 1], data[idx + 2]);
                data[idx] = grey;
                data[idx + 1] = grey;
                data[idx + 2] = grey;
            }
        }

        return activeImage;
    }
};
