import noop from 'lodash/noop';
import { v4 as uuid } from 'uuid';

const { ipcRenderer } = require('electron');

class SocketController {
    socket = null;

    token = '';

    callbacks = {};

    port = null;

    get connected() {
        return !!(this.socket && this.socket.connected);
    }

    connect(token, next = noop) {
        if (typeof next !== 'function') {
            next = noop;
        }

        if (this.token !== '' && this.token === token && this.socket) {
            return;
        }

        this.socket && this.socket.destroy();

        this.token = token;

        this.socket = {
            connected: false,
            destroy: () => {
                this.socket.connected = false;
                if (this.port) {
                    this.port.close();
                    this.port = null;
                }
            }
        };

        ipcRenderer.on('setup-socket-port', (event) => {
            const [port] = event.ports;
            this.port = port;
            this.socket.connected = true;

            this.port.onmessage = (messageEvent) => {
                const { event: eventName, args } = messageEvent.data;
                const callbacks = this.callbacks[eventName];
                if (callbacks) {
                    for (const callback1 of callbacks) {
                        callback1(...args);
                    }
                }
            };

            this.port.start();

            if (next) {
                next();
                next = null;
            }
        });

        ipcRenderer.send('renderer-ready-for-port');
    }

    disconnect() {
        this.socket && this.socket.destroy();
        this.socket = null;
        this.token = '';
    }

    emit(event, ...args) {
        setTimeout(() => {
            if (this.port) {
                try {
                    this.port.postMessage({ event, args });
                } catch (cloneError) {
                    const sanitizeObj = (obj) => {
                        if (obj === null || typeof obj !== 'object') {
                            if (typeof obj === 'function') {
                                return undefined;
                            }
                            return obj;
                        }
                        if (Array.isArray(obj)) {
                            return obj.map((item) => sanitizeObj(item));
                        }
                        const cleanObj = {};
                        Object.keys(obj).forEach(key => {
                            if (key !== 'socket' && key !== 'terminateFn') {
                                const value = obj[key];
                                if (typeof value !== 'function') {
                                    cleanObj[key] = sanitizeObj(value);
                                }
                            }
                        });
                        return cleanObj;
                    };
                    const sanitizedArgs = args.map((arg) => sanitizeObj(arg));
                    this.port.postMessage({ event, args: sanitizedArgs });
                }
            }
        }, 200);
    }

    on(eventName, callback) {
        if (!this.callbacks[eventName]) {
            this.callbacks[eventName] = [];
        }
        const callbacks = this.callbacks[eventName];
        if (callbacks) {
            callbacks.push(callback);
        }
    }

    once(eventName, callback) {
        const handler = (...args) => {
            callback(...args);
            const index = this.callbacks[eventName].indexOf(handler);
            if (index > -1) {
                this.callbacks[eventName].splice(index, 1);
            }
        };
        this.on(eventName, handler);

        return this;
    }

    channel(topic, params, onMessage) {
        return new Promise((resolve, reject) => {
            const actionid = uuid();
            const listener = (...args) => {
                const [_actionid, _STATUS_, result] = args;
                if (actionid === _actionid) {
                    if (_STATUS_ === 'next') {
                        onMessage && onMessage(result);
                    } else if (_STATUS_ === 'complete') {
                        resolve();
                        const index = this.callbacks[topic].indexOf(listener);
                        if (index > -1) {
                            this.callbacks[topic].splice(index, 1);
                        }
                    } else if (_STATUS_ === 'error') {
                        reject();
                        const index = this.callbacks[topic].indexOf(listener);
                        if (index > -1) {
                            this.callbacks[topic].splice(index, 1);
                        }
                    }
                }
            };
            this.on(topic, listener);
            this.emit(topic, actionid, params);
        });
    }
}

const socketController = new SocketController();

export default socketController;
