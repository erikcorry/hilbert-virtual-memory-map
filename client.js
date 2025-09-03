let regions = [];
let originalTextContent = '';
let colorMap = new Map();
let colorIndex = 0;
let highlightedRegion = null;
let originalCanvasData = null;
let zoomState = {
    level: 0,                      // Current zoom level (0 = full view).
    minAddr: 0,                    // Lowest address in current view.
    maxAddr: Math.pow(2, 48),     // Highest address in current view (256 TiB).
    offsetX: 0,                   // X offset in 2^24 coordinate system.
    offsetY: 0                    // Y offset in 2^24 coordinate system.
};

let animationState = {
    isAnimating: false,           // Whether we're currently animating
    animationId: null,            // requestAnimationFrame ID
    startTime: null,              // Animation start timestamp
    duration: 800,                // Animation duration in ms (matches CSS transition)
    fromTransform: null,          // Starting transform state
    toTransform: null             // Target transform state  
};

function generateColorForName(name) {
    if (colorMap.has(name)) {
        return colorMap.get(name);
    }

    // Extract base name and permissions
    let baseName = name;
    let permissions = '';
    const curlyMatch = name.match(/^(.*?)\s*\{([^}]+)\}$/);
    if (curlyMatch) {
        baseName = curlyMatch[1];
        permissions = curlyMatch[2];
    }

    // Generate hue based on base name
    let hue;
    if (colorMap.has(baseName)) {
        // Use existing hue for this base name
        const existingColor = colorMap.get(baseName);
        hue = existingColor.hue;
    } else {
        // Generate new hue for base name
        hue = (colorIndex * 137.5) % 360; // Golden angle spacing
        colorIndex++;
    }

    // Calculate saturation based on permissions: start at 30%, add 10% for r, 20% for w, 40% for x
    let saturation = 30;
    if (permissions) {
        if (permissions.includes('r')) saturation += 10;
        if (permissions.includes('w')) saturation += 20;
        if (permissions.includes('x')) saturation += 40;
    } else {
        // Default saturation for regions without permission suffix (original format)
        saturation = 70;
    }
    
    const lightness = 50 + (colorIndex % 2) * 10;  // 50-60% lightness

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
        a: 255,
        hue: hue  // Store hue for reuse with base name
    };

    colorMap.set(name, color);
    
    // Also store the base name color if it's new
    if (!colorMap.has(baseName)) {
        colorMap.set(baseName, color);
    }
    
    return color;
}

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    // Show selected tab
    if (tabName === 'editor') {
        document.querySelector('.tab:first-child').classList.add('active');
        document.getElementById('editor-tab').classList.add('active');
    } else if (tabName === 'map') {
        document.querySelector('.tab:last-child').classList.add('active');
        document.getElementById('map-tab').classList.add('active');
    }
}

function setStatus(message, isError = false) {
    const statusEl = document.getElementById('status');
    statusEl.textContent = message;
    statusEl.style.color = isError ? '#d32f2f' : '#2e7d32';
    setTimeout(() => {
        statusEl.textContent = '';
    }, 3000);
}

async function loadSampleFile() {
    try {
        const response = await fetch('original-data.txt');
        const text = await response.text();
        document.getElementById('textEditor').value = text;
        originalTextContent = text;
        setStatus('Sample file loaded');
        return true;
    } catch (error) {
        setStatus('Error loading sample file', true);
        return false;
    }
}

function resetToOriginal() {
    document.getElementById('textEditor').value = originalTextContent;
    setStatus('Reset to original content');
}

function getAlignment(address) {
    // Calculate alignment: start with 128TB and divide by 2 until aligned
    let alignment = 128 * 1024 * 1024 * 1024 * 1024; // 128TB in bytes
    while (alignment > 1 && (address % alignment) !== 0) {
        alignment = Math.floor(alignment / 2);
    }
    return alignment;
}

