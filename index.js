#!/usr/bin/env node

/*
 * Hilbert Curve Memory Map Generator
 *
 * Copyright (c) 2025 Cloudflare, Inc.
 * Coded with plentiful help from Claude (Anthropic's AI Assistant)
 *
 * Licensed under the MIT License - see LICENSE file for details
 */

/*
This assumes you have a 47 bit memory map (normal on Linux) and always
plots a 1024x2048 map of that.  See the .txt files for example inputs.
*/

const fs = require('fs');
const { createCanvas } = require('canvas');

class HilbertMemoryMap {
  constructor() {
    this.mapWidth = 1024;
    this.mapHeight = 1024;
    this.borderTop = 200;
    this.borderBottom = 200;
    this.borderLeft = 200;
    this.borderRight = 400; // Wider for scale key
    this.width = this.mapWidth + this.borderLeft + this.borderRight;
    this.height = this.mapHeight + this.borderTop + this.borderBottom;
    this.totalPixels = this.mapWidth * this.mapHeight; // 2,097,152 pixels
    this.addressSpaceBits = 48; // 48-bit virtual space
    this.bytesPerPixel = Math.pow(2, this.addressSpaceBits - Math.log2(this.totalPixels)); // 2^26 = 64 MiB
  }

  // Convert address to pixel index using the virtual address space
  addressToPixelIndex(address) {
    const pixelIndex = Math.floor(address / this.bytesPerPixel);
    return Math.min(pixelIndex, this.totalPixels - 1);
  }

  // Hilbert curve implementation - convert 1D index to 2D coordinates
  hilbertIndexToXY(index, order) {
    const n = 1 << order;
    let x = 0, y = 0;
    let t = index;

    for (let s = 1; s < n; s <<= 1) {
      const rx = 1 & (t >>> 1);
      const ry = 1 & (t ^ rx);

      if (ry === 0) {
        if (rx === 1) {
          x = s - 1 - x;
          y = s - 1 - y;
        }
        [x, y] = [y, x]; // Swap x and y
      }

      x += s * rx;
      y += s * ry;
      t >>>= 2;
    }

    return [x, y];
  }

  // Convert pixel index to canvas coordinates using single Hilbert curve
  pixelIndexToCanvasCoords(pixelIndex) {
    const order = 10; // 2^10 = 1024 for the 1024x1024 map
    const [x, y] = this.hilbertIndexToXY(pixelIndex, order);

    // Add border offset to map coordinates
    return [x + this.borderLeft, y + this.borderTop];
  }

  parseMemoryData(textContent) {
    const lines = textContent.split('\n').filter(line => line.trim());
    const memoryRanges = [];
    const maxAddress = Math.pow(2, this.addressSpaceBits); // 2^47

    for (const line of lines) {
      // Parse format: startAddr endAddr r g b a
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 6) {
        const startAddr = parseInt(parts[0], 16);
        const endAddr = parseInt(parts[1], 16);
        const r = parseInt(parts[2]);
        const g = parseInt(parts[3]);
        const b = parseInt(parts[4]);
        const a = parseInt(parts[5]);

        if (!isNaN(startAddr) && !isNaN(endAddr) && endAddr > startAddr) {
          // Skip ranges that exceed 47-bit address space
          if (startAddr >= maxAddress) {
            continue; // Silently skip
          }

          // Clamp end address to stay within bounds
          const clampedEnd = Math.min(endAddr, maxAddress);

          memoryRanges.push({
            start: startAddr,
            end: clampedEnd,
            color: { r, g, b, a }
          });
        }
      }
    }

