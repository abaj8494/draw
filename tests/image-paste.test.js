const { loadApp, test, assert, assertEqual } = require('./harness');

// A minimal Image replacement: records `src` and fires `onload` synchronously
// when `src` is assigned (only if a handler was attached beforehand, which
// matches the order used by Tools.handlePaste).
function installImageStub(window, { naturalWidth = 0, naturalHeight = 0 } = {}) {
    const created = [];
    class StubImage {
        constructor() {
            this._src = '';
            this.onload = null;
            this.complete = true;
            this.naturalWidth = naturalWidth;
            this.naturalHeight = naturalHeight;
            created.push(this);
        }
        set src(value) {
            this._src = value;
            if (typeof this.onload === 'function') this.onload();
        }
        get src() { return this._src; }
    }
    window.Image = StubImage;
    return created;
}

// A FileReader replacement that resolves readAsDataURL synchronously.
function installFileReaderStub(window, result) {
    const reads = [];
    class StubFileReader {
        constructor() { this.onload = null; }
        readAsDataURL(blob) {
            reads.push(blob);
            if (typeof this.onload === 'function') {
                this.onload({ target: { result } });
            }
        }
    }
    window.FileReader = StubFileReader;
    return reads;
}

function makeClipboardEvent(items) {
    let prevented = 0;
    return {
        clipboardData: items === null ? null : { items },
        preventDefault() { prevented++; },
        get preventDefaultCount() { return prevented; },
    };
}

test('addImageStroke centres the image in the viewport at scale 1', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    // Sanity check on the harness viewport, which the maths below depends on.
    assertEqual(Canvas.width, 1024, 'viewport width');
    assertEqual(Canvas.height, 768, 'viewport height');
    assertEqual(Canvas.scale, 1);
    assertEqual(Canvas.offsetX, 0);
    assertEqual(Canvas.offsetY, 0);

    const stroke = Canvas.addImageStroke('data:image/png;base64,AAA', 200, 100);

    // centre screen (512, 384) -> canvas (512, 384); minus half the image size.
    assertEqual(stroke.x, 512 - 100, 'x = centre - width/2');
    assertEqual(stroke.y, 384 - 50, 'y = centre - height/2');
    assertEqual(stroke.type, 'image');
    assertEqual(stroke.src, 'data:image/png;base64,AAA');
    assertEqual(stroke.width, 200);
    assertEqual(stroke.height, 100);
    assertEqual(stroke.opacity, 1);
    assertEqual(Canvas.strokes.length, 1);
    assertEqual(Canvas.strokes[0], stroke, 'stroke is pushed by reference');

    dom.window.close();
});

test('addImageStroke centres in world coords under a pan/zoom transform', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    Canvas.scale = 2;
    Canvas.offsetX = 100;
    Canvas.offsetY = -50;

    const stroke = Canvas.addImageStroke('data:image/png;base64,BBB', 80, 40);

    // toCanvas(512, 384) = ((512 - 100) / 2, (384 + 50) / 2) = (206, 217)
    assertEqual(stroke.x, 206 - 40, 'x = (512-100)/2 - 80/2');
    assertEqual(stroke.y, 217 - 20, 'y = (384+50)/2 - 40/2');
    assertEqual(stroke.width, 80);
    assertEqual(stroke.height, 40);

    dom.window.close();
});

test('addImageStroke pushes an add undo entry and clears the redo stack', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    // Seed the redo stack so we can prove it gets cleared.
    Canvas.redoStack.push({ action: 'add', stroke: { type: 'image' } });

    const stroke = Canvas.addImageStroke('data:image/png;base64,CCC', 10, 10);

    assertEqual(Canvas.undoStack.length, 1);
    assertEqual(Canvas.undoStack[0].action, 'add');
    assertEqual(Canvas.undoStack[0].stroke, stroke);
    assertEqual(Canvas.redoStack.length, 0, 'redo stack should be cleared');

    dom.window.close();
});

test('undo removes an image stroke and makes it redoable', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    const stroke = Canvas.addImageStroke('data:image/png;base64,DDD', 60, 30);
    assertEqual(Canvas.strokes.length, 1);

    assertEqual(Canvas.undo(), true);
    assertEqual(Canvas.strokes.length, 0, 'image stroke removed by undo');
    assertEqual(Canvas.undoStack.length, 0);
    assertEqual(Canvas.redoStack.length, 1);

    assertEqual(Canvas.redo(), true);
    assertEqual(Canvas.strokes.length, 1);
    assertEqual(Canvas.strokes[0], stroke, 'redo restores the same stroke object');

    dom.window.close();
});

test('getImage memoises Image elements per src in imageCache', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;
    installImageStub(dom.window, { naturalWidth: 4, naturalHeight: 4 });

    const src = 'data:image/png;base64,EEE';
    assertEqual(Canvas.imageCache.has(src), false);

    const first = Canvas.getImage(src);
    assertEqual(Canvas.imageCache.size, 1);
    assertEqual(Canvas.imageCache.get(src), first);
    assertEqual(first.src, src, 'src is assigned on the created image');

    const second = Canvas.getImage(src);
    assert(second === first, 'same src must return the identical cached object');
    assertEqual(Canvas.imageCache.size, 1, 'no extra cache entry on a repeat call');

    const other = Canvas.getImage('data:image/png;base64,FFF');
    assert(other !== first, 'a different src gets its own Image');
    assertEqual(Canvas.imageCache.size, 2);

    dom.window.close();
});

