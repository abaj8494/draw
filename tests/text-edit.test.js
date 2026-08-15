const { loadApp, test, assert, assertEqual } = require('./harness');

function clickCanvas(dom, x, y) {
    dom.window.Canvas.drawCanvas.dispatchEvent(new dom.window.MouseEvent('mousedown', {
        clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true,
    }));
}

function typeAndCommit(dom, value) {
    const overlay = dom.window.document.getElementById('text-input-overlay');
    overlay.value = value;
    overlay.onkeydown({ key: 'Enter', shiftKey: false, preventDefault: () => {} });
}

// Author a label at (x, y) and return its stroke.
function writeText(dom, x, y, value) {
    dom.window.Tools.setTool('text');
    clickCanvas(dom, x, y);
    typeAndCommit(dom, value);
    return dom.window.Canvas.strokes[dom.window.Canvas.strokes.length - 1];
}

test('clicking an existing label reopens it for editing', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Canvas = window.Canvas;
    const Tools = window.Tools;

    writeText(dom, 200, 200, 'hello');
    assertEqual(Canvas.strokes.length, 1);

    clickCanvas(dom, 210, 205);

    const overlay = document.getElementById('text-input-overlay');
    assert(!overlay.classList.contains('hidden'), 'the overlay reopens');
    assertEqual(overlay.value, 'hello', 'prefilled with the existing text');
    assertEqual(Tools.editingTextIndex, 0);
    assertEqual(Canvas.strokes.length, 1, 'no second label was created');

    dom.window.close();
});

test('editing replaces the text in place rather than adding a label', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    const original = writeText(dom, 200, 200, 'hello');
    const x = original.x;
    const y = original.y;

    clickCanvas(dom, 210, 205);
    typeAndCommit(dom, 'hello world');

    assertEqual(Canvas.strokes.length, 1, 'still exactly one label');
    assertEqual(Canvas.strokes[0].text, 'hello world');
    assertEqual(Canvas.strokes[0].x, x, 'it stays where it was');
    assertEqual(Canvas.strokes[0].y, y);

    dom.window.close();
});

test('an edit keeps the original size and colour', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Tools = window.Tools;

    Tools.setSize(10);
    Tools.setColor('#ff0000');
    writeText(dom, 200, 200, 'red and large');
    const before = { ...Canvas.strokes[0] };

    // Change the active brush; the edit must not adopt it.
    Tools.setSize(3);
    Tools.setColor('#0000ff');

    clickCanvas(dom, 205, 205);
    typeAndCommit(dom, 'still red and large');

    assertEqual(Canvas.strokes[0].fontSize, before.fontSize);
    assertEqual(Canvas.strokes[0].color, before.color);
    assertEqual(Canvas.strokes[0].text, 'still red and large');

    dom.window.close();
});

test('an edit is undoable back to the previous text', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    writeText(dom, 200, 200, 'first');
    clickCanvas(dom, 205, 205);
    typeAndCommit(dom, 'second');
    assertEqual(Canvas.strokes[0].text, 'second');

    Canvas.undo();
    assertEqual(Canvas.strokes.length, 1, 'the label is still there');
    assertEqual(Canvas.strokes[0].text, 'first', 'undo restores the old text');

    Canvas.redo();
    assertEqual(Canvas.strokes[0].text, 'second', 'redo reapplies the edit');

    dom.window.close();
});

test('clearing the text of a label deletes it, undoably', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    writeText(dom, 200, 200, 'delete me');
    clickCanvas(dom, 205, 205);
    typeAndCommit(dom, '   ');

    assertEqual(Canvas.strokes.length, 0, 'clearing removes the label');

    Canvas.undo();
    assertEqual(Canvas.strokes.length, 1);
    assertEqual(Canvas.strokes[0].text, 'delete me');

    dom.window.close();
});

test('Escape abandons an edit and leaves the original intact', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Canvas = window.Canvas;

    writeText(dom, 200, 200, 'unchanged');
    const undoDepth = Canvas.undoStack.length;

    clickCanvas(dom, 205, 205);
    const overlay = document.getElementById('text-input-overlay');
    overlay.value = 'discarded';
    overlay.onkeydown({ key: 'Escape', preventDefault: () => {} });

    assertEqual(Canvas.strokes.length, 1);
    assertEqual(Canvas.strokes[0].text, 'unchanged');
    assertEqual(Canvas.undoStack.length, undoDepth, 'nothing was pushed to undo');
    assertEqual(Canvas.hiddenStrokeIndex, -1, 'the label is visible again');

    dom.window.close();
});

