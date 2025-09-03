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

function startServer(inputFile, port = 8080) {
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
            margin: 0;
            padding: 0;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1600px;
            margin: 0 auto;
            background-color: white;
            box-shadow: 0 0 10px rgba(0,0,0,0.1);
        }
        .tabs {
            display: flex;
            border-bottom: 2px solid #ddd;
            background-color: #f8f8f8;
        }
        .tab {
            padding: 12px 24px;
            cursor: pointer;
            border: none;
            background: none;
            font-size: 16px;
            border-bottom: 3px solid transparent;
            transition: all 0.3s ease;
        }
        .tab.active {
            background-color: white;
            border-bottom-color: #007bff;
            color: #007bff;
        }
        .tab:hover {
            background-color: #e8e8e8;
        }
        .tab-content {
            display: none;
            padding: 20px;
        }
        .tab-content.active {
            display: block;
        }
        .map-view {
            text-align: center;
        }
        .canvas-container {
            position: relative;
            display: inline-block;
            border: 1px solid #ddd;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        canvas {
            display: block;
            max-width: 100%;
            height: auto;
        }
        #backgroundCanvas {
            position: relative;
            z-index: 1;
        }
        #memoryCanvas {
            position: absolute;
            top: 100px;
            left: 100px;
            z-index: 2;
            cursor: crosshair;
            transition: transform 0.8s cubic-bezier(0.23, 1, 0.320, 1);
            transform-origin: center center;
        }
        #memoryCanvas.animating {
            cursor: wait;
            pointer-events: none;
        }
        .text-editor {
            display: flex;
            flex-direction: column;
            height: 800px;
        }
        .editor-toolbar {
            padding: 10px;
            background-color: #f8f8f8;
            border-bottom: 1px solid #ddd;
            display: flex;
            gap: 10px;
            align-items: center;
        }
        .editor-toolbar button {
            padding: 8px 16px;
            border: 1px solid #ddd;
            background-color: white;
            cursor: pointer;
            border-radius: 4px;
        }
        .editor-toolbar button:hover {
            background-color: #f0f0f0;
        }
        #textEditor {
            flex: 1;
            border: none;
            outline: none;
            padding: 15px;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            line-height: 1.4;
            resize: none;
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
        <div class="tabs">
            <button class="tab active" onclick="switchTab('editor')">Text Editor</button>
            <button class="tab" onclick="switchTab('map')">Memory Map</button>
        </div>

        <div id="editor-tab" class="tab-content active">
            <div class="text-editor">
                <div class="editor-toolbar">
                    <button onclick="loadSampleFile()">Load Sample</button>
                    <button onclick="applyChanges()">Apply Changes</button>
                    <button onclick="resetToOriginal()">Reset</button>
                    <span id="status"></span>
                </div>
                <textarea id="textEditor" placeholder="Enter memory ranges in format: startAddr endAddr regionName"></textarea>
            </div>
        </div>

        <div id="map-tab" class="tab-content">
            <div class="map-view">
                <h1>Memory Map Visualization</h1>
                <p>48-bit virtual address space (256 TiB) mapped to 1024x1024 using Hilbert curve</p>
                <p><button onclick="resetZoom()">Reset Zoom</button> | Double-click grid squares to zoom in | Press 'r' to reset</p>
                <div class="canvas-container">
                    <canvas id="backgroundCanvas"></canvas>
                    <canvas id="memoryCanvas"></canvas>
                </div>
                <div class="tooltip" id="tooltip" style="display: none;"></div>
            </div>
        </div>
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
      } else if (parsedUrl.pathname === '/original-data') {
        // Serve original input file content for text editor.
        try {
          const textContent = fs.readFileSync(inputFile, 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(textContent);
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error loading original data: ' + error.message);
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

  startServer(inputFile, port);
}

if (require.main === module) {
  main();
}

module.exports = { startServer };