test('renderImageStroke pulls its image through the cache', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;
    installImageStub(dom.window, { naturalWidth: 20, naturalHeight: 10 });

    const stroke = Canvas.addImageStroke('data:image/png;base64,GGG', 20, 10);
    Canvas.renderImageStroke(stroke);

    assertEqual(Canvas.imageCache.size, 1);
    assert(Canvas.imageCache.has(stroke.src), 'stroke src is cached after render');

    dom.window.close();
});

test('handlePaste inserts one image stroke with the pasted natural size', async () => {
    const dom = await loadApp();
    const Tools = dom.window.Tools;
    const Canvas = dom.window.Canvas;

    const dataURL = 'data:image/png;base64,AAA';
    const reads = installFileReaderStub(dom.window, dataURL);
    installImageStub(dom.window, { naturalWidth: 320, naturalHeight: 240 });

    const blob = { __stubBlob: true };
    const evt = makeClipboardEvent([
        { type: 'image/png', getAsFile: () => blob },
    ]);

    Tools.handlePaste(evt);

    assertEqual(evt.preventDefaultCount, 1, 'preventDefault called for an image item');
    assertEqual(reads.length, 1, 'blob handed to FileReader.readAsDataURL');
    assertEqual(reads[0], blob);
    assertEqual(Canvas.strokes.length, 1, 'exactly one stroke added');

    const stroke = Canvas.strokes[0];
    assertEqual(stroke.type, 'image');
    assertEqual(stroke.src, dataURL);
    assertEqual(stroke.width, 320);
    assertEqual(stroke.height, 240);
    assertEqual(stroke.x, 512 - 160);
    assertEqual(stroke.y, 384 - 120);

    dom.window.close();
});

test('handlePaste only handles the first image item in the clipboard', async () => {
    const dom = await loadApp();
    const Tools = dom.window.Tools;
    const Canvas = dom.window.Canvas;

    installFileReaderStub(dom.window, 'data:image/png;base64,AAA');
    installImageStub(dom.window, { naturalWidth: 100, naturalHeight: 50 });

    let secondAsked = 0;
    const evt = makeClipboardEvent([
        { type: 'text/plain', getAsFile: () => null },
        { type: 'image/png', getAsFile: () => ({}) },
        { type: 'image/jpeg', getAsFile: () => { secondAsked++; return {}; } },
    ]);

    Tools.handlePaste(evt);

    assertEqual(Canvas.strokes.length, 1, 'only the first image becomes a stroke');
    assertEqual(secondAsked, 0, 'the second image item is never read');
    assertEqual(evt.preventDefaultCount, 1);

    dom.window.close();
});

test('handlePaste ignores a text-only clipboard', async () => {
    const dom = await loadApp();
    const Tools = dom.window.Tools;
    const Canvas = dom.window.Canvas;

    installFileReaderStub(dom.window, 'data:image/png;base64,AAA');
    installImageStub(dom.window, { naturalWidth: 10, naturalHeight: 10 });

    const evt = makeClipboardEvent([
        { type: 'text/plain', getAsFile: () => null },
    ]);

    Tools.handlePaste(evt);

    assertEqual(Canvas.strokes.length, 0, 'no stroke for a text paste');
    assertEqual(evt.preventDefaultCount, 0, 'default not prevented for a text paste');
    assertEqual(Canvas.undoStack.length, 0);

    dom.window.close();
});

test('handlePaste tolerates an image item whose getAsFile returns null', async () => {
    const dom = await loadApp();
    const Tools = dom.window.Tools;
    const Canvas = dom.window.Canvas;

    const reads = installFileReaderStub(dom.window, 'data:image/png;base64,AAA');
    installImageStub(dom.window, { naturalWidth: 10, naturalHeight: 10 });

    const evt = makeClipboardEvent([
        { type: 'image/png', getAsFile: () => null },
    ]);

    Tools.handlePaste(evt);

    assertEqual(Canvas.strokes.length, 0, 'no stroke when there is no blob');
    assertEqual(reads.length, 0, 'FileReader never used');
    // NOTE: preventDefault fires before the blob is checked, so a null blob
    // still swallows the paste. That is the current behaviour.
    assertEqual(evt.preventDefaultCount, 1);

    dom.window.close();
});

test('handlePaste does not throw when the event has no clipboardData', async () => {
    const dom = await loadApp();
    const Tools = dom.window.Tools;
    const Canvas = dom.window.Canvas;

    Tools.handlePaste({ preventDefault() {} });
    Tools.handlePaste(makeClipboardEvent(null));
    Tools.handlePaste({ clipboardData: {}, preventDefault() {} });

    assertEqual(Canvas.strokes.length, 0);

    dom.window.close();
});
