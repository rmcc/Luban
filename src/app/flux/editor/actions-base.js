import { MINIMUM_WIDTH_AND_HEIGHT } from '../../constants/index';
import {
    ACTION_RESET_CALCULATED_STATE,
    ACTION_UPDATE_CONFIG,
    ACTION_UPDATE_GCODE_CONFIG,
    ACTION_UPDATE_STATE,
} from '../actionType';

/**
 * 1 pt = 1/72 inch
 * 1 inch = 25.4mm
 * @param text
 * @param fontSize: font size, unit is pt.
 * @param lineHeight
 * @param size
 * @returns {{width: number, height: number}}
 */
export const computeTransformationSizeForTextVector = (text, fontSize, lineHeight, size) => {
    // convertTextToSvg calculates sizes by converting the size in points to mm...
    // multiplied by 10. Bring it back down to mm by dividing again and use that value
    // directly instead of using fontSize-based math AGAIN. We have all we need in the size object,
    // don't even need to calculate the multiple lines... if it wasn't for that multiplier, this
    // transformation wouldn't be needed at all.
    // See svg-convert.js for the origin of the "magic 10":
    // const estimatedFontSize = (fontSize / 72 * 25.4 * 10) * (realUnitsPerEm) / unitsPerEm;
    let height = size.height / 10;
    let width = height / size.height * size.width;

    if (!width) {
        width = MINIMUM_WIDTH_AND_HEIGHT;
    }
    if (!height) {
        height = MINIMUM_WIDTH_AND_HEIGHT;
    }

    return {
        width,
        height
    };
};

const checkHeadType = (headType) => {
    if (!['laser', 'cnc'].includes(headType)) {
        console.error('headType is error', headType);
    }
};


export const baseActions = {
    updateState: (headType, state) => {
        checkHeadType(headType);
        return {
            type: ACTION_UPDATE_STATE,
            headType,
            state
        };
    },

    updateGcodeConfig: (headType, gcodeConfig) => {
        checkHeadType(headType);
        return {
            type: ACTION_UPDATE_GCODE_CONFIG,
            headType,
            gcodeConfig
        };
    },

    updateConfig: (headType, config) => {
        checkHeadType(headType);
        return {
            type: ACTION_UPDATE_CONFIG,
            headType,
            config
        };
    },

    // Model configurations
    resetCalculatedState: (headType) => {
        checkHeadType(headType);
        return {
            type: ACTION_RESET_CALCULATED_STATE,
            headType
        };
    },

    render: (headType) => (dispatch) => {
        checkHeadType(headType);
        dispatch(baseActions.updateState(headType, {
            renderingTimestamp: +new Date()
        }));
    }
};
