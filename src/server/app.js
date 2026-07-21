/* eslint callback-return: 0 */
import bodyParser from 'body-parser';
import multiparty from 'connect-multiparty';
import cookieParser from 'cookie-parser';
import errorhandler from 'errorhandler';
import express from 'express';
import expressJwt from 'express-jwt';
import session from 'express-session';
import * as fs from 'fs-extra';
import i18next from 'i18next';
import i18nextHttpMiddleware from 'i18next-http-middleware';
import i18nextBackend from 'i18next-node-fs-backend';
import jwt from 'jsonwebtoken';
import _ from 'lodash';
import path from 'path';
import rangeCheck from 'range_check';
import sessionFileStore from 'session-file-store';

import settings from './config/settings';
import { ERR_FORBIDDEN, ERR_UNAUTHORIZED, IP_WHITELIST } from './constants';
import DataStorage from './DataStorage';
import logger from './lib/logger';
import urljoin from './lib/urljoin';
import { registerApis } from './services';
import config from './services/configstore';


const log = logger('app');

const verifyToken = (token) => {
    // https://github.com/auth0/node-jsonwebtoken#jwtverifytoken-secretorpublickey-options-callback
    try {
        jwt.verify(token, settings.secret);
    } catch (err) {
        return false;
    }
    return true;
};
const DEFAULT_FILE = 'index.html';

