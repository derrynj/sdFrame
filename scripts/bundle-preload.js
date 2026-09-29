const path = require('path');
const esbuild = require('esbuild');

esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'main', 'preload.ts')],
  outfile: path.join(__dirname, '..', 'dist', 'main', 'preload.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
});