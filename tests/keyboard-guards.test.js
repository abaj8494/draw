const { loadApp, test, assert, assertEqual } = require('./harness');

// Dispatch a real keydown from a specific element so the document-level
// listener sees it with e.target set the way a browser would.
function keydown(dom, target, init) {
    const evt = new dom.window.KeyboardEvent('keydown', Object.assign({
        bubbles: true, cancelable: true,
    }, init));
    target.dispatchEvent(evt);
    return evt;
}

test('isTypingTarget recognises text entry elements', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Tools = window.Tools;

    const input = document.getElementById('save-name');
    const textarea = document.getElementById('text-input-overlay');
    const select = document.createElement('select');
    const editable = document.createElement('div');
    editable.isContentEditable = true;

    assertEqual(Tools.isTypingTarget({ target: input }), true, 'input');
    assertEqual(Tools.isTypingTarget({ target: textarea }), true, 'textarea');
    assertEqual(Tools.isTypingTarget({ target: select }), true, 'select');
    assertEqual(Tools.isTypingTarget({ target: editable }), true, 'contenteditable');

    assertEqual(Tools.isTypingTarget({ target: window.Canvas.drawCanvas }), false, 'canvas');
    assertEqual(Tools.isTypingTarget({ target: document.body }), false, 'body');
    assertEqual(Tools.isTypingTarget({ target: null }), false, 'null target');
    assertEqual(Tools.isTypingTarget(null), false, 'null event');

    dom.window.close();
});

test('Backspace inside the save-name input does not delete the selection', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Tools = window.Tools;
    const Canvas = window.Canvas;

    Canvas.strokes = [
        { type: 'pencil', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], color: '#000', size: 3, opacity: 1 },
        { type: 'pencil', points: [{ x: 50, y: 50 }], color: '#000', size: 3, opacity: 1 },
    ];
    Tools.selectedStrokes = [0, 1];

    keydown(dom, document.getElementById('save-name'), { key: 'Backspace' });

    assertEqual(Canvas.strokes.length, 2, 'strokes must survive a Backspace while typing');
    assertEqual(Tools.selectedStrokes.length, 2, 'selection must survive too');

    dom.window.close();
});

test('Delete inside the video URL input does not delete the selection', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Tools = window.Tools;
    const Canvas = window.Canvas;

    Canvas.strokes = [{ type: 'pencil', points: [{ x: 1, y: 1 }], color: '#000', size: 3, opacity: 1 }];
    Tools.selectedStrokes = [0];

    // Any input element stands in for a text field; use a fresh one so this
    // test does not depend on which inputs happen to exist in the markup.
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);

    keydown(dom, input, { key: 'Delete' });

    assertEqual(Canvas.strokes.length, 1, 'strokes must survive Delete while typing');

    dom.window.close();
});

test('Backspace from the canvas still deletes the selection', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Tools = window.Tools;
    const Canvas = window.Canvas;

    Canvas.strokes = [
        { type: 'pencil', points: [{ x: 0, y: 0 }], color: '#000', size: 3, opacity: 1 },
        { type: 'pencil', points: [{ x: 5, y: 5 }], color: '#000', size: 3, opacity: 1 },
    ];
    Tools.selectedStrokes = [0];

    keydown(dom, Canvas.drawCanvas, { key: 'Backspace' });

    assertEqual(Canvas.strokes.length, 1, 'the selected stroke should be gone');
    assertEqual(Tools.selectedStrokes.length, 0, 'selection should be cleared');

    dom.window.close();
});

test('Ctrl+Z inside the text overlay does not undo the drawing', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Canvas = window.Canvas;

    Canvas.strokes = [{ type: 'pencil', points: [{ x: 0, y: 0 }], color: '#000', size: 3, opacity: 1 }];
    Canvas.undoStack = [{ action: 'add', stroke: Canvas.strokes[0] }];

    keydown(dom, document.getElementById('text-input-overlay'), { key: 'z', ctrlKey: true });

    assertEqual(Canvas.strokes.length, 1, 'undo must not fire while typing');
    assertEqual(Canvas.undoStack.length, 1, 'undo stack must be untouched');

    dom.window.close();
});

test('Ctrl+Z from the canvas still undoes', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    Canvas.strokes = [{ type: 'pencil', points: [{ x: 0, y: 0 }], color: '#000', size: 3, opacity: 1 }];
    Canvas.undoStack = [{ action: 'add', stroke: Canvas.strokes[0] }];

    keydown(dom, Canvas.drawCanvas, { key: 'z', ctrlKey: true });

    assertEqual(Canvas.strokes.length, 0, 'undo should have removed the stroke');

    dom.window.close();
});

test('Shift tracking still works from a text field', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Tools = window.Tools;

    // The shift listener is separate from the shortcut listener, so typing a
    // capital letter in an input must not desync the shape-constrain state.
    keydown(dom, document.getElementById('save-name'), { key: 'Shift' });
    assertEqual(Tools.shiftHeld, true);

    const up = new window.KeyboardEvent('keyup', { key: 'Shift', bubbles: true });
    document.getElementById('save-name').dispatchEvent(up);
    assertEqual(Tools.shiftHeld, false);

    dom.window.close();
});
