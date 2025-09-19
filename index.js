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

function startServer(port = 8080) {
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
      } else if (parsedUrl.pathname === '/styles.css') {
        // Serve CSS stylesheet.
        try {
          const cssContent = fs.readFileSync('styles.css', 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/css' });
          res.end(cssContent);
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error loading stylesheet: ' + error.message);
        }
      } else if (parsedUrl.pathname === '/favicon.ico') {
        // Serve favicon (actually a PNG file).
        try {
          const faviconContent = fs.readFileSync('favicon.ico');
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end(faviconContent);
        } catch (error) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Favicon not found');
        }
      } else if (parsedUrl.pathname.startsWith('/data/')) {
        // Serve data files - validate filename with strict pattern matching
        const requestedFile = parsedUrl.pathname.substring(6); // Remove '/data/' prefix

        // Only allow safe filename patterns: letters, numbers, hyphens, underscores, and a single dot for extension
        const safeFilenamePattern = /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/;

        if (!safeFilenamePattern.test(requestedFile)) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Invalid filename format');
          return;
        }

        const sanitizedFilename = requestedFile; // Already validated as safe

        try {
          const textContent = fs.readFileSync(`data/${sanitizedFilename}`, 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(textContent);
        } catch (error) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('File not found: ' + sanitizedFilename);
        }
      } else {
        // 404 for other paths.
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    server.listen(port, () => {
      console.log(`Memory map server running at http://localhost:${port}/`);
      console.log(`\nTry these visualizations:`);
      console.log(`🎮 Chrome Memory Map:    http://localhost:${port}/?file=original-data.txt`);
      console.log(`🌍 IPv4 GeoIP Data:     http://localhost:${port}/?file=geoip2-ipv4.csv`);
    });

    return server;
}

// CLI interface.
function showHelp() {
  console.log(`
Hilbert Curve Memory Map Generator

Usage: node index.js [port]

Arguments:
  port         HTTP server port (default: 8080)

Features:
- Maps 48-bit virtual address space (256 TiB) or 32-bit IPv4 space
- 1024x1024 pixel output using Hilbert curve mapping
- Supports multiple input formats:
  * Memory ranges: startAddr endAddr regionName
  * /proc/pid/maps format
  * IPv4 GeoIP CSV format

Examples:
  node index.js         # Start server on port 8080
  node index.js 3000    # Start server on port 3000

After starting, visit the suggested URLs to try different visualizations.
  `);
}

function main() {
  const args = process.argv.slice(2);

  if (args.length > 0 && (args[0] === '--help' || args[0] === '-h')) {
    showHelp();
    return;
  }

  const port = parseInt(args[0]) || 8080;

  startServer(port);
}

if (require.main === module) {
  main();
}

module.exports = { startServer };
