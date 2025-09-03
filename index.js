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
This assumes you have a 48 bit virtual address space and plots a 1024x1024 map.
See the .txt files for example inputs. Serves the visualization via HTTP.
*/

const fs = require('fs');
const http = require('http');
const url = require('url');

class HilbertMemoryMap {
  constructor() {
    this.colorMap = new Map();
    this.colorIndex = 0;
    this.mapWidth = 1024;
    this.mapHeight = 1024;
    this.borderTop = 100;
    this.borderBottom = 100;
    this.borderLeft = 100;
    this.borderRight = 450; // Wider for scale key.
    this.width = this.mapWidth + this.borderLeft + this.borderRight;
    this.height = this.mapHeight + this.borderTop + this.borderBottom;
    this.totalPixels = this.mapWidth * this.mapHeight; // 2,097,152 pixels.
    this.addressSpaceBits = 48; // 48-bit virtual space.
    this.bytesPerPixel = Math.pow(2, this.addressSpaceBits - Math.log2(this.totalPixels)); // 2^26 = 64 MiB.
  }

  formatBytes(bytes) {
    if (bytes >= 1024 * 1024 * 1024 * 1024) {
      return Math.round(bytes / (1024 * 1024 * 1024 * 1024)) + ' TiB';
    } else if (bytes >= 1024 * 1024 * 1024) {
      return Math.round(bytes / (1024 * 1024 * 1024)) + ' GiB';
    } else if (bytes >= 1024 * 1024) {
      return Math.round(bytes / (1024 * 1024)) + ' MiB';
    } else if (bytes >= 1024) {
      return Math.round(bytes / 1024) + ' KiB';
    } else {
      return Math.round(bytes) + ' bytes';
    }
  }

  // Hilbert curve implementation - convert 1D index to 2D coordinates.
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
        [x, y] = [y, x]; // Swap x and y.
      }

      x += s * rx;
      y += s * ry;
      t = Math.floor(t / 4);
    }

    return [x, y];
  }
  generateColorForName(name) {
    if (this.colorMap.has(name)) {
      return this.colorMap.get(name);
    }

    // Generate bright, saturated colors using HSL.
    const hue = (this.colorIndex * 137.5) % 360; // Golden angle spacing.
    const saturation = 80 + (this.colorIndex % 3) * 10; // 80-100% saturation.
    const lightness = 50 + (this.colorIndex % 2) * 10;  // 50-60% lightness.

    // Convert HSL to RGB.
    const c = (1 - Math.abs(2 * lightness/100 - 1)) * saturation/100;
    const x = c * (1 - Math.abs((hue/60) % 2 - 1));
    const m = lightness/100 - c/2;

    let r, g, b;
    if (hue < 60) { r = c; g = x; b = 0; }
    else if (hue < 120) { r = x; g = c; b = 0; }
    else if (hue < 180) { r = 0; g = c; b = x; }
    else if (hue < 240) { r = 0; g = x; b = c; }
    else if (hue < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }

    const color = {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255),
      a: 255
    };

    this.colorMap.set(name, color);
    this.colorIndex++;
    return color;
  }

  parseMemoryData(textContent) {
    const lines = textContent.split('\n').filter(line => line.trim());
    const memoryRanges = [];
    const maxAddress = Math.pow(2, this.addressSpaceBits);

    for (const line of lines) {
      // Parse format: startAddr endAddr regionName.
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const startAddr = parseInt(parts[0], 16);
        const endAddr = parseInt(parts[1], 16);
        const regionName = parts.slice(2).join(' ');

        if (!isNaN(startAddr) && !isNaN(endAddr) && endAddr > startAddr) {
          // Skip ranges that exceed address space.
          if (startAddr >= maxAddress) {
            continue;
          }

          // Clamp end address to stay within bounds.
          const clampedEnd = Math.min(endAddr, maxAddress);
          const color = this.generateColorForName(regionName);

          memoryRanges.push({
            start: startAddr,
            end: clampedEnd,
            name: regionName,
            color: color
          });
        }
      }
    }

    return memoryRanges.sort((a, b) => a.start - b.start);
  }




  startServer(inputFile, port = 8080) {
    const server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url, true);

      if (parsedUrl.pathname === '/') {
        // Serve HTML page.
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head>
    <title>Memory Map Visualization</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        .container {
            margin: 0 auto;
            text-align: center;
            overflow-x: auto;
            position: relative;
        }
        canvas {
            border: 1px solid #ddd;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            max-width: 100%;
            height: auto;
            cursor: crosshair;
        }
        .tooltip {
            position: absolute;
            background: #f0f0f0;
            color: black;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            pointer-events: auto;
            z-index: 1000;
            white-space: nowrap;
            transform: translate(-50%, -100%);
            margin-top: -10px;
            min-width: 200px;
        }
        .tooltip-close {
            position: absolute;
            top: 2px;
            right: 6px;
            cursor: pointer;
            font-weight: bold;
            color: #666;
            font-size: 14px;
        }
        .tooltip-close:hover {
            color: #000;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Memory Map Visualization</h1>
        <p>48-bit virtual address space (256 TiB) mapped to 1024x1024 using Hilbert curve</p>
        <p><button onclick="resetZoom()">Reset Zoom</button> | Double-click grid squares to zoom in | Press 'r' to reset</p>
        <canvas id="memoryCanvas"></canvas>
        <div class="tooltip" id="tooltip" style="display: none;"></div>
    </div>
    <script src="/client.js"></script>
</html>`);
      } else if (parsedUrl.pathname === '/client.js') {
        // Serve client-side JavaScript.
        try {
          const jsContent = fs.readFileSync('client.js', 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/javascript' });
          res.end(jsContent);
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error loading client script: ' + error.message);
        }
      } else if (parsedUrl.pathname === '/memory-data') {
        // Serve memory data as JSON for tooltip functionality.
        try {
          const textContent = fs.readFileSync(inputFile, 'utf8');
          const memoryRanges = this.parseMemoryData(textContent);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(memoryRanges));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error loading memory data: ' + error.message);
        }
      } else {
        // 404 for other paths.
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    server.listen(port, () => {
      console.log(`Memory map server running at http://localhost:${port}/`);
    });

    return server;
  }
}

// CLI interface.
function showHelp() {
  console.log(`
Hilbert Curve Memory Map Generator

Usage: node index.js <input-file> [port]

Arguments:
  input-file   Text file containing memory ranges with region names
  port         HTTP server port (default: 8080)

Input format (one range per line):
  startAddr endAddr regionName

Example:
  0x7f0000000000 0x7f0000001000 heap
  0x400000 0x500000 text
  400000 500000 text

Where:
- startAddr, endAddr are hex addresses (inclusive start, exclusive end)
- regionName is any descriptive name (spaces allowed)

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
  const port = parseInt(args[1]) || 8080;

  if (!fs.existsSync(inputFile)) {
    console.error(`Error: Input file '${inputFile}' does not exist`);
    process.exit(1);
  }

  const generator = new HilbertMemoryMap();
  generator.startServer(inputFile, port);
}

if (require.main === module) {
  main();
}

module.exports = HilbertMemoryMap;