function applyShading(region) {
    const canvas = document.getElementById('memoryCanvas');
    const ctx = canvas.getContext('2d');
    const mapWidth = 1024;
    const mapHeight = 1024;
    
    // Store original canvas data
    originalCanvasData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    highlightedRegion = region;
    
    // Get image data for the entire memory canvas
    const imageData = ctx.getImageData(0, 0, mapWidth, mapHeight);
    const data = imageData.data;
    
    // Calculate visible address range for current zoom
    const { minAddr, maxAddr } = zoomState;
    const bytesPerPixel = (maxAddr - minAddr) / (mapWidth * mapHeight);
    
    // Apply shading to pixels in the highlighted region
    const startAddr = Math.max(region.start, minAddr);
    const endAddr = Math.min(region.end, maxAddr);
    
    for (let address = startAddr; address < endAddr; address += bytesPerPixel) {
        // Get coordinates in 2^24 coordinate system
        const order = 24;
        const [x24, y24] = hilbertIndexToXY(address, order);
        
        // Scale from 2^24 to 1024 and apply offset
        const baseZoomFactor = Math.pow(2, 24 - 10); // 2^14 = 16384
        const levelZoomFactor = Math.pow(8, zoomState.level);
        const actualZoomFactor = baseZoomFactor / levelZoomFactor;
        
        const scaledX = Math.floor((x24 - zoomState.offsetX) / actualZoomFactor);
        const scaledY = Math.floor((y24 - zoomState.offsetY) / actualZoomFactor);
        
        if (scaledX >= 0 && scaledX < mapWidth && scaledY >= 0 && scaledY < mapHeight) {
            // Check if this pixel should be highlighted based on shading pattern
            const shadingValue = (scaledX + scaledY) % 8;
            if (shadingValue >= 2 && shadingValue <= 4) {
                const dataIndex = (scaledY * mapWidth + scaledX) * 4;
                data[dataIndex] = 255;     // Red = white
                data[dataIndex + 1] = 255; // Green = white  
                data[dataIndex + 2] = 255; // Blue = white
                data[dataIndex + 3] = 255; // Alpha = opaque
            }
        }
    }
    
    // Put the modified image data back
    ctx.putImageData(imageData, 0, 0);
}

function removeShading() {
    if (originalCanvasData) {
        const canvas = document.getElementById('memoryCanvas');
        const ctx = canvas.getContext('2d');
        
        // Restore original canvas data
        ctx.putImageData(originalCanvasData, 0, 0);
        
        originalCanvasData = null;
        highlightedRegion = null;
    }
}

function parseMemoryData(textContent) {
    const lines = textContent.split('\n').filter(line => line.trim());
    const tempMemoryRanges = [];
    
    // Detect format: check if first line looks like /proc/self/maps
    const isProcMapsFormat = lines.length > 0 && lines[0].includes('-') && lines[0].includes(' ');
    
    for (const line of lines) {
        if (isProcMapsFormat) {
            // Skip vsyscall lines
            if (line.includes('[vsyscall]')) {
                continue;
            }
            
            // Parse /proc/self/maps format: address-range perms offset dev inode [pathname]
            // Example: 7ffff7dd2000-7ffff7dd4000 rw-p 00000000 00:00 0 [stack]
            const match = line.match(/^([0-9a-f]+)-([0-9a-f]+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(.*))?/);
            if (match) {
                const startAddr = parseInt(match[1], 16);
                const endAddr = parseInt(match[2], 16);
                const permissions = match[3];
                let regionName = match[7] ? match[7].trim() : '';
                
                // Generate name for unnamed regions using bits 32-48 of start address
                if (regionName === '') {
                    const upperBits = Math.floor(startAddr / Math.pow(2, 32));
                    regionName = `unnamed-${upperBits.toString(16)}`;
                }
                
                // Add permission suffix in curly braces based on first 3 characters (ignore p flag)
                const rwx = permissions.substring(0, 3);
                regionName += ' {' + rwx + '}';
                
                if (!isNaN(startAddr) && !isNaN(endAddr) && endAddr > startAddr) {
                    const maxAddress = Math.pow(2, 48);
                    if (startAddr < maxAddress) {
                        const clampedEnd = Math.min(endAddr, maxAddress);
                        const color = generateColorForName(regionName);
                        
                        tempMemoryRanges.push({
                            start: startAddr,
                            end: clampedEnd,
                            name: regionName,
                            color: color
                        });
                    }
                }
            }
        } else {
            // Parse original format: startAddr endAddr regionName
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 3) {
                const startAddr = parseInt(parts[0], 16);
                const endAddr = parseInt(parts[1], 16);
                const regionName = parts.slice(2).join(' ');
                
                if (!isNaN(startAddr) && !isNaN(endAddr) && endAddr > startAddr) {
                    const maxAddress = Math.pow(2, 48);
                    if (startAddr < maxAddress) {
                        const clampedEnd = Math.min(endAddr, maxAddress);
                        const color = generateColorForName(regionName);
                        
                        tempMemoryRanges.push({
                            start: startAddr,
                            end: clampedEnd,
                            name: regionName,
                            color: color
                        });
                    }
                }
            }
        }
    }
    
    return tempMemoryRanges.sort((a, b) => a.start - b.start);
}

