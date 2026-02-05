/**
 * Canvas Module - Canvas management & rendering
 */

const Canvas = {
    bgCanvas: null,
    bgCtx: null,
    drawCanvas: null,
    drawCtx: null,
    width: 0,
    height: 0,
    dpr: 1, // Device pixel ratio for sharp rendering

    // Pan/zoom state
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    minScale: 0.25,
    maxScale: 4,

    // Drawing state
    strokes: [],
    currentStroke: null,
    undoStack: [],
    redoStack: [],

    // Image cache for rendering pasted images
    imageCache: new Map(),

    // Background configuration
    backgrounds: {
        'grid-light': { type: 'grid', bg: '#ffffff', line: '#e0e0e0' },
        'grid-dark': { type: 'grid', bg: '#1a1a1a', line: '#333333' },
        'grid-sepia': { type: 'grid', bg: '#f5f0e6', line: '#d4c9b0' },
        'blank-light': { type: 'blank', bg: '#ffffff' },
        'blank-dark': { type: 'blank', bg: '#1a1a1a' },
        'blank-sepia': { type: 'blank', bg: '#f5f0e6' }
    },
    currentBackground: 'grid-light',
    gridSize: 20,

    /**
     * Initialize canvas elements
     */
    init() {
        this.bgCanvas = document.getElementById('background-canvas');
        this.bgCtx = this.bgCanvas.getContext('2d');
        this.drawCanvas = document.getElementById('drawing-canvas');
        this.drawCtx = this.drawCanvas.getContext('2d');

        this.resize();
        window.addEventListener('resize', () => this.resize());
    },

    /**
     * Resize canvases to fill window with high-DPI support
     */
    resize() {
        this.dpr = window.devicePixelRatio || 1;
        this.width = window.innerWidth;
        this.height = window.innerHeight;

        // Set canvas size accounting for device pixel ratio
        this.bgCanvas.width = this.width * this.dpr;
        this.bgCanvas.height = this.height * this.dpr;
        this.drawCanvas.width = this.width * this.dpr;
        this.drawCanvas.height = this.height * this.dpr;

        // Set CSS size to match logical pixels
        this.bgCanvas.style.width = this.width + 'px';
        this.bgCanvas.style.height = this.height + 'px';
        this.drawCanvas.style.width = this.width + 'px';
        this.drawCanvas.style.height = this.height + 'px';

        // Scale context to match DPR
        this.bgCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.drawCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        this.drawBackground();
        this.redraw();
    },

    /**
     * Draw background (grid or blank)
     */
    drawBackground() {
        const config = this.backgrounds[this.currentBackground];
        const ctx = this.bgCtx;

        // Fill background color
        ctx.fillStyle = config.bg;
        ctx.fillRect(0, 0, this.width, this.height);

        // Draw grid if needed
        if (config.type === 'grid') {
            ctx.strokeStyle = config.line;
            ctx.lineWidth = 1;

            const scaledGridSize = this.gridSize * this.scale;
            const offsetX = this.offsetX % scaledGridSize;
            const offsetY = this.offsetY % scaledGridSize;

            ctx.beginPath();

            // Vertical lines - align to pixel grid for sharpness
            for (let x = offsetX; x < this.width; x += scaledGridSize) {
                const px = Math.round(x) + 0.5; // 0.5 offset for crisp 1px lines
                ctx.moveTo(px, 0);
                ctx.lineTo(px, this.height);
            }

            // Horizontal lines - align to pixel grid for sharpness
            for (let y = offsetY; y < this.height; y += scaledGridSize) {
                const py = Math.round(y) + 0.5; // 0.5 offset for crisp 1px lines
                ctx.moveTo(0, py);
                ctx.lineTo(this.width, py);
            }

            ctx.stroke();
        }
    },

    /**
     * Set background type
     */
    setBackground(bgKey) {
        if (this.backgrounds[bgKey]) {
            this.currentBackground = bgKey;
            this.drawBackground();
        }
    },

    /**
     * Get current background color
     */
    getBackgroundColor() {
        return this.backgrounds[this.currentBackground].bg;
    },

    /**
     * Clear the drawing canvas
     */
    clear() {
        this.drawCtx.clearRect(0, 0, this.width, this.height);
    },

    /**
     * Redraw all strokes
     */
    redraw() {
        this.clear();
        for (const stroke of this.strokes) {
            this.renderStroke(stroke);
        }
    },

    /**
     * Transform point from canvas coordinates to screen coordinates
     */
    toScreen(x, y) {
        return {
            x: x * this.scale + this.offsetX,
            y: y * this.scale + this.offsetY
        };
    },

    /**
     * Transform point from screen coordinates to canvas coordinates
     */
    toCanvas(x, y) {
        return {
            x: (x - this.offsetX) / this.scale,
            y: (y - this.offsetY) / this.scale
        };
    },

    /**
     * Get or create a cached Image element for a data URL
     */
    getImage(src) {
        if (this.imageCache.has(src)) {
            return this.imageCache.get(src);
        }
        const img = new Image();
        img.src = src;
        this.imageCache.set(src, img);
        // Re-render once loaded if it wasn't cached
        img.onload = () => this.redraw();
        return img;
    },

    /**
     * Render a single stroke
     */
    renderStroke(stroke, ctx = this.drawCtx) {
        if (stroke && stroke.type === 'image') {
            this.renderImageStroke(stroke, ctx);
            return;
        }

        if (!stroke || !stroke.points || stroke.points.length === 0) return;

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size * this.scale;
        ctx.globalAlpha = stroke.opacity;

        if (stroke.type === 'highlighter') {
            ctx.globalCompositeOperation = 'multiply';
        }

        ctx.beginPath();

        if (stroke.points.length === 1) {
            // Single point - draw a dot
            const p = stroke.points[0];
            const screen = this.toScreen(p.x, p.y);
            ctx.arc(screen.x, screen.y, (stroke.size * this.scale) / 2, 0, Math.PI * 2);
            ctx.fill();
        } else if (stroke.type === 'pen') {
            // Smooth bezier curve for pen
            this.drawSmoothLine(ctx, stroke.points);
        } else {
            // Regular line for pencil/highlighter
            const firstPoint = stroke.points[0];
            const firstScreen = this.toScreen(firstPoint.x, firstPoint.y);
            ctx.moveTo(firstScreen.x, firstScreen.y);

            for (let i = 1; i < stroke.points.length; i++) {
                const p = stroke.points[i];
                const screen = this.toScreen(p.x, p.y);
                ctx.lineTo(screen.x, screen.y);
            }
            ctx.stroke();
        }

        ctx.restore();
    },

    /**
     * Render an image stroke
     */
    renderImageStroke(stroke, ctx = this.drawCtx) {
        const img = this.getImage(stroke.src);
        if (!img.complete || img.naturalWidth === 0) return;

        const topLeft = this.toScreen(stroke.x, stroke.y);
        const w = stroke.width * this.scale;
        const h = stroke.height * this.scale;

        ctx.save();
        ctx.globalAlpha = stroke.opacity;
        ctx.drawImage(img, topLeft.x, topLeft.y, w, h);
        ctx.restore();
    },

    /**
     * Draw smooth bezier curve through points
     */
    drawSmoothLine(ctx, points) {
        if (points.length < 2) return;

        const screenPoints = points.map(p => this.toScreen(p.x, p.y));

        ctx.moveTo(screenPoints[0].x, screenPoints[0].y);

        if (points.length === 2) {
            ctx.lineTo(screenPoints[1].x, screenPoints[1].y);
        } else {
            for (let i = 1; i < screenPoints.length - 1; i++) {
                const xc = (screenPoints[i].x + screenPoints[i + 1].x) / 2;
                const yc = (screenPoints[i].y + screenPoints[i + 1].y) / 2;
                ctx.quadraticCurveTo(screenPoints[i].x, screenPoints[i].y, xc, yc);
            }

            // Connect to last point
            const last = screenPoints[screenPoints.length - 1];
            const secondLast = screenPoints[screenPoints.length - 2];
            ctx.quadraticCurveTo(secondLast.x, secondLast.y, last.x, last.y);
        }

        ctx.stroke();
    },

    /**
     * Start a new stroke
     */
    startStroke(type, x, y, color, size, opacity = 1) {
        const canvasPoint = this.toCanvas(x, y);
        this.currentStroke = {
            type: type,
            points: [canvasPoint],
            color: color,
            size: size,
            opacity: opacity
        };
    },

    /**
     * Add point to current stroke
     */
    addPoint(x, y) {
        if (this.currentStroke) {
            const canvasPoint = this.toCanvas(x, y);
            this.currentStroke.points.push(canvasPoint);

            // Render current stroke preview
            this.redraw();
            this.renderStroke(this.currentStroke);
        }
    },

    /**
     * Finish current stroke
     */
    endStroke() {
        if (this.currentStroke && this.currentStroke.points.length > 0) {
            this.strokes.push(this.currentStroke);
            this.undoStack.push({ action: 'add', stroke: this.currentStroke });
            this.redoStack = [];
            this.currentStroke = null;
            this.redraw();
            return true;
        }
        this.currentStroke = null;
        return false;
    },

    /**
     * Pixel eraser - create eraser stroke with destination-out
     */
    pixelErase(x, y, size) {
        this.drawCtx.save();
        this.drawCtx.globalCompositeOperation = 'destination-out';
        this.drawCtx.beginPath();
        this.drawCtx.arc(x, y, (size * this.scale) / 2, 0, Math.PI * 2);
        this.drawCtx.fill();
        this.drawCtx.restore();
    },

    /**
     * Find stroke at position (for object eraser)
     * Checks both points and line segments between points
     */
    findStrokeAt(x, y, threshold = 10) {
        const canvasPoint = this.toCanvas(x, y);
        const scaledThreshold = threshold / this.scale;

        for (let i = this.strokes.length - 1; i >= 0; i--) {
            const stroke = this.strokes[i];

            // Image stroke - bounding box hit test
            if (stroke.type === 'image') {
                if (canvasPoint.x >= stroke.x - scaledThreshold &&
                    canvasPoint.x <= stroke.x + stroke.width + scaledThreshold &&
                    canvasPoint.y >= stroke.y - scaledThreshold &&
                    canvasPoint.y <= stroke.y + stroke.height + scaledThreshold) {
                    return i;
                }
                continue;
            }

            const hitThreshold = scaledThreshold + stroke.size / 2;

            // Check each point
            for (const point of stroke.points) {
                const dist = Math.hypot(point.x - canvasPoint.x, point.y - canvasPoint.y);
                if (dist <= hitThreshold) {
                    return i;
                }
            }

            // Check line segments between points
            if (stroke.points.length > 1) {
                for (let j = 0; j < stroke.points.length - 1; j++) {
                    const p1 = stroke.points[j];
                    const p2 = stroke.points[j + 1];
                    const dist = this.pointToSegmentDistance(canvasPoint, p1, p2);
                    if (dist <= hitThreshold) {
                        return i;
                    }
                }
            }
        }
        return -1;
    },

    /**
     * Calculate distance from a point to a line segment
     */
    pointToSegmentDistance(point, segStart, segEnd) {
        const dx = segEnd.x - segStart.x;
        const dy = segEnd.y - segStart.y;
        const lengthSquared = dx * dx + dy * dy;

        if (lengthSquared === 0) {
            // Segment is a point
            return Math.hypot(point.x - segStart.x, point.y - segStart.y);
        }

        // Project point onto line, clamped to segment
        let t = ((point.x - segStart.x) * dx + (point.y - segStart.y) * dy) / lengthSquared;
        t = Math.max(0, Math.min(1, t));

        const projX = segStart.x + t * dx;
        const projY = segStart.y + t * dy;

        return Math.hypot(point.x - projX, point.y - projY);
    },

    /**
     * Remove stroke by index
     */
    removeStroke(index) {
        if (index >= 0 && index < this.strokes.length) {
            const removed = this.strokes.splice(index, 1)[0];
            this.undoStack.push({ action: 'remove', stroke: removed, index: index });
            this.redoStack = [];
            this.redraw();
            return true;
        }
        return false;
    },

    /**
     * Find strokes within a polygon (lasso selection)
     */
    findStrokesInPolygon(polygon) {
        const indices = [];
        for (let i = 0; i < this.strokes.length; i++) {
            const stroke = this.strokes[i];
            if (stroke.type === 'image') {
                // Check four corners of the image
                const corners = [
                    { x: stroke.x, y: stroke.y },
                    { x: stroke.x + stroke.width, y: stroke.y },
                    { x: stroke.x + stroke.width, y: stroke.y + stroke.height },
                    { x: stroke.x, y: stroke.y + stroke.height }
                ];
                for (const corner of corners) {
                    if (this.pointInPolygon(corner, polygon)) {
                        indices.push(i);
                        break;
                    }
                }
                continue;
            }
            for (const point of stroke.points) {
                if (this.pointInPolygon(point, polygon)) {
                    indices.push(i);
                    break;
                }
            }
        }
        return indices;
    },

    /**
     * Find strokes within rectangle (marquee selection)
     */
    findStrokesInRect(rect) {
        const indices = [];
        for (let i = 0; i < this.strokes.length; i++) {
            const stroke = this.strokes[i];
            if (stroke.type === 'image') {
                // Check if image overlaps with selection rect
                if (stroke.x + stroke.width >= rect.x &&
                    stroke.x <= rect.x + rect.width &&
                    stroke.y + stroke.height >= rect.y &&
                    stroke.y <= rect.y + rect.height) {
                    indices.push(i);
                }
                continue;
            }
            for (const point of stroke.points) {
                if (point.x >= rect.x && point.x <= rect.x + rect.width &&
                    point.y >= rect.y && point.y <= rect.y + rect.height) {
                    indices.push(i);
                    break;
                }
            }
        }
        return indices;
    },

    /**
     * Point in polygon test
     */
    pointInPolygon(point, polygon) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;

            if (((yi > point.y) !== (yj > point.y)) &&
                (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    },

    /**
     * Delete selected strokes
     */
    deleteStrokes(indices) {
        if (indices.length === 0) return;

        // Sort indices in descending order to remove from end first
        indices.sort((a, b) => b - a);
        const removed = [];

        for (const index of indices) {
            removed.push({ stroke: this.strokes[index], index: index });
            this.strokes.splice(index, 1);
        }

        this.undoStack.push({ action: 'remove-multiple', strokes: removed });
        this.redoStack = [];
        this.redraw();
    },

    /**
     * Move selected strokes by delta
     */
    moveStrokes(indices, dx, dy) {
        if (indices.length === 0) return;

        for (const index of indices) {
            const stroke = this.strokes[index];
            if (!stroke) continue;

            if (stroke.type === 'image') {
                stroke.x += dx;
                stroke.y += dy;
            } else {
                for (const point of stroke.points) {
                    point.x += dx;
                    point.y += dy;
                }
            }
        }

        this.redraw();
    },

    /**
     * Pan the canvas
     */
    pan(dx, dy) {
        this.offsetX += dx;
        this.offsetY += dy;
        this.drawBackground();
        this.redraw();
    },

    /**
     * Set scale (zoom) centered on a point
     */
    setScale(newScale, centerX, centerY) {
        const clampedScale = Math.max(this.minScale, Math.min(this.maxScale, newScale));

        if (clampedScale === this.scale) return;

        // Adjust offset to zoom toward center point
        const scaleRatio = clampedScale / this.scale;

        // Convert center point to canvas coordinates
        const canvasX = (centerX - this.offsetX) / this.scale;
        const canvasY = (centerY - this.offsetY) / this.scale;

        // Update scale
        this.scale = clampedScale;

        // Adjust offset to keep the center point stationary
        this.offsetX = centerX - canvasX * this.scale;
        this.offsetY = centerY - canvasY * this.scale;

        this.drawBackground();
        this.redraw();
    },

    /**
     * Undo last action
     */
    undo() {
        if (this.undoStack.length === 0) return false;

        const action = this.undoStack.pop();

        if (action.action === 'add') {
            this.strokes.pop();
            this.redoStack.push(action);
        } else if (action.action === 'remove') {
            this.strokes.splice(action.index, 0, action.stroke);
            this.redoStack.push(action);
        } else if (action.action === 'remove-multiple') {
            // Restore in original order
            action.strokes.sort((a, b) => a.index - b.index);
            for (const item of action.strokes) {
                this.strokes.splice(item.index, 0, item.stroke);
            }
            this.redoStack.push(action);
        } else if (action.action === 'clear') {
            this.strokes = action.strokes;
            this.redoStack.push(action);
        }

        this.redraw();
        return true;
    },

    /**
     * Redo last undone action
     */
    redo() {
        if (this.redoStack.length === 0) return false;

        const action = this.redoStack.pop();

        if (action.action === 'add') {
            this.strokes.push(action.stroke);
            this.undoStack.push(action);
        } else if (action.action === 'remove') {
            this.strokes.splice(action.index, 1);
            this.undoStack.push(action);
        } else if (action.action === 'remove-multiple') {
            // Remove in reverse order
            const indices = action.strokes.map(s => s.index).sort((a, b) => b - a);
            for (const index of indices) {
                this.strokes.splice(index, 1);
            }
            this.undoStack.push(action);
        } else if (action.action === 'clear') {
            this.strokes = [];
            this.undoStack.push(action);
        }

        this.redraw();
        return true;
    },

    /**
     * Clear all strokes (permanent - clears undo history)
     */
    clearAll() {
        if (this.strokes.length > 0) {
            this.strokes = [];
            this.undoStack = [];
            this.redoStack = [];
            this.redraw();
        }
    },

    /**
     * Get drawing state for saving
     */
    getState() {
        return {
            strokes: this.strokes,
            background: this.currentBackground,
            offsetX: this.offsetX,
            offsetY: this.offsetY,
            scale: this.scale
        };
    },

    /**
     * Load drawing state
     */
    loadState(state) {
        if (state) {
            this.strokes = state.strokes || [];
            this.currentBackground = state.background || 'grid-light';
            this.offsetX = state.offsetX || 0;
            this.offsetY = state.offsetY || 0;
            this.scale = state.scale || 1;
            this.undoStack = [];
            this.redoStack = [];
            this.drawBackground();
            this.redraw();
        }
    },

    /**
     * Add an image stroke centered on the current viewport
     */
    addImageStroke(src, imgWidth, imgHeight) {
        // Place image at the center of the current viewport (in canvas coords)
        const centerScreen = { x: this.width / 2, y: this.height / 2 };
        const centerCanvas = this.toCanvas(centerScreen.x, centerScreen.y);

        const stroke = {
            type: 'image',
            src: src,
            x: centerCanvas.x - imgWidth / 2,
            y: centerCanvas.y - imgHeight / 2,
            width: imgWidth,
            height: imgHeight,
            opacity: 1
        };

        this.strokes.push(stroke);
        this.undoStack.push({ action: 'add', stroke: stroke });
        this.redoStack = [];
        this.redraw();
        return stroke;
    },

    /**
     * Reset to default state
     */
    reset() {
        this.strokes = [];
        this.currentStroke = null;
        this.undoStack = [];
        this.redoStack = [];
        this.imageCache.clear();
        this.offsetX = 0;
        this.offsetY = 0;
        this.scale = 1;
        this.currentBackground = 'grid-light';
        this.drawBackground();
        this.redraw();
    }
};
