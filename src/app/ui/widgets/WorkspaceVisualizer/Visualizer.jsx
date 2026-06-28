import { WorkflowStatus } from '@snapmaker/luban-platform';
import TWEEN from '@tweenjs/tween.js';
import colornames from 'colornames';
import isEqual from 'lodash/isEqual';
import PropTypes from 'prop-types';
import pubsub from 'pubsub-js';
import React from 'react';
import { connect } from 'react-redux';
import * as THREE from 'three';
import { includes } from 'lodash';
import { toast } from 'react-toastify';
import { humanReadableTime } from '../../../lib/time-utils';

import {
    CONNECTION_TYPE_SERIAL,
    HEAD_CNC,
    HEAD_LASER,
    HEAD_PRINTING,
    IMAGE_WIFI_ERROR,
    IMAGE_WIFI_WARNING,
    MARLIN,
    PROTOCOL_TEXT,
} from '../../../constants';
import { WORKSPACE_STAGE, actions as workspaceActions } from '../../../flux/workspace';
import gcodeActions from '../../../flux/workspace/actions-gcode';
import { controller } from '../../../communication/socket-communication';
import i18n from '../../../lib/i18n';
import log from '../../../lib/log';
import TargetPoint from '../../../scene/three-extensions/TargetPoint';
import modalSmallHOC from '../../components/Modal/modal-small';
import ModalSmall from '../../components/Modal/ModalSmall';
import ProgressBar from '../../components/ProgressBar';
import Canvas from '../../components/SMCanvas';
import SecondaryToolbar from '../CanvasToolbar/SecondaryToolbar';
import { loadTexture } from './helpers';
import styles from './index.styl';
import Loading from './Loading';
import PrintablePlate from './PrintablePlate';
import Rendering from './Rendering';
import ToolHead from './ToolHead';
import { SnapmakerA150Machine, SnapmakerA250Machine, SnapmakerA350Machine, SnapmakerArtisanMachine, SnapmakerOriginalMachine } from '../../../machines';
import { L20WLaserToolModule, L2WLaserToolModule, L40WLaserToolModule } from '../../../machines/snapmaker-2-toolheads';
import { ConnectionType } from '../../../flux/workspace/state';
import SocketEvent from '../../../communication/socket-events';
import { makeSceneToast } from '../../views/toasts/SceneToast';


class Visualizer extends React.PureComponent {
    static propTypes = {
        // redux
        isEnclosureDoorOpen: PropTypes.bool,
        doorSwitchCount: PropTypes.number,
        isEmergencyStopped: PropTypes.bool,

        laser10WErrorState: PropTypes.number,

        uploadState: PropTypes.string.isRequired,
        boundingBox: PropTypes.object,
        server: PropTypes.object,
        connectionType: PropTypes.string.isRequired,
        workflowStatus: PropTypes.string,
        renderState: PropTypes.string.isRequired,
        renderingTimestamp: PropTypes.number.isRequired,
        stage: PropTypes.number.isRequired,
        progress: PropTypes.number.isRequired,
        unloadGcode: PropTypes.func.isRequired,
        clearGcode: PropTypes.func.isRequired,
        setGcodePrintingIndex: PropTypes.func.isRequired,

        executeGcode: PropTypes.func.isRequired,
        executeCmd: PropTypes.func.isRequired,
        updatePause3dpStatus: PropTypes.func.isRequired,
        pause3dpStatus: PropTypes.object,

        isRotate: PropTypes.bool,
        toolHead: PropTypes.string,
        gcodeFile: PropTypes.object,
        headType: PropTypes.string,

        isLaserPrintAutoMode: PropTypes.bool.isRequired,
        materialThickness: PropTypes.number.isRequired,
        materialThicknessSource: PropTypes.string.isRequired,
        laserFocalLength: PropTypes.number,
        background: PropTypes.object.isRequired,
        useABPosition: PropTypes.bool.isRequired,
        workPosition: PropTypes.object.isRequired,
        originOffset: PropTypes.object.isRequired,

        gcodePrintingInfo: PropTypes.shape({
            sent: PropTypes.number
        }),

        modelGroup: PropTypes.object,
        onRef: PropTypes.func,
        preview: PropTypes.bool,

        activeMachine: PropTypes.shape({
            metadata: PropTypes.object,
            identifier: PropTypes.string
        }),
        crosshairOffset: PropTypes.shape({
            x: PropTypes.string,
            y: PropTypes.string
        })
    };