async function applyChanges() {
    const textContent = document.getElementById('textEditor').value;
    try {
        // Parse the text content using the unified parser
        regions = parseMemoryData(textContent);
        updateCanvas();
        setStatus('Changes applied to visualization');

        // Auto-switch to map tab to show results
        switchTab('map');

    } catch (error) {
        console.error('Error parsing changes:', error);
        setStatus('Error parsing text content', true);
    }
}

async function loadMemoryMap() {
    const response = await fetch('/original-data');
    const textContent = await response.text();
    
    regions = parseMemoryData(textContent);
    updateCanvas();
}

function updateCanvas() {
    // Clear any existing shading
    originalCanvasData = null;
    highlightedRegion = null;

    // Set canvas sizes
    const mapWidth = 1024;
    const mapHeight = 1024;
    const borderTop = 100;
    const borderBottom = 100;
    const borderLeft = 100;
    const borderRight = 450;
    
    // Background canvas (borders, legend, grid)
    const backgroundCanvas = document.getElementById('backgroundCanvas');
    const backgroundCtx = backgroundCanvas.getContext('2d');
    backgroundCanvas.width = mapWidth + borderLeft + borderRight;
    backgroundCanvas.height = mapHeight + borderTop + borderBottom;
    
    // Memory map canvas (just the 1024x1024 memory data)
    const memoryCanvas = document.getElementById('memoryCanvas');
    const memoryCtx = memoryCanvas.getContext('2d');
    memoryCanvas.width = mapWidth;
    memoryCanvas.height = mapHeight;

    drawBackground(backgroundCtx, mapWidth, mapHeight, borderLeft, borderTop, borderRight);
    drawMemoryData(memoryCtx, mapWidth, mapHeight);
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

function hilbertIndexToXY(index, order) {
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
            [x, y] = [y, x];
        }

        x += s * rx;
        y += s * ry;
        t = Math.floor(t / 4);
    }

    return [x, y];
}

function getMapCoordinates(e, memoryCanvas) {
    const rect = memoryCanvas.getBoundingClientRect();
    const scaleX = memoryCanvas.width / rect.width;
    const scaleY = memoryCanvas.height / rect.height;
    const mapX = Math.floor((e.clientX - rect.left) * scaleX);
    const mapY = Math.floor((e.clientY - rect.top) * scaleY);

    return { canvasX: mapX, canvasY: mapY, mapX, mapY };
}

