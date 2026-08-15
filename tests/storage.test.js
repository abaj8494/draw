const { loadApp, test, assert, assertEqual } = require('./harness');

// Replace dom.window.fetch with a recorder. The app sources call a bare
// `fetch(...)`, which resolves to window.fetch at call time, so reassigning
// dom.window.fetch is enough to intercept every request.
function recordFetch(dom, responder) {
    const calls = [];
    dom.window.fetch = (url, options) => {
        calls.push({ url, options });
        const res = (responder && responder(url, options)) || {};
        return Promise.resolve({
            ok: res.ok !== undefined ? res.ok : true,
            json: () => Promise.resolve(res.body !== undefined ? res.body : {}),
            text: () => Promise.resolve(res.text !== undefined ? res.text : ''),
        });
    };
    return calls;
}

const sampleState = () => ({
    strokes: [
        { type: 'pencil', color: '#ff0000', size: 4, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
        { type: 'text', text: 'hi', x: 10, y: 20, color: '#000000', size: 16 },
    ],
    background: 'grid-dark',
    offsetX: -42,
    offsetY: 17,
    scale: 2.5,
});

test('autoSave then loadAutoSave round-trips strokes, background, offsets and scale', async () => {
    const dom = await loadApp();
    const Storage = dom.window.Storage;

    const state = sampleState();
    Storage.autoSave(state);

    const raw = dom.window.localStorage.getItem(Storage.AUTO_SAVE_KEY);
    assert(typeof raw === 'string' && raw.length > 0, 'autosave key should hold a JSON string');

    const loaded = Storage.loadAutoSave();
    assertEqual(loaded.background, 'grid-dark');
    assertEqual(loaded.offsetX, -42);
    assertEqual(loaded.offsetY, 17);
    assertEqual(loaded.scale, 2.5);
    assertEqual(loaded.strokes.length, 2);
    assertEqual(loaded.strokes[0].type, 'pencil');
    assertEqual(loaded.strokes[0].color, '#ff0000');
    assertEqual(loaded.strokes[0].points.length, 2);
    assertEqual(loaded.strokes[0].points[1].y, 4);
    assertEqual(loaded.strokes[1].text, 'hi');
    assertEqual(loaded.strokes[1].x, 10);

    dom.window.close();
});

test('loadAutoSave returns null when nothing is stored and does not throw', async () => {
    const dom = await loadApp();
    const Storage = dom.window.Storage;

    dom.window.localStorage.removeItem(Storage.AUTO_SAVE_KEY);
    assertEqual(Storage.loadAutoSave(), null, 'no stored autosave should yield null');

    dom.window.close();
});

test('loadAutoSave swallows corrupt JSON and returns null', async () => {
    const dom = await loadApp();
    const Storage = dom.window.Storage;

    dom.window.localStorage.setItem(Storage.AUTO_SAVE_KEY, '{not json at all,,,');
    let threw = null;
    let result;
    try {
        result = Storage.loadAutoSave();
    } catch (e) {
        threw = e;
    }
    assertEqual(threw, null, 'loadAutoSave must not throw on corrupt JSON');
    assertEqual(result, null, 'corrupt JSON should yield null');

    dom.window.close();
});

test('clearAutoSave removes the autosave key', async () => {
    const dom = await loadApp();
    const Storage = dom.window.Storage;

    Storage.autoSave(sampleState());
    assert(dom.window.localStorage.getItem(Storage.AUTO_SAVE_KEY) !== null, 'key should exist first');

    Storage.clearAutoSave();
    assertEqual(dom.window.localStorage.getItem(Storage.AUTO_SAVE_KEY), null);
    assertEqual(Storage.loadAutoSave(), null);

    dom.window.close();
});

test('saveSettings and loadSettings round-trip tool settings', async () => {
    const dom = await loadApp();
    const Storage = dom.window.Storage;

    const settings = {
        tool: 'marker',
        size: 12,
        color: '#00ff00',
        shapeSnap: true,
        toolDefaults: { pencil: { size: 2 }, marker: { size: 12 } },
    };
    Storage.saveSettings(settings);

    const loaded = Storage.loadSettings();
    assertEqual(loaded.tool, 'marker');
    assertEqual(loaded.size, 12);
    assertEqual(loaded.color, '#00ff00');
    assertEqual(loaded.shapeSnap, true);
    assertEqual(loaded.toolDefaults.marker.size, 12);

    dom.window.localStorage.removeItem(Storage.SETTINGS_KEY);
    assertEqual(Storage.loadSettings(), null, 'missing settings should yield null');

    dom.window.close();
});

test('Canvas.getState survives a JSON round-trip through loadState', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    Canvas.strokes = sampleState().strokes;
    Canvas.currentBackground = 'grid-dark';
    Canvas.offsetX = -42;
    Canvas.offsetY = 17;
    Canvas.scale = 2.5;

    const serialized = JSON.parse(JSON.stringify(Canvas.getState()));

    // Wipe the canvas, then restore from the serialized snapshot.
    Canvas.strokes = [];
    Canvas.currentBackground = 'grid-light';
    Canvas.offsetX = 0;
    Canvas.offsetY = 0;
    Canvas.scale = 1;

    Canvas.loadState(serialized);

    assertEqual(Canvas.strokes.length, 2);
    assertEqual(Canvas.strokes[0].type, 'pencil');
    assertEqual(Canvas.strokes[0].points[1].x, 3);
    assertEqual(Canvas.strokes[1].text, 'hi');
    assertEqual(Canvas.currentBackground, 'grid-dark');
    assertEqual(Canvas.offsetX, -42);
    assertEqual(Canvas.offsetY, 17);
    assertEqual(Canvas.scale, 2.5);

    dom.window.close();
});