    previewPrintableArea = null;

    visualizerGroup = { object: new THREE.Group() };

    isMounted = React.createRef();

    canvas = React.createRef();

    previewCanvas = React.createRef();

    targetPoint = null;

    toolhead = null;

    toolheadRotationAnimation = null;

    pubsubTokens = [];

    pauseStatus = {
        pos: {},
        headStatus: false,
        headPower: 0
    };

    state = {
        printableArea: null,
        coordinateVisible: true,
        toolheadVisible: true,
        controller: {
            type: controller.type,
            state: controller.state,
            settings: controller.settings
        },
        workflowState: controller.workflowState,
        workPosition: {
            x: '0.000',
            y: '0.000',
            z: '0.000',
            e: '0.000'
        },
        gcode: {
            ready: false,

            // Updates by the "sender:status" event
            name: '',
            size: 0,
            total: 0,
            sent: 0,
            received: 0
        },
        showEnclosureDoorWarn: false,
        isEmergencyStopped: false,

        isLaser10WCheck1: false,
        isLaser10WCheck2: false
    };

    controllerEvents = {
        'connection:open': () => {
            this.stopToolheadRotationAnimation();
            this.updateWorkPositionToZero();
            this.props.setGcodePrintingIndex(0);
        },
        'connection:close': () => {
            // reset state related to port and controller
            this.stopToolheadRotationAnimation();
            this.updateWorkPositionToZero();
            this.props.setGcodePrintingIndex(0);

            this.setState(() => ({
                controller: {
                    type: controller.type,
                    state: controller.state
                },
                workflowState: controller.workflowState
            }));

            this.unloadGcode();
        },
        // 'sender:status': (data, dataSource) => {
        'sender:status': (options) => {
            const { data, dataSource } = options;
            if (dataSource !== PROTOCOL_TEXT) {
                return;
            }
            const { name, size, total, sent, received } = data;
            this.setState({
                gcode: {
                    ...this.state.gcode,
                    name,
                    size,
                    total,
                    sent,
                    received
                }
            });
            this.props.setGcodePrintingIndex(sent);
            this.renderScene();
        },
        'workflow:state': (options) => {
            const { dataSource, workflowState } = options;
            if (dataSource !== PROTOCOL_TEXT) {
                return;
            }
            if (this.state.workflowState !== workflowState) {
                this.setState({ workflowState });
                switch (workflowState) {
                    case WorkflowStatus.Idle:
                        this.stopToolheadRotationAnimation();
                        this.updateWorkPositionToZero();
                        this.props.setGcodePrintingIndex(0);
                        break;
                    case WorkflowStatus.Running:
                        this.startToolheadRotationAnimation();
                        break;
                    case WorkflowStatus.Paused:
                        this.stopToolheadRotationAnimation();
                        break;
                    default:
                        break;
                }
            }
        },
        // FIXME
        'Marlin:state': (options) => {
            const { state, dataSource } = options;
            if (dataSource !== PROTOCOL_TEXT) {
                return;
            }
            const { pos } = state;
            this.setState({
                controller: {
                    type: MARLIN,
                    ...this.state.controller,
                    state
                }
            });
            if (this.state.workflowState === WorkflowStatus.Running) {
                this.updateWorkPosition(pos);
            }
        },
        'Marlin:settings': (options) => {
            const { settings, dataSource } = options;
            if (dataSource !== PROTOCOL_TEXT) {
                return;
            }
            this.setState({
                controller: {
                    type: MARLIN,
                    ...this.state.controller,
                    settings
                }
            });
        }
    };

