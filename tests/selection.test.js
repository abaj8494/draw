const { loadApp, test, assert, assertEqual } = require('./harness');

// --- small builders so each test only states what it cares about -------------

function pen(points, size = 2) {
    return { type: 'pen', points: points.map(p => ({ x: p.x, y: p.y })), color: '#000', size, opacity: 1 };
}
function image(x, y, width, height) {
    return { type: 'image', x, y, width, height, src: 'data:image/png;base64,', opacity: 1 };
}
function text(x, y, str, fontSize = 20) {
    return { type: 'text', x, y, text: str, fontSize, color: '#000', opacity: 1 };
}

test('findStrokeAt hits a pen stroke on a segment midpoint and misses when far away', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    // Long horizontal segment: the midpoint is 100 units from either stored
    // point, so only pointToSegmentDistance can produce a hit here.
    Canvas.strokes = [pen([{ x: 100, y: 100 }, { x: 300, y: 100 }], 4)];

    assertEqual(Canvas.scale, 1, 'test assumes identity transform');
    assertEqual(Canvas.offsetX, 0);
    assertEqual(Canvas.offsetY, 0);

    // hitThreshold = threshold / scale + size / 2 = 10 + 2 = 12
    assertEqual(Canvas.findStrokeAt(200, 100, 10), 0, 'exactly on the segment midpoint');
    assertEqual(Canvas.findStrokeAt(200, 111, 10), 0, 'just inside the segment threshold');
    assertEqual(Canvas.findStrokeAt(200, 113, 10), -1, 'just outside the segment threshold');
    assertEqual(Canvas.findStrokeAt(200, 400, 10), -1, 'clearly outside the stroke');
    assertEqual(Canvas.findStrokeAt(500, 100, 10), -1, 'past the end of the segment');

    dom.window.close();
});

test('findStrokeAt returns the topmost stroke when two overlap', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    const horizontal = pen([{ x: 100, y: 150 }, { x: 200, y: 150 }], 4);
    const vertical = pen([{ x: 150, y: 100 }, { x: 150, y: 200 }], 4);
    Canvas.strokes = [horizontal, vertical];

    const hit = Canvas.findStrokeAt(150, 150, 10);
    assertEqual(hit, 1, 'highest index wins');
    assert(Canvas.strokes[hit] === vertical, 'topmost stroke should be the later one');

    // Removing the top stroke exposes the one underneath.
    Canvas.strokes.pop();
    assertEqual(Canvas.findStrokeAt(150, 150, 10), 0);

    dom.window.close();
});

test('findStrokeAt bounding-box hit tests an image stroke including the threshold', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    Canvas.strokes = [image(50, 60, 100, 80)]; // box 50..150 x 60..140

    assertEqual(Canvas.findStrokeAt(100, 100, 10), 0, 'inside the image');
    assertEqual(Canvas.findStrokeAt(41, 100, 10), 0, 'within threshold left of the image');
    assertEqual(Canvas.findStrokeAt(39, 100, 10), -1, 'beyond threshold left of the image');
    assertEqual(Canvas.findStrokeAt(159, 139, 10), 0, 'within threshold past bottom-right');
    assertEqual(Canvas.findStrokeAt(161, 100, 10), -1, 'beyond threshold right of the image');
    assertEqual(Canvas.findStrokeAt(100, 200, 10), -1, 'below the image');

    dom.window.close();
});

