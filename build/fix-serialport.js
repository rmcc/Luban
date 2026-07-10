// Workaround for https://github.com/serialport/node-serialport/issues/2619
//
const fs = require('fs');
const path = require('path');

exports.default = async function(context) {
  const appOutDir = context.appOutDir;
  
  // Target the root of the build artifacts folder
  const buildDir = path.join(
    context.packager.projectDir,
    'dist/Luban/node_modules/@serialport/bindings-cpp/build'
  );

  if (fs.existsSync(buildDir)) {
    console.log('\x1b[33m%s\x1b[0m', `[WARNING] Found rogue build directory containing ELF and python artifacts: ${buildDir}`);
    
    try {
      // Use recursive and force to nuke everything inside (including node_gyp_bins)
      fs.rmSync(buildDir, { recursive: true, force: true });
      console.log('\x1b[32m%s\x1b[0m', '[WARNING] Successfully nuked the entire build folder.');
    } catch (err) {
      console.error('\x1b[31m%s\x1b[0m', `[WARNING] Failed to remove build folder: ${err.message}`);
    }
  } else {
    console.log('[WARNING] Checked for build folder; staging directory is already clean.');
  }
};