    actions = {
        isCNC: () => {
            return (this.props.headType === HEAD_CNC);
        },
        is3DP: () => {
            return (this.props.headType === HEAD_PRINTING);
        },
        isLaser: () => {
            return (this.props.headType === HEAD_LASER);
        },
        handleRun: () => {
            const {
                server,
                workflowStatus,
                headType, isLaserPrintAutoMode,
                materialThickness,
                materialThicknessSource,
                isRotate,
                toolHead,
                gcodeFile,
                laserFocalLength,
                background,
                workPosition,
                originOffset,
                activeMachine,
                connectionType,
                crosshairOffset,
                useABPosition
            } = this.props;


            if (workflowStatus === WorkflowStatus.Idle) {
                // Fix me?: 2w laser head set origin offset(crosshair offset) before start print
                const isSnapmaker2 = includes([SnapmakerA350Machine.identifier, SnapmakerA250Machine.identifier, SnapmakerA150Machine.identifier], activeMachine.identifier);
                if (includes([L2WLaserToolModule.identifier], toolHead) && connectionType === ConnectionType.Serial && isSnapmaker2) {
                    const { x, y } = workPosition;
                    server.setWorkOrigin(x - (parseFloat(crosshairOffset.x) || 21.5), y - (parseFloat(crosshairOffset.y) || -11));
                }

                // Hard code: for artisan turn off crossihair
                if (includes([SnapmakerArtisanMachine.identifier], activeMachine.identifier)
                    && includes([L2WLaserToolModule.identifier, L20WLaserToolModule.identifier, L40WLaserToolModule.identifier], toolHead)
                ) {
                    controller
                        .emitEvent(SocketEvent.TurnOffCrosshair)
                        .once(SocketEvent.TurnOffCrosshair, ({ err }) => {
                            if (err) {
                                toast(makeSceneToast('info', i18n._('Failed to turn on crosshair.')));
                            }
                        });
                }
                log.info('Start to run G-code...');
                server.startServerGcode({
                    headType,
                    workflowStatus,
                    isLaserPrintAutoMode,
                    materialThickness,
                    materialThicknessSource,
                    isRotate,
                    toolHead,
                    // for wifi indiviual
                    uploadName: gcodeFile.uploadName,
                    laserFocalLength,
                    background,
                    useABPosition,
                    series: activeMachine.identifier,
                    size: activeMachine.metadata.size,
                    workPosition,
                    originOffset,
                    renderName: gcodeFile?.renderGcodeFileName || gcodeFile.uploadName
                }, (res) => {
                    if (res) {
                        const { msg, code } = res;
                        if (msg) {
                            if (code === 202) {
                                modalSmallHOC({
                                    title: i18n._('key-Workspace/Page-Filament Runout Recovery'),
                                    text: i18n._('key-Workspace/Page-Filament has run out. Please load new filament to continue printing.'),
                                    img: IMAGE_WIFI_ERROR
                                });
                            } else if (code === 203) {
                                modalSmallHOC({
                                    title: i18n._('key-Workspace/Page-Enclosure Door Open'),
                                    text: i18n._('key-Workspace/Page-One or both of the enclosure panels is/are opened. Please close the panel(s) to continue printing.'),
                                    subtext: i18n._('key-Workspace/Page-Please wait one second after you close the panel(s) to continue printing.'),
                                    img: IMAGE_WIFI_WARNING
                                });
                            } else {
                                modalSmallHOC({
                                    title: i18n._(`Error ${code}`),
                                    text: i18n._('key-Workspace/Page-Unable to start the job.'),
                                    img: IMAGE_WIFI_ERROR
                                });
                            }
                        }
                    }
                });
            }

            if (workflowStatus === WorkflowStatus.Paused) {
                server.resumeServerGcode({
                    headType: this.props.headType,
                    pause3dpStatus: this.props.pause3dpStatus,
                    pauseStatus: this.pauseStatus,
                    gcodeFile,
                    sizeZ: this.props.activeMachine.metadata.size.z
                }, ({ msg, code }) => {
                    if (msg) {
                        if (code === 202 || code === 222) {
                            modalSmallHOC({
                                title: i18n._('key-Workspace/Page-Filament Runout Recovery'),
                                text: i18n._('key-Workspace/Page-Filament has run out. Please load new filament to continue printing.'),
                                img: IMAGE_WIFI_ERROR
                            });
                        } else if (code === 203) {
                            modalSmallHOC({
                                title: i18n._('key-Workspace/Page-Enclosure Door Open'),
                                text: i18n._('key-Workspace/Page-One or both of the enclosure panels is/are opened. Please close the panel(s) to continue printing.'),
                                subtext: i18n._('key-Workspace/Page-Please wait one second after you close the panel(s) to continue printing.'),
                                img: IMAGE_WIFI_WARNING
                            });
                        } else {
                            modalSmallHOC({
                                title: i18n._(`Error ${code}`),
                                text: i18n._('key-Workspace/Page-Unable to resume the job.'),
                                img: IMAGE_WIFI_ERROR
                            });
                        }
                    }
                });
            }
        },
        tryPause: () => {
            // delay 500ms to let buffer executed. and status propagated
            setTimeout(() => {
                if (this.state.gcode.received + 1 >= this.state.gcode.sent) {
                    const workPosition = this.state.workPosition;

                    this.pauseStatus = {
                        headStatus: this.state.controller.state.headStatus,
                        headPower: this.state.controller.state.headPower,
                        pos: {
                            x: Number(workPosition.x),
                            y: Number(workPosition.y),
                            z: Number(workPosition.z),
                            e: Number(workPosition.e)
                        }
                    };
                    if (this.pauseStatus.headStatus || this.props.headType !== HEAD_PRINTING) {
                        this.props.executeGcode('M5');
                    }

                    // toolhead has stopped
                    if (this.props.pause3dpStatus?.pausing) {
                        const pause3dpStatus = {};
                        pause3dpStatus.pausing = false;
                        pause3dpStatus.pos = {
                            x: Number(workPosition.x),
                            y: Number(workPosition.y),
                            z: Number(workPosition.z),
                            e: Number(workPosition.e)
                        };
                        const pos = pause3dpStatus.pos;
                        // experience params for retraction: F3000, E->(E-5)
                        const targetE = Math.max(pos.e - 5, 0);
                        const targetZ = Math.min(pos.z + 30, this.props.activeMachine.metadata.size.z);
                        const gcode = [
                            `G1 E${targetE}\n`,
                            `G1 Z${targetZ}\n`,
                            `G1 E${pos.e}\n`
                        ];
                        // const gcode = `G1 E${targetE}\nG1 Z${targetZ}\nG1 E${pos.e}\n`;
                        this.props.executeGcode(gcode);
                        this.props.updatePause3dpStatus(pause3dpStatus);
                    }
                } else {
                    this.actions.tryPause();
                }
            }, 50);
        },
        handlePause: () => {
            const { workflowStatus, connectionType, server } = this.props;
            // const { workflowState } = this.state;
            if (this.actions.is3DP()) {
                this.props.updatePause3dpStatus({
                    pausing: true,
                    pos: null
                });
            }
            if (workflowStatus === WorkflowStatus.Running) {
                server.pauseServerGcode(() => {
                    // Refactor: serial + text?, unify api
                    if (connectionType === CONNECTION_TYPE_SERIAL) {
                        this.actions.tryPause();
                    }
                });
            }
        },
        handleStop: () => {
            // const { workflowState } = this.state;
            const { workflowStatus, server, connectionType } = this.props;
            if (this.actions.is3DP()) {
                this.props.updatePause3dpStatus({
                    pausing: true,
                    pos: null
                });
            }
            if (connectionType === CONNECTION_TYPE_SERIAL) {
                this.actions.tryPause();
            }
            if (workflowStatus !== WorkflowStatus.Idle) {
                setTimeout(() => {
                    server.stopServerGcode();

                    // Stop the laser or CNC machine. While trying to pause, if the 'tryPause' doesn't turn off, then wait for synchronization issues.
                    if (connectionType === CONNECTION_TYPE_SERIAL && (this.pauseStatus.headStatus || this.props.headType !== HEAD_PRINTING)) {
                        this.props.executeGcode('M5');
                    }
                }, 60);
            }
        },
        handleClose: () => {
            // dismiss gcode file name
            this.props.clearGcode();
            const { workflowState } = this.state;
            if ([WorkflowStatus.Idle].includes(workflowState)) {
                this.props.executeCmd('gcode:unload');
            }
        },
        // canvas
        switchCoordinateVisibility: () => {
            const visible = !this.state.coordinateVisible;
            this.setState(
                { coordinateVisible: visible },
                () => {
                    this.state.printableArea.changeCoordinateVisibility(visible);
                    this.renderScene();
                }
            );
        },
        autoFocus: () => {
            this.autoFocus();
        },
        zoomIn: () => {
            this.canvas.current.zoomIn();
        },
        zoomOut: () => {
            this.canvas.current.zoomOut();
        },

        switchToolheadVisibility: () => {
            const visible = !this.state.toolheadVisible;
            this.toolhead.visible = visible;
            this.setState({ toolheadVisible: visible });
            this.renderScene();
        },
        closeModal: () => {
            this.setState({
                // enclosure door warning
                showEnclosureDoorWarn: false,
                // emergency stop
                isEmergencyStopped: false,
                // laser 10w warning
                isLaser10WCheck1: false,
                isLaser10WCheck2: false
            });
        }
    };

