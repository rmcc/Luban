import { ConfigProvider } from 'antd';
import 'antd/dist/antd.css';
import series from 'async/series';
import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import i18nHttpApi from 'i18next-http-backend';
import React from 'react';
import ReactDOM from 'react-dom';
import { initReactI18next } from 'react-i18next';
import { Provider } from 'react-redux';

import settings from './config/settings';
import { controller } from './communication/socket-communication';
import log from './lib/log';
import user from './lib/user';
import reduxStore from './store';
import { machineStore } from './store/local-storage';
import './styles/app.styl';
import './styles/vendor.styl';
import workerManager from './lib/manager/workerManager';
import App from './ui/App';


function setupLog() {
    log.setLevel(settings.log.level);
}

async function setupI18next() {
    return new Promise((resolve) => {
        i18next
            .use(i18nHttpApi)
            .use(LanguageDetector)
            .use(initReactI18next)
            .init(settings.i18next, () => {
                resolve();
            });
    });
}

function setupWorkerManager() {
    workerManager.initPool();
}

async function setup() {
    log.info('Bootstrap');

    // Setup log level
    setupLog();

    // Setup i18n
    await setupI18next();

    // Setup worker
    setupWorkerManager();

    log.info('Bootstrap finished.');
}

series([
    (next) => {
        setup()
            .then(() => {
                next();
            })
            .catch((err) => {
                // Prevent silent failures if setup rejects
                console.error('Setup initialization failed:', err);
                next(err);
            });
    },
    (next) => {
        const token = machineStore.get('session.token');
        user.signin({ token: token })
            .then(({ authenticated }) => {
                if (authenticated) {
                    log.info('Create and establish a MessagePort connection');
                    controller.connect(() => {
                        next();
                    });
                    return;
                }
                next();
            });
    },
], () => {
    log.info(`Launching Snapmaker Luban v${settings.version}...`);

    // Prevent browser from loading a drag-and-dropped file
    // http://stackoverflow.com/questions/6756583/prevent-browser-from-loading-a-drag-and-dropped-file
    window.addEventListener('dragover', (e) => {
        e = e || window.event;
        e.preventDefault();
    }, false);

    window.addEventListener('drop', (e) => {
        e = e || window.event;
        e.preventDefault();
    }, false);

    // Hide loading
    const loading = document.getElementById('loading');
    loading && loading.remove();

    // Generate the window title w/ the current version in it
    document.title = `Snapmaker Luban ${settings?.version || ''}`;

    // Change background color after loading complete
    const body = document.querySelector('body');
    body.style.backgroundColor = '#f8f8f8'; // sidebar background color

    const container = document.createElement('div');
    document.body.appendChild(container);

    ReactDOM.render(
        <ConfigProvider
            autoInsertSpaceInButton={false}
            getPopupContainer={(triggerNode) => (triggerNode ? triggerNode.parentElement : document.body)}
        >
            <Provider store={reduxStore}>
                <App />
            </Provider>
        </ConfigProvider>,
        container
    );
});