function findAddressAtPixel(mapX, mapY) {
    // Convert 1024x1024 coordinates to 2^24 coordinate system and apply zoom offsets
    const baseZoomFactor = Math.pow(2, 24 - 10); // 2^14 = 16384 (maps 1024 pixels to 2^24 coords)
    const levelZoomFactor = Math.pow(8, zoomState.level);
    const actualZoomFactor = baseZoomFactor / levelZoomFactor;

    const x24 = zoomState.offsetX + mapX * actualZoomFactor;
    const y24 = zoomState.offsetY + mapY * actualZoomFactor;

    // Check bounds in the 2^24 coordinate system
    const maxCoord24 = Math.pow(2, 24) - 1;
    if (x24 < 0 || x24 > maxCoord24 || y24 < 0 || y24 > maxCoord24) return null;

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

function formatBytes(bytes) {
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

function drawBackground(ctx, mapWidth, mapHeight, borderLeft, borderTop, borderRight) {
    const minAddr = zoomState.minAddr;
    const maxAddr = zoomState.maxAddr;
    const addressRange = maxAddr - minAddr;
    const bytesPerPixel = addressRange / (mapWidth * mapHeight);

    // Light gray background for entire canvas
    ctx.fillStyle = '#C0C0C0';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Black background for the actual map area
    ctx.fillStyle = '#000000';
    ctx.fillRect(borderLeft, borderTop, mapWidth, mapHeight);

    // Draw scale key (but not grid lines - those go on memory canvas)
    drawScaleKey(ctx, mapWidth, borderLeft, borderTop, borderRight, zoomState.level, bytesPerPixel, minAddr, maxAddr);
}

function drawMemoryData(ctx, mapWidth, mapHeight) {
    const totalPixels = mapWidth * mapHeight;
    const minAddr = zoomState.minAddr;
    const maxAddr = zoomState.maxAddr;
    const addressRange = maxAddr - minAddr;
    const bytesPerPixel = addressRange / totalPixels;

    // Black background for the memory canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, mapWidth, mapHeight);

    if (regions.length === 0) {
        return;
    }

    // Filter ranges to only those that overlap with current view
    const visibleRanges = regions.filter(range =>
        range.end > minAddr && range.start < maxAddr
    );

    // Create image data for the memory canvas
    const imageData = ctx.getImageData(0, 0, mapWidth, mapHeight);
    const data = imageData.data;

    // Process each visible memory range
    visibleRanges.forEach(range => {
        const { r, g, b, a } = range.color;

        // Calculate pixel range for this memory range in current view
        const startAddr = Math.max(range.start, minAddr);
        const endAddr = Math.min(range.end, maxAddr);

        // Fill pixels for this memory range
        for (let address = startAddr; address < endAddr; address += bytesPerPixel) {
            // Get coordinates in 2^24 coordinate system
            const order = 24;
            const [x24, y24] = hilbertIndexToXY(address, order);

            // Scale from 2^24 to 1024 and apply offset
            const baseZoomFactor = Math.pow(2, 24 - 10); // 2^14 = 16384
            const levelZoomFactor = Math.pow(8, zoomState.level);
            const actualZoomFactor = baseZoomFactor / levelZoomFactor;

            const scaledX = Math.floor((x24 - zoomState.offsetX) / actualZoomFactor);
            const scaledY = Math.floor((y24 - zoomState.offsetY) / actualZoomFactor);

            if (scaledX >= 0 && scaledX < mapWidth &&
                scaledY >= 0 && scaledY < mapHeight) {
                const dataIndex = (scaledY * mapWidth + scaledX) * 4;
                data[dataIndex] = r;     // Red
                data[dataIndex + 1] = g; // Green
                data[dataIndex + 2] = b; // Blue
                data[dataIndex + 3] = a; // Alpha
            }
        }
    });

    // Apply the image data to canvas
    ctx.putImageData(imageData, 0, 0);
    
    // Draw grid lines on top of the memory data
    drawGridLines(ctx, mapWidth, mapHeight, 0, 0, zoomState.level);
}

function drawGridLines(ctx, mapWidth, mapHeight, borderLeft, borderTop, zoomLevel) {
    const tbSize = 128; // 128x128 pixel squares
    
    // Helper function to draw a single line segment with appropriate style
    function drawLineSegment(startX, startY, endX, endY, connected) {
        // Set up style based on connectivity
        if (connected) {
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 4]); // Dotted pattern - squares ARE adjacent
        } else {
            ctx.lineWidth = 3;
            ctx.setLineDash([]); // Solid line - squares are NOT adjacent
        }
        
        // Draw the segment (no border adjustment needed for memory canvas)
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
    }
    
    // Helper function to check if two adjacent squares are adjacent in memory
    function areSquaresAdjacentInMemory(x1, y1, x2, y2) {
        // Get center points of both squares
        const centerX1 = x1 + tbSize / 2;
        const centerY1 = y1 + tbSize / 2;
        const centerX2 = x2 + tbSize / 2;
        const centerY2 = y2 + tbSize / 2;
        
        // Find addresses at center of each square
        const addr1 = findAddressAtPixel(centerX1, centerY1);
        const addr2 = findAddressAtPixel(centerX2, centerY2);
        
        if (addr1 === null || addr2 === null) {
            return true; // Default to light if we can't determine
        }
        
        // Calculate the memory size of one 128x128 square
        const { minAddr, maxAddr } = zoomState;
        const bytesPerPixel = (maxAddr - minAddr) / (mapWidth * mapHeight);
        const bytesPerSquare = bytesPerPixel * tbSize * tbSize;
        
        // Round addresses down to square boundaries
        const roundedAddr1 = Math.floor(addr1 / bytesPerSquare) * bytesPerSquare;
        const roundedAddr2 = Math.floor(addr2 / bytesPerSquare) * bytesPerSquare;
        
        // Check if the rounded addresses are exactly one square apart
        const addressDiff = Math.abs(roundedAddr1 - roundedAddr2);
        const isAdjacent = addressDiff === bytesPerSquare;
        
        
        return isAdjacent;
    }
    
    // Set up basic line style
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    
    // Draw vertical lines
    for (let i = 0; i <= 1024; i += tbSize) {
        // Check each segment of the vertical line
        for (let j = 0; j < 1024; j += tbSize) {
            const leftSquareX = i - tbSize;
            const rightSquareX = i;
            const squareY = j;
            
            // Check if squares on left and right of this line are adjacent in memory
            const isAdjacent = areSquaresAdjacentInMemory(leftSquareX, squareY, rightSquareX, squareY);
            
            // Draw this segment using the helper function
            drawLineSegment(i, j, i, j + tbSize, isAdjacent);
        }
    }
    
    // Draw horizontal lines
    for (let i = 0; i <= 1024; i += tbSize) {
        // Check each segment of the horizontal line
        for (let j = 0; j < 1024; j += tbSize) {
            const squareX = j;
            const topSquareY = i - tbSize;
            const bottomSquareY = i;
            
            // Check if squares above and below this line are adjacent in memory
            const isAdjacent = areSquaresAdjacentInMemory(squareX, topSquareY, squareX, bottomSquareY);
            
            // Draw this segment using the helper function
            drawLineSegment(j, i, j + tbSize, i, isAdjacent);
        }
    }
    
    // Reset line dash for other drawing
    ctx.setLineDash([]);
}