    async componentDidMount() {
        this.isMounted.current = true;

        this.visualizerGroup.object.add(this.props.modelGroup);

        this.props.onRef && this.props.onRef(this);
        await this.setupToolhead();

        this.subscribe();
        this.addControllerEvents();
        this.setupTargetPoint();

        const activeMachine = this.props.activeMachine;
        this.previewPrintableArea = new PrintablePlate({
            x: activeMachine.metadata.size.x * 2,
            y: activeMachine.metadata.size.y * 2
        });

        // In Async function, the componenet could be unmounted already
        if (this.isMounted.current) {
            this.setState({
                printableArea: new PrintablePlate({
                    x: activeMachine.metadata.size.x * 2,
                    y: activeMachine.metadata.size.y * 2
                })
            });
        }
    }

    /**
     * Listen on props updates.
     *
     * When new G-code list received:
     *  - Re-render G-code objects
     *  - Upload G-code to controller
     */
    /* eslint-disable react/no-did-update-set-state */
    componentDidUpdate(prevProps) {
        if (this.props.onRef !== prevProps.onRef && this.props.onRef) {
            this.props.onRef(this);
        }

        if (!isEqual(this.props.activeMachine, prevProps.activeMachine) || !isEqual(this.props.preview, prevProps.preview)) {
            const activeMachine = this.props.activeMachine;
            if (this.props.preview) {
                this.previewPrintableArea && this.previewPrintableArea.updateSize(prevProps.activeMachine.identifier, {
                    x: activeMachine.metadata.size.x * 2,
                    y: activeMachine.metadata.size.y * 2
                });
            } else {
                this.state.printableArea && this.state.printableArea.updateSize(prevProps.activeMachine.identifier, {
                    x: activeMachine.metadata.size.x * 2,
                    y: activeMachine.metadata.size.y * 2
                });
            }
            this.canvas.current && this.canvas.current.setCamera(new THREE.Vector3(0, 0, Math.min(activeMachine.metadata.size.z * 2, 300)), new THREE.Vector3());
        }

        if (prevProps.workflowStatus !== WorkflowStatus.Idle && this.props.workflowStatus === WorkflowStatus.Idle) {
            this.stopToolheadRotationAnimation();
            this.updateWorkPositionToZero();
            this.props.setGcodePrintingIndex(0);
        }
        if (prevProps.workflowStatus !== WorkflowStatus.Unknown && this.props.workflowStatus === WorkflowStatus.Unknown) {
            this.stopToolheadRotationAnimation();
            this.updateWorkPositionToZero();
            this.props.setGcodePrintingIndex(0);
        }
        if (prevProps.workflowStatus !== WorkflowStatus.Running && this.props.workflowStatus === WorkflowStatus.Running) {
            for (let i = 0; i < this.props.gcodePrintingInfo.sent; i++) {
                this.props.setGcodePrintingIndex(i);
            }
            this.startToolheadRotationAnimation();
            this.renderScene();
        }
        if (prevProps.workflowStatus !== WorkflowStatus.Paused && this.props.workflowStatus === WorkflowStatus.Paused) {
            this.stopToolheadRotationAnimation();
        }
        if (this.props.gcodePrintingInfo && this.props.gcodePrintingInfo.sent > 0 && this.props.gcodePrintingInfo.sent !== prevProps.gcodePrintingInfo.sent) {
            this.updateWorkPosition(prevProps.workPosition);
            this.props.setGcodePrintingIndex(this.props.gcodePrintingInfo.sent);
            this.renderScene();
        }
        if (this.props.renderingTimestamp !== prevProps.renderingTimestamp) {
            this.renderScene();
        }
        if (this.props.stage !== prevProps.stage && this.props.stage === WORKSPACE_STAGE.LOAD_GCODE_SUCCEED) {
            if (this.props.boundingBox !== null) {
                const { min, max } = this.props.boundingBox;
                const target = new THREE.Vector3();

                target.copy(min).add(max).divideScalar(2);
                const width = new THREE.Vector3().add(min).distanceTo(new THREE.Vector3().add(max));
                const position = new THREE.Vector3(target.x, target.y, width * 2);
                this.canvas.current && this.canvas.current.setCamera(position, target);
            }
        }

        let nextState = null;

        // open the enclosureDoorOpened modal
        if (this.props.isEnclosureDoorOpen !== prevProps.isEnclosureDoorOpen) {
            nextState = nextState || {};
            nextState.showEnclosureDoorWarn = this.props.isEnclosureDoorOpen;
        } else if (prevProps.doorSwitchCount !== 0 && this.props.doorSwitchCount !== prevProps.doorSwitchCount) {
            nextState = nextState || {};
            nextState.showEnclosureDoorWarn = true;
        }
        // open the enclosureDoorOpened modal
        if (this.props.isEnclosureDoorOpen !== prevProps.isEnclosureDoorOpen) {
            nextState = nextState || {};
            nextState.showEnclosureDoorWarn = this.props.isEnclosureDoorOpen;
        } else if (prevProps.doorSwitchCount !== 0 && this.props.doorSwitchCount !== prevProps.doorSwitchCount) {
            nextState = nextState || {};
            nextState.showEnclosureDoorWarn = true;
        }
        // open the emergencyStopped warning modal
        if (this.props.isEmergencyStopped !== prevProps.isEmergencyStopped && this.props.isEmergencyStopped) {
            nextState = nextState || {};
            nextState.isEmergencyStopped = true;
        }
        if (this.props.laser10WErrorState !== prevProps.laser10WErrorState) {
            nextState = nextState || {};
            if (this.props.laser10WErrorState & (1 << 2)) {
                nextState.isLaser10WCheck2 = true;
                nextState.isLaser10WCheck1 = false;
            } else if (this.props.laser10WErrorState & (1 << 1)) {
                nextState.isLaser10WCheck2 = false;
                nextState.isLaser10WCheck1 = true;
            } else {
                nextState.isLaser10WCheck2 = false;
                nextState.isLaser10WCheck1 = false;
            }
        }

        if (nextState) {
            this.setState(nextState);
        }
    }

