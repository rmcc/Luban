import * as fs from 'fs-extra';

import logger from '../../logger';

const log = logger('util-fs');

interface CopyDirOptions {
    overwrite?: boolean;
    asarSafe?: boolean;
}
/**
 * Copy files from srcDir to dstDir.
 */
export async function copyDir(srcDir: string, dstDir: string, options: CopyDirOptions = {}): Promise<void> {
    log.info(`Copying folder ${srcDir} to ${dstDir}`);

    if (typeof options.overwrite === 'undefined') {
        options.overwrite = true;
    }

    if (typeof options.asarSafe !== 'undefined' && options.asarSafe === 'true') {
        await copyRecurse(srcDir, dstDir);
    }

    try {
        await fs.copy(srcDir, dstDir, options);
    } catch (e) {
        log.error(e);
    }
}

/* fs-extra and ASAR don't quite mix. it tries to lstat the origin files */
function copyRecurse(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyRecurse(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}