test('findStrokeAt bounding-box hit tests a text stroke from its measured extents', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    // width  = maxLineLength * fontSize * 0.6 = 4 * 20 * 0.6 = 48
    // height = lines * fontSize * 1.3         = 1 * 26       = 26
    Canvas.strokes = [text(200, 300, 'abcd', 20)];

    assertEqual(Canvas.findStrokeAt(210, 310, 10), 0, 'inside the text box');
    assertEqual(Canvas.findStrokeAt(200 + 48 + 9, 300 + 26 + 9, 10), 0, 'within threshold past bottom-right');
    assertEqual(Canvas.findStrokeAt(200 + 48 + 11, 310, 10), -1, 'beyond the text width + threshold');
    assertEqual(Canvas.findStrokeAt(210, 300 + 26 + 11, 10), -1, 'beyond the text height + threshold');
    assertEqual(Canvas.findStrokeAt(180, 310, 10), -1, 'left of the text anchor');

    // A second line widens and heightens the box.
    Canvas.strokes = [text(200, 300, 'abcd\nabcdefghij', 20)];
    assertEqual(Canvas.findStrokeAt(200 + 10 * 20 * 0.6 - 1, 300 + 2 * 26 - 1, 10), 0, 'two-line box');

    dom.window.close();
});

test('findStrokeAt takes screen coords and scales its threshold by the zoom level', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    Canvas.strokes = [pen([{ x: 100, y: 100 }, { x: 300, y: 100 }], 2)];
    Canvas.scale = 2;
    Canvas.offsetX = 50;
    Canvas.offsetY = 30;

    // World (200,100) -> screen (450, 230).
    assertEqual(Canvas.findStrokeAt(450, 230, 10), 0, 'screen coords are converted to world coords');
    // hitThreshold in world units = 10 / 2 + 2 / 2 = 6
    assertEqual(Canvas.findStrokeAt(450, 238, 10), 0, 'world dy 4 <= 6');
    assertEqual(Canvas.findStrokeAt(450, 246, 10), -1, 'world dy 8 > 6 once the threshold is scaled');

    // The same world offset does hit at scale 1, proving the threshold scaled.
    Canvas.scale = 1;
    Canvas.offsetX = 0;
    Canvas.offsetY = 0;
    assertEqual(Canvas.findStrokeAt(200, 108, 10), 0, 'world dy 8 <= 11 at scale 1');

    dom.window.close();
});

test('pointToSegmentDistance projects onto the segment and clamps past both endpoints', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };

    assertEqual(Canvas.pointToSegmentDistance({ x: 5, y: 3 }, a, b), 3, 'perpendicular mid-segment');
    assertEqual(Canvas.pointToSegmentDistance({ x: 0, y: -4 }, a, b), 4, 'perpendicular at the start point');
    assertEqual(Canvas.pointToSegmentDistance({ x: -4, y: 3 }, a, b), 5, 'clamped to the start endpoint');
    assertEqual(Canvas.pointToSegmentDistance({ x: 14, y: 3 }, a, b), 5, 'clamped to the end endpoint');
    assertEqual(Canvas.pointToSegmentDistance({ x: 7, y: 0 }, a, b), 0, 'on the segment');

    // Diagonal segment: (0,0)-(4,4), point (4,0) projects to (2,2).
    assertEqual(
        Canvas.pointToSegmentDistance({ x: 4, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 4 }),
        Math.hypot(2, 2),
        'diagonal projection'
    );

    dom.window.close();
});

test('pointToSegmentDistance handles a degenerate zero-length segment', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    const p = { x: 2, y: 2 };
    assertEqual(Canvas.pointToSegmentDistance({ x: 5, y: 6 }, p, p), 5, 'falls back to point distance');
    assertEqual(Canvas.pointToSegmentDistance({ x: 2, y: 2 }, p, p), 0, 'coincident point');

    dom.window.close();
});

test('findStrokesInRect uses point containment for pen strokes but box overlap for images', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    // The rect straddles the middle of both shapes; only the image is caught,
    // because the pen stroke stores no point inside the rect even though its
    // segment crosses it.
    const crossing = pen([{ x: 0, y: 0 }, { x: 200, y: 0 }], 2);
    const img = image(0, -10, 200, 20);
    const inside = pen([{ x: 60, y: 0 }, { x: 70, y: 5 }], 2);
    Canvas.strokes = [crossing, img, inside];

    const rect = { x: 50, y: -10, width: 60, height: 20 };
    const found = Canvas.findStrokesInRect(rect);

    assertEqual(JSON.stringify(found), JSON.stringify([1, 2]), 'image overlaps, crossing pen stroke does not qualify');
    assert(!found.includes(0), 'a pen segment merely crossing the rect is not selected');

    // An image that only touches the rect edge still overlaps (>= / <= compare).
    Canvas.strokes = [image(110, -10, 50, 20)];
    assertEqual(JSON.stringify(Canvas.findStrokesInRect(rect)), JSON.stringify([0]), 'edge-touching image overlaps');

    // An image entirely outside is excluded.
    Canvas.strokes = [image(200, 200, 50, 20)];
    assertEqual(Canvas.findStrokesInRect(rect).length, 0);

    dom.window.close();
});

