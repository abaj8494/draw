const { loadApp, test, assert, assertEqual } = require('./harness');

function mouse(dom, type, { x, y, button = 0 }) {
    return new dom.window.MouseEvent(type, {
        clientX: x, clientY: y, button, buttons: button === 2 ? 2 : 1,
        bubbles: true, cancelable: true,
    });
}

function drag(dom, points, button) {
    const canvas = dom.window.Canvas.drawCanvas;
    canvas.dispatchEvent(mouse(dom, 'mousedown', { ...points[0], button }));
    for (let i = 1; i < points.length; i++) {
        canvas.dispatchEvent(mouse(dom, 'mousemove', { ...points[i], button }));
    }
    canvas.dispatchEvent(mouse(dom, 'mouseup', { ...points[points.length - 1], button }));
}

test('right-click dragging pans without drawing', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Tools = window.Tools;

    Tools.setTool('pen');
    const startX = Canvas.offsetX;
    const startY = Canvas.offsetY;

    drag(dom, [
        { x: 200, y: 200 }, { x: 240, y: 220 }, { x: 300, y: 260 },
    ], 2);

    assertEqual(Canvas.strokes.length, 0, 'a right drag must not leave ink');
    assertEqual(Canvas.currentStroke, null, 'no stroke should be in progress');
    assertEqual(Canvas.offsetX, startX + 100, 'the canvas panned by the drag delta');
    assertEqual(Canvas.offsetY, startY + 60);

    dom.window.close();
});

test('right-click dragging pans with every drawing tool selected', async () => {
    for (const tool of ['pencil', 'pen', 'highlighter', 'eraser-pixel', 'shape-rect', 'lasso', 'marquee']) {
        const dom = await loadApp();
        const { window } = dom;
        const Canvas = window.Canvas;

        window.Tools.setTool(tool);
        drag(dom, [{ x: 150, y: 150 }, { x: 200, y: 180 }], 2);

        assertEqual(Canvas.strokes.length, 0, `${tool} must not draw on a right drag`);
        assertEqual(Canvas.offsetX, 50, `${tool} should still pan`);
        assertEqual(Canvas.offsetY, 30);

        dom.window.close();
    }
});

test('left-click dragging still draws', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    window.Tools.setTool('pen');
    const startX = Canvas.offsetX;

    drag(dom, [{ x: 200, y: 200 }, { x: 240, y: 220 }, { x: 300, y: 260 }], 0);

    assertEqual(Canvas.strokes.length, 1, 'a left drag draws');
    assertEqual(Canvas.strokes[0].type, 'pen');
    assertEqual(Canvas.strokes[0].points.length, 3);
    assertEqual(Canvas.offsetX, startX, 'and does not pan');

    dom.window.close();
});

test('middle-click dragging neither draws nor pans', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    window.Tools.setTool('pencil');
    drag(dom, [{ x: 100, y: 100 }, { x: 160, y: 140 }], 1);

    assertEqual(Canvas.strokes.length, 0);
    assertEqual(Canvas.offsetX, 0);

    dom.window.close();
});

test('a right drag leaves isDrawing false so the next left drag is clean', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Tools = window.Tools;

    Tools.setTool('pencil');
    drag(dom, [{ x: 100, y: 100 }, { x: 150, y: 150 }], 2);
    assertEqual(Tools.isDrawing, false);
    assertEqual(Tools.isRightClickPanning, false, 'the pan latch is released');

    drag(dom, [{ x: 300, y: 300 }, { x: 340, y: 340 }], 0);
    assertEqual(Canvas.strokes.length, 1, 'drawing works normally afterwards');

    dom.window.close();
});

test('a right drag does not start a text input', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;

    window.Tools.setTool('text');
    drag(dom, [{ x: 300, y: 300 }, { x: 340, y: 320 }], 2);

    assert(document.getElementById('text-input-overlay').classList.contains('hidden'),
        'the text overlay must not open on a right click');
    assertEqual(window.Tools.textInputActive, false);

    dom.window.close();
});

test('touch input still draws even though it carries no button', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    window.Tools.setTool('pencil');

    // A touch event has no `button` property at all.
    const touch = (type, x, y) => {
        const evt = new window.Event(type, { bubbles: true, cancelable: true });
        evt.touches = type === 'touchend' ? [] : [{ clientX: x, clientY: y }];
        return evt;
    };

    Canvas.drawCanvas.dispatchEvent(touch('touchstart', 100, 100));
    Canvas.drawCanvas.dispatchEvent(touch('touchmove', 150, 150));
    Canvas.drawCanvas.dispatchEvent(touch('touchend', 150, 150));

    assertEqual(Canvas.strokes.length, 1, 'touch drawing must keep working');

    dom.window.close();
});