    return memoryRanges.sort((a, b) => a.start - b.start);
  }

  drawMemoryMap(memoryRanges) {
    const canvas = createCanvas(this.width, this.height);
    const ctx = canvas.getContext('2d');

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.width, this.height);

    // Black area for the memory map
    ctx.fillStyle = '#000000';
    ctx.fillRect(this.borderLeft, this.borderTop, this.mapWidth, this.mapHeight);

    if (memoryRanges.length === 0) {
      console.log('No memory ranges found');
      return canvas;
    }

    console.log(`Drawing ${memoryRanges.length} memory ranges...`);

    // Create image data for the entire canvas
    const imageData = ctx.getImageData(0, 0, this.width, this.height);
    const data = imageData.data;

    // Process each memory range
    memoryRanges.forEach((range, rangeIndex) => {
      const { r, g, b, a } = range.color;

      // Calculate pixel range for this memory range
      const startPixelIndex = this.addressToPixelIndex(range.start);
      const endPixelIndex = this.addressToPixelIndex(range.end);
      const pixelCount = Math.max(1, endPixelIndex - startPixelIndex);

      console.log(`Range ${rangeIndex + 1}/${memoryRanges.length}: 0x${range.start.toString(16)}-0x${range.end.toString(16)} (${pixelCount} pixels)`);

      // Fill pixels for this memory range
      for (let pixelIndex = startPixelIndex; pixelIndex < endPixelIndex && pixelIndex < this.totalPixels; pixelIndex++) {
        const [x, y] = this.pixelIndexToCanvasCoords(pixelIndex);

        if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
          const dataIndex = (y * this.width + x) * 4;
          data[dataIndex] = r;     // Red
          data[dataIndex + 1] = g; // Green
          data[dataIndex + 2] = b; // Blue
          data[dataIndex + 3] = a; // Alpha
        }
      }
    });

    // Apply the image data to canvas
    ctx.putImageData(imageData, 0, 0);

    // Draw grid lines for terabyte boundaries
    this.drawGridLines(ctx);

    // Draw scale key in the right border
    this.drawScaleKey(ctx);

    return canvas;
  }

  drawGridLines(ctx) {
    // Set up dotted line style
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'; // Brighter white
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]); // Dotted pattern

    // 1TB = 4096 pixels = 64x64 square in Hilbert space (1TB / 256MB = 4096)
    const tbSize = 64; // sqrt(4096) = 64

    // Draw grid lines every 64 pixels in both directions
    ctx.beginPath();

    for (let i = tbSize; i < 1024; i += tbSize) {
      // Vertical lines
      ctx.moveTo(this.borderLeft + i, this.borderTop);
      ctx.lineTo(this.borderLeft + i, this.borderTop + 1024);
      // Horizontal lines
      ctx.moveTo(this.borderLeft, this.borderTop + i);
      ctx.lineTo(this.borderLeft + 1024, this.borderTop + i);
    }

    ctx.stroke();

    // Reset line dash for other drawing
    ctx.setLineDash([]);
  }

  drawScaleKey(ctx) {
    const keyX = this.borderLeft + this.mapWidth + 50;
    const keyY = this.borderTop + 100;

    // Set text style
    ctx.fillStyle = '#000000';
    ctx.font = '16px Arial';

    // Title
    ctx.fillText('Scale:', keyX, keyY);

    // 1 GB scale (approximately 4 pixels: 1GB / 256MiB = 4)
    const gbPixels = Math.round(1024 * 1024 * 1024 / this.bytesPerPixel); // 1GB in pixels
    const gbSize = Math.sqrt(gbPixels); // Approximate square size

    ctx.fillStyle = '#808080';
    ctx.fillRect(keyX, keyY + 30, gbSize, gbSize);
    ctx.fillStyle = '#000000';
    ctx.font = '14px Arial';
    ctx.fillText(`1 GiB (${gbPixels} pixels)`, keyX + gbSize + 10, keyY + 30 + gbSize/2);

    // 1 TB scale (approximately 4096 pixels: 1TB / 256MiB = 4096)
    const tbPixels = Math.round(1024 * 1024 * 1024 * 1024 / this.bytesPerPixel); // 1TB in pixels
    const tbSize = Math.sqrt(tbPixels); // Approximate square size

    ctx.fillStyle = '#404040';
    ctx.fillRect(keyX, keyY + 100, tbSize, tbSize);
    ctx.fillStyle = '#000000';
    ctx.fillText(`1 TiB (${tbPixels} pixels)`, keyX + tbSize + 10, keyY + 100 + tbSize/2);

    // Additional info
    ctx.font = '12px Arial';
    ctx.fillText(`Each pixel = 256 MiB`, keyX, keyY + 250);
    ctx.fillText(`Total space = 256 TiB`, keyX, keyY + 270);
  }

  async generateMemoryMap(inputFile, outputFile) {
    try {
      console.log(`Reading memory layout from ${inputFile}...`);
      const textContent = fs.readFileSync(inputFile, 'utf8');
      const memoryRanges = this.parseMemoryData(textContent);

      console.log(`Parsed ${memoryRanges.length} memory ranges`);
      console.log(`Address space: 256 TiB (48-bit)`);
      console.log(`Canvas: ${this.width}x${this.height} pixels`);
      console.log(`Resolution: 256 MiB per pixel`);

      const canvas = this.drawMemoryMap(memoryRanges);
      const buffer = canvas.toBuffer('image/png');

      fs.writeFileSync(outputFile, buffer);
      console.log(`Hilbert curve memory map saved to ${outputFile}`);

    } catch (error) {
      console.error('Error generating memory map:', error.message);
      process.exit(1);
    }
  }
}

// CLI interface
function showHelp() {
  console.log(`
Hilbert Curve Memory Map Generator

Usage: node index.js <input-file> [output-file]

Arguments:
  input-file   Text file containing memory ranges with colors
  output-file  Output PNG file (default: memory-map.png)

Input format (one range per line):
  startAddr endAddr r g b a

Example:
  0x7f0000000000 0x7f0000001000 255 0 0 255
  0x400000 0x500000 0 255 0 255
  400000 500000 0 0 255 128

Where:
- startAddr, endAddr are hex addresses (inclusive start, exclusive end)
- r, g, b, a are color values (0-255)

Features:
- Maps 48-bit virtual address space (256 TiB)
- 1024x1024 pixel output (256 MiB per pixel)
- Uses Hilbert curve for space-filling mapping
- Adjacent addresses remain visually adjacent
  `);
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    return;
  }

  const inputFile = args[0];
  const outputFile = args[1] || 'memory-map.png';

  if (!fs.existsSync(inputFile)) {
    console.error(`Error: Input file '${inputFile}' does not exist`);
    process.exit(1);
  }

  const generator = new HilbertMemoryMap();
  generator.generateMemoryMap(inputFile, outputFile);
}

if (require.main === module) {
  main();
}

module.exports = HilbertMemoryMap;
