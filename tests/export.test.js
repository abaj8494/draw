const { loadApp, test, assert, assertEqual } = require('./harness');

// A 2D context that records the calls we care about, so the shared render path
// can be asserted without a real canvas.
function recordingCtx() {
    const calls = [];
    const rec = (name) => (...args) => calls.push({ name, args });
    return {
        calls,
        find: (name) => calls.filter(c => c.name === name),
        clearRect: rec('clearRect'), save: rec('save'), restore: rec('restore'),
        beginPath: rec('beginPath'), moveTo: rec('moveTo'), lineTo: rec('lineTo'),
        stroke: rec('stroke'), fill: rec('fill'), arc: rec('arc'),
        fillText: rec('fillText'), fillRect: rec('fillRect'), strokeRect: rec('strokeRect'),
        closePath: rec('closePath'), quadraticCurveTo: rec('quadraticCurveTo'),
        drawImage: rec('drawImage'), clip: rec('clip'), scale: rec('scale'),
        translate: rec('translate'), rotate: rec('rotate'), setTransform: rec('setTransform'),
        transform: rec('transform'), resetTransform: rec('resetTransform'),
        setLineDash: rec('setLineDash'), getLineDash: () => [],
        isPointInPath: () => false,
        createLinearGradient: () => ({ addColorStop() {} }),
        createPattern: () => null,
        measureText: (t) => ({ width: (t || '').length * 8 }),
        fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', lineJoin: '',
        globalAlpha: 1, globalCompositeOperation: '', font: '',
        textBaseline: '', textAlign: '',
    };
}

const pencil = (points, extra) => Object.assign({
    type: 'pencil', points, color: '#123456', size: 4, opacity: 1,
}, extra);

test('renderScene paints the background then every stroke', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Export = window.Export;

    Canvas.currentBackground = 'blank-light';
    Canvas.strokes = [
        pencil([{ x: 0, y: 0 }, { x: 10, y: 10 }]),
        pencil([{ x: 20, y: 20 }, { x: 30, y: 30 }]),
    ];

    const ctx = recordingCtx();
    Export.renderScene(ctx);

    const fills = ctx.find('fillRect');
    assertEqual(fills.length, 1, 'background should be filled exactly once');
    assertEqual(fills[0].args[2], Canvas.width);
    assertEqual(fills[0].args[3], Canvas.height);
    // Two strokes, each ending in a stroke() call.
    assert(ctx.find('stroke').length >= 2, 'each stroke should be painted');

    dom.window.close();
});

test('renderScene draws grid lines only for grid backgrounds', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Export = window.Export;

    Canvas.strokes = [];

    Canvas.currentBackground = 'blank-dark';
    const blank = recordingCtx();
    Export.renderScene(blank);
    assertEqual(blank.find('moveTo').length, 0, 'blank background has no grid');

    Canvas.currentBackground = 'grid-light';
    const grid = recordingCtx();
    Export.renderScene(grid);
    assert(grid.find('moveTo').length > 0, 'grid background draws lines');

    dom.window.close();
});

test('renderToCanvas sizes the offscreen canvas for the device pixel ratio', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Export = window.Export;

    Canvas.dpr = 2;
    Canvas.strokes = [];

    const canvas = Export.renderToCanvas();
    assertEqual(canvas.width, Canvas.width * 2);
    assertEqual(canvas.height, Canvas.height * 2);

    dom.window.close();
});

test('toPNG downloads a png without throwing', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Canvas = window.Canvas;
    const Export = window.Export;

    Canvas.strokes = [
        pencil([{ x: 5, y: 5 }, { x: 40, y: 40 }]),
        { type: 'text', text: 'hi', x: 10, y: 10, fontSize: 16, color: '#000', opacity: 1 },
    ];

    const downloads = [];
    const originalCreate = document.createElement.bind(document);
    document.createElement = function(tag) {
        const el = originalCreate(tag);
        if (tag === 'a') el.click = () => downloads.push(el.download);
        return el;
    };

    Export.toPNG();

    assertEqual(downloads.length, 1);
    assertEqual(downloads[0], 'drawing.png');

    document.createElement = originalCreate;
    dom.window.close();
});

test('toPDF reports missing jsPDF instead of throwing', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Export = window.Export;

    const alerts = [];
    window.alert = (msg) => alerts.push(msg);

    window.Canvas.strokes = [pencil([{ x: 1, y: 1 }, { x: 2, y: 2 }])];
    Export.toPDF();

    assertEqual(alerts.length, 1, 'user should be told jsPDF is unavailable');
    assert(/jsPDF/.test(alerts[0]));

    dom.window.close();
});

