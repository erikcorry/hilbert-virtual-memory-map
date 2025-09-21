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

function serveFile(res, filepath, contentType, encoding = 'utf8', notFoundStatus = 500) {
    try {
        const content = fs.readFileSync(filepath, encoding);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    } catch (error) {
        const status = notFoundStatus === 404 ? 404 : 500;
        const message = notFoundStatus === 404 ?
            `${filepath.split('/').pop()} not found` :
            `Error loading ${filepath.split('/').pop()}: ${error.message}`;
        res.writeHead(status, { 'Content-Type': 'text/plain' });
        res.end(message);
    }
}

function startServer(port = 8080) {
    const server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url, true);

      // Only allow safe filename patterns: letters, numbers, hyphens,
      // underscores, and a single dot for extension
      const safeFilenamePattern = /^\/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/;

      if (parsedUrl.pathname === '/') {
        // Serve HTML page from file.
        serveFile(res, 'index.html', 'text/html');
      } else if (parsedUrl.pathname === '/client.js') {
        // Serve client-side JavaScript.
        serveFile(res, 'client.js', 'application/javascript');
      } else if (parsedUrl.pathname === '/styles.css') {
        // Serve CSS stylesheet.
        serveFile(res, 'styles.css', 'text/css');
      } else if (parsedUrl.pathname === '/favicon.ico') {
        // Serve favicon (actually a PNG file).
        serveFile(res, 'favicon.ico', 'image/png', null, 404);
      } else if (safeFilenamePattern.test(parsedUrl.pathname)) {
        // Serve data files - validate filename with strict pattern matching
        const requestedFile = parsedUrl.pathname.substring(1); // Remove initial slash.

        serveFile(res, `${requestedFile}`, 'text/plain', 'utf8', 404);
      } else {
        // 404 for other paths.
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found "' + parsedUrl.pathname + '"');
      }
    });

    server.listen(port, () => {
      console.log(`Memory map server running at http://localhost:${port}/`);
      console.log(`\nTry these visualizations:`);
      console.log(`🎮 Chrome Memory Map:    http://localhost:${port}/?file=chrome-maps.txt`);
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