test('findStrokesInRect selects a text stroke only by its anchor point', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    const rect = { x: 50, y: -10, width: 60, height: 20 };

    // NOTE: text is tested by its (x, y) anchor only, so a wide run of text
    // that visually covers the rect is NOT selected.
    const wide = text(0, 0, 'aaaaaaaaaa', 20); // ~120 wide, overlaps the rect
    const anchored = text(60, 0, 'a', 20);
    Canvas.strokes = [wide, anchored];

    const found = Canvas.findStrokesInRect(rect);
    assertEqual(JSON.stringify(found), JSON.stringify([1]), 'only the anchored text is selected');

    dom.window.close();
});

test('findStrokesInPolygon selects strokes inside a triangle and pointInPolygon agrees', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    const triangle = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }];

    assertEqual(Canvas.pointInPolygon({ x: 10, y: 10 }, triangle), true, 'well inside');
    assertEqual(Canvas.pointInPolygon({ x: 60, y: 60 }, triangle), false, 'beyond the hypotenuse');
    assertEqual(Canvas.pointInPolygon({ x: -5, y: 50 }, triangle), false, 'left of the polygon');
    assertEqual(Canvas.pointInPolygon({ x: 500, y: 500 }, triangle), false, 'far outside');

    const insideStroke = pen([{ x: 10, y: 10 }, { x: 20, y: 20 }], 2);
    const outsideStroke = pen([{ x: 200, y: 200 }, { x: 300, y: 300 }], 2);
    // Only one point needs to be inside for the whole stroke to be selected.
    const partialStroke = pen([{ x: 400, y: 400 }, { x: 5, y: 5 }], 2);
    Canvas.strokes = [insideStroke, outsideStroke, partialStroke];

    const found = Canvas.findStrokesInPolygon(triangle);
    assertEqual(JSON.stringify(found), JSON.stringify([0, 2]));

    dom.window.close();
});

test('findStrokesInPolygon tests images by their four corners and text by its anchor', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    const quad = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

    const cornerInside = image(50, 50, 200, 200);   // top-left corner inside the quad
    // NOTE: an image that completely swallows the polygon has no corner inside,
    // so the corner-based test does not select it.
    const swallowing = image(-500, -500, 1000, 1000);
    const anchoredText = text(20, 20, 'hi', 20);
    const outsideText = text(400, 400, 'hi', 20);
    Canvas.strokes = [cornerInside, swallowing, anchoredText, outsideText];

    const found = Canvas.findStrokesInPolygon(quad);
    assertEqual(JSON.stringify(found), JSON.stringify([0, 2]));

    dom.window.close();
});

test('moveStrokes shifts freehand points and image/text anchors', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    const stroke = pen([{ x: 10, y: 20 }, { x: 30, y: 40 }], 4);
    const img = image(100, 100, 50, 60);
    const txt = text(200, 210, 'hello', 16);
    const untouched = pen([{ x: 0, y: 0 }], 4);
    Canvas.strokes = [stroke, img, txt, untouched];

    Canvas.moveStrokes([0, 1, 2], 10, -5);

    assertEqual(stroke.points[0].x, 20);
    assertEqual(stroke.points[0].y, 15);
    assertEqual(stroke.points[1].x, 40);
    assertEqual(stroke.points[1].y, 35);

    assertEqual(img.x, 110);
    assertEqual(img.y, 95);
    assertEqual(img.width, 50, 'size is unchanged by a move');
    assertEqual(img.height, 60);

    assertEqual(txt.x, 210);
    assertEqual(txt.y, 205);
    assertEqual(txt.fontSize, 16, 'font size is unchanged by a move');

    assertEqual(untouched.points[0].x, 0, 'unselected stroke is untouched');
    assertEqual(untouched.points[0].y, 0);

    // Empty selection is a no-op.
    Canvas.moveStrokes([], 100, 100);
    assertEqual(stroke.points[0].x, 20);

    dom.window.close();
});

