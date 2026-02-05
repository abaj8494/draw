/**
 * Export Module - PNG, SVG, PDF export functionality
 */

const Export = {
    /**
     * Export to PNG
     */
    toPNG() {
        // Create a temporary canvas at full resolution
        const tempCanvas = document.createElement('canvas');
        const dpr = Canvas.dpr || 1;
        tempCanvas.width = Canvas.width * dpr;
        tempCanvas.height = Canvas.height * dpr;
        const ctx = tempCanvas.getContext('2d');

        // Scale for DPR
        ctx.scale(dpr, dpr);

        // Draw background
        const bgConfig = Canvas.backgrounds[Canvas.currentBackground];
        ctx.fillStyle = bgConfig.bg;
        ctx.fillRect(0, 0, Canvas.width, Canvas.height);

        // Draw grid if needed
        if (bgConfig.type === 'grid') {
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
        }

        // Draw all strokes
        for (const stroke of Canvas.strokes) {
            this.renderStrokeToContext(ctx, stroke);
        }

        // Create download link
        const dataURL = tempCanvas.toDataURL('image/png');
        this.downloadFile(dataURL, 'drawing.png');
    },

    /**
     * Render a stroke to a given context
     */
    renderStrokeToContext(ctx, stroke) {
        if (stroke && stroke.type === 'image') {
            this.renderImageToContext(ctx, stroke);
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
     * Export to SVG
     */
    toSVG() {
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

        // Add strokes
        svgContent += '\n  <!-- Strokes -->\n';

        for (const stroke of Canvas.strokes) {
            if (stroke.type === 'image') {
                const screenPos = Canvas.toScreen(stroke.x, stroke.y);
                const w = stroke.width * Canvas.scale;
                const h = stroke.height * Canvas.scale;
                const opacity = stroke.opacity < 1 ? ` opacity="${stroke.opacity}"` : '';
                svgContent += `  <image x="${screenPos.x}" y="${screenPos.y}" width="${w}" height="${h}" href="${stroke.src}"${opacity}/>\n`;
                continue;
            }

            if (!stroke.points || stroke.points.length === 0) continue;

            const pathData = this.pointsToSVGPath(stroke.points, stroke.type === 'pen');
            const opacity = stroke.opacity < 1 ? ` opacity="${stroke.opacity}"` : '';

            svgContent += `  <path class="stroke" d="${pathData}" stroke="${stroke.color}" stroke-width="${stroke.size}"${opacity}/>\n`;
        }

        svgContent += '</svg>';

        // Create download
        const blob = new Blob([svgContent], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        this.downloadFile(url, 'drawing.svg');
        URL.revokeObjectURL(url);
    },

    /**
     * Convert points array to SVG path data
     */
    pointsToSVGPath(points, smooth = false) {
        if (points.length === 0) return '';

        const offsetX = Canvas.offsetX;
        const offsetY = Canvas.offsetY;

        if (points.length === 1) {
            const p = points[0];
            return `M ${p.x + offsetX} ${p.y + offsetY} L ${p.x + offsetX} ${p.y + offsetY}`;
        }

        let d = `M ${points[0].x + offsetX} ${points[0].y + offsetY}`;

        if (smooth && points.length > 2) {
            // Smooth bezier curves
            for (let i = 1; i < points.length - 1; i++) {
                const p = points[i];
                const next = points[i + 1];
                const xc = (p.x + next.x) / 2 + offsetX;
                const yc = (p.y + next.y) / 2 + offsetY;
                d += ` Q ${p.x + offsetX} ${p.y + offsetY} ${xc} ${yc}`;
            }

            const last = points[points.length - 1];
            const secondLast = points[points.length - 2];
            d += ` Q ${secondLast.x + offsetX} ${secondLast.y + offsetY} ${last.x + offsetX} ${last.y + offsetY}`;
        } else {
            // Simple line segments
            for (let i = 1; i < points.length; i++) {
                const p = points[i];
                d += ` L ${p.x + offsetX} ${p.y + offsetY}`;
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

        // Create a temporary canvas at full resolution
        const tempCanvas = document.createElement('canvas');
        const dpr = Canvas.dpr || 1;
        tempCanvas.width = Canvas.width * dpr;
        tempCanvas.height = Canvas.height * dpr;
        const ctx = tempCanvas.getContext('2d');

        ctx.scale(dpr, dpr);

        // Draw background
        const bgConfig = Canvas.backgrounds[Canvas.currentBackground];
        ctx.fillStyle = bgConfig.bg;
        ctx.fillRect(0, 0, Canvas.width, Canvas.height);

        if (bgConfig.type === 'grid') {
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
        }

        // Draw all strokes
        for (const stroke of Canvas.strokes) {
            this.renderStrokeToContext(ctx, stroke);
        }

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
