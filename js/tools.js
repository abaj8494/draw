/**
 * Tools Module - Drawing tool implementations
 */

const Tools = {
    currentTool: 'pencil',
    brushSize: 3,
    brushColor: '#000000',
    isDrawing: false,
    shapeSnapEnabled: false,

    // Tool defaults (remembered in localStorage)
    toolDefaults: {
        eraser: 'eraser-pixel',
        laser: 'laser-plain'
    },

    // Tool-specific state
    lastX: 0,
    lastY: 0,
    lassoPoints: [],
    marqueeStart: null,
    panStart: null,
    moveStart: null,
    laserTimeout: null,
    laserTrail: [],
    selectionOverlay: null,
    selectedStrokes: [],

    // Pinch zoom state
    isPinching: false,
    initialPinchDistance: 0,
    initialScale: 1,
    pinchCenter: { x: 0, y: 0 },

    /**
     * Initialize tools
     */
    init() {
        this.setupEventListeners();
    },

    /**
     * Set current tool
     */
    setTool(tool) {
        // Handle expandable tools - use the default subtype
        if (tool === 'eraser') {
            tool = this.toolDefaults.eraser;
        } else if (tool === 'laser') {
            tool = this.toolDefaults.laser;
        }

        // Update defaults when subtool is selected
        if (tool === 'eraser-pixel' || tool === 'eraser-object') {
            this.toolDefaults.eraser = tool;
        } else if (tool === 'laser-plain' || tool === 'laser-trail') {
            this.toolDefaults.laser = tool;
        }

        this.currentTool = tool;
        if (tool !== 'move') {
            this.clearSelection();
        }
        this.updateCursor();
    },

    /**
     * Update cursor based on tool
     */
    updateCursor() {
        const canvas = Canvas.drawCanvas;
        canvas.className = '';

        const baseTool = this.currentTool.split('-')[0];

        switch (baseTool) {
            case 'pencil':
                canvas.classList.add('cursor-pencil');
                break;
            case 'pen':
                canvas.classList.add('cursor-pen');
                break;
            case 'highlighter':
                canvas.classList.add('cursor-highlighter');
                break;
            case 'eraser':
                if (this.currentTool === 'eraser-object') {
                    canvas.classList.add('cursor-eraser-object');
                } else {
                    canvas.classList.add('cursor-eraser-pixel');
                }
                break;
            case 'lasso':
                canvas.classList.add('cursor-lasso');
                break;
            case 'marquee':
                canvas.classList.add('cursor-marquee');
                break;
            case 'pan':
                canvas.classList.add('cursor-pan');
                break;
            case 'move':
                canvas.classList.add('cursor-move');
                break;
            case 'laser':
                canvas.classList.add('cursor-laser');
                break;
        }
    },

    /**
     * Set brush size
     */
    setSize(size) {
        this.brushSize = parseInt(size);
    },

    /**
     * Set brush color
     */
    setColor(color) {
        this.brushColor = color;
    },

    /**
     * Set shape snap enabled
     */
    setShapeSnap(enabled) {
        this.shapeSnapEnabled = enabled;
    },

    /**
     * Get coordinates from event (mouse or touch)
     */
    getCoords(e) {
        if (e.touches && e.touches.length > 0) {
            return {
                x: e.touches[0].clientX,
                y: e.touches[0].clientY
            };
        }
        return { x: e.clientX, y: e.clientY };
    },

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        const canvas = Canvas.drawCanvas;

        // Mouse events
        canvas.addEventListener('mousedown', (e) => this.handleStart(e));
        canvas.addEventListener('mousemove', (e) => this.handleMove(e));
        canvas.addEventListener('mouseup', (e) => this.handleEnd(e));
        canvas.addEventListener('mouseleave', (e) => this.handleEnd(e));

        // Touch events
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (e.touches.length === 2) {
                this.handlePinchStart(e);
            } else if (e.touches.length === 1 && !this.isPinching) {
                this.handleStart(e);
            }
        }, { passive: false });

        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (e.touches.length === 2) {
                this.handlePinchMove(e);
            } else if (e.touches.length === 1 && !this.isPinching) {
                this.handleMove(e);
            }
        }, { passive: false });

        canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            if (this.isPinching) {
                this.handlePinchEnd(e);
            } else {
                this.handleEnd(e);
            }
        }, { passive: false });

        canvas.addEventListener('touchcancel', (e) => {
            e.preventDefault();
            if (this.isPinching) {
                this.handlePinchEnd(e);
            } else {
                this.handleEnd(e);
            }
        }, { passive: false });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'z') {
                    e.preventDefault();
                    Canvas.undo();
                    UI.updateUndoRedoButtons();
                } else if (e.key === 'y') {
                    e.preventDefault();
                    Canvas.redo();
                    UI.updateUndoRedoButtons();
                }
            }

            // Delete selected strokes
            if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedStrokes.length > 0) {
                e.preventDefault();
                Canvas.deleteStrokes(this.selectedStrokes);
                this.clearSelection();
            }
        });
    },

    /**
     * Handle pointer start
     */
    handleStart(e) {
        const coords = this.getCoords(e);
        this.isDrawing = true;
        this.lastX = coords.x;
        this.lastY = coords.y;

        switch (this.currentTool) {
            case 'pencil':
                Canvas.startStroke('pencil', coords.x, coords.y, this.brushColor, this.brushSize);
                break;

            case 'pen':
                Canvas.startStroke('pen', coords.x, coords.y, this.brushColor, this.brushSize);
                break;

            case 'highlighter':
                Canvas.startStroke('highlighter', coords.x, coords.y, this.brushColor, this.brushSize * 3, 0.4);
                break;

            case 'eraser-pixel':
                Canvas.pixelErase(coords.x, coords.y, this.brushSize * 2);
                break;

            case 'eraser-object':
                const strokeIndex = Canvas.findStrokeAt(coords.x, coords.y);
                if (strokeIndex >= 0) {
                    Canvas.removeStroke(strokeIndex);
                    App.triggerAutoSave();
                }
                this.isDrawing = false;
                break;

            case 'lasso':
                const lassoStart = Canvas.toCanvas(coords.x, coords.y);
                this.lassoPoints = [lassoStart];
                this.clearSelection();
                break;

            case 'marquee':
                this.marqueeStart = Canvas.toCanvas(coords.x, coords.y);
                this.clearSelection();
                break;

            case 'pan':
                this.panStart = { x: coords.x, y: coords.y };
                Canvas.drawCanvas.classList.remove('cursor-pan');
                Canvas.drawCanvas.classList.add('cursor-pan-active');
                break;

            case 'move':
                if (this.selectedStrokes.length > 0) {
                    this.moveStart = { x: coords.x, y: coords.y };
                    Canvas.drawCanvas.classList.add('cursor-move-active');
                } else {
                    this.isDrawing = false;
                }
                break;

            case 'laser-plain':
                this.showLaser(coords.x, coords.y);
                break;

            case 'laser-trail':
                this.laserTrail = [{ x: coords.x, y: coords.y, time: Date.now() }];
                this.showLaser(coords.x, coords.y);
                this.startLaserTrailAnimation();
                break;
        }
    },

    /**
     * Handle pointer move
     */
    handleMove(e) {
        const coords = this.getCoords(e);

        if (!this.isDrawing) {
            if (this.currentTool === 'laser-plain' || this.currentTool === 'laser-trail') {
                this.showLaser(coords.x, coords.y);
                if (this.currentTool === 'laser-trail') {
                    this.laserTrail.push({ x: coords.x, y: coords.y, time: Date.now() });
                }
            }
            return;
        }

        switch (this.currentTool) {
            case 'pencil':
            case 'pen':
            case 'highlighter':
                Canvas.addPoint(coords.x, coords.y);
                break;

            case 'eraser-pixel':
                Canvas.pixelErase(coords.x, coords.y, this.brushSize * 2);
                break;

            case 'lasso':
                const lassoPoint = Canvas.toCanvas(coords.x, coords.y);
                this.lassoPoints.push(lassoPoint);
                this.drawLassoPreview();
                break;

            case 'marquee':
                const marqueePoint = Canvas.toCanvas(coords.x, coords.y);
                this.drawMarqueePreview(marqueePoint.x, marqueePoint.y);
                break;

            case 'pan':
                const dx = coords.x - this.panStart.x;
                const dy = coords.y - this.panStart.y;
                Canvas.pan(dx, dy);
                this.panStart = { x: coords.x, y: coords.y };
                break;

            case 'move':
                if (this.moveStart && this.selectedStrokes.length > 0) {
                    const mdx = coords.x - this.moveStart.x;
                    const mdy = coords.y - this.moveStart.y;
                    Canvas.moveStrokes(this.selectedStrokes, mdx, mdy);
                    this.moveStart = { x: coords.x, y: coords.y };
                    this.highlightSelection();
                }
                break;

            case 'laser-plain':
                this.showLaser(coords.x, coords.y);
                break;

            case 'laser-trail':
                this.laserTrail.push({ x: coords.x, y: coords.y, time: Date.now() });
                this.showLaser(coords.x, coords.y);
                break;
        }

        this.lastX = coords.x;
        this.lastY = coords.y;
    },

    /**
     * Handle pointer end
     */
    handleEnd(e) {
        if (!this.isDrawing) return;
        this.isDrawing = false;

        switch (this.currentTool) {
            case 'pencil':
            case 'pen':
            case 'highlighter':
                // Apply shape snapping if enabled
                if (this.shapeSnapEnabled && Canvas.currentStroke) {
                    const snappedStroke = this.snapToShape(Canvas.currentStroke);
                    if (snappedStroke) {
                        Canvas.currentStroke = snappedStroke;
                    }
                }
                if (Canvas.endStroke()) {
                    App.triggerAutoSave();
                }
                break;

            case 'eraser-pixel':
                App.triggerAutoSave();
                break;

            case 'lasso':
                if (this.lassoPoints.length > 2) {
                    this.selectedStrokes = Canvas.findStrokesInPolygon(this.lassoPoints);
                    this.highlightSelection();
                }
                this.removeSelectionOverlay();
                this.lassoPoints = [];
                break;

            case 'marquee':
                if (this.marqueeStart) {
                    const endPoint = Canvas.toCanvas(this.lastX, this.lastY);
                    const rect = this.getMarqueeRect(endPoint.x, endPoint.y);
                    this.selectedStrokes = Canvas.findStrokesInRect(rect);
                    this.highlightSelection();
                }
                this.removeSelectionOverlay();
                this.marqueeStart = null;
                break;

            case 'pan':
                Canvas.drawCanvas.classList.remove('cursor-pan-active');
                Canvas.drawCanvas.classList.add('cursor-pan');
                this.panStart = null;
                break;

            case 'move':
                Canvas.drawCanvas.classList.remove('cursor-move-active');
                this.moveStart = null;
                if (this.selectedStrokes.length > 0) {
                    App.triggerAutoSave();
                }
                break;

            case 'laser-plain':
                this.hideLaser();
                break;

            case 'laser-trail':
                // Trail fades out naturally via animation
                break;
        }
    },

    /**
     * Snap stroke to detected shape
     */
    snapToShape(stroke) {
        if (!stroke || !stroke.points || stroke.points.length < 3) return null;

        const points = stroke.points;
        const firstPoint = points[0];
        const lastPoint = points[points.length - 1];

        // Calculate bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of points) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        }

        const width = maxX - minX;
        const height = maxY - minY;
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        // Check if stroke is closed (endpoints close together)
        const closedThreshold = Math.max(width, height) * 0.15;
        const isClosed = Math.hypot(lastPoint.x - firstPoint.x, lastPoint.y - firstPoint.y) < closedThreshold;

        // Calculate path length and average deviation from line
        let pathLength = 0;
        for (let i = 1; i < points.length; i++) {
            pathLength += Math.hypot(points[i].x - points[i-1].x, points[i].y - points[i-1].y);
        }

        // Detect LINE
        const directDist = Math.hypot(lastPoint.x - firstPoint.x, lastPoint.y - firstPoint.y);
        if (!isClosed && pathLength < directDist * 1.2 && pathLength > 20) {
            // It's a line
            return {
                ...stroke,
                points: [firstPoint, lastPoint]
            };
        }

        if (isClosed) {
            // Calculate circularity
            const avgRadius = points.reduce((sum, p) =>
                sum + Math.hypot(p.x - centerX, p.y - centerY), 0) / points.length;
            const radiusVariance = points.reduce((sum, p) => {
                const r = Math.hypot(p.x - centerX, p.y - centerY);
                return sum + Math.pow(r - avgRadius, 2);
            }, 0) / points.length;
            const circularity = 1 - Math.sqrt(radiusVariance) / avgRadius;

            // Detect CIRCLE/ELLIPSE
            if (circularity > 0.85) {
                const radius = avgRadius;
                const circlePoints = [];
                const segments = 36;
                for (let i = 0; i <= segments; i++) {
                    const angle = (i / segments) * Math.PI * 2;
                    circlePoints.push({
                        x: centerX + Math.cos(angle) * (width / 2),
                        y: centerY + Math.sin(angle) * (height / 2)
                    });
                }
                return {
                    ...stroke,
                    points: circlePoints
                };
            }

            // Detect RECTANGLE
            const aspectRatio = width / height;
            if (aspectRatio > 0.5 && aspectRatio < 2) {
                // Check if points cluster around corners
                const corners = [
                    { x: minX, y: minY },
                    { x: maxX, y: minY },
                    { x: maxX, y: maxY },
                    { x: minX, y: maxY }
                ];

                // Check if stroke follows edges
                let edgeDeviation = 0;
                for (const p of points) {
                    const distToLeft = Math.abs(p.x - minX);
                    const distToRight = Math.abs(p.x - maxX);
                    const distToTop = Math.abs(p.y - minY);
                    const distToBottom = Math.abs(p.y - maxY);
                    const minEdgeDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);
                    edgeDeviation += minEdgeDist;
                }
                edgeDeviation /= points.length;

                if (edgeDeviation < Math.max(width, height) * 0.15) {
                    return {
                        ...stroke,
                        points: [...corners, corners[0]]
                    };
                }
            }

            // Detect TRIANGLE
            const triangleCorners = this.detectTriangle(points, minX, minY, maxX, maxY);
            if (triangleCorners) {
                return {
                    ...stroke,
                    points: [...triangleCorners, triangleCorners[0]]
                };
            }
        }

        return null;
    },

    /**
     * Detect triangle shape
     */
    detectTriangle(points, minX, minY, maxX, maxY) {
        // Find 3 most extreme points that could form corners
        const width = maxX - minX;
        const height = maxY - minY;

        if (width < 20 || height < 20) return null;

        // Sample points and find candidates for corners
        const corners = [];
        const samplePoints = points.filter((_, i) => i % 3 === 0);

        // Find topmost, leftmost bottom, rightmost bottom for upward triangle
        let top = { x: 0, y: Infinity };
        let bottomLeft = { x: Infinity, y: -Infinity };
        let bottomRight = { x: -Infinity, y: -Infinity };

        for (const p of samplePoints) {
            if (p.y < top.y) top = p;
            if (p.y > bottomLeft.y - height * 0.1 && p.x < bottomLeft.x) bottomLeft = p;
            if (p.y > bottomRight.y - height * 0.1 && p.x > bottomRight.x) bottomRight = p;
        }

        // Check if these form a reasonable triangle
        const area = Math.abs((bottomRight.x - top.x) * (bottomLeft.y - top.y) -
                            (bottomLeft.x - top.x) * (bottomRight.y - top.y)) / 2;
        const expectedArea = width * height / 2;

        if (area > expectedArea * 0.4 && area < expectedArea * 1.5) {
            return [top, bottomRight, bottomLeft];
        }

        return null;
    },

    /**
     * Draw lasso selection preview
     */
    drawLassoPreview() {
        this.removeSelectionOverlay();

        if (this.lassoPoints.length < 2) return;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10';

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const firstScreen = Canvas.toScreen(this.lassoPoints[0].x, this.lassoPoints[0].y);
        let d = `M ${firstScreen.x} ${firstScreen.y}`;
        for (let i = 1; i < this.lassoPoints.length; i++) {
            const screen = Canvas.toScreen(this.lassoPoints[i].x, this.lassoPoints[i].y);
            d += ` L ${screen.x} ${screen.y}`;
        }

        path.setAttribute('d', d);
        path.setAttribute('fill', 'rgba(0, 102, 204, 0.1)');
        path.setAttribute('stroke', '#0066cc');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('stroke-dasharray', '5,5');

        svg.appendChild(path);
        document.getElementById('app').appendChild(svg);
        this.selectionOverlay = svg;
    },

    /**
     * Draw marquee selection preview
     */
    drawMarqueePreview(currentX, currentY) {
        this.removeSelectionOverlay();

        const rect = this.getMarqueeRect(currentX, currentY);
        const topLeft = Canvas.toScreen(rect.x, rect.y);

        const div = document.createElement('div');
        div.className = 'selection-overlay';
        div.style.left = topLeft.x + 'px';
        div.style.top = topLeft.y + 'px';
        div.style.width = (rect.width * Canvas.scale) + 'px';
        div.style.height = (rect.height * Canvas.scale) + 'px';

        document.getElementById('app').appendChild(div);
        this.selectionOverlay = div;
    },

    /**
     * Get marquee rectangle
     */
    getMarqueeRect(currentX, currentY) {
        const x = Math.min(this.marqueeStart.x, currentX);
        const y = Math.min(this.marqueeStart.y, currentY);
        const width = Math.abs(currentX - this.marqueeStart.x);
        const height = Math.abs(currentY - this.marqueeStart.y);
        return { x, y, width, height };
    },

    /**
     * Remove selection overlay
     */
    removeSelectionOverlay() {
        if (this.selectionOverlay) {
            this.selectionOverlay.remove();
            this.selectionOverlay = null;
        }
    },

    /**
     * Highlight selected strokes
     */
    highlightSelection() {
        Canvas.redraw();

        if (this.selectedStrokes.length === 0) return;

        const ctx = Canvas.drawCtx;
        ctx.save();
        ctx.strokeStyle = '#0066cc';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);

        for (const index of this.selectedStrokes) {
            const stroke = Canvas.strokes[index];
            if (!stroke) continue;

            // Calculate bounding box
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;

            for (const point of stroke.points) {
                minX = Math.min(minX, point.x);
                minY = Math.min(minY, point.y);
                maxX = Math.max(maxX, point.x);
                maxY = Math.max(maxY, point.y);
            }

            const padding = stroke.size / 2 + 5;
            const topLeft = Canvas.toScreen(minX - padding, minY - padding);
            const scaledWidth = (maxX - minX + padding * 2) * Canvas.scale;
            const scaledHeight = (maxY - minY + padding * 2) * Canvas.scale;

            ctx.strokeRect(topLeft.x, topLeft.y, scaledWidth, scaledHeight);
        }

        ctx.restore();
    },

    /**
     * Clear selection
     */
    clearSelection() {
        this.selectedStrokes = [];
        this.removeSelectionOverlay();
        Canvas.redraw();
    },

    /**
     * Show laser pointer
     */
    showLaser(x, y) {
        const laser = document.getElementById('laser-pointer');
        laser.classList.remove('hidden');
        laser.style.left = x + 'px';
        laser.style.top = y + 'px';

        // Auto-hide after inactivity (only for plain laser)
        if (this.currentTool === 'laser-plain') {
            if (this.laserTimeout) {
                clearTimeout(this.laserTimeout);
            }
            this.laserTimeout = setTimeout(() => this.hideLaser(), 3000);
        }
    },

    /**
     * Hide laser pointer
     */
    hideLaser() {
        const laser = document.getElementById('laser-pointer');
        laser.classList.add('hidden');

        if (this.laserTimeout) {
            clearTimeout(this.laserTimeout);
            this.laserTimeout = null;
        }
    },

    /**
     * Start laser trail animation
     */
    startLaserTrailAnimation() {
        const trailCanvas = document.getElementById('laser-trail-canvas');
        if (!trailCanvas) {
            const canvas = document.createElement('canvas');
            canvas.id = 'laser-trail-canvas';
            canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:49';
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            document.getElementById('app').appendChild(canvas);
        }

        const animate = () => {
            const canvas = document.getElementById('laser-trail-canvas');
            if (!canvas) return;

            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const now = Date.now();
            const fadeTime = 1500; // 1.5 seconds fade

            // Remove old points
            this.laserTrail = this.laserTrail.filter(p => now - p.time < fadeTime);

            if (this.laserTrail.length > 1) {
                for (let i = 1; i < this.laserTrail.length; i++) {
                    const p1 = this.laserTrail[i - 1];
                    const p2 = this.laserTrail[i];
                    const age = now - p2.time;
                    const alpha = 1 - (age / fadeTime);

                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(255, 0, 0, ${alpha})`;
                    ctx.lineWidth = 3;
                    ctx.lineCap = 'round';
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                }
            }

            if (this.laserTrail.length > 0 || this.currentTool === 'laser-trail') {
                requestAnimationFrame(animate);
            } else {
                canvas.remove();
            }
        };

        requestAnimationFrame(animate);
    },

    /**
     * Get distance between two touch points
     */
    getPinchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.hypot(dx, dy);
    },

    /**
     * Get center point between two touches
     */
    getPinchCenter(touches) {
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2
        };
    },

    /**
     * Handle pinch start
     */
    handlePinchStart(e) {
        // Cancel any ongoing drawing
        if (this.isDrawing) {
            this.isDrawing = false;
            Canvas.currentStroke = null;
        }

        this.isPinching = true;
        this.initialPinchDistance = this.getPinchDistance(e.touches);
        this.initialScale = Canvas.scale;
        this.pinchCenter = this.getPinchCenter(e.touches);
    },

    /**
     * Handle pinch move (zoom)
     */
    handlePinchMove(e) {
        if (!this.isPinching || e.touches.length !== 2) return;

        const currentDistance = this.getPinchDistance(e.touches);
        const currentCenter = this.getPinchCenter(e.touches);

        // Calculate scale change
        const scaleChange = currentDistance / this.initialPinchDistance;
        const newScale = Math.max(0.25, Math.min(4, this.initialScale * scaleChange));

        // Calculate pan to keep pinch center stationary
        const dx = currentCenter.x - this.pinchCenter.x;
        const dy = currentCenter.y - this.pinchCenter.y;

        Canvas.setScale(newScale, this.pinchCenter.x, this.pinchCenter.y);
        Canvas.pan(dx, dy);

        this.pinchCenter = currentCenter;
    },

    /**
     * Handle pinch end
     */
    handlePinchEnd(e) {
        this.isPinching = false;
        this.initialPinchDistance = 0;
    },

    /**
     * Get current tool settings
     */
    getSettings() {
        return {
            tool: this.currentTool,
            size: this.brushSize,
            color: this.brushColor,
            shapeSnap: this.shapeSnapEnabled,
            toolDefaults: this.toolDefaults
        };
    },

    /**
     * Load tool settings
     */
    loadSettings(settings) {
        if (settings) {
            this.currentTool = settings.tool || 'pencil';
            this.brushSize = settings.size || 3;
            this.brushColor = settings.color || '#000000';
            this.shapeSnapEnabled = settings.shapeSnap || false;
            if (settings.toolDefaults) {
                this.toolDefaults = { ...this.toolDefaults, ...settings.toolDefaults };
            }
            this.updateCursor();
        }
    }
};
