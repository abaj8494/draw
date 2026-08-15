/**
 * Export Module - PNG, SVG, PDF export functionality
 */

const Export = {
    /**
     * Export to PNG
     */
    toPNG() {
        const tempCanvas = this.renderToCanvas();
        const dataURL = tempCanvas.toDataURL('image/png');
        this.downloadFile(dataURL, 'drawing.png');
    },

    /**
     * Render the current viewport into a fresh offscreen canvas at full
     * resolution. Shared by PNG and PDF export.
     */
    renderToCanvas() {
        const tempCanvas = document.createElement('canvas');
        const dpr = Canvas.dpr || 1;
        tempCanvas.width = Canvas.width * dpr;
        tempCanvas.height = Canvas.height * dpr;

        const ctx = tempCanvas.getContext('2d');
        ctx.scale(dpr, dpr);
        this.renderScene(ctx);

        return tempCanvas;
    },

    /**
     * Paint background, grid and every stroke into a context.
     *
     * Strokes go onto their own layer before being composited, mirroring the
     * app's two-canvas model: an eraser stroke must reveal the background,
     * not punch a transparent hole through it.
     */
    renderScene(ctx) {
        this.renderBackground(ctx);

        const dpr = Canvas.dpr || 1;
        const layer = document.createElement('canvas');
        layer.width = Canvas.width * dpr;
        layer.height = Canvas.height * dpr;

        const layerCtx = layer.getContext('2d');
        layerCtx.scale(dpr, dpr);
        this.renderStrokes(layerCtx);

        ctx.drawImage(layer, 0, 0, Canvas.width, Canvas.height);
    },

    /**
     * Paint the background colour and grid into a context
     */
    renderBackground(ctx) {
        const bgConfig = Canvas.backgrounds[Canvas.currentBackground];

        ctx.fillStyle = bgConfig.bg;
        ctx.fillRect(0, 0, Canvas.width, Canvas.height);

        if (bgConfig.type !== 'grid') return;

        ctx.strokeStyle = bgConfig.line;
        ctx.lineWidth = 1;
        const scaledGridSize = Canvas.gridSize * Canvas.scale;

        ctx.beginPath();
        for (let x = Canvas.offsetX % scaledGridSize; x < Canvas.width; x += scaledGridSize) {
            const px = Math.round(x) + 0.5;
            ctx.moveTo(px, 0);
            ctx.lineTo(px, Canvas.height);
        }
        for (let y = Canvas.offsetY % scaledGridSize; y < Canvas.height; y += scaledGridSize) {
            const py = Math.round(y) + 0.5;
            ctx.moveTo(0, py);
            ctx.lineTo(Canvas.width, py);
        }
        ctx.stroke();
    },

    /**
     * Paint every stroke into a context
     */
    renderStrokes(ctx) {
        for (const stroke of Canvas.strokes) {
            this.renderStrokeToContext(ctx, stroke);
        }
    },

    /**
     * Render a stroke to a given context
     */
    renderStrokeToContext(ctx, stroke) {
        if (stroke && stroke.type === 'video') {
            this.renderVideoPlaceholder(ctx, stroke);
            return;
        }

        if (stroke && stroke.type === 'image') {
            this.renderImageToContext(ctx, stroke);
            return;
        }

        if (stroke && stroke.type === 'text') {
            Canvas.renderTextStroke(stroke, ctx);
            return;
        }

        if (!stroke || !stroke.points || stroke.points.length === 0) return;

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size * Canvas.scale;
        ctx.globalAlpha = stroke.opacity;

        if (stroke.type === 'highlighter') {
            ctx.globalCompositeOperation = 'multiply';
        } else if (stroke.type === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
        }

        ctx.beginPath();

        if (stroke.points.length === 1) {
            const p = stroke.points[0];
            const screen = Canvas.toScreen(p.x, p.y);
            ctx.arc(screen.x, screen.y, (stroke.size * Canvas.scale) / 2, 0, Math.PI * 2);
            ctx.fill();
        } else if (stroke.type === 'pen') {
            const screenPoints = stroke.points.map(p => Canvas.toScreen(p.x, p.y));
            ctx.moveTo(screenPoints[0].x, screenPoints[0].y);

            if (stroke.points.length === 2) {
                ctx.lineTo(screenPoints[1].x, screenPoints[1].y);
            } else {
                for (let i = 1; i < screenPoints.length - 1; i++) {
                    const xc = (screenPoints[i].x + screenPoints[i + 1].x) / 2;
                    const yc = (screenPoints[i].y + screenPoints[i + 1].y) / 2;
                    ctx.quadraticCurveTo(screenPoints[i].x, screenPoints[i].y, xc, yc);
                }
                const last = screenPoints[screenPoints.length - 1];
                const secondLast = screenPoints[screenPoints.length - 2];
                ctx.quadraticCurveTo(secondLast.x, secondLast.y, last.x, last.y);
            }
            ctx.stroke();
        } else {
            const firstScreen = Canvas.toScreen(stroke.points[0].x, stroke.points[0].y);
            ctx.moveTo(firstScreen.x, firstScreen.y);

            for (let i = 1; i < stroke.points.length; i++) {
                const screen = Canvas.toScreen(stroke.points[i].x, stroke.points[i].y);
                ctx.lineTo(screen.x, screen.y);
            }
            ctx.stroke();
        }

        ctx.restore();
    },

    /**
     * Render an image stroke to a given context (for export)
     */
    renderImageToContext(ctx, stroke) {
        const img = Canvas.getImage(stroke.src);
        if (!img.complete || img.naturalWidth === 0) return;

        const topLeft = Canvas.toScreen(stroke.x, stroke.y);
        const w = stroke.width * Canvas.scale;
        const h = stroke.height * Canvas.scale;

        ctx.save();
        ctx.globalAlpha = stroke.opacity;
        ctx.drawImage(img, topLeft.x, topLeft.y, w, h);
        ctx.restore();
    },

    /**
     * Draw a stand-in for an embedded video.
     *
     * Deliberately vector rather than the real poster frame: fetching
     * img.youtube.com would taint the canvas and make toDataURL throw, which
     * would break PNG and PDF export for every drawing containing a video.
     */
    renderVideoPlaceholder(ctx, stroke) {
        const topLeft = Canvas.toScreen(stroke.x, stroke.y);
        const w = stroke.width * Canvas.scale;
        const h = stroke.height * Canvas.scale;

        ctx.save();
        ctx.globalAlpha = stroke.opacity === undefined ? 1 : stroke.opacity;

        ctx.fillStyle = '#000000';
        ctx.fillRect(topLeft.x, topLeft.y, w, h);

        // Play triangle, centred
        const size = Math.min(w, h) * 0.25;
        const cx = topLeft.x + w / 2;
        const cy = topLeft.y + h / 2;
        ctx.fillStyle = '#ff0000';
        ctx.beginPath();
        ctx.moveTo(cx - size / 2, cy - size);
        ctx.lineTo(cx - size / 2, cy + size);
        ctx.lineTo(cx + size, cy);
        ctx.closePath();
        ctx.fill();

        const fontSize = Math.max(10, Math.min(16, h * 0.06));
        ctx.fillStyle = '#ffffff';
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(this.videoWatchUrl(stroke), cx, cy + size + fontSize);

        ctx.restore();
    },

    videoWatchUrl(stroke) {
        return `https://www.youtube.com/watch?v=${stroke.videoId}`;
    },

    /**
     * Export to SVG
     */
    toSVG() {
        const svgContent = this.buildSVG();
        const blob = new Blob([svgContent], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        this.downloadFile(url, 'drawing.svg');
        URL.revokeObjectURL(url);
    },

    /**
     * Build the SVG document for the current viewport
     */
    buildSVG() {
        const width = Canvas.width;
        const height = Canvas.height;
        const bgColor = Canvas.getBackgroundColor();
        const bgConfig = Canvas.backgrounds[Canvas.currentBackground];

        let svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      .stroke { fill: none; stroke-linecap: round; stroke-linejoin: round; }
    </style>
  </defs>

  <!-- Background -->
  <rect width="${width}" height="${height}" fill="${bgColor}"/>
`;

        // Draw grid if applicable
        if (bgConfig.type === 'grid') {
            svgContent += `
  <!-- Grid -->
  <defs>
    <pattern id="grid" width="${Canvas.gridSize}" height="${Canvas.gridSize}" patternUnits="userSpaceOnUse">
      <path d="M ${Canvas.gridSize} 0 L 0 0 0 ${Canvas.gridSize}" fill="none" stroke="${bgConfig.line}" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#grid)"/>
`;
        }

        // Add strokes.
        //
        // Eraser strokes split the drawing into runs: everything painted
        // before an eraser is masked by it, everything after is not. That
        // preserves the paint-order semantics of destination-out on canvas.
        svgContent += '\n  <!-- Strokes -->\n';

        const runs = [''];
        const erasers = [];

        for (const stroke of Canvas.strokes) {
            if (stroke.type === 'eraser') {
                if (stroke.points && stroke.points.length > 0) {
                    erasers.push(stroke);
                    runs.push('');
                }
                continue;
            }
            runs[runs.length - 1] += this.strokeToSVG(stroke);
        }

        for (let i = 0; i < runs.length; i++) {
            if (!runs[i]) continue;

            // Every eraser from index i onwards was drawn after this run.
            const applied = erasers.slice(i);
            if (applied.length === 0) {
                svgContent += runs[i];
                continue;
            }

            const maskId = `erase-${i}`;
            svgContent += `  <defs>\n    <mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">\n`;
            svgContent += `      <rect width="${width}" height="${height}" fill="white"/>\n`;
            for (const eraser of applied) {
                const d = this.pointsToSVGPath(eraser.points);
                svgContent += `      <path d="${d}" stroke="black" stroke-width="${eraser.size * Canvas.scale}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>\n`;
            }
            svgContent += '    </mask>\n  </defs>\n';
            svgContent += `  <g mask="url(#${maskId})">\n${runs[i]}  </g>\n`;
        }

        svgContent += '</svg>';

        return svgContent;
    },

    /**
     * Markup for a single non-eraser stroke
     */
    strokeToSVG(stroke) {
        const opacity = stroke.opacity < 1 ? ` opacity="${stroke.opacity}"` : '';

        if (stroke.type === 'video') {
            const pos = Canvas.toScreen(stroke.x, stroke.y);
            const w = stroke.width * Canvas.scale;
            const h = stroke.height * Canvas.scale;
            const size = Math.min(w, h) * 0.25;
            const cx = pos.x + w / 2;
            const cy = pos.y + h / 2;
            const fontSize = Math.max(10, Math.min(16, h * 0.06));
            const url = this.videoWatchUrl(stroke);

            // A link beats a raster stand-in: it survives into the exported file.
            return `  <g${opacity}>\n`
                + `    <rect x="${pos.x}" y="${pos.y}" width="${w}" height="${h}" fill="#000000"/>\n`
                + `    <polygon points="${cx - size / 2},${cy - size} ${cx - size / 2},${cy + size} ${cx + size},${cy}" fill="#ff0000"/>\n`
                + `    <a href="${url}"><text x="${cx}" y="${cy + size + fontSize * 2}" fill="#ffffff" font-size="${fontSize}" font-family="sans-serif" text-anchor="middle">${url}</text></a>\n`
                + '  </g>\n';
        }

        if (stroke.type === 'image') {
            const screenPos = Canvas.toScreen(stroke.x, stroke.y);
            const w = stroke.width * Canvas.scale;
            const h = stroke.height * Canvas.scale;
            return `  <image x="${screenPos.x}" y="${screenPos.y}" width="${w}" height="${h}" href="${stroke.src}"${opacity}/>\n`;
        }

        if (stroke.type === 'text') {
            const screenPos = Canvas.toScreen(stroke.x, stroke.y);
            const scaledFontSize = stroke.fontSize * Canvas.scale;
            const escapedText = stroke.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const lines = escapedText.split('\n');
            let markup = '';
            for (let li = 0; li < lines.length; li++) {
                const ty = screenPos.y + scaledFontSize + li * scaledFontSize * 1.3;
                markup += `  <text x="${screenPos.x}" y="${ty}" fill="${stroke.color}" font-size="${scaledFontSize}" font-family="sans-serif"${opacity}>${lines[li]}</text>\n`;
            }
            return markup;
        }

        if (!stroke.points || stroke.points.length === 0) return '';

        const pathData = this.pointsToSVGPath(stroke.points, stroke.type === 'pen');
        return `  <path class="stroke" d="${pathData}" stroke="${stroke.color}" stroke-width="${stroke.size * Canvas.scale}"${opacity}/>\n`;
    },

    /**
     * Convert points array to SVG path data
     */
    pointsToSVGPath(points, smooth = false) {
        if (points.length === 0) return '';

        // Go through the same world -> screen transform as every other export
        // path, so strokes stay registered with images and text at any zoom.
        const screen = points.map(p => Canvas.toScreen(p.x, p.y));

        if (screen.length === 1) {
            return `M ${screen[0].x} ${screen[0].y} L ${screen[0].x} ${screen[0].y}`;
        }

        let d = `M ${screen[0].x} ${screen[0].y}`;

        if (smooth && screen.length > 2) {
            // Smooth bezier curves
            for (let i = 1; i < screen.length - 1; i++) {
                const xc = (screen[i].x + screen[i + 1].x) / 2;
                const yc = (screen[i].y + screen[i + 1].y) / 2;
                d += ` Q ${screen[i].x} ${screen[i].y} ${xc} ${yc}`;
            }

            const last = screen[screen.length - 1];
            const secondLast = screen[screen.length - 2];
            d += ` Q ${secondLast.x} ${secondLast.y} ${last.x} ${last.y}`;
        } else {
            // Simple line segments
            for (let i = 1; i < screen.length; i++) {
                d += ` L ${screen[i].x} ${screen[i].y}`;
            }
        }

        return d;
    },

    /**
     * Export to PDF
     */
    toPDF() {
        // Check if jsPDF is available
        if (typeof window.jspdf === 'undefined') {
            alert('PDF export requires jsPDF library. Please ensure it is loaded.');
            return;
        }

        const { jsPDF } = window.jspdf;

        const tempCanvas = this.renderToCanvas();

        // Determine orientation based on canvas dimensions
        const orientation = Canvas.width > Canvas.height ? 'landscape' : 'portrait';

        // Create PDF
        const pdf = new jsPDF({
            orientation: orientation,
            unit: 'px',
            format: [Canvas.width, Canvas.height]
        });

        // Add image to PDF
        const imgData = tempCanvas.toDataURL('image/png');
        pdf.addImage(imgData, 'PNG', 0, 0, Canvas.width, Canvas.height);

        // Download
        pdf.save('drawing.pdf');
    },

    /**
     * Helper to download a file
     */
    downloadFile(dataURL, filename) {
        const link = document.createElement('a');
        link.download = filename;
        link.href = dataURL;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
};
