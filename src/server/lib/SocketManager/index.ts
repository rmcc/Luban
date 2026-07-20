import EventEmitter from 'events';

import settings from '../../config/settings';
import logger from '../logger';

const log = logger('service:socket-server');

type TMessage = {
    type: string,
    [key: string]: unknown
}

class SocketServer extends EventEmitter {
    private server = null;

    private io = null;

    private sockets: any[] = [];

    public id = '';

    private events = [];

    private port: any = null;

    public start(server) {
        this.sockets = [];
        this.stop();

        this.server = server;

        if (typeof process.parentPort !== 'undefined' && process.parentPort) {
            process.parentPort.on('message', (messageEvent: any) => {
                if (messageEvent.data && messageEvent.data.type === 'setup-socket-port') {
                    // If we lost the channel during HMR
                    if (this.port) {
                        this.port.close();
                    }
                    const [port] = messageEvent.ports;
                    this.port = port;

                    // Support both EventEmitter style and property-assignment message listeners for UtilityProcess frameworks
                    const handlePortMessage = (e: any) => {
                        const { event, args } = e.data;
                        this.emit(event, ...args);

                        if (this.events && this.events.length > 0) {
                            for (const [evt, callback] of this.events) {
                                if (evt === event) {
                                    const mockSocket = this.getOrCreateMockSocket();
                                    callback(mockSocket, ...args);
                                }
                            }
                        }
                    };

                    this.port.on('message', handlePortMessage);
                    if ('onmessage' in this.port) {
                        this.port.onmessage = handlePortMessage;
                    }

                    this.port.start();

                    const mockSocket = this.getOrCreateMockSocket();
                    this.onConnection(mockSocket);
                }
            });
        } else {
            console.error('[SOCKETSERVER] Warning: process.parentPort is undefined inside this thread context. This shouldn\'t happen');
        }
    }

    public stop() {
        if (this.port) {
            this.port.close();
            this.port = null;
        }
        this.sockets = [];
        this.server = null;
        // this.events = [];
    }

    // established a new socket connection
    public onConnection = (socket) => {
        const address = socket.handshake.address;
        const token = socket.decoded_token || {};
        log.debug(`New connection from ${address}: id=${socket.id}, token.id=${token.id}, token.name=${token.name}`);

        // Add to the socket pool
        this.sockets.push(socket);

        // connection startup
        socket.emit('startup');
        this.emit('connection', socket);

        // Disconnect from socket doesn't happen. MessagePort is persistent
    };

    public registerEvent(event: string, callback) {
        this.events.push([event, callback]);
    }

    private channelMiddleware = (socket: any, topic: string, invoke, actionid, params) => {
        const actions = {
            next: (res) => {
                socket.emit(topic, actionid, 'next', res);
            },
            error: (res) => {
                socket.emit(topic, actionid, 'error', res);
            },
            complete: (res) => {
                socket.emit(topic, actionid, 'complete', res);
            }
        };
        return invoke(actions, params);
    };

    public registerChannel(
        topic: string, callback: (subscriber: {
            next: (msg: TMessage) => void;
            complete: (msg: TMessage) => void;
        }, ...data: unknown[]) => void
    ) {
        this.events.push([
            topic, (socket, actionid, params) => {
                return this.channelMiddleware(socket, topic, callback, actionid, params);
            }
        ]);
    }

    // This is here just to make the various event emitters happy. They want a socket,
    // so they get a "socket". It's just wrapping their socket "emit" events into
    // MessagePort messages, easier than rewriting everything to use postMessage.
    private getOrCreateMockSocket() {
        let existing = this.sockets.find(s => s.id === 'utility-port');
        if (existing) {
            return existing;
        }

        const mockSocket = {
            id: 'utility-port',
            handshake: {
                address: '127.0.0.1',
                headers: {}
            },
            decoded_token: {},
            emit: (event: string, ...args: any[]) => {
                if (this.port) {
                    try {
                        this.port.postMessage({ event, args });
                    } catch (cloneError) {
                        // Safe fallback emulator matching old socket behavior:
                        const sanitizedArgs = JSON.parse(JSON.stringify(args));
                        this.port.postMessage({ event, args: sanitizedArgs });
                    }
                }
            },
            on: (event: string, callback: (...args: any[]) => void) => {
                this.on(event, callback);
            },
            once: (event: string, callback: (...args: any[]) => void) => {
                this.once(event, callback);
            }
        };

        return mockSocket;
    }
}

export default SocketServer;
