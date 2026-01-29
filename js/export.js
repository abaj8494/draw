/**
 * Export Module - PNG, SVG, PDF export functionality
 */

const Export = {
    /**
     * Export to PNG
     */
    toPNG() {
        // Create a temporary canvas with background and drawing combined
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = Canvas.width;
        tempCanvas.height = Canvas.height;
        const ctx = tempCanvas.getContext('2d');

        // Draw background
        ctx.drawImage(Canvas.bgCanvas, 0, 0);

        // Draw all strokes
        ctx.drawImage(Canvas.drawCanvas, 0, 0);

        // Create download link
        const dataURL = tempCanvas.toDataURL('image/png');
        this.downloadFile(dataURL, 'drawing.png');
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

        // Create a temporary canvas with background and drawing
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = Canvas.width;
        tempCanvas.height = Canvas.height;
        const ctx = tempCanvas.getContext('2d');

        // Draw background
        ctx.drawImage(Canvas.bgCanvas, 0, 0);

        // Draw all strokes
        ctx.drawImage(Canvas.drawCanvas, 0, 0);

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