    componentWillUnmount() {
        this.isMounted.current = false;
        this.unsubscribe();
        this.removeControllerEvents();

        this.canvas.current = null;
    }

    setupTargetPoint() {
        this.targetPoint = new TargetPoint({
            color: colornames('indianred'),
            radius: 0.5
        });
        this.visualizerGroup.object.add(this.targetPoint);
    }

    setupToolhead() {
        const color = colornames('silver');
        const url = 'resources/textures/brushed-steel-texture.jpg';
        return new Promise((resolve, reject) => {
            loadTexture(url, (err, texture) => {
                if (err) {
                    reject(err);
                } else {
                    this.toolhead = new ToolHead(color, texture);
                    this.visualizerGroup.object.add(this.toolhead);

                    this.toolheadRotationAnimation = new TWEEN.Tween(this.toolhead.rotation)
                        .to({ x: 0, y: 0, z: Number.MAX_VALUE }, Number.MAX_VALUE);
                    resolve();
                }
            });
        });
    }

    unloadGcode() {
        this.props.unloadGcode();
    }

    subscribe() {
        const tokens = [
            pubsub.subscribe('resize', () => {
                if (this.canvas.current) {
                    this.canvas.current.resizeWindow();
                }
            })
        ];
        this.pubsubTokens = this.pubsubTokens.concat(tokens);
    }

