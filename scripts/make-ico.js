const fs = require('fs');
const path = require('path');

const pngPath = path.join(__dirname, '..', 'assets', 'icon.png');
const icoPath = path.join(__dirname, '..', 'assets', 'icon.ico');

const png = fs.readFileSync(pngPath);

if (png.readUInt32BE(0) !== 0x89504e47) {
  console.error('assets/icon.png is not a valid PNG');
  process.exit(1);
}

const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);

if (width !== height) {
  console.error(`Icon must be square (got ${width}x${height}); .ico not generated`);
  process.exit(1);
}
if (width > 256 || height > 256) {
  console.error(`Icon larger than 256x256 (${width}x${height}); .ico not generated`);
  process.exit(1);
}

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // image count

const entry = Buffer.alloc(16);
entry.writeUInt8(width >= 256 ? 0 : width, 0);
entry.writeUInt8(height >= 256 ? 0 : height, 1);
entry.writeUInt8(0, 2);
entry.writeUInt8(0, 3);
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12);

const ico = Buffer.concat([header, entry, png]);
fs.writeFileSync(icoPath, ico);
console.log(`Icon created: ${icoPath} (${width}x${height}, PNG-compressed entry)`);