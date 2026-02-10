const fs = require('fs');
const path = require('path');

// Create a simple 256x256 PNG with RGBA data
// This is a minimal valid PNG file
const width = 256;
const height = 256;

// PNG signature
const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

function crc32(data) {
  let crc = 0xFFFFFFFF;
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  
  const typeBuffer = Buffer.from(type);
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData));
  
  return Buffer.concat([length, typeBuffer, data, crc]);
}

// IHDR chunk
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type (RGBA)
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

const ihdrChunk = createChunk('IHDR', ihdr);

// Create raw image data (uncompressed for simplicity)
const rawData = [];
for (let y = 0; y < height; y++) {
  rawData.push(0); // filter byte
  for (let x = 0; x < width; x++) {
    // Create a grid pattern with the frame colors
    const cellX = Math.floor(x / 128);
    const cellY = Math.floor(y / 128);
    const cell = cellY * 2 + cellX;
    
    const colors = [
      [78, 205, 196],  // #4ECDC4
      [255, 107, 107], // #FF6B6B
      [69, 183, 209],  // #45B7D1
      [150, 206, 180], // #96CEB4
    ];
    
    const margin = 16;
    const isMargin = x < margin || x >= width - margin || y < margin || y >= height - margin;
    const isBorder = x < margin + 4 || x >= width - margin - 4 || y < margin + 4 || y >= height - margin - 4;
    
    if (isMargin) {
      rawData.push(26, 26, 46, 255); // Background #1a1a2e
    } else {
      const color = colors[cell];
      rawData.push(color[0], color[1], color[2], 255);
    }
  }
}

// Use zlib to compress (Node.js built-in)
const zlib = require('zlib');
const compressed = zlib.deflateSync(Buffer.from(rawData), { level: 9 });
const idatChunk = createChunk('IDAT', compressed);

// IEND chunk
const iendChunk = createChunk('IEND', Buffer.alloc(0));

// Combine all chunks
const png = Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);

// Write to file
const outputPath = path.join(__dirname, '..', 'assets', 'icon.png');
fs.writeFileSync(outputPath, png);
console.log(`Icon created: ${outputPath}`);