function drawScaleKey(ctx, mapWidth, borderLeft, borderTop, borderRight, level, bytesPerPixel, minAddr, maxAddr) {
    const keyX = borderLeft + mapWidth + 50;
    const keyY = borderTop + 100;

    // Set text style
    ctx.fillStyle = '#000000';
    ctx.font = '16px Arial';

    // Memory range above Scale
    ctx.fillText(`0x${minAddr.toString(16)} - 0x${maxAddr.toString(16)}`, keyX, keyY - 20);

    // Title
    ctx.fillText('Scale:', keyX, keyY);

    // Show useful sizes starting from 4KiB
    const sizes = [
        { bytes: 4 * 1024, name: '4 KiB' },
        { bytes: 64 * 1024, name: '64 KiB' },
        { bytes: 1024 * 1024, name: '1 MiB' },
        { bytes: 64 * 1024 * 1024, name: '64 MiB' },
        { bytes: 1024 * 1024 * 1024, name: '1 GiB' },
        { bytes: 64 * 1024 * 1024 * 1024, name: '64 GiB' },
        { bytes: 1024 * 1024 * 1024 * 1024, name: '1 TiB' },
        { bytes: 64 * 1024 * 1024 * 1024 * 1024, name: '64 TiB' }
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
            ctx.fillText(`${size.name} (${Math.round(pixels)} px)`, keyX + squareSize + 10, keyY + yOffset + squareSize/2 + 5);

            yOffset += squareSize + 10;
        }
    }

    // Additional info
    ctx.font = '12px Arial';

    // Each dotted square is 128x128 pixels
    const squareSize = 128;
    const bytesPerSquare = bytesPerPixel * squareSize * squareSize;

    ctx.fillText(`Each pixel = ${formatBytes(bytesPerPixel)}`, keyX, keyY + yOffset + 20);
    ctx.fillText(`Each square = ${formatBytes(bytesPerSquare)}`, keyX, keyY + yOffset + 40);

    if (level > 0) {
        const currentRange = maxAddr - minAddr;
        ctx.fillText(`Zoomed view = ${formatBytes(currentRange)}`, keyX, keyY + yOffset + 60);
        ctx.fillText(`Zoom level: ${level}`, keyX, keyY + yOffset + 80);
    } else {
        ctx.fillText(`Zoom level: ${level}`, keyX, keyY + yOffset + 60);
    }
}

