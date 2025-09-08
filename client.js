let regions = [];
let originalTextContent = '';
let colorMap = new Map();
let colorIndex = 0;
let highlightedRegion = null;
let originalCanvasData = null;
// Layout constants
const MAP = {
    WIDTH: 1024,              // Memory map canvas width
    HEIGHT: 1024,             // Memory map canvas height
    BORDER_TOP: 100,              // Top border/margin
    BORDER_BOTTOM: 100,           // Bottom border/margin  
    BORDER_LEFT: 100,             // Left border/margin
    BORDER_RIGHT_DESKTOP: 450,    // Right border/margin on desktop
    BORDER_RIGHT_MOBILE: 100,     // Right border/margin on mobile
    KEY_OFFSET: 50,               // Offset for legend from map edge
    MAX_ZOOM: 4                   // Max zoom level.
};

class ZoomState {
    constructor(level = 0, minAddr = 0, maxAddr = Math.pow(2, 48), offsetX = 0, offsetY = 0) {
        this.level = level;         // Current zoom level (0 = full view)
        this.minAddr = minAddr;     // Lowest address in current view
        this.maxAddr = maxAddr;     // Highest address in current view (256 TiB)
        this.offsetX = offsetX;     // X offset in 2^24 coordinate system
        this.offsetY = offsetY;     // Y offset in 2^24 coordinate system
    }

    // Check if this zoom state equals another
    equals(other) {
        return this.level === other.level &&
               this.minAddr === other.minAddr &&
               this.maxAddr === other.maxAddr &&
               this.offsetX === other.offsetX &&
               this.offsetY === other.offsetY;
    }

    // Get the zoom factor for coordinate scaling
    getZoomFactor() {
        const baseZoomFactor = Math.pow(2, 24 - 10); // 2^14 = 16384
        const levelZoomFactor = Math.pow(8, this.level);
        return levelZoomFactor / baseZoomFactor;
    }

    // Create a copy of this zoom state
    copy() {
        return new ZoomState(this.level, this.minAddr, this.maxAddr, this.offsetX, this.offsetY);
    }

    // Reset to default state
    reset() {
        this.level = 0;
        this.minAddr = 0;
        this.maxAddr = Math.pow(2, 48);
        this.offsetX = 0;
        this.offsetY = 0;
    }
}

