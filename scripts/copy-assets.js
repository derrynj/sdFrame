const fs = require('fs');
const path = require('path');

const filesToCopy = [
  { src: 'src/renderer/settings/index.html', dest: 'dist/renderer/settings/index.html' },
  { src: 'src/renderer/settings/styles.css', dest: 'dist/renderer/settings/styles.css' },
  { src: 'src/renderer/error/index.html', dest: 'dist/renderer/error/index.html' },
  { src: 'src/renderer/error/styles.css', dest: 'dist/renderer/error/styles.css' },
  { src: 'src/renderer/error/error.js', dest: 'dist/renderer/error/error.js' },
  { src: 'src/renderer/loading/index.html', dest: 'dist/renderer/loading/index.html' },
  { src: 'src/renderer/loading/styles.css', dest: 'dist/renderer/loading/styles.css' },
  { src: 'src/renderer/titlebar/index.html', dest: 'dist/renderer/titlebar/index.html' },
  { src: 'src/renderer/titlebar/styles.css', dest: 'dist/renderer/titlebar/styles.css' },
  { src: 'src/renderer/titlebar/titlebar.js', dest: 'dist/renderer/titlebar/titlebar.js' },
];

for (const file of filesToCopy) {
  const srcPath = path.join(__dirname, '..', file.src);
  const destPath = path.join(__dirname, '..', file.dest);
  
  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  
  fs.copyFileSync(srcPath, destPath);
  console.log(`Copied: ${file.src} -> ${file.dest}`);
}

console.log('Assets copied successfully');
