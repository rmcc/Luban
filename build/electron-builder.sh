#!/bin/bash
set -x

__dirname="$(CDPATH= cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
electron_version=$(electron --version)

display_usage() {
    npm run electron-builder -- --help
}

if [ $# -le 1 ]; then
    display_usage
    exit 1
fi

if [[ ( $# == "--help") ||  $# == "-h" ]]; then
    display_usage
    exit 0
fi

pushd "$__dirname/../dist/Luban"
echo "Cleaning up \"`pwd`/node_modules\""
rm -rf node_modules

echo 'Syncing modified modules for distribution install...'
# Make sure we pull the Windows modules if cross-building, otherwise
# "npm install" will use natives
if [[ " $* " =~ " --win " ]]; then
    echo "Windows build detected! Forcing Windows environment variables..."
    export npm_config_target_platform=win32
    export npm_config_target_arch=x64
fi
# Copy the folder from the project root to the dist folder
cp -r ../../modified-modules ./

echo "Installing packages..."
npm install --omit=dev
npm dedupe
# Clean them up so they don't end in the packaged file
rm -rf modified-modules

# Jimp 1.6.1's commonJS fails to resolve the ESM file-type path. force it as a submodule
mkdir -p node_modules/@jimp/core/node_modules && cp -r node_modules/file-type node_modules/@jimp/core/node_modules || true

popd

#echo "Rebuild native modules using electron ${electron_version}"

# No more need to rebuild natives. font-scanner has been replaced, and serialport has NAPI prebuilts
# If you really want to rebuild, uncomment the line below and remove the -c.npmRebuild=false argument from electron-builder
#
# npm run electron-rebuild -- --version=${electron_version:1} --module-dir=dist/Luban --which-module=serialport

cross-env USE_HARD_LINKS=false npm run electron-builder -- -c.npmRebuild=false -c.buildDependenciesFromSource=false -c.afterPack=./build/fix-serialport.js "$@"