test('buildSVG emits a path per freehand stroke', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Export = window.Export;

    Canvas.currentBackground = 'blank-light';
    Canvas.strokes = [
        pencil([{ x: 0, y: 0 }, { x: 10, y: 10 }]),
        pencil([{ x: 20, y: 20 }, { x: 30, y: 30 }], { color: '#ff0000' }),
    ];

    const svg = Export.buildSVG();

    assert(svg.startsWith('<?xml'), 'should be a standalone document');
    assert(svg.trim().endsWith('</svg>'));
    assertEqual((svg.match(/<path /g) || []).length, 2);
    assert(svg.includes('stroke="#123456"'));
    assert(svg.includes('stroke="#ff0000"'));

    dom.window.close();
});

test('buildSVG embeds images and escapes text', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Export = window.Export;

    Canvas.currentBackground = 'blank-light';
    Canvas.strokes = [
        { type: 'image', src: 'data:image/png;base64,AAA', x: 0, y: 0, width: 100, height: 50, opacity: 1 },
        { type: 'text', text: 'a < b & c', x: 5, y: 5, fontSize: 20, color: '#000000', opacity: 1 },
    ];

    const svg = Export.buildSVG();

    assert(svg.includes('href="data:image/png;base64,AAA"'), 'image should be embedded');
    assert(svg.includes('a &lt; b &amp; c'), 'text must be XML-escaped');
    assert(!svg.includes('a < b & c'), 'raw text must not leak into the document');

    dom.window.close();
});

test('buildSVG emits one text element per line', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Export = window.Export;

    Canvas.currentBackground = 'blank-light';
    Canvas.strokes = [
        { type: 'text', text: 'one\ntwo\nthree', x: 0, y: 0, fontSize: 10, color: '#000', opacity: 1 },
    ];

    const svg = Export.buildSVG();
    assertEqual((svg.match(/<text /g) || []).length, 3);

    dom.window.close();
});

test('buildSVG includes a grid pattern only for grid backgrounds', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Export = window.Export;

    Canvas.strokes = [];

    Canvas.currentBackground = 'grid-sepia';
    assert(Export.buildSVG().includes('<pattern id="grid"'));

    Canvas.currentBackground = 'blank-sepia';
    assert(!Export.buildSVG().includes('<pattern id="grid"'));

    dom.window.close();
});

test('buildSVG registers strokes with images at a non-identity zoom', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Export = window.Export;

    Canvas.currentBackground = 'blank-light';
    Canvas.scale = 2;
    Canvas.offsetX = 30;
    Canvas.offsetY = -10;

    // A pen stroke and an image that both start at the same world point must
    // land at the same place in the exported document.
    Canvas.strokes = [
        { type: 'image', src: 'data:image/png;base64,AAA', x: 100, y: 50, width: 10, height: 10, opacity: 1 },
        pencil([{ x: 100, y: 50 }, { x: 120, y: 70 }]),
    ];

    const svg = Export.buildSVG();
    const expected = Canvas.toScreen(100, 50);

    assertEqual(expected.x, 230);
    assertEqual(expected.y, 90);
    assert(svg.includes(`<image x="230" y="90"`), 'image anchored at the screen position');
    assert(svg.includes(`d="M 230 90`), 'path must start at the same screen position');

    dom.window.close();
});

test('buildSVG scales stroke width with the zoom level', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Export = window.Export;

    Canvas.currentBackground = 'blank-light';
    Canvas.strokes = [pencil([{ x: 0, y: 0 }, { x: 10, y: 10 }])]; // size 4

    Canvas.scale = 1;
    assert(Export.buildSVG().includes('stroke-width="4"'));

    Canvas.scale = 3;
    assert(Export.buildSVG().includes('stroke-width="12"'), 'width must track the zoom');

    dom.window.close();
});

test('toSVG downloads the document built by buildSVG', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Export = window.Export;

    window.Canvas.strokes = [pencil([{ x: 0, y: 0 }, { x: 1, y: 1 }])];
    window.URL.createObjectURL = () => 'blob:fake';
    window.URL.revokeObjectURL = () => {};

    const downloads = [];
    const originalCreate = document.createElement.bind(document);
    document.createElement = function(tag) {
        const el = originalCreate(tag);
        if (tag === 'a') el.click = () => downloads.push(el.download);
        return el;
    };

    Export.toSVG();

    assertEqual(downloads.length, 1);
    assertEqual(downloads[0], 'drawing.svg');

    document.createElement = originalCreate;
    dom.window.close();
});
