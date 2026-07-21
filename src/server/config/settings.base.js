import path from 'path';
import pkg from '../../package.json';

// RCFile
const RCFILE = '.snapmaker-luban.json';

// Secret
const secret = pkg.version;

const getUserHome = () => ((process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME']) || '');

export default {
    rcfile: path.resolve(getUserHome(), RCFILE),
    verbosity: 0,
    version: pkg.version,

    // The secret key is loaded from the config file
    // @see "src/server/index.js"
    secret: secret,

    // Access Token Lifetime
    accessTokenLifetime: '30d', // https://github.com/zeit/ms

    // Allow Remote Access
    allowRemoteAccess: false,

    // Middleware (https://github.com/senchalabs/connect)
    middleware: {
        // https://github.com/expressjs/body-parser
        'body-parser': {
            'json': {
                // maximum request body size. (default: <100kb>)
                limit: '256mb'
            },
            'urlencoded': {
                extended: true,
                // maximum request body size. (default: <100kb>)
                limit: '256mb'
            }
        },
        // https://github.com/mscdex/connect-busboy
        'busboy': {
            limits: {
                fileSize: 256 * 1024 * 1024 // 256MB
            },
            // immediate
            //   false: no immediate parsing
            //   true: immediately start reading from the request stream and parsing
            immediate: false
        },
        // https://github.com/andrewrk/node-multiparty/
        'multiparty': {
            // Limits the amount of memory a field (not a file) can allocate in bytes.
            // If this value is exceeded, an error event is emitted. The default size is 2MB.
            maxFieldsSize: 20 * 1024 * 1024, // 20MB

            // Limits the number of fields that will be parsed before emitting an error event. A file counts as a field in this case. Defaults to 1000.
            maxFields: 1000
        },
        // https://github.com/expressjs/session
        'session': {
            // https://github.com/expressjs/session#resave
            resave: true,
            // https://github.com/expressjs/session#saveuninitialized
            saveUninitialized: true
        }
    },
    // Supported languages
    supportedLngs: [
        'en', // English (default)
        'cs', // Czech
        'de', // German
        'es', // Spanish
        'fr', // French
        'hu', // Hungarian
        'it', // Italian
        'ja', // Japanese
        'ko', // Korean
        'pt-br', // Portuguese (Brazil)
        'ru', // Russian
        'uk', // Ukrainian
        'zh-CN', // Simplified Chinese
        'zh-tw' // Traditional Chinese
    ],
    siofu: { // SocketIOFileUploader
        dir: './tmp/siofu'
    },
    i18next: {
        lowerCaseLng: false,

        // logs out more info (console)
        debug: false,

        // language to lookup key if not found on set language
        fallbackLng: 'en',

        // string or array of namespaces
        ns: [
            'config',
            'resource' // default
        ],

        // default namespace used if not passed to translation function
        defaultNS: 'resource',

        whitelist: [
            'en', // English (default)
            'cs', // Czech
            'de', // German
            'es', // Spanish
            'fr', // French
            'hu', // Hungarian
            'it', // Italian
            'ja', // Japanese
            'ko', // Korean
            'pt-br', // Portuguese (Brazil)
            'ru', // Russian
            'uk', // Ukrainian
            'zh-CN', // Simplified Chinese
            'zh-tw' // Traditional Chinese
        ],

        // array of languages to preload
        preload: [],

        // language codes to lookup, given set language is 'en-US':
        // 'all' --> ['en-US', 'en', 'dev']
        // 'currentOnly' --> 'en-US'
        // 'languageOnly' --> 'en'
        load: 'currentOnly',

        // char to separate keys
        keySeparator: false,

        // char to split namespace from key
        nsSeparator: false,

        interpolation: {
            prefix: '{{',
            suffix: '}}'
        },

        detection: {
            // order and from where user language should be detected
            order: ['session', 'querystring', 'cookie', 'header'],

            // keys or params to lookup language from
            lookupQuerystring: 'lang',
            lookupCookie: 'lang',
            lookupSession: 'lang',

            // cache user language
            caches: ['cookie']
        },

        backend: {
            // path where resources get loaded from
            loadPath: path.resolve(__dirname, '..', 'i18n', '{{lng}}', '{{ns}}.json'),

            // path to post missing resources
            addPath: path.resolve(__dirname, '..', 'i18n', '{{lng}}', '{{ns}}.savedMissing.json'),

            // jsonIndent to use when storing json files
            jsonIndent: 4
        }
    }
};