test('committing an unchanged edit records no undo step', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    writeText(dom, 200, 200, 'same');
    const undoDepth = Canvas.undoStack.length;

    clickCanvas(dom, 205, 205);
    typeAndCommit(dom, 'same');

    assertEqual(Canvas.strokes.length, 1);
    assertEqual(Canvas.undoStack.length, undoDepth, 'a no-op edit is not undoable');

    dom.window.close();
});

test('the label being edited is hidden so it is not drawn twice', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    writeText(dom, 200, 200, 'hello');
    clickCanvas(dom, 205, 205);

    assertEqual(Canvas.hiddenStrokeIndex, 0, 'suppressed while the overlay is open');

    typeAndCommit(dom, 'hello again');
    assertEqual(Canvas.hiddenStrokeIndex, -1, 'visible again after committing');

    dom.window.close();
});

test('the hidden index is transient and never saved', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    writeText(dom, 200, 200, 'hello');
    clickCanvas(dom, 205, 205);

    const state = Canvas.getState();
    assertEqual(state.hiddenStrokeIndex, undefined, 'not part of the document');

    dom.window.close();
});

test('clicking empty space still starts a new label', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Canvas = window.Canvas;

    writeText(dom, 200, 200, 'first');
    clickCanvas(dom, 600, 600);

    assertEqual(window.Tools.editingTextIndex, -1, 'not editing anything');
    assertEqual(document.getElementById('text-input-overlay').value, '', 'a blank overlay');

    typeAndCommit(dom, 'second');
    assertEqual(Canvas.strokes.length, 2, 'a second label was added');

    dom.window.close();
});

test('the topmost label wins when two overlap', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Canvas = window.Canvas;

    // Overlapping labels cannot be authored by clicking any more (the click
    // would edit the first one), so stack them directly.
    Canvas.strokes = [
        { type: 'text', text: 'under', x: 200, y: 200, fontSize: 20, color: '#000', opacity: 1 },
        { type: 'text', text: 'over', x: 202, y: 202, fontSize: 20, color: '#000', opacity: 1 },
    ];

    window.Tools.setTool('text');
    clickCanvas(dom, 205, 205);

    assertEqual(window.Tools.editingTextIndex, 1, 'the later label is picked');
    assertEqual(document.getElementById('text-input-overlay').value, 'over');

    dom.window.close();
});

test('findTextStrokeAt ignores non-text strokes and misses', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    Canvas.strokes = [
        { type: 'pencil', points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], color: '#000', size: 3, opacity: 1 },
        { type: 'text', text: 'hi', x: 200, y: 200, fontSize: 20, color: '#000', opacity: 1 },
    ];

    assertEqual(Canvas.findTextStrokeAt(50, 50), -1, 'a pencil stroke is not editable text');
    assertEqual(Canvas.findTextStrokeAt(205, 205), 1, 'inside the label');
    assertEqual(Canvas.findTextStrokeAt(900, 900), -1, 'far away');

    dom.window.close();
});

test('editing works after panning and zooming', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Canvas = window.Canvas;

    writeText(dom, 200, 200, 'moved');
    Canvas.pan(120, -40);
    Canvas.setScale(2, 0, 0);

    // The label now lives somewhere else on screen; click it there.
    const stroke = Canvas.strokes[0];
    const screen = Canvas.toScreen(stroke.x, stroke.y);
    clickCanvas(dom, screen.x + 4, screen.y + 4);

    assertEqual(window.Tools.editingTextIndex, 0, 'hit testing follows the transform');
    assertEqual(document.getElementById('text-input-overlay').value, 'moved');

    dom.window.close();
});

test('replaceStroke rejects an out of range index', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    Canvas.strokes = [{ type: 'text', text: 'a', x: 0, y: 0, fontSize: 12, color: '#000', opacity: 1 }];

    assertEqual(Canvas.replaceStroke(5, { type: 'text' }), false);
    assertEqual(Canvas.replaceStroke(-1, { type: 'text' }), false);
    assertEqual(Canvas.undoStack.length, 0, 'nothing recorded');

    dom.window.close();
});