const createApplication = () => {
    const app = express();

    // Settings
    if (process.env.NODE_ENV === 'development') {
        // Error handler - https://github.com/expressjs/errorhandler
        // Development error handler, providing stack traces and error message responses
        // for requests accepting text, html, or json.
        app.use(errorhandler());

        // a custom "verbose errors" setting which can be used in the templates via settings['verbose errors']
        app.enable('verbose errors'); // Enables verbose errors in development
        app.disable('view cache'); // Disables view template compilation caching in development
    } else {
        // a custom "verbose errors" setting which can be used in the templates via settings['verbose errors']
        app.disable('verbose errors'); // Disables verbose errors in production
        app.enable('view cache'); // Enables view template compilation caching in production
    }

    app.enable('trust proxy'); // Enables reverse proxy support, disabled by default
    app.enable('case sensitive routing'); // Enable case sensitivity, disabled by default, treating "/Foo" and "/foo" as the same
    app.disable('strict routing'); // Enable strict routing, by default "/foo" and "/foo/" are treated the same by the router

    log.debug('app.settings: %j', app.settings);

    // Check if client's IP address is in the whitelist
    app.use((req, res, next) => {
        const ipaddr = req.ip || req.connection.remoteAddress;
        const isPipeConnection = !ipaddr;

        const allowedAccess = isPipeConnection || _.some(IP_WHITELIST, (whitelist) => {
            return rangeCheck.inRange(ipaddr, whitelist);
        }) || (settings.allowRemoteAccess);
        const forbiddenAccess = !allowedAccess;

        if (forbiddenAccess) {
            const text = 'Access to the requested directory is only available from the local network.';
            res.status(ERR_FORBIDDEN).end(text);
            log.warn(`ERR_FORBIDDEN: ipaddr=${ipaddr}, message=${text}`);
            return;
        }

        next();
    });

    // Middleware
    // https://github.com/senchalabs/connect
    // https://github.com/valery-barysok/session-file-store
    const sessionPath = DataStorage.sessionDir;
    if (fs.existsSync(sessionPath)) {
        const files = fs.readdirSync(sessionPath);
        if (files.length > 0) {
            for (let i = 0; i < files.length; i++) {
                const filePath = `${sessionPath}/${files[i]}`;
                if (fs.statSync(filePath).isFile()) {
                    fs.unlinkSync(filePath);
                }
            }
        }
    }
    fs.ensureDir(sessionPath);
    const FileStore = sessionFileStore(session);
    app.use(session({
        ...settings.middleware.session,
        // https://github.com/expressjs/session#secret
        secret: settings.secret,
        store: new FileStore({
            path: sessionPath,
            logFn: (...args) => {
                log.debug(...args);
            }
        })
    }));

    app.get(/\/favicon\.ico$/, (req, res) => {
        const iconPath = path.join(settings.assets.app.path, 'favicon.ico');
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year cache
        res.sendFile(iconPath);
    });
    app.use(cookieParser());

    // Connect's body parsing middleware. This only handles urlencoded and json bodies.
    // https://github.com/expressjs/body-parser
    app.use(bodyParser.json(settings.middleware['body-parser'].json));
    app.use(bodyParser.urlencoded(settings.middleware['body-parser'].urlencoded));

    // For multipart bodies, please use the following modules:
    // - [busboy](https://github.com/mscdex/busboy) and [connect-busboy](https://github.com/mscdex/connect-busboy)
    // - [multiparty](https://github.com/andrewrk/node-multiparty) and [connect-multiparty](https://github.com/andrewrk/connect-multiparty)
    app.use(multiparty(settings.middleware.multiparty));

    Object.keys(settings.assets).forEach((name) => {
        const asset = settings.assets[name];

        log.debug('assets: name=%s, asset=%s', name, JSON.stringify(asset));
        if (!(asset.path)) {
            log.error('asset path is not defined');
            return;
        }

        asset.routes.forEach((assetRoute) => {
            const route = urljoin(settings.route || '/', assetRoute || '');
            log.debug('> route=%s', name, route);
            app.use(route, express.static(asset.path, {
                maxAge: asset.maxAge
            }));
        });
    });

    app.use('/data', express.static(DataStorage.userDataDir));

    // Setup i18n (i18next)
    i18next
        .use(i18nextBackend)
        .use(i18nextHttpMiddleware.LanguageDetector)
        .init({
            lng: config.get('language', undefined), // use saved lang
            ...settings.i18next
        });

    // app.use(i18nextHandle(i18next, {}));
    app.use(i18nextHttpMiddleware.handle(i18next));

    // Secure API Access
    app.use(urljoin(settings.route, 'api'), expressJwt({
        secret: config.get('secret'),
        algorithms: ['HS256'],
        credentialsRequired: true,
    }));

    app.use((err, req, res, next) => {
        let bypass = true;

        // Check whether the app is running in development mode
        bypass = bypass || (process.env.NODE_ENV === 'development');

        // Check if the provided credentials are correct
        const token = req.query && req.query.token;
        bypass = bypass || (token && verifyToken(token));

        // Check white list
        const whitelist = [
            // Also see "src/server/api/index.js"
            urljoin(settings.route, 'api/signin')
        ];
        bypass = bypass || _.some(whitelist, (p) => {
            return req.path.indexOf(p) === 0;
        });

        if (!bypass && err && (err.name === 'UnauthorizedError')) {
            const ipaddr = req.ip || req.connection.remoteAddress;
            const text = 'No Unauthorized Access';
            res.status(ERR_UNAUTHORIZED).end(text);
            log.warn(`ERR_UNAUTHORIZED: ipaddr=${ipaddr}, code="${err.code}", message="${err.message}"`);
            return;
        }

        next();
    });

    // register http service api
    registerApis(app);

    // Also see "src/app/app.js"
    app.use((req, res, next) => {
        if (req.method === 'OPTIONS') {
            res.sendStatus(200);
        } else {
            next();
        }
    });

    // page
    app.get(urljoin(settings.route, '/'), (req, res) => {
        const indexPath = path.resolve(__dirname, '../app', DEFAULT_FILE);
        res.sendFile(indexPath);
    });

    // Error handling
    app.use((req, res, next) => {
        res.status(404).send({ msg: 'Not found' });
    });

    app.use((err, req, res, next) => {
        if (err) {
            log.error(err);
            res.status(500).send({ error: err.message });
        } else {
            res.status(404).send({ msg: 'Not found' });
        }
    });

    return app;
};

process.on('uncaughtException', (err) => {
    log.error('uncaught exception', err);
});

process.on('unhandledRejection', (reason, promise) => {
    log.error('unhandled rejection', promise, 'reason', reason);
});

export default createApplication;
