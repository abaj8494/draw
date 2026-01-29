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
     * Resize canvases to fill window
     */
    resize() {
        this.width = window.innerWidth;
        this.height = window.innerHeight;

        this.bgCanvas.width = this.width;
        this.bgCanvas.height = this.height;
        this.drawCanvas.width = this.width;
        this.drawCanvas.height = this.height;

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

            // Vertical lines
            for (let x = offsetX; x < this.width; x += scaledGridSize) {
                ctx.moveTo(x, 0);
                ctx.lineTo(x, this.height);
            }

            // Horizontal lines
            for (let y = offsetY; y < this.height; y += scaledGridSize) {
                ctx.moveTo(0, y);
                ctx.lineTo(this.width, y);
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
     * Render a single stroke
     */
    renderStroke(stroke, ctx = this.drawCtx) {
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
     */
    findStrokeAt(x, y, threshold = 10) {
        const canvasPoint = this.toCanvas(x, y);
        const scaledThreshold = threshold / this.scale;

        for (let i = this.strokes.length - 1; i >= 0; i--) {
            const stroke = this.strokes[i];
            for (const point of stroke.points) {
                const dist = Math.sqrt(
                    Math.pow(point.x - canvasPoint.x, 2) +
                    Math.pow(point.y - canvasPoint.y, 2)
                );
                if (dist <= scaledThreshold + stroke.size / 2) {
                    return i;
                }
            }
        }
        return -1;
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

            for (const point of stroke.points) {
                point.x += dx;
                point.y += dy;
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
     * Clear all strokes
     */
    clearAll() {
        if (this.strokes.length > 0) {
            this.undoStack.push({ action: 'clear', strokes: [...this.strokes] });
            this.redoStack = [];
            this.strokes = [];
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
     * Reset to default state
     */
    reset() {
        this.strokes = [];
        this.currentStroke = null;
        this.undoStack = [];
        this.redoStack = [];
        this.offsetX = 0;
        this.offsetY = 0;
        this.scale = 1;
        this.currentBackground = 'grid-light';
        this.drawBackground();
        this.redraw();
    }
};
