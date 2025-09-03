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
    const ctx = canvas.getContext('2d');
    
    // Set canvas size
    const mapWidth = 1024;
    const mapHeight = 1024;
    const borderTop = 100;
    const borderBottom = 100;
    const borderLeft = 100;
    const borderRight = 450;
    canvas.width = mapWidth + borderLeft + borderRight;
    canvas.height = mapHeight + borderTop + borderBottom;
    
    drawMemoryMap(ctx, mapWidth, mapHeight, borderLeft, borderTop, borderRight);
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

function drawMemoryMap(ctx, mapWidth, mapHeight, borderLeft, borderTop, borderRight) {
    const totalPixels = mapWidth * mapHeight;
    const minAddr = zoomState.minAddr;
    const maxAddr = zoomState.maxAddr;
    const addressRange = maxAddr - minAddr;
    const bytesPerPixel = addressRange / totalPixels;

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Black area for the memory map
    ctx.fillStyle = '#000000';
    ctx.fillRect(borderLeft, borderTop, mapWidth, mapHeight);

    if (regions.length === 0) {
        return;
    }

    // Filter ranges to only those that overlap with current view
    const visibleRanges = regions.filter(range => 
        range.end > minAddr && range.start < maxAddr
    );

    // Create image data for the entire canvas
    const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
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
                const canvasX = scaledX + borderLeft;
                const canvasY = scaledY + borderTop;
                const dataIndex = (canvasY * ctx.canvas.width + canvasX) * 4;
                data[dataIndex] = r;     // Red
                data[dataIndex + 1] = g; // Green
                data[dataIndex + 2] = b; // Blue
                data[dataIndex + 3] = a; // Alpha
            }
        }
    });

    // Apply the image data to canvas
    ctx.putImageData(imageData, 0, 0);

    // Draw grid lines and scale key
    drawGridLines(ctx, mapWidth, mapHeight, borderLeft, borderTop, zoomState.level);
    drawScaleKey(ctx, mapWidth, borderLeft, borderTop, borderRight, zoomState.level, bytesPerPixel, minAddr, maxAddr);
}

function drawGridLines(ctx, mapWidth, mapHeight, borderLeft, borderTop, zoomLevel) {
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
        ctx.moveTo(borderLeft + i, borderTop);
        ctx.lineTo(borderLeft + i, borderTop + 1024);
        // Horizontal lines
        ctx.moveTo(borderLeft, borderTop + i);
        ctx.lineTo(borderLeft + 1024, borderTop + i);
    }

    ctx.stroke();

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

document.addEventListener('DOMContentLoaded', function() {
    loadMemoryMap();

    const canvas = document.getElementById('memoryCanvas');
    const tooltip = document.getElementById('tooltip');

    let clickTimeout;

    canvas.addEventListener('click', function(e) {
        clearTimeout(clickTimeout);
        clickTimeout = setTimeout(function() {
            const coords = getMapCoordinates(e, canvas);
            const address = findAddressAtPixel(coords.mapX, coords.mapY);
            const region = findRegionFromAddress(address);

            if (region) {
                const size = region.end - region.start;
                const sizeStr = formatBytes(size);

                tooltip.innerHTML = `<span class="tooltip-close" onclick="hideTooltip()">&times;</span>${region.name}<br>0x${region.start.toString(16)} - 0x${region.end.toString(16)}<br>Size: ${sizeStr}`;
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

            // Update zoom state.
            zoomState.level++;
            zoomState.minAddr = gridStartAddr;
            zoomState.maxAddr = gridEndAddr;
            zoomState.offsetX = newOffsetX;
            zoomState.offsetY = newOffsetY;

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

    // Keyboard shortcut for zoom reset.
    document.addEventListener('keydown', function(e) {
        if (e.key === 'r' || e.key === 'R') {
            resetZoom();
        }
    });
});