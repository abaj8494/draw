const { loadApp, test, assert, assertEqual } = require('./harness');

function drag(dom, points) {
    const Canvas = dom.window.Canvas;
    const Tools = dom.window.Tools;
    const mouse = (type, p) => new dom.window.MouseEvent(type, {
        clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, button: 0,
    });

    Canvas.drawCanvas.dispatchEvent(mouse('mousedown', points[0]));
    for (let i = 1; i < points.length; i++) {
        Canvas.drawCanvas.dispatchEvent(mouse('mousemove', points[i]));
    }
    Canvas.drawCanvas.dispatchEvent(mouse('mouseup', points[points.length - 1]));
    return Tools;
}

const pencil = (points) => ({
    type: 'pencil', points, color: '#000000', size: 3, opacity: 1,
});

test('pixel erasing records an eraser stroke on the canvas', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Tools = window.Tools;

    Tools.setTool('eraser-pixel');
    Tools.brushSize = 5;

    drag(dom, [{ x: 100, y: 100 }, { x: 120, y: 110 }, { x: 140, y: 120 }]);

    assertEqual(Canvas.strokes.length, 1, 'the erase must be part of the document');
    const stroke = Canvas.strokes[0];
    assertEqual(stroke.type, 'eraser');
    assertEqual(stroke.points.length, 3, 'every sampled point is kept, so fast drags leave no gaps');
    assertEqual(stroke.size, 10, 'eraser is twice the brush size');

    dom.window.close();
});

test('an erasure survives a redraw', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Tools = window.Tools;

    Canvas.strokes = [pencil([{ x: 0, y: 0 }, { x: 200, y: 200 }])];

    Tools.setTool('eraser-pixel');
    drag(dom, [{ x: 100, y: 100 }, { x: 110, y: 110 }]);

    assertEqual(Canvas.strokes.length, 2);

    // Panning, zooming and resizing all funnel through redraw(). Before the
    // fix these wiped the erasure and brought the stroke back whole.
    Canvas.pan(40, 40);
    Canvas.setScale(2, 100, 100);
    Canvas.redraw();

    assertEqual(Canvas.strokes.length, 2, 'the eraser stroke must still be there');
    assertEqual(Canvas.strokes[1].type, 'eraser');

    dom.window.close();
});

test('an erasure is undoable and redoable', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Tools = window.Tools;

    Canvas.strokes = [pencil([{ x: 0, y: 0 }, { x: 50, y: 50 }])];

    Tools.setTool('eraser-pixel');
    drag(dom, [{ x: 10, y: 10 }, { x: 20, y: 20 }]);

    assertEqual(Canvas.strokes.length, 2);
    assertEqual(Canvas.undoStack.length, 1);
    assertEqual(Canvas.undoStack[0].action, 'add');

    Canvas.undo();
    assertEqual(Canvas.strokes.length, 1, 'undo removes the erasure');
    assertEqual(Canvas.strokes[0].type, 'pencil');

    Canvas.redo();
    assertEqual(Canvas.strokes.length, 2, 'redo puts it back');
    assertEqual(Canvas.strokes[1].type, 'eraser');

    dom.window.close();
});

test('an erasure survives a save and load round-trip', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Tools = window.Tools;

    Canvas.strokes = [pencil([{ x: 0, y: 0 }, { x: 50, y: 50 }])];
    Tools.setTool('eraser-pixel');
    drag(dom, [{ x: 10, y: 10 }, { x: 20, y: 20 }]);

    const saved = JSON.parse(JSON.stringify(Canvas.getState()));
    Canvas.strokes = [];
    Canvas.loadState(saved);

    assertEqual(Canvas.strokes.length, 2);
    assertEqual(Canvas.strokes[1].type, 'eraser');
    assertEqual(Canvas.strokes[1].points.length, 2);

    dom.window.close();
});

test('eraser points are stored in world coordinates', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Tools = window.Tools;

    Canvas.offsetX = 100;
    Canvas.offsetY = 50;
    Canvas.scale = 2;

    Tools.setTool('eraser-pixel');
    drag(dom, [{ x: 300, y: 250 }]);

    const stroke = Canvas.strokes[0];
    assertEqual(stroke.points[0].x, 100, '(300 - 100) / 2');
    assertEqual(stroke.points[0].y, 100, '(250 - 50) / 2');

    dom.window.close();
});

test('renderStroke uses destination-out for eraser strokes only', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    const seen = [];
    const ctx = Object.assign({}, Canvas.drawCtx, {
        save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
        stroke() { seen.push(this.globalCompositeOperation); },
        arc() {}, fill() { seen.push(this.globalCompositeOperation); },
        quadraticCurveTo() {},
        globalCompositeOperation: '',
    });

    Canvas.renderStroke(pencil([{ x: 0, y: 0 }, { x: 10, y: 10 }]), ctx);
    assertEqual(seen[0], '', 'a pencil stroke composites normally');

    ctx.globalCompositeOperation = '';
    Canvas.renderStroke({ type: 'eraser', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], color: '#000', size: 8, opacity: 1 }, ctx);
    assertEqual(seen[1], 'destination-out', 'an eraser stroke removes what is under it');

    ctx.globalCompositeOperation = '';
    Canvas.renderStroke({ type: 'highlighter', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], color: '#ff0', size: 8, opacity: 0.4 }, ctx);
    assertEqual(seen[2], 'multiply', 'highlighter is untouched');

    dom.window.close();
});

test('an eraser only masks the strokes drawn before it in SVG export', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Export = window.Export;

    Canvas.currentBackground = 'blank-light';
    Canvas.strokes = [
        pencil([{ x: 0, y: 0 }, { x: 10, y: 10 }]),
        { type: 'eraser', points: [{ x: 5, y: 5 }, { x: 8, y: 8 }], color: '#000', size: 6, opacity: 1 },
        pencil([{ x: 20, y: 20 }, { x: 30, y: 30 }]),
    ];

    const svg = Export.buildSVG();

    assertEqual((svg.match(/<mask /g) || []).length, 1, 'one mask for the run before the eraser');
    assert(svg.includes('<g mask="url(#erase-0)">'), 'the earlier run is masked');

    // The stroke drawn after the eraser must sit outside the masked group.
    const groupEnd = svg.indexOf('</g>');
    const laterStroke = svg.indexOf('M 20 20');
    assert(laterStroke > groupEnd, 'a stroke drawn after the eraser is not masked');

    dom.window.close();
});

test('SVG export has no mask when nothing was erased', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Export = window.Export;

    Canvas.currentBackground = 'blank-light';
    Canvas.strokes = [pencil([{ x: 0, y: 0 }, { x: 10, y: 10 }])];

    const svg = Export.buildSVG();
    assert(!svg.includes('<mask '), 'no eraser means no mask');
    assert(svg.includes('<path class="stroke"'));

    dom.window.close();
});

test('the object eraser still removes whole strokes', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Tools = window.Tools;

    Canvas.strokes = [pencil([{ x: 100, y: 100 }, { x: 200, y: 100 }])];

    Tools.setTool('eraser-object');
    drag(dom, [{ x: 150, y: 100 }]);

    assertEqual(Canvas.strokes.length, 0, 'the whole stroke is gone');
    assertEqual(Canvas.undoStack[0].action, 'remove');

    dom.window.close();
});