    unsubscribe() {
        this.pubsubTokens.forEach((token) => {
            pubsub.unsubscribe(token);
        });
        this.pubsubTokens = [];
    }

    addControllerEvents() {
        Object.keys(this.controllerEvents).forEach(eventName => {
            const callback = this.controllerEvents[eventName];
            controller.on(eventName, callback);
        });
    }

    removeControllerEvents() {
        Object.keys(this.controllerEvents).forEach(eventName => {
            const callback = this.controllerEvents[eventName];
            controller.off(eventName, callback);
        });
    }

    startToolheadRotationAnimation() {
        this.toolheadRotationAnimation && this.toolheadRotationAnimation.start();
    }

    stopToolheadRotationAnimation() {
        this.toolheadRotationAnimation && this.toolheadRotationAnimation.stop(); // TODO
    }

    updateWorkPositionToZero() {
        this.updateWorkPosition({
            x: '0.000',
            y: '0.000',
            z: '0.000',
            e: '0.000'
        });
    }

    updateWorkPosition(pos) {
        this.setState({
            workPosition: {
                ...this.state.workPosition,
                ...pos
            }
        });
        let { x = 0, y = 0, z = 0 } = { ...pos };
        x = (Number(x) || 0);
        y = (Number(y) || 0);
        z = (Number(z) || 0);
        this.toolhead && this.toolhead.position.set(x, y, z);
        this.targetPoint && this.targetPoint.position.set(x, y, z);
    }

