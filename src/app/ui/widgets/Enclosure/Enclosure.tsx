import React, { useEffect, useState } from 'react';
import { shallowEqual, useSelector } from 'react-redux';

import SocketEvent from '../../../communication/socket-events';
import { RootState } from '../../../flux/index.def';
import { controller } from '../../../communication/socket-communication';
import i18n from '../../../lib/i18n';
import Switch from '../../components/Switch';
import TipTrigger from '../../components/TipTrigger';
import { SnapmakerJ1Machine } from '../../../machines';

const Enclosure: React.FC = () => {
    const { isConnected } = useSelector((state: RootState) => state.workspace);

    const {
        connectionType,
        enclosureLight,
        headType,
        enclosureFan,
        enclosureDoorDetection,
        machineIdentifier
    } = useSelector((state: RootState) => state.workspace, shallowEqual);

    const [isLedReady, setIsLedReady] = useState(true);
    const [isFanReady, setIsFanReady] = useState(true);
    const [isDoorEnabledReady, setIsDoorEnabledReady] = useState(true);

    const actions = {
        onHandleLed: async () => {
            const _led = enclosureLight === 0 ? 100 : 0;
            setIsLedReady(false);
            controller.emitEvent(SocketEvent.SetEnclosureLight, {
                value: _led
            });
        },
        onHandleCoolingFans: async () => {
            const _fan = enclosureFan === 0 ? 100 : 0;
            setIsFanReady(false);
            controller.emitEvent(SocketEvent.SetEnclosureFan, {
                value: _fan
            });
        },
        onHandleDoorEnabled: () => {
            setIsDoorEnabledReady(false);
            controller.emitEvent(SocketEvent.SetEnclosureDoorDetection, {
                enable: !enclosureDoorDetection
            });
        }
    };

    useEffect(() => {
        setIsLedReady(true);
    }, [enclosureLight]);

    useEffect(() => {
        setIsFanReady(true);
    }, [enclosureFan]);

    useEffect(() => {
        setIsDoorEnabledReady(true);
    }, [enclosureDoorDetection]);

    return (
        <div>
            <div className="margin-bottom-8">
                <div className="sm-flex justify-space-between margin-vertical-8">
                    <span>{i18n._('key-Workspace/Enclosure-LED Strips')}</span>
                    <Switch
                        onClick={actions.onHandleLed}
                        checked={Boolean(enclosureLight)}
                        disabled={(!isLedReady) || !isConnected}
                    />
                </div>

                {machineIdentifier !== SnapmakerJ1Machine.identifier && (
                    <div className="sm-flex justify-space-between margin-vertical-8">
                        <span>{i18n._('key-Workspace/Enclosure-Exhaust Fan')}</span>
                        <Switch
                            onClick={actions.onHandleCoolingFans}
                            checked={Boolean(enclosureFan)}
                            disabled={(!isFanReady) || !isConnected}
                        />
                    </div>
                )}
                {(isConnected && connectionType === 'wifi' && headType !== '3dp') && (
                    <TipTrigger
                        title={i18n._('key-Workspace/Enclosure-Door Detection')}
                        content={(
                            <div>
                                <p>{i18n._('key-Workspace/Enclosure-If you disable the Door Detection feature,\r\nyour job will not pause when one of both of the enclosure panels is/are opened.')}</p>
                            </div>
                        )}
                    >
                        <div className="sm-flex justify-space-between margin-vertical-8 ">
                            <span>{i18n._('key-Workspace/Enclosure-Door Detection')}</span>
                            <Switch
                                onClick={actions.onHandleDoorEnabled}
                                checked={Boolean(enclosureDoorDetection)}
                                disabled={(!isDoorEnabledReady) || !isConnected}
                            />
                        </div>
                    </TipTrigger>
                )}
            </div>
        </div>
    );
};

export default Enclosure;
