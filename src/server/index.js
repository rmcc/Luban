/* eslint no-unused-vars: 0 */
import bcrypt from 'bcryptjs';
import chalk from 'chalk';
import dns from 'dns';
import fs from 'fs';
import _, { set, size } from 'lodash';
import os from 'os';
import path from 'path';
import http from 'http';

import DataStorage from './DataStorage';
import createApplication from './app';
import settings from './config/settings';
import logger from './lib/logger';
import { startServices } from './services';
import config from './services/configstore';
import monitor from './services/monitor';


const log = logger('init');

const createServer = (options, callback) => {
    options = { ...options };

    const profile = path.resolve(settings.rcfile);

    // configstore service
    log.info(`Loading configuration from ${chalk.yellow(JSON.stringify(profile))}`);

    config.load(profile);

    settings.rcfile = profile;

    // secret
    if (!config.get('secret')) {
        // generate a secret key
        const secret = bcrypt.genSaltSync(); // TODO: use a strong secret
        config.set('secret', secret);
    }

    settings.secret = config.get('secret', settings.secret);

    // watchDirectory
    const watchDirectory = options.watchDirectory || config.get('watchDirectory');

    if (watchDirectory) {
        if (fs.existsSync(watchDirectory)) {
            log.info(`Watching ${chalk.yellow(JSON.stringify(watchDirectory))} for file changes.`);

            // monitor service
            monitor.start({ watchDirectory: watchDirectory });
        } else {
            log.error(`The directory ${chalk.yellow(JSON.stringify(watchDirectory))} does not exist.`);
        }
    }

    // accessTokenLifetime
    const accessTokenLifetime = options.accessTokenLifetime || config.get('accessTokenLifetime');

    if (accessTokenLifetime) {
        set(settings, 'accessTokenLifetime', accessTokenLifetime);
    }

    // allowRemoteAccess
    const allowRemoteAccess = options.allowRemoteAccess || config.get('allowRemoteAccess', false);

    if (allowRemoteAccess) {
        if (size(config.get('users')) === 0) {
            log.warn('You\'ve enabled remote access to the server. It\'s recommended to create an user account to protect against malicious attacks.');
        }

        set(settings, 'allowRemoteAccess', allowRemoteAccess);
    }

    // Data storage initialize
    log.info('Initializing user data storage...');
    DataStorage.init();

    process.env.Tmpdir = DataStorage.tmpDir;

    const app = createApplication();

    const { port = 0, pipePath, host, backlog } = options;
    const server = http.createServer(app);

    const listenOptions = {};
    if (typeof pipePath !== 'undefined' && pipePath !== '') {
        listenOptions.path = pipePath;
    } else {
        listenOptions.port = port;
        listenOptions.host = host;
        listenOptions.backlog = backlog;
    }

    server.listen(listenOptions, () => {
        // Start socket service
        startServices(server);

        // Deal with address bindings
        const realAddress = server.address().address;
        const realPort = server.address().port;
        callback && callback(null, {
            address: realAddress,
            port: realPort,
            pipePath: pipePath
        });

        log.info(`Starting the server at ${chalk.cyan(`${pipePath}`)}`);
    });
};

export {
    createServer
};
