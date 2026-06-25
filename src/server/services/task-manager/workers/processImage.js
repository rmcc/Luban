import { processMode } from '../../../lib/ProcessMode';
import sendMessage from '../utils/sendMessage';

const processImage = async (modelInfo) => {
    const onProgress = (num) => {
        sendMessage({ status: 'progress', value: num });
    };

    if (!modelInfo) {
        sendMessage({ status: 'fail', value: 'modelInfo is empty.' });
        return;
    }

    try {
        const ret = await processMode(modelInfo, onProgress);
        sendMessage({ status: 'complete', value: ret });
    } catch (e) {
        sendMessage({ status: 'fail', value: String(e) });
        throw e instanceof Error ? e : new Error(String(e));
    }
};

export default processImage;
