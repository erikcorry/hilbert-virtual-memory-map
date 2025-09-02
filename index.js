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
const { createCanvas } = require('canvas');

class HilbertMemoryMap {
  constructor() {
    this.colorMap = new Map();
    this.colorIndex = 0;
    this.mapWidth = 1024;
    this.mapHeight = 1024;
    this.borderTop = 100;
    this.borderBottom = 100;
    this.borderLeft = 100;
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

  generateColorForName(name) {
    if (this.colorMap.has(name)) {
      return this.colorMap.get(name);
    }

    // Generate bright, saturated colors using HSL
    const hue = (this.colorIndex * 137.5) % 360; // Golden angle spacing
    const saturation = 80 + (this.colorIndex % 3) * 10; // 80-100% saturation
    const lightness = 50 + (this.colorIndex % 2) * 10;  // 50-60% lightness
    
    // Convert HSL to RGB
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
      // Parse format: startAddr endAddr regionName
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const startAddr = parseInt(parts[0], 16);
        const endAddr = parseInt(parts[1], 16);
        const regionName = parts.slice(2).join(' ');

        if (!isNaN(startAddr) && !isNaN(endAddr) && endAddr > startAddr) {
          // Skip ranges that exceed address space
          if (startAddr >= maxAddress) {
            continue;
          }

          // Clamp end address to stay within bounds
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

    // 4TB = 16384 pixels = 128x128 square in Hilbert space (4TB / 256MB = 16384)
    const tbSize = 128; // sqrt(16384) = 128

    // Draw grid lines every 128 pixels in both directions  
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

  generateMemoryMapBuffer(inputFile) {
    console.log(`Reading memory layout from ${inputFile}...`);
    const textContent = fs.readFileSync(inputFile, 'utf8');
    const memoryRanges = this.parseMemoryData(textContent);

    console.log(`Parsed ${memoryRanges.length} memory ranges`);
    console.log(`Address space: 256 TiB (48-bit)`);
    console.log(`Canvas: ${this.width}x${this.height} pixels`);
    console.log(`Resolution: 256 MiB per pixel`);

    const canvas = this.drawMemoryMap(memoryRanges);
    return canvas.toBuffer('image/png');
  }

  startServer(inputFile, port = 8080) {
    const server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url, true);
      
      if (parsedUrl.pathname === '/') {
        // Serve HTML page
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
        <canvas id="memoryCanvas"></canvas>
        <div class="tooltip" id="tooltip" style="display: none;"></div>
    </div>
    <script>
        let regions = [];
        
        async function loadMemoryMap() {
            const response = await fetch('/memory-data');
            regions = await response.json();
            
            const canvas = document.getElementById('memoryCanvas');
            const img = new Image();
            img.onload = function() {
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
            };
            img.src = '/memory-map.png';
        }
        
        function addressToPixelIndex(address) {
            const bytesPerPixel = Math.pow(2, 48 - 20); // 2^28 = 256MB
            return Math.floor(address / bytesPerPixel);
        }
        
        function hilbertIndexToXY(index) {
            const n = 1024;
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
                    [x, y] = [y, x];
                }
                
                x += s * rx;
                y += s * ry;
                t >>>= 2;
            }
            
            return [x, y];
        }
        
        function xyToHilbertIndex(x, y) {
            const n = 1024;
            let index = 0;
            
            for (let s = n >>> 1; s > 0; s >>>= 1) {
                let rx = (x & s) > 0 ? 1 : 0;
                let ry = (y & s) > 0 ? 1 : 0;
                index += s * s * ((3 * rx) ^ ry);
                
                if (ry === 0) {
                    if (rx === 1) {
                        x = n - 1 - x;
                        y = n - 1 - y;
                    }
                    [x, y] = [y, x];
                }
            }
            
            return index;
        }

        function findRegionAtPixel(canvasX, canvasY) {
            const borderLeft = 100;
            const borderTop = 100;
            const mapX = Math.floor(canvasX - borderLeft);
            const mapY = Math.floor(canvasY - borderTop);
            
            if (mapX < 0 || mapX >= 1024 || mapY < 0 || mapY >= 1024) return null;
            
            let bestMatch = null;
            let bestDistance = Infinity;
            
            // Check area around the click point for small regions
            for (let dx = -3; dx <= 3; dx++) {
                for (let dy = -3; dy <= 3; dy++) {
                    const checkX = mapX + dx;
                    const checkY = mapY + dy;
                    if (checkX < 0 || checkX >= 1024 || checkY < 0 || checkY >= 1024) continue;
                    
                    const hilbertIndex = xyToHilbertIndex(checkX, checkY);
                    const address = hilbertIndex * Math.pow(2, 28); // 256MB per pixel
                    
                    for (const region of regions) {
                        if (address >= region.start && address < region.end) {
                            const distance = Math.abs(dx) + Math.abs(dy);
                            if (distance < bestDistance) {
                                bestDistance = distance;
                                bestMatch = region;
                            }
                        }
                    }
                }
            }
            
            return bestMatch;
        }
        
        document.addEventListener('DOMContentLoaded', function() {
            loadMemoryMap();
            
            const canvas = document.getElementById('memoryCanvas');
            const tooltip = document.getElementById('tooltip');
            
            canvas.addEventListener('click', function(e) {
                const rect = canvas.getBoundingClientRect();
                const scaleX = canvas.width / rect.width;
                const scaleY = canvas.height / rect.height;
                const x = (e.clientX - rect.left) * scaleX;
                const y = (e.clientY - rect.top) * scaleY;
                
                const region = findRegionAtPixel(x, y);
                
                if (region) {
                    const size = region.end - region.start;
                    let sizeStr;
                    if (size >= 1024 * 1024 * 1024 * 1024) {
                        sizeStr = (size / (1024 * 1024 * 1024 * 1024)).toFixed(1) + ' TiB';
                    } else if (size >= 1024 * 1024 * 1024) {
                        sizeStr = (size / (1024 * 1024 * 1024)).toFixed(1) + ' GiB';
                    } else if (size >= 1024 * 1024) {
                        sizeStr = (size / (1024 * 1024)).toFixed(1) + ' MiB';
                    } else if (size >= 1024) {
                        sizeStr = (size / 1024).toFixed(1) + ' KiB';
                    } else {
                        sizeStr = size + ' bytes';
                    }
                    
                    tooltip.innerHTML = \`<span class="tooltip-close" onclick="hideTooltip()">&times;</span>\${region.name}<br>0x\${region.start.toString(16)} - 0x\${region.end.toString(16)}<br>Size: \${sizeStr}\`;
                    tooltip.style.display = 'block';
                    tooltip.style.left = e.clientX + 'px';
                    tooltip.style.top = e.clientY + 'px';
                } else {
                    hideTooltip();
                }
            });
            
            // Click outside map area to dismiss
            document.addEventListener('click', function(e) {
                const canvas = document.getElementById('memoryCanvas');
                const rect = canvas.getBoundingClientRect();
                const scaleX = canvas.width / rect.width;
                const scaleY = canvas.height / rect.height;
                const x = (e.clientX - rect.left) * scaleX;
                const y = (e.clientY - rect.top) * scaleY;
                
                const borderLeft = 100;
                const borderTop = 100;
                const mapX = x - borderLeft;
                const mapY = y - borderTop;
                
                // If click is outside the 1024x1024 map area or outside canvas entirely
                if (e.target !== canvas || mapX < 0 || mapX >= 1024 || mapY < 0 || mapY >= 1024) {
                    hideTooltip();
                }
            });
        });
        
        function hideTooltip() {
            document.getElementById('tooltip').style.display = 'none';
        }
    </script>
</body>
</html>`);
      } else if (parsedUrl.pathname === '/memory-data') {
        // Serve memory data as JSON for tooltip functionality
        try {
          const textContent = fs.readFileSync(inputFile, 'utf8');
          const memoryRanges = this.parseMemoryData(textContent);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(memoryRanges));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error loading memory data: ' + error.message);
        }
      } else if (parsedUrl.pathname === '/memory-map.png') {
        // Serve PNG image
        try {
          const pngBuffer = this.generateMemoryMapBuffer(inputFile);
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end(pngBuffer);
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error generating memory map: ' + error.message);
        }
      } else {
        // 404 for other paths
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

// CLI interface
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