test('resizeStrokes scales image width/height about the anchor, leaving the anchor fixed', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    const atAnchor = image(100, 100, 50, 40);
    const offAnchor = image(200, 300, 50, 40);
    Canvas.strokes = [atAnchor, offAnchor];

    Canvas.resizeStrokes([0, 1], 100, 100, 2, 3);

    assertEqual(atAnchor.x, 100, 'the anchor point itself is invariant');
    assertEqual(atAnchor.y, 100, 'the anchor point itself is invariant');
    assertEqual(atAnchor.width, 100);
    assertEqual(atAnchor.height, 120);

    assertEqual(offAnchor.x, 100 + 100 * 2);
    assertEqual(offAnchor.y, 100 + 200 * 3);
    assertEqual(offAnchor.width, 100);
    assertEqual(offAnchor.height, 120);

    dom.window.close();
});

test('resizeStrokes scales text position and fontSize by the larger axis factor', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    const txt = text(10, 20, 'hello', 16);
    const anchored = text(0, 0, 'anchor', 16);
    Canvas.strokes = [txt, anchored];

    Canvas.resizeStrokes([0, 1], 0, 0, 2, 3);

    assertEqual(txt.x, 20);
    assertEqual(txt.y, 60);
    // fontSize *= abs(max(scaleX, scaleY))
    assertEqual(txt.fontSize, 48);

    assertEqual(anchored.x, 0, 'a stroke sitting on the anchor does not move');
    assertEqual(anchored.y, 0, 'a stroke sitting on the anchor does not move');

    dom.window.close();
});

test('resizeStrokes scales freehand points and stroke size about the anchor', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    const stroke = pen([{ x: 100, y: 100 }, { x: 150, y: 100 }, { x: 100, y: 200 }], 4);
    Canvas.strokes = [stroke];

    Canvas.resizeStrokes([0], 100, 100, 2, 0.5);

    assertEqual(stroke.points[0].x, 100, 'point on the anchor is invariant');
    assertEqual(stroke.points[0].y, 100, 'point on the anchor is invariant');
    assertEqual(stroke.points[1].x, 200);
    assertEqual(stroke.points[1].y, 100);
    assertEqual(stroke.points[2].x, 100);
    assertEqual(stroke.points[2].y, 150);
    // size *= abs(max(scaleX, scaleY))
    assertEqual(stroke.size, 8);

    dom.window.close();
});

