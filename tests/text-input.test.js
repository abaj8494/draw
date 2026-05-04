const { loadApp, test, assert, assertEqual } = require('./harness');

test('clicking canvas with text tool opens overlay and keeps focus on textarea', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Tools = window.Tools;
    const Canvas = window.Canvas;

    Tools.setTool('text');
    assertEqual(Tools.currentTool, 'text');

    const overlay = document.getElementById('text-input-overlay');
    assert(overlay.classList.contains('hidden'), 'overlay should start hidden');

    // Track focus/blur the same way the browser fires them.
    const events = [];
    overlay.addEventListener('focus', () => events.push('focus'));
    overlay.addEventListener('blur', () => events.push('blur'));

    const evt = new window.MouseEvent('mousedown', {
        clientX: 250, clientY: 180, bubbles: true, cancelable: true, button: 0,
    });
    Canvas.drawCanvas.dispatchEvent(evt);

    assert(!overlay.classList.contains('hidden'), 'overlay should be visible after click');
    assertEqual(Tools.textInputActive, true, 'textInputActive should be true');
    assertEqual(document.activeElement, overlay, 'textarea should be the active element');
    assert(evt.defaultPrevented, 'mousedown default action must be prevented to keep focus on textarea');

    dom.window.close();
});

test('typing and pressing Enter commits a text stroke at canvas coords', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Tools = window.Tools;
    const Canvas = window.Canvas;

    Tools.setTool('text');
    const overlay = document.getElementById('text-input-overlay');
    Canvas.drawCanvas.dispatchEvent(new window.MouseEvent('mousedown', {
        clientX: 100, clientY: 80, bubbles: true, cancelable: true, button: 0,
    }));

    overlay.value = 'Hello world';
    overlay.onkeydown({ key: 'Enter', shiftKey: false, preventDefault: () => {} });

    assert(overlay.classList.contains('hidden'), 'overlay should hide after Enter');
    assertEqual(Tools.textInputActive, false);
    assertEqual(Canvas.strokes.length, 1);
    const stroke = Canvas.strokes[0];
    assertEqual(stroke.type, 'text');
    assertEqual(stroke.text, 'Hello world');
    assertEqual(stroke.x, 100);
    assertEqual(stroke.y, 80);

    dom.window.close();
});

test('Escape cancels text input without creating a stroke', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Tools = window.Tools;
    const Canvas = window.Canvas;

    Tools.setTool('text');
    Canvas.drawCanvas.dispatchEvent(new window.MouseEvent('mousedown', {
        clientX: 50, clientY: 50, bubbles: true, cancelable: true, button: 0,
    }));
    const overlay = document.getElementById('text-input-overlay');
    overlay.value = 'should not be saved';
    overlay.onkeydown({ key: 'Escape', preventDefault: () => {} });

    assert(overlay.classList.contains('hidden'));
    assertEqual(Tools.textInputActive, false);
    assertEqual(Canvas.strokes.length, 0);

    dom.window.close();
});

test('committing empty text does not create a stroke', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Tools = window.Tools;
    const Canvas = window.Canvas;

    Tools.setTool('text');
    Canvas.drawCanvas.dispatchEvent(new window.MouseEvent('mousedown', {
        clientX: 10, clientY: 10, bubbles: true, cancelable: true, button: 0,
    }));
    const overlay = document.getElementById('text-input-overlay');
    overlay.value = '   ';
    overlay.onkeydown({ key: 'Enter', shiftKey: false, preventDefault: () => {} });

    assertEqual(Canvas.strokes.length, 0);

    dom.window.close();
});