function hideTooltip() {
    document.getElementById('tooltip').style.display = 'none';
    removeShading();
}

function resetZoom() {
    zoomState.level = 0;
    zoomState.minAddr = 0;
    zoomState.maxAddr = Math.pow(2, 48);
    zoomState.offsetX = 0;
    zoomState.offsetY = 0;
    hideTooltip();
    
    // Reset memory canvas transform and update
    const memoryCanvas = document.getElementById('memoryCanvas');
    memoryCanvas.style.transform = '';
    updateCanvas();
}

function animateZoom(gridX, gridY, newZoomState) {
    if (animationState.isAnimating) {
        return; // Already animating
    }
    
    const memoryCanvas = document.getElementById('memoryCanvas');
    const container = document.querySelector('.canvas-container');
    
    // Add animating class to disable interactions
    memoryCanvas.classList.add('animating');
    
    // Create off-screen canvas with new zoomed content
    const offScreenCanvas = document.createElement('canvas');
    offScreenCanvas.width = 1024;
    offScreenCanvas.height = 1024;
    const offScreenCtx = offScreenCanvas.getContext('2d');
    
    // Render new zoomed content to off-screen canvas
    const oldZoomState = { ...zoomState };
    Object.assign(zoomState, newZoomState);
    drawMemoryData(offScreenCtx, 1024, 1024);
    
    // Create DOM element from off-screen canvas and position it
    const animatingCanvas = document.createElement('canvas');
    animatingCanvas.width = 1024;
    animatingCanvas.height = 1024;
    animatingCanvas.style.position = 'absolute';
    animatingCanvas.style.zIndex = '3'; // Above the memory canvas
    animatingCanvas.style.pointerEvents = 'none';
    animatingCanvas.style.transition = 'transform 0.8s cubic-bezier(0.23, 1, 0.320, 1)';
    animatingCanvas.style.transformOrigin = 'center center';
    
    // Copy the off-screen content to the animating canvas
    const animatingCtx = animatingCanvas.getContext('2d');
    animatingCtx.drawImage(offScreenCanvas, 0, 0);
    
    // Calculate positions
    const gridSize = 128;
    const gridCenterX = (gridX * gridSize) + (gridSize / 2);
    const gridCenterY = (gridY * gridSize) + (gridSize / 2);
    const canvasCenterX = 512;
    const canvasCenterY = 512;
    
    // Position at grid square center with small scale
    const startScale = gridSize / 1024; // 1/8 scale
    const startTranslateX = gridCenterX - canvasCenterX;
    const startTranslateY = gridCenterY - canvasCenterY;
    
    // Get the actual rendered position and size of the memory canvas
    const memoryCanvasRect = memoryCanvas.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    // Position the animating canvas at the same location as the memory canvas
    animatingCanvas.style.left = (memoryCanvasRect.left - containerRect.left) + 'px';
    animatingCanvas.style.top = (memoryCanvasRect.top - containerRect.top) + 'px';
    animatingCanvas.style.width = memoryCanvasRect.width + 'px';
    animatingCanvas.style.height = memoryCanvasRect.height + 'px';
    
    // Calculate scale based on actual rendered canvas size vs original 1024px
    const actualCanvasWidth = memoryCanvasRect.width;
    const actualGridSize = (gridSize / 1024) * actualCanvasWidth;
    const actualStartScale = actualGridSize / actualCanvasWidth;
    
    // Calculate translation based on actual rendered dimensions
    const actualGridCenterX = (gridX * actualGridSize) + (actualGridSize / 2);
    const actualGridCenterY = (gridY * actualGridSize) + (actualGridSize / 2);
    const actualCanvasCenterX = actualCanvasWidth / 2;
    const actualCanvasCenterY = memoryCanvasRect.height / 2;
    const actualStartTranslateX = actualGridCenterX - actualCanvasCenterX;
    const actualStartTranslateY = actualGridCenterY - actualCanvasCenterY;
    
    animatingCanvas.style.transform = `translate(${actualStartTranslateX}px, ${actualStartTranslateY}px) scale(${actualStartScale})`;
    
    // Add to container
    container.appendChild(animatingCanvas);
    
    // Set animation state
    animationState.isAnimating = true;
    animationState.startTime = performance.now();
    
    // Start animation to full size
    setTimeout(() => {
        animatingCanvas.style.transform = '';
        
        // After animation completes, update main canvas and remove animating canvas
        setTimeout(() => {
            // Update the main memory canvas with new content
            const mainCtx = memoryCanvas.getContext('2d');
            mainCtx.drawImage(offScreenCanvas, 0, 0);
            
            // Update the background canvas (legend/scale key) with new zoom state
            const backgroundCanvas = document.getElementById('backgroundCanvas');
            const backgroundCtx = backgroundCanvas.getContext('2d');
            const mapWidth = 1024;
            const mapHeight = 1024;
            const borderLeft = 100;
            const borderTop = 100;
            const borderRight = 450;
            
            drawBackground(backgroundCtx, mapWidth, mapHeight, borderLeft, borderTop, borderRight);
            
            // Clean up
            container.removeChild(animatingCanvas);
            animationState.isAnimating = false;
            memoryCanvas.classList.remove('animating');
        }, animationState.duration);
    }, 50);
}

