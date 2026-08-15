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
        laser: 'laser-plain',
        shape: 'shape-rect'
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

    // Shape drawing state
    shapeStart: null,
    shiftHeld: false,

    // Text tool state
    textInputActive: false,
    textCanvasPoint: null,

    // Resize state
    resizingHandle: null, // which handle is being dragged
    resizeAnchor: null,   // opposite corner anchor point (canvas coords)
    resizeStartMouse: null,
    resizeOriginalBounds: null,

    // Right-click pan state
    isRightClickPanning: false,
    rightClickPanStart: null,

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
        } else if (tool === 'shape') {
            tool = this.toolDefaults.shape;
        }

        // Update defaults when subtool is selected
        if (tool === 'eraser-pixel' || tool === 'eraser-object') {
            this.toolDefaults.eraser = tool;
        } else if (tool === 'laser-plain' || tool === 'laser-trail') {
            this.toolDefaults.laser = tool;
        } else if (tool.startsWith('shape-')) {
            this.toolDefaults.shape = tool;
        }

        // Hide laser when switching away from laser tools
        if (this.currentTool !== tool) {
            this.hideLaser();
        }

        this.currentTool = tool;
        if (tool !== 'move') {
            this.clearSelection();
        }
        if (this.textInputActive) {
            this.commitTextInput();
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
            case 'text':
                canvas.classList.add('cursor-text');
                break;
            case 'shape':
                canvas.classList.add('cursor-crosshair');
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
        canvas.addEventListener('mouseleave', (e) => {
            // Hide the laser dot when the mouse leaves the canvas, regardless
            // of whether a drag was in progress.
            if (this.currentTool === 'laser-plain' || this.currentTool === 'laser-trail') {
                this.hideLaser();
            }
            this.handleEnd(e);
        });

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

        // Mouse wheel zoom
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
            const newScale = Canvas.scale * zoomFactor;
            Canvas.setScale(newScale, e.clientX, e.clientY);
        }, { passive: false });

        // Right-click pan
        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        canvas.addEventListener('mousedown', (e) => {
            if (e.button === 2) {
                e.preventDefault();
                this.isRightClickPanning = true;
                this.rightClickPanStart = { x: e.clientX, y: e.clientY };
                canvas.classList.add('cursor-panning');
            }
        });

        canvas.addEventListener('mousemove', (e) => {
            if (this.isRightClickPanning && this.rightClickPanStart) {
                const dx = e.clientX - this.rightClickPanStart.x;
                const dy = e.clientY - this.rightClickPanStart.y;
                Canvas.pan(dx, dy);
                this.rightClickPanStart = { x: e.clientX, y: e.clientY };
            }
        });

        canvas.addEventListener('mouseup', (e) => {
            if (e.button === 2 && this.isRightClickPanning) {
                this.isRightClickPanning = false;
                this.rightClickPanStart = null;
                canvas.classList.remove('cursor-panning');
            }
        });

        // Track shift key for constrained shapes
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Shift') {
                this.shiftHeld = true;
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.key === 'Shift') {
                this.shiftHeld = false;
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Never steal keys from a field the user is typing into.
            if (this.isTypingTarget(e)) return;

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

        // Clipboard paste for images
        document.addEventListener('paste', (e) => {
            this.handlePaste(e);
        });
    },

    /**
     * True when an event originated from a field the user is typing into.
     * Canvas shortcuts (undo, delete selection) must not fire in that case.
     */
    isTypingTarget(e) {
        const target = e && e.target;
        if (!target) return false;
        if (target.isContentEditable === true) return true;
        const tag = target.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    },

    /**
     * Handle paste event - insert image from clipboard onto canvas
     */
    handlePaste(e) {
        // Never hijack a paste into a text field.
        if (this.isTypingTarget(e)) return;

        const data = e.clipboardData;
        if (!data) return;

        const items = data.items;
        if (!items) {
            this.pasteYouTubeLink(e);
            return;
        }

        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const blob = item.getAsFile();
                if (!blob) continue;

                const reader = new FileReader();
                reader.onload = (event) => {
                    const dataURL = event.target.result;
                    const img = new Image();
                    img.onload = () => {
                        Canvas.addImageStroke(dataURL, img.naturalWidth, img.naturalHeight);
                        UI.updateUndoRedoButtons();
                        App.triggerAutoSave();
                    };
                    img.src = dataURL;
                };
                reader.readAsDataURL(blob);
                return; // Only handle the first image
            }
        }

        // No image in the clipboard - a YouTube link is the next best thing.
        this.pasteYouTubeLink(e);
    },

    /**
     * Embed a YouTube link pasted onto the canvas
     */
    pasteYouTubeLink(e) {
        if (typeof Video === 'undefined') return false;

        const text = e.clipboardData && typeof e.clipboardData.getData === 'function'
            ? e.clipboardData.getData('text')
            : '';
        if (!text || !Video.parseVideoId(text)) return false;

        e.preventDefault();
        Video.embed(text);
        UI.updateUndoRedoButtons();
        App.triggerAutoSave();
        return true;
    },

    /**
     * Handle pointer start
     */
    handleStart(e) {
        // Only the primary button draws. Right-click is reserved for panning
        // and middle-click for the browser, and both share this listener.
        // Touch events carry no button, so an undefined one is primary.
        if (e.button !== undefined && e.button !== 0) return;

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
                Canvas.startStroke('eraser', coords.x, coords.y, '#000000', this.brushSize * 2);
                break;

            case 'eraser-object':
                this.eraseObjectAt(coords.x, coords.y);
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
                    // Check if clicking on a resize handle
                    const handleId = this.hitTestResizeHandle(coords.x, coords.y);
                    if (handleId) {
                        const bounds = this.getSelectionBounds();
                        this.resizingHandle = handleId;
                        this.resizeAnchor = this.getResizeAnchor(handleId, bounds);
                        this.resizeOriginalBounds = { ...bounds };
                        this.resizeStartMouse = Canvas.toCanvas(coords.x, coords.y);
                        // Save original stroke data for undo
                        this._resizeOriginalStrokes = this.selectedStrokes.map(i => JSON.parse(JSON.stringify(Canvas.strokes[i])));
                    } else {
                        this.moveStart = { x: coords.x, y: coords.y };
                        Canvas.drawCanvas.classList.add('cursor-move-active');
                    }
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

            case 'text':
                // Prevent the browser's default mousedown focus behavior from
                // stealing focus away from the textarea after we open it.
                if (e && e.preventDefault) e.preventDefault();
                this.showTextInput(coords.x, coords.y);
                this.isDrawing = false;
                break;

            case 'shape-line':
            case 'shape-rect':
            case 'shape-circle':
            case 'shape-triangle':
                this.shapeStart = Canvas.toCanvas(coords.x, coords.y);
                break;
        }
    },

    /**
     * Handle pointer move
     */
    handleMove(e) {
        // A right-click drag pans; it must not also feed the active tool.
        if (this.isRightClickPanning) return;

        const coords = this.getCoords(e);

        if (!this.isDrawing) {
            // Show laser pointer on hover for both laser tools so the user
            // always has a visible cursor (the CSS hides the OS cursor for laser).
            if (this.currentTool === 'laser-plain' || this.currentTool === 'laser-trail') {
                this.showLaser(coords.x, coords.y);
            }
            // Show resize cursor when hovering over handles
            if (this.currentTool === 'move' && this.selectedStrokes.length > 0) {
                const handle = this.hitTestResizeHandle(coords.x, coords.y);
                const canvas = Canvas.drawCanvas;
                canvas.className = '';
                if (handle) {
                    const cursorMap = {
                        'nw': 'cursor-resize-nwse', 'se': 'cursor-resize-nwse',
                        'ne': 'cursor-resize-nesw', 'sw': 'cursor-resize-nesw',
                        'n': 'cursor-resize-ns', 's': 'cursor-resize-ns',
                        'e': 'cursor-resize-ew', 'w': 'cursor-resize-ew'
                    };
                    canvas.classList.add(cursorMap[handle]);
                } else {
                    canvas.classList.add('cursor-move');
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
                Canvas.addPoint(coords.x, coords.y);
                break;

            case 'eraser-object':
                this.eraseObjectAt(coords.x, coords.y);
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
                if (this.resizingHandle && this.selectedStrokes.length > 0) {
                    const currentCanvas = Canvas.toCanvas(coords.x, coords.y);
                    const ob = this.resizeOriginalBounds;
                    const anchor = this.resizeAnchor;
                    const handle = this.resizingHandle;

                    // Restore original strokes before applying new scale
                    for (let si = 0; si < this.selectedStrokes.length; si++) {
                        const idx = this.selectedStrokes[si];
                        Canvas.strokes[idx] = JSON.parse(JSON.stringify(this._resizeOriginalStrokes[si]));
                    }

                    // Compute scale factor based on handle type
                    let scaleX = 1, scaleY = 1;
                    const origW = ob.maxX - ob.minX;
                    const origH = ob.maxY - ob.minY;

                    if (handle === 'n' || handle === 's') {
                        // Vertical only
                        const newDistY = Math.abs(currentCanvas.y - anchor.y);
                        scaleY = origH > 0 ? newDistY / origH : 1;
                        scaleX = 1;
                    } else if (handle === 'e' || handle === 'w') {
                        // Horizontal only
                        const newDistX = Math.abs(currentCanvas.x - anchor.x);
                        scaleX = origW > 0 ? newDistX / origW : 1;
                        scaleY = 1;
                    } else {
                        // Corner handles - proportional
                        const newDistX = Math.abs(currentCanvas.x - anchor.x);
                        const newDistY = Math.abs(currentCanvas.y - anchor.y);
                        scaleX = origW > 0 ? newDistX / origW : 1;
                        scaleY = origH > 0 ? newDistY / origH : 1;
                        // Use uniform scale for corners
                        const uniformScale = Math.max(scaleX, scaleY);
                        scaleX = uniformScale;
                        scaleY = uniformScale;
                    }

                    scaleX = Math.max(0.05, scaleX);
                    scaleY = Math.max(0.05, scaleY);

                    Canvas.resizeStrokes(this.selectedStrokes, anchor.x, anchor.y, scaleX, scaleY);
                    this.highlightSelection();
                } else if (this.moveStart && this.selectedStrokes.length > 0) {
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

            case 'shape-line':
            case 'shape-rect':
            case 'shape-circle':
            case 'shape-triangle':
                if (this.shapeStart) {
                    this.drawShapePreview(coords.x, coords.y);
                }
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
                if (Canvas.endStroke()) {
                    App.triggerAutoSave();
                }
                break;

            case 'eraser-object':
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
                if (this.resizingHandle) {
                    // Push undo entry for the resize
                    Canvas.undoStack.push({
                        action: 'resize',
                        indices: [...this.selectedStrokes],
                        originalStrokes: this._resizeOriginalStrokes
                    });
                    Canvas.redoStack = [];
                    this.resizingHandle = null;
                    this.resizeAnchor = null;
                    this.resizeOriginalBounds = null;
                    this.resizeStartMouse = null;
                    this._resizeOriginalStrokes = null;
                    App.triggerAutoSave();
                }
                this.moveStart = null;
                if (this.selectedStrokes.length > 0) {
                    App.triggerAutoSave();
                }
                break;

            case 'laser-plain':
                this.hideLaser();
                break;

            case 'laser-trail':
                // Hide laser pointer, trail fades out via animation
                this.hideLaser();
                break;

            case 'shape-line':
            case 'shape-rect':
            case 'shape-circle':
            case 'shape-triangle':
                if (this.shapeStart) {
                    this.finalizeShape(this.lastX, this.lastY);
                    this.shapeStart = null;
                }
                break;
        }
    },

    /**
     * Snap stroke to detected shape (lines and circles only)
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

        // Calculate path length
        let pathLength = 0;
        for (let i = 1; i < points.length; i++) {
            pathLength += Math.hypot(points[i].x - points[i-1].x, points[i].y - points[i-1].y);
        }

        // Detect LINE
        const directDist = Math.hypot(lastPoint.x - firstPoint.x, lastPoint.y - firstPoint.y);
        if (!isClosed && pathLength < directDist * 1.2 && pathLength > 20) {
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

            // Detect CIRCLE/ELLIPSE (high circularity)
            if (circularity > 0.85) {
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

            // Detect RECTANGLE - check if points follow edges
            // Calculate how close points are to the bounding box edges
            let edgeScore = 0;
            let cornerScore = 0;
            const edgeThreshold = Math.max(width, height) * 0.12;

            for (const p of points) {
                const distToLeft = Math.abs(p.x - minX);
                const distToRight = Math.abs(p.x - maxX);
                const distToTop = Math.abs(p.y - minY);
                const distToBottom = Math.abs(p.y - maxY);

                // Point is near an edge if close to one of the four sides
                const nearVerticalEdge = Math.min(distToLeft, distToRight) < edgeThreshold;
                const nearHorizontalEdge = Math.min(distToTop, distToBottom) < edgeThreshold;

                if (nearVerticalEdge || nearHorizontalEdge) {
                    edgeScore++;
                }

                // Check if near a corner
                const nearCorner = (distToLeft < edgeThreshold || distToRight < edgeThreshold) &&
                                   (distToTop < edgeThreshold || distToBottom < edgeThreshold);
                if (nearCorner) {
                    cornerScore++;
                }
            }

            const edgeRatio = edgeScore / points.length;
            const hasEnoughCorners = cornerScore >= 4;

            // If most points are near edges, it's likely a rectangle
            if (edgeRatio > 0.75 && hasEnoughCorners) {
                const corners = [
                    { x: minX, y: minY },
                    { x: maxX, y: minY },
                    { x: maxX, y: maxY },
                    { x: minX, y: maxY },
                    { x: minX, y: minY }
                ];
                return {
                    ...stroke,
                    points: corners
                };
            }
        }

        return null;
    },

    /**
     * Generate shape points based on type and bounds
     * If shift is held, constrain proportions
     */
    generateShapePoints(shapeType, start, end) {
        let endX = end.x;
        let endY = end.y;

        // Constrain proportions if shift is held
        if (this.shiftHeld) {
            const dx = end.x - start.x;
            const dy = end.y - start.y;

            if (shapeType === 'shape-line') {
                // Snap to 45-degree angles
                const absDx = Math.abs(dx);
                const absDy = Math.abs(dy);
                const maxD = Math.max(absDx, absDy);

                if (absDx > absDy * 2) {
                    // Horizontal line
                    endY = start.y;
                } else if (absDy > absDx * 2) {
                    // Vertical line
                    endX = start.x;
                } else {
                    // 45-degree diagonal
                    const sign = (dx * dy >= 0) ? 1 : -1;
                    endX = start.x + maxD * Math.sign(dx);
                    endY = start.y + maxD * Math.sign(dy);
                }
            } else {
                // Square/circle constraint - use larger dimension
                const size = Math.max(Math.abs(dx), Math.abs(dy));
                endX = start.x + size * Math.sign(dx || 1);
                endY = start.y + size * Math.sign(dy || 1);
            }
        }

        const minX = Math.min(start.x, endX);
        const maxX = Math.max(start.x, endX);
        const minY = Math.min(start.y, endY);
        const maxY = Math.max(start.y, endY);
        const width = maxX - minX;
        const height = maxY - minY;
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        switch (shapeType) {
            case 'shape-line':
                return [start, { x: endX, y: endY }];

            case 'shape-rect':
                return [
                    { x: minX, y: minY },
                    { x: maxX, y: minY },
                    { x: maxX, y: maxY },
                    { x: minX, y: maxY },
                    { x: minX, y: minY }
                ];

            case 'shape-circle':
                const points = [];
                const segments = 36;
                for (let i = 0; i <= segments; i++) {
                    const angle = (i / segments) * Math.PI * 2;
                    points.push({
                        x: centerX + Math.cos(angle) * (width / 2),
                        y: centerY + Math.sin(angle) * (height / 2)
                    });
                }
                return points;

            case 'shape-triangle':
                return [
                    { x: centerX, y: minY },
                    { x: maxX, y: maxY },
                    { x: minX, y: maxY },
                    { x: centerX, y: minY }
                ];

            default:
                return [];
        }
    },

    /**
     * Draw shape preview while dragging
     */
    drawShapePreview(x, y) {
        const end = Canvas.toCanvas(x, y);
        const points = this.generateShapePoints(this.currentTool, this.shapeStart, end);

        if (points.length < 2) return;

        Canvas.redraw();

        const ctx = Canvas.drawCtx;
        ctx.save();
        ctx.strokeStyle = this.brushColor;
        ctx.lineWidth = this.brushSize * Canvas.scale;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([5, 5]);

        ctx.beginPath();
        const first = Canvas.toScreen(points[0].x, points[0].y);
        ctx.moveTo(first.x, first.y);

        for (let i = 1; i < points.length; i++) {
            const p = Canvas.toScreen(points[i].x, points[i].y);
            ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.restore();
    },

    /**
     * Finalize shape and add as stroke
     */
    finalizeShape(x, y) {
        const end = Canvas.toCanvas(x, y);
        const points = this.generateShapePoints(this.currentTool, this.shapeStart, end);

        if (points.length < 2) return;

        // Minimum size check
        const dx = Math.abs(end.x - this.shapeStart.x);
        const dy = Math.abs(end.y - this.shapeStart.y);
        if (dx < 5 && dy < 5) return;

        const stroke = {
            type: 'shape',
            points: points,
            color: this.brushColor,
            size: this.brushSize,
            opacity: 1
        };

        Canvas.strokes.push(stroke);
        Canvas.undoStack.push({ action: 'add', stroke: stroke });
        Canvas.redoStack = [];
        Canvas.redraw();
        App.triggerAutoSave();
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
     * Get the combined bounding box of selected strokes (canvas coords)
     */
    getSelectionBounds() {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (const index of this.selectedStrokes) {
            const stroke = Canvas.strokes[index];
            if (!stroke) continue;
            const b = Canvas.getStrokeBounds(stroke);
            if (!b) continue;

            let padding = 0;
            if (!Canvas.isBoxStroke(stroke) && stroke.type !== 'text' && stroke.size) {
                padding = stroke.size / 2;
            }
            minX = Math.min(minX, b.minX - padding);
            minY = Math.min(minY, b.minY - padding);
            maxX = Math.max(maxX, b.maxX + padding);
            maxY = Math.max(maxY, b.maxY + padding);
        }

        if (!isFinite(minX)) return null;
        return { minX, minY, maxX, maxY };
    },

    /**
     * Highlight selected strokes and draw resize handles
     */
    highlightSelection() {
        Canvas.redraw();

        if (this.selectedStrokes.length === 0) return;

        const bounds = this.getSelectionBounds();
        if (!bounds) return;

        const ctx = Canvas.drawCtx;
        ctx.save();

        // Draw bounding box
        const topLeft = Canvas.toScreen(bounds.minX, bounds.minY);
        const bottomRight = Canvas.toScreen(bounds.maxX, bounds.maxY);
        const w = bottomRight.x - topLeft.x;
        const h = bottomRight.y - topLeft.y;

        ctx.strokeStyle = '#0066cc';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(topLeft.x, topLeft.y, w, h);
        ctx.setLineDash([]);

        // Draw 8 resize handles
        const handleSize = 8;
        const handles = this.getResizeHandlePositions(topLeft.x, topLeft.y, w, h);
        ctx.fillStyle = '#0066cc';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;

        for (const handle of handles) {
            ctx.fillRect(handle.x - handleSize / 2, handle.y - handleSize / 2, handleSize, handleSize);
            ctx.strokeRect(handle.x - handleSize / 2, handle.y - handleSize / 2, handleSize, handleSize);
        }

        ctx.restore();
    },

    /**
     * Get positions of 8 resize handles (screen coords)
     */
    getResizeHandlePositions(x, y, w, h) {
        return [
            { x: x,         y: y,         id: 'nw' },
            { x: x + w / 2, y: y,         id: 'n'  },
            { x: x + w,     y: y,         id: 'ne' },
            { x: x + w,     y: y + h / 2, id: 'e'  },
            { x: x + w,     y: y + h,     id: 'se' },
            { x: x + w / 2, y: y + h,     id: 's'  },
            { x: x,         y: y + h,     id: 'sw' },
            { x: x,         y: y + h / 2, id: 'w'  },
        ];
    },

    /**
     * Check if a screen point hits a resize handle. Returns handle id or null.
     */
    hitTestResizeHandle(screenX, screenY) {
        if (this.selectedStrokes.length === 0) return null;

        const bounds = this.getSelectionBounds();
        if (!bounds) return null;

        const topLeft = Canvas.toScreen(bounds.minX, bounds.minY);
        const bottomRight = Canvas.toScreen(bounds.maxX, bounds.maxY);
        const w = bottomRight.x - topLeft.x;
        const h = bottomRight.y - topLeft.y;
        const handles = this.getResizeHandlePositions(topLeft.x, topLeft.y, w, h);

        const threshold = 8;
        for (const handle of handles) {
            if (Math.abs(screenX - handle.x) <= threshold && Math.abs(screenY - handle.y) <= threshold) {
                return handle.id;
            }
        }
        return null;
    },

    /**
     * Get the anchor point (opposite corner) for a given handle
     */
    getResizeAnchor(handleId, bounds) {
        switch (handleId) {
            case 'nw': return { x: bounds.maxX, y: bounds.maxY };
            case 'n':  return { x: (bounds.minX + bounds.maxX) / 2, y: bounds.maxY };
            case 'ne': return { x: bounds.minX, y: bounds.maxY };
            case 'e':  return { x: bounds.minX, y: (bounds.minY + bounds.maxY) / 2 };
            case 'se': return { x: bounds.minX, y: bounds.minY };
            case 's':  return { x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY };
            case 'sw': return { x: bounds.maxX, y: bounds.minY };
            case 'w':  return { x: bounds.maxX, y: (bounds.minY + bounds.maxY) / 2 };
        }
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
            const fadeTime = 600; // shorter fade so the trail doesn't stretch across the canvas

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
     * Show text input overlay at click position
     */
    showTextInput(screenX, screenY) {
        if (this.textInputActive) {
            this.commitTextInput();
        }

        const overlay = document.getElementById('text-input-overlay');
        const canvasPoint = Canvas.toCanvas(screenX, screenY);
        this.textCanvasPoint = canvasPoint;

        const fontSize = Math.max(12, this.brushSize * 4);
        overlay.style.left = screenX + 'px';
        overlay.style.top = screenY + 'px';
        overlay.style.fontSize = (fontSize * Canvas.scale) + 'px';
        overlay.style.color = this.brushColor;
        overlay.value = '';
        overlay.classList.remove('hidden');
        overlay.focus();

        this.textInputActive = true;

        // Commit on Enter (without shift), blur
        const onKeyDown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.commitTextInput();
            } else if (e.key === 'Escape') {
                this.cancelTextInput();
            }
        };

        const onBlur = () => {
            // Small delay to allow click-away detection
            setTimeout(() => {
                if (this.textInputActive) {
                    this.commitTextInput();
                }
            }, 100);
        };

        overlay.onkeydown = onKeyDown;
        overlay.onblur = onBlur;
    },

    /**
     * Commit text input as a stroke
     */
    commitTextInput() {
        const overlay = document.getElementById('text-input-overlay');
        const text = overlay.value.trim();

        if (text && this.textCanvasPoint) {
            const fontSize = Math.max(12, this.brushSize * 4);
            const stroke = {
                type: 'text',
                text: text,
                x: this.textCanvasPoint.x,
                y: this.textCanvasPoint.y,
                fontSize: fontSize,
                color: this.brushColor,
                opacity: 1
            };

            Canvas.strokes.push(stroke);
            Canvas.undoStack.push({ action: 'add', stroke: stroke });
            Canvas.redoStack = [];
            Canvas.redraw();
            App.triggerAutoSave();
        }

        overlay.classList.add('hidden');
        overlay.value = '';
        overlay.onkeydown = null;
        overlay.onblur = null;
        this.textInputActive = false;
        this.textCanvasPoint = null;
    },

    /**
     * Cancel text input without committing
     */
    cancelTextInput() {
        const overlay = document.getElementById('text-input-overlay');
        overlay.classList.add('hidden');
        overlay.value = '';
        overlay.onkeydown = null;
        overlay.onblur = null;
        this.textInputActive = false;
        this.textCanvasPoint = null;
    },

    /**
     * Erase any object at the given position
     */
    eraseObjectAt(x, y) {
        const strokeIndex = Canvas.findStrokeAt(x, y);
        if (strokeIndex >= 0) {
            Canvas.removeStroke(strokeIndex);
        }
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
        const newScale = this.initialScale * scaleChange;

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
