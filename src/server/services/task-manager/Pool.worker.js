// the forked utilityProcess that spawned the server
// gave us a pseudo-root path from which we work. Keep overloading it
// since a direct process.chdir() can't be done inside ASAR
if (process.env.VIRTUAL_CWD) {
    process.cwd = () => process.env.VIRTUAL_CWD;
}

import workerpool from 'workerpool';

const methods = require.context('./workers', false, /\.(t|j)s/).keys()
    .reduce((prev, key) => {
        key = key.replace('./', '');
        const [name] = key.split('.');
        // eslint-disable-next-line import/no-dynamic-require
        prev[name] = require(`./workers/${key}`).default;
        return prev;
    }, {});

workerpool.worker(methods);