    autoFocus() {
        const child = this.props.modelGroup.children[0];
        this.canvas.current.autoFocus(child, true);
    }

    notice() {
        const { stage, progress } = this.props;
        switch (stage) {
            case WORKSPACE_STAGE.EMPTY:
                return '';
            case WORKSPACE_STAGE.LOADING_GCODE:
                return i18n._('key-Workspace/Page-Loading G-code...{{progress}}%', { progress: (100.0 * progress).toFixed(1) });
            case WORKSPACE_STAGE.LOAD_GCODE_SUCCEED:
                return i18n._('key-Workspace/Page-Loaded G-code successfully.');
            case WORKSPACE_STAGE.LOAD_GCODE_FAILED:
                return i18n._('key-Workspace/Page-Failed to load G-code.');
            default:
                return '';
        }
    }

    renderScene() {
        this.canvas.current && this.canvas.current.renderScene();
    }

    render() {
        const state = this.state;
        const notice = this.notice();
        const { gcodeFile } = this.props;
        return (
            <div style={{ top: 0, bottom: 0, left: 0, right: 0 }}>
                <div className={styles['visualizer-progress']}>
                    <ProgressBar tips={notice} progress={this.props.progress * 100} />
                </div>
                {gcodeFile !== null && (
                    <div className={styles['visualizer-info']}>
                        <p>{i18n._(gcodeFile?.renderGcodeFileName)}</p>
                        <p>{humanReadableTime(gcodeFile?.estimated_time)}</p>
                    </div>
                )}
                <div className={styles['canvas-wrapper']}>
                    {
                        this.props.uploadState === 'uploading' ? <Loading />
                            : (this.props.renderState === 'rendering' && <Rendering />)
                    }
                    {state.printableArea && (
                        // size={this.props.size}
                        <Canvas
                            ref={this.canvas}
                            modelGroup={this.visualizerGroup}
                            printableArea={this.state.printableArea}
                            cameraInitialPosition={new THREE.Vector3(0, 0, Math.min(this.props.activeMachine.metadata.size.z * 2, 300))}
                            cameraInitialTarget={new THREE.Vector3(0, 0, 0)}
                        />
                    )}
                </div>
                <div className="position-absolute left-16 bottom-16">
                    <SecondaryToolbar
                        zoomIn={this.actions.zoomIn}
                        zoomOut={this.actions.zoomOut}
                        toFront={this.actions.autoFocus}
                    />
                </div>

                {(state.isEmergencyStopped) && (
                    <ModalSmall
                        title={i18n._('key-Workspace/Page-Emergency Stop')}
                        text={i18n._('key-Workspace/Page-You have pressed the Emergency Stop Button. Solve the emergency and reconnect Luban.')}
                        img="WarningTipsEmergencyStop"
                        iconColor="#FF4D4F"
                        onClose={this.actions.closeModal}
                    />
                )}
                {(state.showEnclosureDoorWarn) && (
                    <ModalSmall
                        title={i18n._('key-Workspace/Page-Enclosure Door Open')}
                        onClose={this.actions.closeModal}
                        text={i18n._('key-Workspace/Page-One or both of the enclosure panels is/are opened. Please close the panel(s) to continue printing.')}
                        subtext={i18n._('key-Workspace/Page-Please wait one second after you close the panel(s) to continue printing.')}
                        img="WarningTipsWarning"
                        iconColor="#FFA940"
                    />
                )}
                {(state.isLaser10WCheck1) && (
                    <ModalSmall
                        title={i18n._('key-Workspace/Window-10W Laser Overheating protection')}
                        text={i18n._('key-Workspace/Window-10W Laser Overheating protection Info')}
                        img="WarningTipsWarning"
                        iconColor="#FFA940"
                        onClose={this.actions.closeModal}
                    />
                )}
                {(state.isLaser10WCheck2) && (
                    <ModalSmall
                        title={i18n._('key-Workspace/Window-10W Laser Attitude detection')}
                        text={i18n._('key-Workspace/Window-10W Laser Attitude detection Info')}
                        img="WarningTipsWarning"
                        iconColor="#FFA940"
                        onClose={this.actions.closeModal}
                    />
                )}
            </div>
        );
    }
}