test('all eight resize handles round-trip through hitTestResizeHandle', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;
    const Tools = dom.window.Tools;

    // Image bounds get no padding, so the selection box is exactly 400x300.
    Canvas.strokes = [image(100, 100, 400, 300)];
    Tools.selectedStrokes = [0];

    const expectedIds = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

    const roundTrip = (label) => {
        const bounds = Tools.getSelectionBounds();
        const topLeft = Canvas.toScreen(bounds.minX, bounds.minY);
        const bottomRight = Canvas.toScreen(bounds.maxX, bounds.maxY);
        const handles = Tools.getResizeHandlePositions(
            topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y
        );
        assertEqual(handles.length, 8, label);
        assertEqual(JSON.stringify(handles.map(h => h.id)), JSON.stringify(expectedIds), label);
        for (const handle of handles) {
            assertEqual(Tools.hitTestResizeHandle(handle.x, handle.y), handle.id, `${label}: ${handle.id}`);
        }
        return handles;
    };

    const handles = roundTrip('identity transform');
    assertEqual(handles[0].x, 100);
    assertEqual(handles[0].y, 100);
    assertEqual(handles[4].x, 500, 'se handle at bottom-right');
    assertEqual(handles[4].y, 400);
    assertEqual(handles[1].x, 300, 'n handle is centred horizontally');
    assertEqual(handles[3].y, 250, 'e handle is centred vertically');

    // Handles are screen-space, so panning/zooming moves them.
    Canvas.scale = 0.5;
    Canvas.offsetX = 30;
    Canvas.offsetY = -20;
    const zoomed = roundTrip('zoomed and panned');
    assertEqual(zoomed[0].x, 100 * 0.5 + 30);
    assertEqual(zoomed[0].y, 100 * 0.5 - 20);

    assertEqual(Tools.hitTestResizeHandle(-1000, -1000), null, 'far away point hits nothing');

    Tools.selectedStrokes = [];
    assertEqual(Tools.hitTestResizeHandle(100, 100), null, 'nothing selected means no handles');

    dom.window.close();
});

test('getResizeAnchor returns the diagonally opposite corner or edge for every handle', async () => {
    const dom = await loadApp();
    const Tools = dom.window.Tools;

    const bounds = { minX: 100, minY: 100, maxX: 500, maxY: 400 };
    const midX = 300;
    const midY = 250;

    const expected = {
        nw: { x: 500, y: 400 },
        n: { x: midX, y: 400 },
        ne: { x: 100, y: 400 },
        e: { x: 100, y: midY },
        se: { x: 100, y: 100 },
        s: { x: midX, y: 100 },
        sw: { x: 500, y: 100 },
        w: { x: 500, y: midY },
    };

    for (const id of Object.keys(expected)) {
        const anchor = Tools.getResizeAnchor(id, bounds);
        assertEqual(anchor.x, expected[id].x, `anchor x for ${id}`);
        assertEqual(anchor.y, expected[id].y, `anchor y for ${id}`);
    }

    dom.window.close();
});

test('getSelectionBounds pads freehand strokes by half the stroke size but not images or text', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;
    const Tools = dom.window.Tools;

    const stroke = pen([{ x: 100, y: 100 }, { x: 200, y: 150 }], 10);
    const img = image(400, 50, 100, 100);
    const txt = text(600, 600, 'abcd', 20);
    Canvas.strokes = [stroke, img, txt];

    Tools.selectedStrokes = [];
    assertEqual(Tools.getSelectionBounds(), null, 'no selection means no bounds');

    Tools.selectedStrokes = [0];
    let b = Tools.getSelectionBounds();
    assertEqual(b.minX, 95);
    assertEqual(b.minY, 95);
    assertEqual(b.maxX, 205);
    assertEqual(b.maxY, 155);

    Tools.selectedStrokes = [1];
    b = Tools.getSelectionBounds();
    assertEqual(b.minX, 400, 'images are not padded');
    assertEqual(b.minY, 50);
    assertEqual(b.maxX, 500);
    assertEqual(b.maxY, 150);

    Tools.selectedStrokes = [2];
    b = Tools.getSelectionBounds();
    assertEqual(b.minX, 600, 'text is not padded');
    assertEqual(b.minY, 600);
    assertEqual(b.maxX, 600 + 4 * 20 * 0.6);
    assertEqual(b.maxY, 600 + 20 * 1.3);

    Tools.selectedStrokes = [0, 1, 2];
    b = Tools.getSelectionBounds();
    assertEqual(b.minX, 95, 'union of padded and unpadded bounds');
    assertEqual(b.minY, 50);
    assertEqual(b.maxX, 600 + 4 * 20 * 0.6);
    assertEqual(b.maxY, 600 + 20 * 1.3);

    // Missing indices are skipped rather than throwing.
    Tools.selectedStrokes = [99, 1];
    b = Tools.getSelectionBounds();
    assertEqual(b.minX, 400);

    dom.window.close();
});