test('loadState clears both the undo and redo stacks', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    Canvas.undoStack = [[], [{ type: 'pencil' }]];
    Canvas.redoStack = [[{ type: 'pencil' }]];

    Canvas.loadState(JSON.parse(JSON.stringify(sampleState())));

    assertEqual(Canvas.undoStack.length, 0, 'loadState deliberately drops undo history');
    assertEqual(Canvas.redoStack.length, 0, 'loadState deliberately drops redo history');

    dom.window.close();
});

test('loadState with an empty object falls back to documented defaults', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    Canvas.strokes = sampleState().strokes;
    Canvas.currentBackground = 'grid-dark';
    Canvas.offsetX = 99;
    Canvas.offsetY = 88;
    Canvas.scale = 3;

    Canvas.loadState({});

    assertEqual(Canvas.strokes.length, 0);
    assertEqual(Canvas.currentBackground, 'grid-light');
    assertEqual(Canvas.offsetX, 0);
    assertEqual(Canvas.offsetY, 0);
    assertEqual(Canvas.scale, 1);

    dom.window.close();
});

test('loadState with a partial object keeps defaults for missing fields', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    Canvas.offsetX = 5;
    Canvas.offsetY = 5;
    Canvas.scale = 4;
    Canvas.currentBackground = 'grid-dark';

    Canvas.loadState({ strokes: [{ type: 'text', text: 'only strokes', x: 0, y: 0 }] });

    assertEqual(Canvas.strokes.length, 1);
    assertEqual(Canvas.strokes[0].text, 'only strokes');
    assertEqual(Canvas.currentBackground, 'grid-light');
    assertEqual(Canvas.offsetX, 0);
    assertEqual(Canvas.offsetY, 0);
    assertEqual(Canvas.scale, 1);

    // A null/undefined state is a no-op rather than a reset.
    Canvas.loadState(null);
    assertEqual(Canvas.strokes.length, 1, 'loadState(null) must leave the canvas untouched');

    dom.window.close();
});

// NOTE: Canvas.loadState() does not validate `background` against
// Canvas.backgrounds. A persisted state naming a background that no longer
// exists (renamed/removed preset, hand-edited save file) makes drawBackground()
// throw "Cannot read properties of undefined (reading 'bg')" and aborts the
// load. Asserting the actual behaviour here rather than the desired one.
test('loadState with an unknown background name throws from drawBackground', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    let message = null;
    try {
        Canvas.loadState({ strokes: [], background: 'no-such-background' });
    } catch (e) {
        message = e.message;
    }
    assert(message !== null, 'unknown background currently throws instead of falling back');
    assert(/bg/.test(message), `unexpected error: ${message}`);

    dom.window.close();
});

test('generateDefaultName produces a YYYY-MM-DD_HH-MM-SS timestamp', async () => {
    const dom = await loadApp();
    const Storage = dom.window.Storage;

    const name = Storage.generateDefaultName();
    assert(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(name), `bad default name: ${name}`);

    dom.window.close();
});

test('saveDrawing POSTs {name, data} as JSON to /api/save', async () => {
    const dom = await loadApp();
    const Storage = dom.window.Storage;

    const calls = recordFetch(dom, () => ({ ok: true, body: { name: 'my-drawing' } }));

    const state = sampleState();
    const returned = await Storage.saveDrawing('my-drawing', state);

    assertEqual(calls.length, 1);
    assertEqual(calls[0].url, '/api/save');
    assertEqual(calls[0].options.method, 'POST');
    assertEqual(calls[0].options.headers['Content-Type'], 'application/json');

    const body = JSON.parse(calls[0].options.body);
    assertEqual(Object.keys(body).sort().join(','), 'data,name');
    assertEqual(body.name, 'my-drawing');
    assertEqual(body.data.background, 'grid-dark');
    assertEqual(body.data.scale, 2.5);
    assertEqual(body.data.strokes.length, 2);

    // saveDrawing resolves with the server-reported name.
    assertEqual(returned, 'my-drawing');

    dom.window.close();
});

test('saveDrawing with no name falls back to the generated timestamp name', async () => {
    const dom = await loadApp();
    const Storage = dom.window.Storage;

    const calls = recordFetch(dom, () => ({ ok: true, body: { name: 'server-name' } }));
    await Storage.saveDrawing('', sampleState());

    const body = JSON.parse(calls[0].options.body);
    assert(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(body.name), `bad fallback name: ${body.name}`);

    dom.window.close();
});