const mapStateToProps = (state) => {
    const workspace = state.workspace;
    const laser = state.laser;
    const activeMachine = state.machine.activeMachine || SnapmakerOriginalMachine;
    activeMachine.metadata.size.z = activeMachine.metadata.size.z || SnapmakerArtisanMachine.metadata.size.z;

    // connection
    const {
        connectionType
    } = state.workspace;

    // connected server
    const {
        server
    } = state.workspace;

    return {
        connectionType,

        pause3dpStatus: workspace.pause3dpStatus,
        doorSwitchCount: workspace.doorSwitchCount,
        isEmergencyStopped: workspace.isEmergencyStopped,
        isEnclosureDoorOpen: workspace.isEnclosureDoorOpen,
        laser10WErrorState: workspace.laser10WErrorState,

        headType: workspace.headType,
        toolHead: workspace.toolHead,
        workflowStatus: workspace.workflowStatus,
        uploadState: workspace.uploadState,
        gcodeList: workspace.gcodeList,
        gcodeFile: workspace.gcodeFile,

        gcodePrintingInfo: workspace.gcodePrintingInfo,
        isLaserPrintAutoMode: workspace.isLaserPrintAutoMode,

        // laser camera capture
        materialThickness: workspace.materialThickness,
        materialThicknessSource: workspace.materialThicknessSource,
        background: laser.background,
        useABPosition: laser.useABPosition,
        isRotate: workspace.isRotate,

        // type
        laserFocalLength: workspace.laserFocalLength,

        modelGroup: workspace.modelGroup,
        renderState: workspace.renderState,
        boundingBox: workspace.boundingBox,
        renderingTimestamp: workspace.renderingTimestamp,
        stage: workspace.stage,
        progress: workspace.progress,

        // connection
        server,
        isConnected: workspace.isConnected,

        activeMachine,

        // machine state
        workPosition: workspace.workPosition,
        originOffset: workspace.originOffset,
        crosshairOffset: workspace.crosshairOffset,
    };
};

const mapDispatchToProps = (dispatch) => ({
    clearGcode: () => dispatch(gcodeActions.clearGcode()),
    unloadGcode: () => dispatch(workspaceActions.unloadGcode()),
    setGcodePrintingIndex: (index) => dispatch(workspaceActions.setGcodePrintingIndex(index)),

    executeGcode: (gcode) => dispatch(workspaceActions.executeGcode(gcode)),
    executeCmd: (cmd) => dispatch(workspaceActions.executeCmd(cmd)),
    updatePause3dpStatus: (pause3dpStatus) => dispatch(workspaceActions.updatePause3dpStatus(pause3dpStatus))
});

export default connect(mapStateToProps, mapDispatchToProps)(Visualizer);
