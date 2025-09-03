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
        // Serve HTML page from file.
        try {
          const htmlContent = fs.readFileSync('index.html', 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(htmlContent);
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error loading HTML file: ' + error.message);
        }
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