document.addEventListener('DOMContentLoaded', async function() {
    // Try to load sample file first
    const sampleLoaded = await loadSampleFile();
    
    if (sampleLoaded) {
        // If sample file loaded successfully, apply changes and switch to map
        await applyChanges();
        switchTab('map');
    } else {
        // If sample file failed to load, stay on text editor
        switchTab('editor');
    }

    const canvas = document.getElementById('memoryCanvas');
    const tooltip = document.getElementById('tooltip');

    let clickTimeout;

    canvas.addEventListener('click', function(e) {
        // Don't handle clicks during animation
        if (animationState.isAnimating) {
            return;
        }
        
        clearTimeout(clickTimeout);
        clickTimeout = setTimeout(function() {
            const coords = getMapCoordinates(e, canvas);
            const address = findAddressAtPixel(coords.mapX, coords.mapY);
            const region = findRegionFromAddress(address);

            if (region) {
                const size = region.end - region.start;
                const sizeHex = '0x' + size.toString(16);
                const sizeApprox = formatBytes(size);
                
                const startAlignment = getAlignment(region.start);
                const endAlignment = getAlignment(region.end);
                const startAlignmentStr = formatBytes(startAlignment);
                const endAlignmentStr = formatBytes(endAlignment);

                tooltip.innerHTML = `<span class="tooltip-close" onclick="hideTooltip()">&times;</span>${region.name}<br>0x${region.start.toString(16)} - 0x${region.end.toString(16)}<br>Size: ${sizeHex} (ca. ${sizeApprox})<br>Start alignment: ${startAlignmentStr}<br>End alignment: ${endAlignmentStr}`;
                tooltip.style.display = 'block';
                tooltip.style.left = e.clientX + 'px';
                tooltip.style.top = (e.clientY - 100) + 'px';
                
                // Remove any existing shading and apply new shading
                removeShading();
                applyShading(region);
            } else {
                hideTooltip();
            }
        }, 200); // Delay to allow double-click to cancel.
    });

    canvas.addEventListener('dblclick', function(e) {
        clearTimeout(clickTimeout); // Cancel single-click.
        
        // Don't zoom if already animating
        if (animationState.isAnimating) {
            return;
        }
        
        const coords = getMapCoordinates(e, canvas);

        const maxZoomLevel = 4;

        if (zoomState.level >= maxZoomLevel) {
            return;
        }

        if (coords.mapX >= 0 && coords.mapX < 1024 && coords.mapY >= 0 && coords.mapY < 1024) {
            // Find what address was clicked.
            const clickedAddress = findAddressAtPixel(coords.mapX, coords.mapY);

            // Round to nearest 64th boundaries.
            const currentRange = zoomState.maxAddr - zoomState.minAddr;
            const gridAddressSize = currentRange / 64; // 8x8 = 64 squares.
            const gridIndex = Math.floor((clickedAddress - zoomState.minAddr) / gridAddressSize);
            const gridStartAddr = zoomState.minAddr + gridIndex * gridAddressSize;
            const gridEndAddr = gridStartAddr + gridAddressSize;

            // Calculate new offsets based on canvas coordinates.
            // Each 8x8 grid square becomes the new canvas, so find which grid square was clicked.
            const gridX = Math.floor(coords.mapX / (1024 / 8)); // Which of the 8 columns.
            const gridY = Math.floor(coords.mapY / (1024 / 8)); // Which of the 8 rows.
            const pixelsPerGrid = 1024 / 8; // 128 pixels per grid square.

            // Calculate the offset in Hilbert coordinate system (order 24).
            const baseZoomFactor = Math.pow(2, 24 - 10); // 2^14 = 16384 (maps 2^24 coords to 1024 pixels).
            const levelZoomFactor = Math.pow(8, zoomState.level);
            const actualZoomFactor = baseZoomFactor / levelZoomFactor;

            const newOffsetX = zoomState.offsetX + gridX * pixelsPerGrid * actualZoomFactor;
            const newOffsetY = zoomState.offsetY + gridY * pixelsPerGrid * actualZoomFactor;

            // Prepare new zoom state
            const newZoomState = {
                level: zoomState.level + 1,
                minAddr: gridStartAddr,
                maxAddr: gridEndAddr,
                offsetX: newOffsetX,
                offsetY: newOffsetY
            };

            hideTooltip();
            
            // Trigger animated zoom instead of immediate update
            animateZoom(gridX, gridY, newZoomState);
        }
    });

    // Click outside map area to dismiss.
    document.addEventListener('click', function(e) {
        const memoryCanvas = document.getElementById('memoryCanvas');
        const backgroundCanvas = document.getElementById('backgroundCanvas');
        
        // If click is outside both canvases entirely
        if (e.target !== memoryCanvas && e.target !== backgroundCanvas) {
            hideTooltip();
        }
    });

    // Keyboard shortcut for zoom reset.
    document.addEventListener('keydown', function(e) {
        if (e.key === 'r' || e.key === 'R') {
            resetZoom();
        }
    });
});