test('saveDrawing rejects with the server error message when the response is not ok', async () => {
    const dom = await loadApp();
    const Storage = dom.window.Storage;

    recordFetch(dom, () => ({ ok: false, body: { error: 'disk full' } }));

    let message = null;
    try {
        await Storage.saveDrawing('x', sampleState());
    } catch (e) {
        message = e.message;
    }
    assertEqual(message, 'disk full');

    dom.window.close();
});

test('loadDrawing GETs /api/load/<encoded name> and wraps the payload', async () => {
    const dom = await loadApp();
    const Storage = dom.window.Storage;

    const stored = sampleState();
    const calls = recordFetch(dom, () => ({ ok: true, body: stored }));

    const result = await Storage.loadDrawing('my drawing/1');

    assertEqual(calls.length, 1);
    assertEqual(calls[0].url, '/api/load/my%20drawing%2F1');
    // No options object at all: a plain GET.
    assertEqual(calls[0].options, undefined);

    assertEqual(result.id, 'my drawing/1');
    assertEqual(result.name, 'my drawing/1');
    assertEqual(result.data.background, 'grid-dark');
    assertEqual(result.data.strokes.length, 2);

    dom.window.close();
});

test('loadDrawing throws "Drawing not found" on a non-ok response', async () => {
    const dom = await loadApp();
    const Storage = dom.window.Storage;

    recordFetch(dom, () => ({ ok: false }));

    let message = null;
    try {
        await Storage.loadDrawing('missing');
    } catch (e) {
        message = e.message;
    }
    assertEqual(message, 'Drawing not found');

    dom.window.close();
});

test('listDrawings GETs /api/list and converts timestamps to milliseconds', async () => {
    const dom = await loadApp();
    const Storage = dom.window.Storage;

    const calls = recordFetch(dom, () => ({
        ok: true,
        body: [
            { name: 'alpha', timestamp: 1700000000 },
            { name: 'beta', timestamp: 1700000060 },
        ],
    }));

    const drawings = await Storage.listDrawings();

    assertEqual(calls.length, 1);
    assertEqual(calls[0].url, '/api/list');
    assertEqual(calls[0].options, undefined);

    assertEqual(drawings.length, 2);
    assertEqual(drawings[0].id, 'alpha');
    assertEqual(drawings[0].name, 'alpha');
    assertEqual(drawings[0].timestamp, 1700000000000);
    assertEqual(drawings[1].timestamp, 1700000060000);

    dom.window.close();
});

test('deleteDrawing sends DELETE to /api/delete/<encoded name>', async () => {
    const dom = await loadApp();
    const Storage = dom.window.Storage;

    const calls = recordFetch(dom, () => ({ ok: true }));
    await Storage.deleteDrawing('a b&c');

    assertEqual(calls.length, 1);
    assertEqual(calls[0].url, '/api/delete/a%20b%26c');
    assertEqual(calls[0].options.method, 'DELETE');

    // Non-ok responses surface as an error.
    recordFetch(dom, () => ({ ok: false }));
    let message = null;
    try {
        await Storage.deleteDrawing('a');
    } catch (e) {
        message = e.message;
    }
    assertEqual(message, 'Failed to delete drawing');

    dom.window.close();
});

test('triggerAutoSave debounces repeated calls into a single autoSave', async () => {
    const dom = await loadApp();
    const App = dom.window.App;

    assertEqual(App.AUTO_SAVE_DELAY, 1000);

    let calls = 0;
    App.autoSave = () => { calls++; };

    App.triggerAutoSave();
    App.triggerAutoSave();
    App.triggerAutoSave();
    await new Promise(r => setTimeout(r, 200));
    App.triggerAutoSave();
    App.triggerAutoSave();

    // Not yet: the last call reset the 1s timer.
    assertEqual(calls, 0, 'autoSave must not fire before the debounce delay elapses');

    await new Promise(r => setTimeout(r, 1100));
    assertEqual(calls, 1, 'exactly one autoSave should run after the debounce window');

    dom.window.close();
});

test('debounced autoSave writes canvas state and tool settings to localStorage', async () => {
    const dom = await loadApp();
    const { App, Canvas, Storage } = dom.window;

    Storage.clearAutoSave();
    Canvas.strokes = sampleState().strokes;
    Canvas.currentBackground = 'grid-dark';
    Canvas.offsetX = -42;
    Canvas.offsetY = 17;
    Canvas.scale = 2.5;

    App.triggerAutoSave();
    App.triggerAutoSave();
    await new Promise(r => setTimeout(r, 1200));

    const saved = Storage.loadAutoSave();
    assert(saved !== null, 'autosave should have been written');
    assertEqual(saved.strokes.length, 2);
    assertEqual(saved.background, 'grid-dark');
    assertEqual(saved.offsetX, -42);
    assertEqual(saved.offsetY, 17);
    assertEqual(saved.scale, 2.5);

    const settings = Storage.loadSettings();
    assert(settings !== null, 'tool settings should have been written alongside the drawing');
    assert(typeof settings.tool === 'string', 'settings should carry the current tool');

    dom.window.close();
});
