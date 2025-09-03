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
    this.borderRight = 400; // Wider for scale key.
    this.width = this.mapWidth + this.borderLeft + this.borderRight;
    this.height = this.mapHeight + this.borderTop + this.borderBottom;
    this.totalPixels = this.mapWidth * this.mapHeight; // 2,097,152 pixels.
    this.addressSpaceBits = 48; // 48-bit virtual space.
    this.bytesPerPixel = Math.pow(2, this.addressSpaceBits - Math.log2(this.totalPixels)); // 2^26 = 64 MiB.
  }

  // Convert address to pixel index using the virtual address space.
  addressToPixelIndex(address) {
    const pixelIndex = Math.floor(address / this.bytesPerPixel);
    return Math.min(pixelIndex, this.totalPixels - 1);
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

  drawMemoryMap(memoryRanges, level, minAddr, maxAddr, offsetX, offsetY) {
    const canvas = createCanvas(this.width, this.height);
    const ctx = canvas.getContext('2d');

    // White background.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.width, this.height);

    // Black area for the memory map.
    ctx.fillStyle = '#000000';
    ctx.fillRect(this.borderLeft, this.borderTop, this.mapWidth, this.mapHeight);

    if (memoryRanges.length === 0) {
      console.log('No memory ranges found');
      return canvas;
    }

    const addressRange = maxAddr - minAddr;
    const bytesPerPixel = addressRange / this.totalPixels;

    // Filter ranges to only those that overlap with current view.
    const visibleRanges = memoryRanges.filter(range =>
      range.end > minAddr && range.start < maxAddr
    );

    console.log(`Filtering: minAddr=0x${minAddr.toString(16)} maxAddr=0x${maxAddr.toString(16)}`);

    console.log(`Drawing ${visibleRanges.length}/${memoryRanges.length} visible ranges...`);

    // Create image data for the entire canvas.
    const imageData = ctx.getImageData(0, 0, this.width, this.height);
    const data = imageData.data;

    // Process each visible memory range.
    visibleRanges.forEach((range, rangeIndex) => {
      const { r, g, b, a } = range.color;

      // Calculate pixel range for this memory range in current view.
      const startAddr = Math.max(range.start, minAddr);
      const endAddr = Math.min(range.end, maxAddr);

      console.log(`Range ${rangeIndex}: start=0x${range.start.toString(16)} end=0x${range.end.toString(16)} minAddr=0x${minAddr.toString(16)} maxAddr=0x${maxAddr.toString(16)}`);
      console.log(`Zoom level ${level}`);

      // Fill pixels for this memory range.
      for (let address = startAddr; address < endAddr; address += bytesPerPixel) {

        // Get coordinates in 2^24 coordinate system.
        const order = 24;
        const [x24, y24] = this.hilbertIndexToXY(address, order);

        // Scale from 2^24 to 1024 and apply offset.
        const baseZoomFactor = Math.pow(2, 24 - 10); // 2^14 = 16384.
        const levelZoomFactor = Math.pow(8, level);
        const actualZoomFactor = baseZoomFactor / levelZoomFactor;

        const scaledX = Math.floor((x24 - offsetX) / actualZoomFactor);
        const scaledY = Math.floor((y24 - offsetY) / actualZoomFactor);
        if (scaledX >= 0 && scaledX < this.mapWidth &&
            scaledY >= 0 && scaledY < this.mapHeight) {
          const canvasX = scaledX + this.borderLeft;
          const canvasY = scaledY + this.borderTop;
          const dataIndex = (canvasY * this.width + canvasX) * 4;
          data[dataIndex] = r;     // Red.
          data[dataIndex + 1] = g; // Green.
          data[dataIndex + 2] = b; // Blue.
          data[dataIndex + 3] = a; // Alpha.
        }
      }
    });

    // Apply the image data to canvas.
    ctx.putImageData(imageData, 0, 0);

    // Draw grid lines.
    this.drawGridLines(ctx, level);

    // Draw scale key.
    this.drawScaleKey(ctx, level, bytesPerPixel);

    return canvas;
  }

  drawGridLines(ctx, zoomLevel = 0) {
    // Set up dotted line style.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'; // Brighter white.
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]); // Dotted pattern.

    // 4TB = 16384 pixels = 128x128 square in Hilbert space (4TB / 256MB = 16384).
    const tbSize = 128; // sqrt(16384) = 128.

    // Draw grid lines every 128 pixels in both directions.
    ctx.beginPath();

    for (let i = tbSize; i < 1024; i += tbSize) {
      // Vertical lines.
      ctx.moveTo(this.borderLeft + i, this.borderTop);
      ctx.lineTo(this.borderLeft + i, this.borderTop + 1024);
      // Horizontal lines.
      ctx.moveTo(this.borderLeft, this.borderTop + i);
      ctx.lineTo(this.borderLeft + 1024, this.borderTop + i);
    }

    ctx.stroke();

    // Reset line dash for other drawing.
    ctx.setLineDash([]);
  }

  drawScaleKey(ctx, level, bytesPerPixel) {
    const keyX = this.borderLeft + this.mapWidth + 50;
    const keyY = this.borderTop + 100;

    // Set text style.
    ctx.fillStyle = '#000000';
    ctx.font = '16px Arial';

    // Title.
    ctx.fillText('Scale:', keyX, keyY);

    // Show round sizes between 1 pixel and 128x128 pixels.
    const sizes = [
      { bytes: 1, name: '1 byte' },
      { bytes: 1024, name: '1 KiB' },
      { bytes: 1024 * 1024, name: '1 MiB' },
      { bytes: 1024 * 1024 * 1024, name: '1 GiB' },
      { bytes: 1024 * 1024 * 1024 * 1024, name: '1 TiB' }
    ];

    let yOffset = 30;
    ctx.font = '14px Arial';

    for (const size of sizes) {
      const pixels = size.bytes / bytesPerPixel;
      const squareSize = Math.sqrt(pixels);

      if (squareSize >= 1 && squareSize <= 256) {
        ctx.fillStyle = '#808080';
        ctx.fillRect(keyX, keyY + yOffset, squareSize, squareSize);
        ctx.fillStyle = '#000000';
        ctx.fillText(`${size.name} (${pixels.toFixed(1)} px)`, keyX + squareSize + 10, keyY + yOffset + squareSize/2 + 5);

        yOffset += squareSize + 10;
      }
    }

    // Additional info.
    ctx.font = '12px Arial';
    ctx.fillText(`Each pixel = ${(bytesPerPixel / (1024*1024)).toFixed(1)} MiB`, keyX, keyY + yOffset + 20);
    ctx.fillText(`Zoom level: ${level}`, keyX, keyY + yOffset + 40);
  }

  generateMemoryMapBuffer(inputFile, level, minAddr, maxAddr, offsetX, offsetY) {
    console.log(`Reading memory layout from ${inputFile}...`);
    const textContent = fs.readFileSync(inputFile, 'utf8');
    const memoryRanges = this.parseMemoryData(textContent);

    const addressRange = maxAddr - minAddr;
    const bytesPerPixel = addressRange / this.totalPixels;

    console.log(`Parsed ${memoryRanges.length} memory ranges`);
    console.log(`Address range: 0x${minAddr.toString(16)} - 0x${maxAddr.toString(16)}`);
    console.log(`Canvas: ${this.width}x${this.height} pixels`);
    console.log(`Resolution: ${bytesPerPixel / (1024*1024)} MiB per pixel`);

    const canvas = this.drawMemoryMap(memoryRanges, level, minAddr, maxAddr, offsetX, offsetY);
    return canvas.toBuffer('image/png');
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
    <script>
        let regions = [];
        let zoomState = {
            level: 0,                      // Current zoom level (0 = full view).
            minAddr: 0,                    // Lowest address in current view.
            maxAddr: Math.pow(2, 48),     // Highest address in current view (256 TiB).
            offsetX: 0,                   // X offset in 2^24 coordinate system.
            offsetY: 0                    // Y offset in 2^24 coordinate system.
        };

        async function loadMemoryMap() {
            const response = await fetch('/memory-data');
            regions = await response.json();
            updateCanvas();
        }

        function updateCanvas() {
            const canvas = document.getElementById('memoryCanvas');
            const img = new Image();
            img.onload = function() {
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
            };
            img.src = \`/memory-map.png?level=\${zoomState.level}&minAddr=\${zoomState.minAddr}&maxAddr=\${zoomState.maxAddr}&offsetX=\${zoomState.offsetX}&offsetY=\${zoomState.offsetY}\`;
        }

        function addressToPixelIndex(address) {
            const bytesPerPixel = Math.pow(2, 48 - 20); // 2^28 = 256MB.
            return Math.floor(address / bytesPerPixel);
        }
        function xyToHilbertIndex(x, y) {
            const n = 0x1000000; // 2^24 = 16777216
            let index = 0;

            for (let s = n >>> 1; s > 0; s = Math.floor(s / 2)) {
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

        function getMapCoordinates(e, canvas) {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const canvasX = Math.floor((e.clientX - rect.left) * scaleX);
            const canvasY = Math.floor((e.clientY - rect.top) * scaleY);

            const borderLeft = 100;
            const borderTop = 100;
            const mapX = canvasX - borderLeft;
            const mapY = canvasY - borderTop;

            return { canvasX, canvasY, mapX, mapY };
        }

        function findAddressAtPixel(mapX, mapY) {
            if (mapX < 0 || mapX >= 1024 || mapY < 0 || mapY >= 1024) return null;

            // Convert 1024x1024 coordinates to 2^24 coordinate system and apply zoom offsets
            const baseZoomFactor = Math.pow(2, 24 - 10); // 2^14 = 16384 (maps 1024 pixels to 2^24 coords)
            const levelZoomFactor = Math.pow(8, zoomState.level);
            const actualZoomFactor = baseZoomFactor / levelZoomFactor;
            
            const x24 = zoomState.offsetX + mapX * actualZoomFactor;
            const y24 = zoomState.offsetY + mapY * actualZoomFactor;

            // Calculate address using 2^24 Hilbert mapping
            const hilbertIndex24 = xyToHilbertIndex(x24, y24);
            const address = hilbertIndex24; // Each Hilbert index maps to 1 byte in 48-bit space

            return address;
        }

        function findRegionFromAddress(address) {
            if (address === null) return null;

            for (const region of regions) {
                if (address >= region.start && address < region.end) {
                    return region;
                }
            }

            return null;
        }
        document.addEventListener('DOMContentLoaded', function() {
            loadMemoryMap();

            const canvas = document.getElementById('memoryCanvas');
            const tooltip = document.getElementById('tooltip');

            let clickTimeout;

            canvas.addEventListener('click', function(e) {
                clearTimeout(clickTimeout);
                clickTimeout = setTimeout(function() {
                    const coords = getMapCoordinates(e, canvas);

                    console.log(\`Single click at canvas (\${coords.canvasX}, \${coords.canvasY}) -> map (\${coords.mapX}, \${coords.mapY})\`);
                    console.log(\`Current zoom state: level=\${zoomState.level}, offsetX=\${zoomState.offsetX}, offsetY=\${zoomState.offsetY}, range=0x\${zoomState.minAddr.toString(16)} - 0x\${zoomState.maxAddr.toString(16)}\`);

                    const address = findAddressAtPixel(coords.mapX, coords.mapY);
                    console.log(\`Calculated address: 0x\${address.toString(16)}\`);

                    const region = findRegionFromAddress(address);
                    console.log(\`Found region:\`, region);

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
                }, 200); // Delay to allow double-click to cancel.
            });

            canvas.addEventListener('dblclick', function(e) {
                clearTimeout(clickTimeout); // Cancel single-click.
                const coords = getMapCoordinates(e, canvas);

                console.log(\`Double-click at canvas (\${coords.canvasX}, \${coords.canvasY}) -> map (\${coords.mapX}, \${coords.mapY})\`);
                console.log(\`Current zoom state: level=\${zoomState.level}, offsetX=\${zoomState.offsetX}, offsetY=\${zoomState.offsetY}\`);
                console.log(\`Current address range: 0x\${zoomState.minAddr.toString(16)} - 0x\${zoomState.maxAddr.toString(16)}\`);

                if (coords.mapX >= 0 && coords.mapX < 1024 && coords.mapY >= 0 && coords.mapY < 1024) {
                    // Find what address was clicked.
                    const clickedAddress = findAddressAtPixel(coords.mapX, coords.mapY);
                    console.log(\`Clicked address: 0x\${clickedAddress.toString(16)}\`);

                    // Round to nearest 64th boundaries.
                    const currentRange = zoomState.maxAddr - zoomState.minAddr;
                    const gridAddressSize = currentRange / 64; // 8x8 = 64 squares.
                    const gridIndex = Math.floor((clickedAddress - zoomState.minAddr) / gridAddressSize);
                    const gridStartAddr = zoomState.minAddr + gridIndex * gridAddressSize;
                    const gridEndAddr = gridStartAddr + gridAddressSize;
                    console.log(\`Grid: index=\${gridIndex}, range=0x\${gridStartAddr.toString(16)} - 0x\${gridEndAddr.toString(16)}\`);

                    // Calculate new offsets based on canvas coordinates.
                    // Each 8x8 grid square becomes the new canvas, so find which grid square was clicked.
                    const gridX = Math.floor(coords.mapX / (1024 / 8)); // Which of the 8 columns.
                    const gridY = Math.floor(coords.mapY / (1024 / 8)); // Which of the 8 rows.
                    const pixelsPerGrid = 1024 / 8; // 128 pixels per grid square.
                    console.log(\`Grid position: (\${gridX}, \${gridY}), pixels per grid: \${pixelsPerGrid}\`);

                    // Calculate the offset in Hilbert coordinate system (order 24).
                    const baseZoomFactor = Math.pow(2, 24 - 10); // 2^14 = 16384 (maps 2^24 coords to 1024 pixels).
                    const levelZoomFactor = Math.pow(8, zoomState.level);
                    const actualZoomFactor = baseZoomFactor / levelZoomFactor;

                    const newOffsetX = zoomState.offsetX + gridX * pixelsPerGrid * actualZoomFactor;
                    const newOffsetY = zoomState.offsetY + gridY * pixelsPerGrid * actualZoomFactor;
                    console.log(\`Actual zoom factor: \${actualZoomFactor}, new offsets: (\${newOffsetX}, \${newOffsetY})\`);

                    // Update zoom state.
                    zoomState.level++;
                    zoomState.minAddr = gridStartAddr;
                    zoomState.maxAddr = gridEndAddr;
                    zoomState.offsetX = newOffsetX;
                    zoomState.offsetY = newOffsetY;

                    console.log(\`Updated zoom state: level=\${zoomState.level}, offsetX=\${zoomState.offsetX}, offsetY=\${zoomState.offsetY}\`);
                    console.log(\`New address range: 0x\${zoomState.minAddr.toString(16)} - 0x\${zoomState.maxAddr.toString(16)}\`);

                    hideTooltip();
                    updateCanvas();
                }
            });

            // Click outside map area to dismiss.
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

                // If click is outside the 1024x1024 map area or outside canvas entirely.
                if (e.target !== canvas || mapX < 0 || mapX >= 1024 || mapY < 0 || mapY >= 1024) {
                    hideTooltip();
                }
            });
        });

        function hideTooltip() {
            document.getElementById('tooltip').style.display = 'none';
        }

        function resetZoom() {
            zoomState.level = 0;
            zoomState.minAddr = 0;
            zoomState.maxAddr = Math.pow(2, 48);
            zoomState.offsetX = 0;
            zoomState.offsetY = 0;
            hideTooltip();
            updateCanvas();
        }

        // Keyboard shortcut for zoom reset.
        document.addEventListener('keydown', function(e) {
            if (e.key === 'r' || e.key === 'R') {
                resetZoom();
            }
        });
    </script>
</body>
</html>`);
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
      } else if (parsedUrl.pathname === '/memory-map.png') {
        // Serve PNG image with optional zoom parameters.
        try {
          const level = parseInt(parsedUrl.query.level) || 0;
          const minAddr = parseInt(parsedUrl.query.minAddr) || 0;
          const maxAddr = parseInt(parsedUrl.query.maxAddr) || Math.pow(2, 48);
          const offsetX = parseInt(parsedUrl.query.offsetX) || 0;
          const offsetY = parseInt(parsedUrl.query.offsetY) || 0;

          const pngBuffer = this.generateMemoryMapBuffer(inputFile, level, minAddr, maxAddr, offsetX, offsetY);
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end(pngBuffer);
        } catch (error) {
          console.error('Error generating memory map:', error);
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error generating memory map: ' + error.message + '\n' + error.stack);
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
