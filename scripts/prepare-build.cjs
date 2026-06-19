const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');

copyDirectory(path.join(projectRoot, 'src', 'public'), path.join(distDir, 'public'));
copyDirectory(path.join(projectRoot, 'src', 'models'), path.join(distDir, 'models'));

function copyDirectory(sourceDir, targetDir) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
}