let zoomState = new ZoomState();

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
    
    // Store original canvas data
    originalCanvasData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    highlightedRegion = region;
    
    // Get image data for the entire memory canvas
    const imageData = ctx.getImageData(0, 0, MAP.WIDTH, MAP.HEIGHT);
    const data = imageData.data;
    
    // Calculate visible address range for current zoom
    const { minAddr, maxAddr } = zoomState;
    const bytesPerPixel = (maxAddr - minAddr) / (MAP.WIDTH * MAP.HEIGHT);
    
    // Apply shading to pixels in the highlighted region
    const startAddr = Math.max(region.start, minAddr);
    const endAddr = Math.min(region.end, maxAddr);
    const zoomFactor = zoomState.getZoomFactor();
    
    for (let address = startAddr; address < endAddr; address += bytesPerPixel) {
        // Get coordinates in 2^24 coordinate system
        const order = 24;
        const [x24, y24] = hilbertIndexToXY(address, order);
        
        // Scale from 2^24 to 1024 and apply offset
        
        const scaledX = Math.floor((x24 - zoomState.offsetX) * zoomFactor);
        const scaledY = Math.floor((y24 - zoomState.offsetY) * zoomFactor);
        
        if (scaledX >= 0 && scaledX < MAP.WIDTH && scaledY >= 0 && scaledY < MAP.HEIGHT) {
            // Check if this pixel should be highlighted based on shading pattern
            const shadingValue = (scaledX + scaledY) % 8;
            if (shadingValue >= 2 && shadingValue <= 4) {
                const dataIndex = (scaledY * MAP.WIDTH + scaledX) * 4;
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

    // Check if we're on mobile
    const isMobile = window.innerWidth <= 768;
    
    // Background canvas (borders, legend on desktop, just borders on mobile)
    const backgroundCanvas = document.getElementById('backgroundCanvas');
    const backgroundCtx = backgroundCanvas.getContext('2d');
    backgroundCanvas.width = MAP.WIDTH + MAP.BORDER_LEFT + (isMobile ? MAP.BORDER_RIGHT_MOBILE : MAP.BORDER_RIGHT_DESKTOP);
    backgroundCanvas.height = MAP.HEIGHT + MAP.BORDER_TOP + MAP.BORDER_BOTTOM;
    
    // Memory map canvas (just the 1024x1024 memory data)
    const memoryCanvas = document.getElementById('memoryCanvas');
    const memoryCtx = memoryCanvas.getContext('2d');
    memoryCanvas.width = MAP.WIDTH;
    memoryCanvas.height = MAP.HEIGHT;

    if (isMobile) {
        drawBackgroundMobile(backgroundCtx);
        updateMobileScaleInfo();
    } else {
        drawBackground(backgroundCtx);
    }
    
    drawMemoryData(memoryCtx);
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
    const zoomFactor = zoomState.getZoomFactor();

    const x24 = zoomState.offsetX + mapX / zoomFactor;
    const y24 = zoomState.offsetY + mapY / zoomFactor;

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

function drawBackground(ctx) {
    const minAddr = zoomState.minAddr;
    const maxAddr = zoomState.maxAddr;
    const addressRange = maxAddr - minAddr;
    const bytesPerPixel = addressRange / (MAP.WIDTH * MAP.HEIGHT);

    // Light gray background for entire canvas
    ctx.fillStyle = '#C0C0C0';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Black background for the actual map area
    ctx.fillStyle = '#000000';
    ctx.fillRect(MAP.BORDER_LEFT, MAP.BORDER_TOP, MAP.WIDTH, MAP.HEIGHT);

    // Draw grid lines on background canvas with margin offsets
    drawGridLines(ctx, zoomState.level, MAP.BORDER_LEFT, MAP.BORDER_TOP);
    
    // Draw scale key
    drawScaleKey(ctx, zoomState.level, bytesPerPixel, minAddr, maxAddr);
}

function drawBackgroundMobile(ctx) {
    // Light gray background for entire canvas
    ctx.fillStyle = '#C0C0C0';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Black background for the actual map area
    ctx.fillStyle = '#000000';
    ctx.fillRect(MAP.BORDER_LEFT, MAP.BORDER_TOP, MAP.WIDTH, MAP.HEIGHT);
    
    // Draw grid lines on background canvas with margin offsets
    drawGridLines(ctx, zoomState.level, MAP.BORDER_LEFT, MAP.BORDER_TOP);
    
    // No scale key drawn on mobile - it goes in the HTML div below
}

function updateMobileScaleInfo() {
    const mobileScaleDiv = document.getElementById('mobile-scale-info');
    if (!mobileScaleDiv) return;
    
    const minAddr = zoomState.minAddr;
    const maxAddr = zoomState.maxAddr;
    const addressRange = maxAddr - minAddr;
    const bytesPerPixel = addressRange / (1024 * 1024);
    const squareSize = 128;
    const bytesPerSquare = bytesPerPixel * squareSize * squareSize;
    
    let html = `
        <div style="margin-bottom: 10px;">
            <strong>Memory Range:</strong><br>
            0x${minAddr.toString(16)} - 0x${maxAddr.toString(16)}
        </div>
        <div style="margin-bottom: 10px;">
            <strong>Scale:</strong><br>
            Each pixel = ${formatBytes(bytesPerPixel)}<br>
            Each square = ${formatBytes(bytesPerSquare)}
        </div>
    `;
    
    if (zoomState.level > 0) {
        const currentRange = maxAddr - minAddr;
        html += `
            <div>
                <strong>Zoom:</strong><br>
                Level ${zoomState.level}<br>
                View = ${formatBytes(currentRange)}
            </div>
        `;
    } else {
        html += `<div><strong>Zoom Level:</strong> ${zoomState.level}</div>`;
    }
    
    mobileScaleDiv.innerHTML = html;
}

function drawMemoryData(ctx) {
    const totalPixels = MAP.WIDTH * MAP.HEIGHT;
    const minAddr = zoomState.minAddr;
    const maxAddr = zoomState.maxAddr;
    const addressRange = maxAddr - minAddr;
    const bytesPerPixel = addressRange / totalPixels;

    // Black background for the memory canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, MAP.WIDTH, MAP.HEIGHT);

    if (regions.length === 0) {
        return;
    }

    // Filter ranges to only those that overlap with current view
    const visibleRanges = regions.filter(range =>
        range.end > minAddr && range.start < maxAddr
    );

    // Create image data for the memory canvas
    const imageData = ctx.getImageData(0, 0, MAP.WIDTH, MAP.HEIGHT);
    const data = imageData.data;

    // Get zoom factor once outside of loops
    const zoomFactor = zoomState.getZoomFactor();

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

            const scaledX = Math.floor((x24 - zoomState.offsetX) * zoomFactor);
            const scaledY = Math.floor((y24 - zoomState.offsetY) * zoomFactor);

            if (scaledX >= 0 && scaledX < MAP.WIDTH &&
                scaledY >= 0 && scaledY < MAP.HEIGHT) {
                const dataIndex = (scaledY * MAP.WIDTH + scaledX) * 4;
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
    drawGridLines(ctx, zoomState.level);
}

function drawGridLines(ctx, zoomLevel, offsetX = 0, offsetY = 0) {
    const tbSize = 128; // 128x128 pixel squares
    const subSize = 16; // 16x16 pixel sub-squares (128/8 = 16)
    
    // Helper function to draw a single line segment with appropriate style
    function drawLineSegment(startX, startY, endX, endY, isSubGrid) {
        // Set up style based on connectivity and grid level
        if (isSubGrid) {
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'; // Lighter color for sub-grid
        } else {
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        }
        
        // Draw the segment with optional offset
        ctx.beginPath();
        ctx.moveTo(startX + offsetX, startY + offsetY);
        ctx.lineTo(endX + offsetX, endY + offsetY);
        ctx.stroke();
    }
    
    // Helper function to check if two adjacent squares are adjacent in memory
    function areSquaresAdjacentInMemory(x1, y1, x2, y2, squareSize) {
        
        // Find addresses in each square.
        const addr1 = findAddressAtPixel(x1, y1);
        const addr2 = findAddressAtPixel(x2, y2);
        
        if (addr1 === null || addr2 === null) {
            return true; // Default to light if we can't determine
        }
        
        // Calculate the memory size of one square of the given size
        const { minAddr, maxAddr } = zoomState;
        const bytesPerPixel = (maxAddr - minAddr) / (MAP.WIDTH * MAP.HEIGHT);
        const bytesPerSquare = bytesPerPixel * squareSize * squareSize;
        
        // Round addresses down to square boundaries
        const roundedAddr1 = Math.floor(addr1 / bytesPerSquare) * bytesPerSquare;
        const roundedAddr2 = Math.floor(addr2 / bytesPerSquare) * bytesPerSquare;
        
        // Check if the rounded addresses are exactly one square apart
        const addressDiff = Math.abs(roundedAddr1 - roundedAddr2);
        const isAdjacent = addressDiff === bytesPerSquare;

        return isAdjacent;
    }
    
    // Draw vertical sub-grid lines
    for (let i = 0; i <= MAP.WIDTH; i += subSize) {
        // Check each segment of the vertical sub-grid line
        for (let j = 0; j < MAP.HEIGHT; j += subSize) {
            let isSubGrid = i % tbSize !== 0;
            const leftSquareX = i - subSize;
            const rightSquareX = i;
            const squareY = j;
            
            const isAdjacent   = areSquaresAdjacentInMemory(leftSquareX, squareY, rightSquareX, squareY, subSize);
            if (!isSubGrid) {
                const isAdjacentHi = areSquaresAdjacentInMemory(leftSquareX, squareY, rightSquareX, squareY, tbSize);
                if (isAdjacentHi) isSubGrid = true;
            }
            
            if (!isAdjacent) drawLineSegment(i, j, i, j + subSize, isSubGrid);
        }
    }
    
    // Draw horizontal sub-grid lines
    for (let i = 0; i <= MAP.HEIGHT; i += subSize) {
        // Check each segment of the horizontal sub-grid line
        for (let j = 0; j < MAP.WIDTH; j += subSize) {
            let isSubGrid = i % tbSize !== 0;
            const squareX = j;
            const topSquareY = i - subSize;
            const bottomSquareY = i;
            
            // Check if sub-squares above and below this line are adjacent in memory
            const isAdjacent   = areSquaresAdjacentInMemory(squareX, topSquareY, squareX, bottomSquareY, subSize);
            if (!isSubGrid) {
                const isAdjacentHi = areSquaresAdjacentInMemory(squareX, topSquareY, squareX, bottomSquareY, tbSize);
                if (isAdjacentHi) isSubGrid = true;
            }
            
            // Draw this segment using the helper function (isSubGrid = true)
            if (!isAdjacent) drawLineSegment(j, i, j + subSize, i, isSubGrid);
        }
    }
    
    // Reset line dash for other drawing
    ctx.setLineDash([]);
}

function drawScaleKey(ctx, level, bytesPerPixel, minAddr, maxAddr) {
    const keyX = MAP.BORDER_LEFT + MAP.WIDTH + MAP.KEY_OFFSET;
    const keyY = MAP.BORDER_TOP + 100;

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

function isTooltipVisible() {
    const tooltip = document.getElementById('tooltip');
    return tooltip && tooltip.style.display === 'block';
}

function showTooltipForCoords(coords, clientX, clientY) {
    const address = findAddressAtPixel(coords.mapX, coords.mapY);
    const region = findRegionFromAddress(address);
    const tooltip = document.getElementById('tooltip');
    
    if (region) {
        showTooltipForRegion(region, clientX, clientY);
    } else {
        hideTooltip();
    }
}

function showTooltipForRegion(region, clientX, clientY) {
    const tooltip = document.getElementById('tooltip');
    
    const size = region.end - region.start;
    const sizeHex = '0x' + size.toString(16);
    const sizeApprox = formatBytes(size);
    
    const startAlignment = getAlignment(region.start);
    const endAlignment = getAlignment(region.end);
    const startAlignmentStr = formatBytes(startAlignment);
    const endAlignmentStr = formatBytes(endAlignment);
    
    // Find current region index
    const currentIndex = regions.indexOf(region);
    
    tooltip.innerHTML = `
        <span class="tooltip-close" onclick="hideTooltip()">&times;</span>
        <div style="display: flex; align-items: center; margin-bottom: 5px;">
            <button class="tooltip-nav" onclick="showPreviousRegion()" style="margin-right: 10px;">&#9664;</button>
            <div class="tooltip-region-name" style="flex: 1; text-align: center; font-weight: bold;">${region.name}</div>
            <button class="tooltip-nav" onclick="showNextRegion()" style="margin-left: 10px;">&#9654;</button>
        </div>
        <div class="tooltip-content">
            <div class="tooltip-address">0x${region.start.toString(16)} - 0x${region.end.toString(16)}</div>
            <div class="tooltip-size">Size: ${sizeHex} (ca. ${sizeApprox})</div>
            <div class="tooltip-alignment-start">Start alignment: ${startAlignmentStr}</div>
            <div class="tooltip-alignment-end">End alignment: ${endAlignmentStr}</div>
        </div>
    `;
    
    tooltip.style.display = 'block';
    tooltip.style.left = clientX + 'px';
    tooltip.style.top = (clientY - 100) + 'px';
    
    // Store current region and position for navigation
    tooltip.dataset.currentRegion = currentIndex;
    tooltip.dataset.clientX = clientX;
    tooltip.dataset.clientY = clientY;
    
    // Remove any existing shading and apply new shading
    removeShading();
    applyShading(region);
}

function showPreviousRegion() {
    const tooltip = document.getElementById('tooltip');
    const currentIndex = parseInt(tooltip.dataset.currentRegion);
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : regions.length - 1;
    
    updateTooltipContent(regions[prevIndex], prevIndex);
}

function showNextRegion() {
    const tooltip = document.getElementById('tooltip');
    const currentIndex = parseInt(tooltip.dataset.currentRegion);
    const nextIndex = currentIndex < regions.length - 1 ? currentIndex + 1 : 0;
    
    updateTooltipContent(regions[nextIndex], nextIndex);
}

function updateTooltipContent(region, regionIndex) {
    const tooltip = document.getElementById('tooltip');
    
    const size = region.end - region.start;
    const sizeHex = '0x' + size.toString(16);
    const sizeApprox = formatBytes(size);
    
    const startAlignment = getAlignment(region.start);
    const endAlignment = getAlignment(region.end);
    const startAlignmentStr = formatBytes(startAlignment);
    const endAlignmentStr = formatBytes(endAlignment);
    
    // Update only the content elements, not the buttons
    const regionNameEl = tooltip.querySelector('.tooltip-region-name');
    const addressEl = tooltip.querySelector('.tooltip-address');
    const sizeEl = tooltip.querySelector('.tooltip-size');
    const startAlignmentEl = tooltip.querySelector('.tooltip-alignment-start');
    const endAlignmentEl = tooltip.querySelector('.tooltip-alignment-end');
    
    if (regionNameEl) regionNameEl.textContent = region.name;
    if (addressEl) addressEl.textContent = `0x${region.start.toString(16)} - 0x${region.end.toString(16)}`;
    if (sizeEl) sizeEl.textContent = `Size: ${sizeHex} (ca. ${sizeApprox})`;
    if (startAlignmentEl) startAlignmentEl.textContent = `Start alignment: ${startAlignmentStr}`;
    if (endAlignmentEl) endAlignmentEl.textContent = `End alignment: ${endAlignmentStr}`;
    
    // Update stored region index
    tooltip.dataset.currentRegion = regionIndex;
    
    // Update shading to highlight the new region
    removeShading();
    applyShading(region);
}

function maybePerformZoom(coords) {
    // Check zoom level and bounds
    if (zoomState.level >= MAP.MAX_ZOOM) {
        return;
    }
    
    if (coords.mapX < 0 || coords.mapX >= 1024 || coords.mapY < 0 || coords.mapY >= 1024) {
        return;
    }
    
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
    const zoomFactor = zoomState.getZoomFactor();
    
    const newOffsetX = zoomState.offsetX + gridX * pixelsPerGrid / zoomFactor;
    const newOffsetY = zoomState.offsetY + gridY * pixelsPerGrid / zoomFactor;
    
    // Prepare new zoom state
    const newZoomState = new ZoomState(
        zoomState.level + 1,
        gridStartAddr,
        gridEndAddr,
        newOffsetX,
        newOffsetY
    );
    
    hideTooltip();
    
    // Trigger animated zoom
    animateZoom(gridX, gridY, newZoomState);
}

function resetZoom() {
    zoomState.reset();
    hideTooltip();
    
    // Reset memory canvas transform and update
    const memoryCanvas = document.getElementById('memoryCanvas');
    memoryCanvas.style.transform = '';
    updateCanvas();
    updateURLState();
}

function updateURLState() {
    const url = new URL(window.location);
    
    if (zoomState.level === 0) {
        // Remove zoom parameters for default state
        url.searchParams.delete('level');
        url.searchParams.delete('minAddr');
        url.searchParams.delete('maxAddr');
        url.searchParams.delete('offsetX');
        url.searchParams.delete('offsetY');
    } else {
        // Add zoom parameters
        url.searchParams.set('level', zoomState.level.toString());
        url.searchParams.set('minAddr', '0x' + zoomState.minAddr.toString(16));
        url.searchParams.set('maxAddr', '0x' + zoomState.maxAddr.toString(16));
        url.searchParams.set('offsetX', zoomState.offsetX.toString());
        url.searchParams.set('offsetY', zoomState.offsetY.toString());
    }
    
    // Update URL without triggering a page reload
    window.history.pushState(null, '', url.toString());
}

function parseURLState() {
    const params = new URLSearchParams(window.location.search);
    
    if (params.has('level')) {
        const level = parseInt(params.get('level'));
        const minAddr = parseInt(params.get('minAddr'), 16);
        const maxAddr = parseInt(params.get('maxAddr'), 16);
        const offsetX = parseFloat(params.get('offsetX'));
        const offsetY = parseFloat(params.get('offsetY'));
        
        // Validate the parameters
        if (!isNaN(level) && !isNaN(minAddr) && !isNaN(maxAddr) && 
            !isNaN(offsetX) && !isNaN(offsetY) && 
            level >= 0 && level <= 4) {
            
            zoomState.level = level;
            zoomState.minAddr = minAddr;
            zoomState.maxAddr = maxAddr;
            zoomState.offsetX = offsetX;
            zoomState.offsetY = offsetY;
            
            return true; // State was restored from URL
        }
    }
    
    return false; // No valid state in URL
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
    offScreenCanvas.width = MAP.WIDTH;
    offScreenCanvas.height = MAP.HEIGHT;
    const offScreenCtx = offScreenCanvas.getContext('2d');
    
    // Render new zoomed content to off-screen canvas
    const oldZoomState = zoomState.copy();
    Object.assign(zoomState, newZoomState);
    drawMemoryData(offScreenCtx);
    
    // Create DOM element from off-screen canvas and position it
    const animatingCanvas = document.createElement('canvas');
    animatingCanvas.width = MAP.WIDTH;
    animatingCanvas.height = MAP.HEIGHT;
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
            const isMobile = window.innerWidth <= 768;
            
            if (isMobile) {
                drawBackgroundMobile(backgroundCtx);
                updateMobileScaleInfo();
            } else {
                drawBackground(backgroundCtx);
            }
            
            // Clean up
            container.removeChild(animatingCanvas);
            animationState.isAnimating = false;
            memoryCanvas.classList.remove('animating');
            
            // Update URL state after zoom completes
            updateURLState();
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
        
        // Check if URL contains zoom state to restore
        const urlStateRestored = parseURLState();
        if (urlStateRestored) {
            // URL contained valid zoom state, update canvas to reflect it
            updateCanvas();
        }
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
            showTooltipForCoords(coords, e.clientX, e.clientY);
        }, 200); // Delay to allow double-click to cancel.
    });

    canvas.addEventListener('dblclick', function(e) {
        clearTimeout(clickTimeout); // Cancel single-click.
        
        // Don't zoom if already animating
        if (animationState.isAnimating) {
            return;
        }
        
        const coords = getMapCoordinates(e, canvas);

        maybePerformZoom(coords);
    });

    // Click outside map area to dismiss.
    document.addEventListener('click', function(e) {
        const memoryCanvas = document.getElementById('memoryCanvas');
        const backgroundCanvas = document.getElementById('backgroundCanvas');
        const tooltip = document.getElementById('tooltip');
        
        // If click is not on the memory canvas and not on the tooltip itself
        if (e.target !== memoryCanvas && !tooltip.contains(e.target)) {
            hideTooltip();
        }
    });

    // Touch event support for mobile
    let lastTouchTime = 0;
    let touchTimeout;
    
    canvas.addEventListener('touchstart', function(e) {
        // Prevent browser zoom and scrolling
        e.preventDefault();
        
        // Don't handle touches during animation
        if (animationState.isAnimating) {
            return;
        }
        
        const currentTime = Date.now();
        const timeDiff = currentTime - lastTouchTime;
        
        // Clear any existing timeout
        clearTimeout(touchTimeout);
        
        if (timeDiff < 300 && timeDiff > 0) {
            // Double tap detected - trigger zoom
            const touch = e.touches[0];
            const coords = getMapCoordinates({
                clientX: touch.clientX,
                clientY: touch.clientY
            }, canvas);
            
            maybePerformZoom(coords);
            
            lastTouchTime = 0; // Reset to prevent triple-tap
        } else {
            // Single tap - show tooltip after delay
            touchTimeout = setTimeout(function() {
                const touch = e.touches[0];
                const coords = getMapCoordinates({
                    clientX: touch.clientX,
                    clientY: touch.clientY
                }, canvas);
                showTooltipForCoords(coords, touch.clientX, touch.clientY);
            }, 200);
            
            lastTouchTime = currentTime;
        }
    }, { passive: false });
    
    // Keyboard shortcuts for zoom reset and tooltip navigation.
    document.addEventListener('keydown', function(e) {
        if (e.key === 'r' || e.key === 'R') {
            resetZoom();
        } else if (e.key === 'ArrowLeft' && isTooltipVisible()) {
            e.preventDefault(); // Prevent page scrolling
            showPreviousRegion();
        } else if (e.key === 'ArrowRight' && isTooltipVisible()) {
            e.preventDefault(); // Prevent page scrolling
            showNextRegion();
        }
    });
    
    // Window resize listener for responsive layout updates
    let resizeTimeout;
    window.addEventListener('resize', function() {
        // Debounce resize events to avoid excessive redraws
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(function() {
            // Only update canvas if we're not currently animating
            if (!animationState.isAnimating) {
                updateCanvas();
            }
        }, 250); // 250ms debounce delay
    });
    
    // Browser back/forward button support
    window.addEventListener('popstate', function(event) {
        // Don't handle popstate during animations
        if (animationState.isAnimating) {
            return;
        }
        
        // Store current state to compare
        const oldState = zoomState.copy();
        
        // Try to parse URL state (returns true if URL had zoom params)
        const urlHadZoomParams = parseURLState();
        
        // If URL had no zoom params, reset to default state
        if (!urlHadZoomParams) {
            zoomState.reset();
        }
        
        if (!oldState.equals(zoomState)) {
            hideTooltip();
            updateCanvas();
        }
    });
});
