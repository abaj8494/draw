const { loadApp, test, assert, assertEqual } = require('./harness');

// Build a plain point-stroke without going through the pointer pipeline.
function penStroke(points, color = '#000000', size = 4) {
    return { type: 'pen', points: points, color: color, size: size, opacity: 1 };
}

test('startStroke and addPoint store points in world coords under pan and zoom', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    Canvas.offsetX = 100;
    Canvas.offsetY = 50;
    Canvas.scale = 2;

    Canvas.startStroke('pen', 300, 250, '#ff0000', 6, 0.5);
    Canvas.addPoint(500, 450);

    const s = Canvas.currentStroke;
    assertEqual(s.type, 'pen');
    assertEqual(s.color, '#ff0000');
    assertEqual(s.size, 6);
    assertEqual(s.opacity, 0.5);
    assertEqual(s.points.length, 2);
    // toCanvas: (screen - offset) / scale
    assertEqual(s.points[0].x, 100, 'first point x in world coords');
    assertEqual(s.points[0].y, 100, 'first point y in world coords');
    assertEqual(s.points[1].x, 200, 'second point x in world coords');
    assertEqual(s.points[1].y, 200, 'second point y in world coords');

    // A stroke stays uncommitted until endStroke.
    assertEqual(Canvas.strokes.length, 0, 'nothing committed before endStroke');

    dom.window.close();
});

test('addPoint is a no-op when there is no current stroke', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    Canvas.currentStroke = null;
    Canvas.addPoint(10, 10);

    assertEqual(Canvas.currentStroke, null);
    assertEqual(Canvas.strokes.length, 0);

    dom.window.close();
});

test('endStroke commits the stroke and pushes an add undo entry', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    Canvas.offsetX = -20;
    Canvas.offsetY = 40;
    Canvas.scale = 0.5;

    Canvas.startStroke('pencil', 0, 0, '#123456', 2);
    Canvas.addPoint(30, 30);
    const pending = Canvas.currentStroke;

    assertEqual(Canvas.endStroke(), true, 'endStroke should report success');
    assertEqual(Canvas.currentStroke, null, 'currentStroke should be cleared');
    assertEqual(Canvas.strokes.length, 1);
    assertEqual(Canvas.strokes[0], pending, 'the committed stroke is the same object');
    assertEqual(Canvas.strokes[0].points[0].x, 40, 'world coords survive the commit');
    assertEqual(Canvas.strokes[0].points[0].y, -80);

    assertEqual(Canvas.undoStack.length, 1);
    assertEqual(Canvas.undoStack[0].action, 'add');
    assertEqual(Canvas.undoStack[0].stroke, pending);
    assertEqual(Canvas.redoStack.length, 0);

    dom.window.close();
});

test('endStroke with no current stroke returns false and creates nothing', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    Canvas.currentStroke = null;
    assertEqual(Canvas.endStroke(), false);
    assertEqual(Canvas.strokes.length, 0);
    assertEqual(Canvas.undoStack.length, 0);

    // An empty point list is also rejected, and clears currentStroke.
    Canvas.currentStroke = penStroke([]);
    assertEqual(Canvas.endStroke(), false);
    assertEqual(Canvas.currentStroke, null);
    assertEqual(Canvas.strokes.length, 0);
    assertEqual(Canvas.undoStack.length, 0);

    dom.window.close();
});

test('undo and redo of an add action', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    Canvas.startStroke('pen', 10, 10, '#000', 3);
    Canvas.endStroke();
    Canvas.startStroke('pen', 50, 50, '#fff', 3);
    Canvas.endStroke();
    const first = Canvas.strokes[0];
    const second = Canvas.strokes[1];

    assertEqual(Canvas.undo(), true);
    assertEqual(Canvas.strokes.length, 1);
    assertEqual(Canvas.strokes[0], first, 'the earlier stroke stays put');
    assertEqual(Canvas.undoStack.length, 1);
    assertEqual(Canvas.redoStack.length, 1);

    assertEqual(Canvas.redo(), true);
    assertEqual(Canvas.strokes.length, 2);
    assertEqual(Canvas.strokes[0], first);
    assertEqual(Canvas.strokes[1], second, 'redo restores order');
    assertEqual(Canvas.undoStack.length, 2);
    assertEqual(Canvas.redoStack.length, 0);

    dom.window.close();
});

test('undo and redo of a remove action restores the original index', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    const a = penStroke([{ x: 0, y: 0 }]);
    const b = penStroke([{ x: 1, y: 1 }]);
    const c = penStroke([{ x: 2, y: 2 }]);
    Canvas.strokes = [a, b, c];

    assertEqual(Canvas.removeStroke(1), true);
    assertEqual(Canvas.strokes.length, 2);
    assertEqual(Canvas.strokes[0], a);
    assertEqual(Canvas.strokes[1], c);
    assertEqual(Canvas.undoStack.length, 1);
    assertEqual(Canvas.undoStack[0].action, 'remove');
    assertEqual(Canvas.undoStack[0].index, 1);
    assertEqual(Canvas.undoStack[0].stroke, b);

    assertEqual(Canvas.undo(), true);
    assertEqual(Canvas.strokes.length, 3);
    assertEqual(Canvas.strokes[0], a);
    assertEqual(Canvas.strokes[1], b, 'removed stroke goes back to index 1');
    assertEqual(Canvas.strokes[2], c);

    assertEqual(Canvas.redo(), true);
    assertEqual(Canvas.strokes.length, 2);
    assertEqual(Canvas.strokes[0], a);
    assertEqual(Canvas.strokes[1], c);
    assertEqual(Canvas.undoStack.length, 1);
    assertEqual(Canvas.redoStack.length, 0);

    dom.window.close();
});

test('removeStroke rejects out-of-range and negative indices', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    Canvas.strokes = [penStroke([{ x: 0, y: 0 }]), penStroke([{ x: 1, y: 1 }])];

    assertEqual(Canvas.removeStroke(2), false, 'index === length is out of range');
    assertEqual(Canvas.removeStroke(99), false);
    assertEqual(Canvas.removeStroke(-1), false);
    assertEqual(Canvas.strokes.length, 2, 'nothing was removed');
    assertEqual(Canvas.undoStack.length, 0, 'no undo entry for a rejected removal');

    // Empty canvas: index 0 is also out of range.
    Canvas.strokes = [];
    assertEqual(Canvas.removeStroke(0), false);
    assertEqual(Canvas.undoStack.length, 0);

    dom.window.close();
});

test('deleteStrokes removes the selected strokes and keeps the rest', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    const a = penStroke([{ x: 0, y: 0 }]);
    const b = penStroke([{ x: 1, y: 1 }]);
    const c = penStroke([{ x: 2, y: 2 }]);
    Canvas.strokes = [a, b, c];

    Canvas.deleteStrokes([0, 2]);

    assertEqual(Canvas.strokes.length, 1);
    assertEqual(Canvas.strokes[0], b, 'the surviving stroke is the one that was at index 1');
    assertEqual(Canvas.undoStack.length, 1);
    assertEqual(Canvas.undoStack[0].action, 'remove-multiple');
    assertEqual(Canvas.undoStack[0].strokes.length, 2);
    assertEqual(Canvas.redoStack.length, 0);

    dom.window.close();
});

test('undo of remove-multiple restores every stroke at its original index', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    const a = penStroke([{ x: 0, y: 0 }]);
    const b = penStroke([{ x: 1, y: 1 }]);
    const c = penStroke([{ x: 2, y: 2 }]);
    Canvas.strokes = [a, b, c];

    Canvas.deleteStrokes([0, 2]);
    assertEqual(Canvas.undo(), true);

    assertEqual(Canvas.strokes.length, 3);
    assertEqual(Canvas.strokes[0], a, 'index 0 restored');
    assertEqual(Canvas.strokes[1], b, 'index 1 unchanged');
    assertEqual(Canvas.strokes[2], c, 'index 2 restored');
    assertEqual(Canvas.undoStack.length, 0);
    assertEqual(Canvas.redoStack.length, 1);

    dom.window.close();
});

test('redo of remove-multiple deletes the same strokes again', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    const a = penStroke([{ x: 0, y: 0 }]);
    const b = penStroke([{ x: 1, y: 1 }]);
    const c = penStroke([{ x: 2, y: 2 }]);
    const d = penStroke([{ x: 3, y: 3 }]);
    Canvas.strokes = [a, b, c, d];

    Canvas.deleteStrokes([1, 3]);
    assertEqual(Canvas.strokes.length, 2);
    Canvas.undo();
    assertEqual(Canvas.strokes.length, 4);

    assertEqual(Canvas.redo(), true);
    assertEqual(Canvas.strokes.length, 2);
    assertEqual(Canvas.strokes[0], a);
    assertEqual(Canvas.strokes[1], c);
    assertEqual(Canvas.undoStack.length, 1);
    assertEqual(Canvas.redoStack.length, 0);

    // And it round-trips a second time.
    Canvas.undo();
    assertEqual(Canvas.strokes.length, 4);
    assertEqual(Canvas.strokes[1], b);
    assertEqual(Canvas.strokes[3], d);

    dom.window.close();
});

test('undo and redo of a resize action restores stroke geometry', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    const a = penStroke([{ x: 0, y: 0 }, { x: 10, y: 20 }], '#000', 4);
    const b = penStroke([{ x: 100, y: 100 }], '#000', 2);
    Canvas.strokes = [a, b];

    // Tools pushes the resize entry itself (js/tools.js, pointer-up on 'move'),
    // snapshotting the originals before Canvas.resizeStrokes mutates them.
    const indices = [0];
    const originalStrokes = indices.map(i => JSON.parse(JSON.stringify(Canvas.strokes[i])));
    Canvas.resizeStrokes(indices, 0, 0, 2, 3);
    Canvas.undoStack.push({ action: 'resize', indices: indices, originalStrokes: originalStrokes });
    Canvas.redoStack = [];

    assertEqual(Canvas.strokes[0].points[1].x, 20);
    assertEqual(Canvas.strokes[0].points[1].y, 60);
    assertEqual(Canvas.strokes[0].size, 12, 'size scales by max(|scaleX|, |scaleY|)');
    assertEqual(Canvas.strokes[1].size, 2, 'unselected stroke untouched');

    assertEqual(Canvas.undo(), true);
    assertEqual(Canvas.strokes.length, 2);
    assertEqual(Canvas.strokes[0].points[0].x, 0);
    assertEqual(Canvas.strokes[0].points[0].y, 0);
    assertEqual(Canvas.strokes[0].points[1].x, 10);
    assertEqual(Canvas.strokes[0].points[1].y, 20);
    assertEqual(Canvas.strokes[0].size, 4);
    assertEqual(Canvas.strokes[1], b, 'other strokes keep their identity and index');
    assertEqual(Canvas.redoStack.length, 1);
    assertEqual(Canvas.redoStack[0].resizedStrokes.length, 1, 'redo entry carries the resized copy');

    assertEqual(Canvas.redo(), true);
    assertEqual(Canvas.strokes[0].points[1].x, 20);
    assertEqual(Canvas.strokes[0].points[1].y, 60);
    assertEqual(Canvas.strokes[0].size, 12);
    assertEqual(Canvas.undoStack.length, 1);
    assertEqual(Canvas.redoStack.length, 0);

    // NOTE: undo/redo of 'resize' replaces strokes with JSON deep copies, so the
    // array slot no longer holds the original object identity.
    assert(Canvas.strokes[0] !== a, 'resize undo/redo swaps in a cloned stroke object');

    dom.window.close();
});

test('undo and redo of a clear action', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    const a = penStroke([{ x: 0, y: 0 }]);
    const b = penStroke([{ x: 1, y: 1 }]);

    // NOTE: no production code path pushes a 'clear' entry any more — Canvas.clearAll()
    // is deliberately permanent — but Canvas.undo/redo still handle the action type,
    // so drive it directly to cover that branch.
    Canvas.strokes = [];
    Canvas.undoStack = [{ action: 'clear', strokes: [a, b] }];
    Canvas.redoStack = [];

    assertEqual(Canvas.undo(), true);
    assertEqual(Canvas.strokes.length, 2);
    assertEqual(Canvas.strokes[0], a, 'order preserved on restore');
    assertEqual(Canvas.strokes[1], b);
    assertEqual(Canvas.undoStack.length, 0);
    assertEqual(Canvas.redoStack.length, 1);

    assertEqual(Canvas.redo(), true);
    assertEqual(Canvas.strokes.length, 0, 'redo clears again');
    assertEqual(Canvas.undoStack.length, 1);
    assertEqual(Canvas.redoStack.length, 0);

    dom.window.close();
});

test('clearAll empties strokes and both history stacks permanently', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    Canvas.startStroke('pen', 10, 10, '#000', 3);
    Canvas.endStroke();
    Canvas.startStroke('pen', 20, 20, '#000', 3);
    Canvas.endStroke();
    Canvas.undo(); // populate the redo stack too
    assertEqual(Canvas.undoStack.length, 1);
    assertEqual(Canvas.redoStack.length, 1);

    Canvas.clearAll();

    assertEqual(Canvas.strokes.length, 0);
    assertEqual(Canvas.undoStack.length, 0, 'undo history is wiped');
    assertEqual(Canvas.redoStack.length, 0, 'redo history is wiped');
    assertEqual(Canvas.undo(), false, 'clearAll cannot be undone');
    assertEqual(Canvas.redo(), false);
    assertEqual(Canvas.strokes.length, 0);

    dom.window.close();
});

test('clearAll on an empty canvas leaves the stacks alone', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    // NOTE: clearAll() short-circuits when there are no strokes, so a stack left
    // over from an earlier undo survives the call.
    Canvas.startStroke('pen', 10, 10, '#000', 3);
    Canvas.endStroke();
    Canvas.undo();
    assertEqual(Canvas.strokes.length, 0);

    Canvas.clearAll();
    assertEqual(Canvas.redoStack.length, 1, 'no strokes to clear, so history is untouched');
    assertEqual(Canvas.redo(), true);
    assertEqual(Canvas.strokes.length, 1);

    dom.window.close();
});

test('a new stroke after an undo clears the redo stack', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    Canvas.startStroke('pen', 10, 10, '#000', 3);
    Canvas.endStroke();
    Canvas.undo();
    assertEqual(Canvas.redoStack.length, 1);

    Canvas.startStroke('pen', 60, 60, '#abcdef', 5);
    Canvas.endStroke();

    assertEqual(Canvas.redoStack.length, 0, 'the redone future is dropped');
    assertEqual(Canvas.strokes.length, 1);
    assertEqual(Canvas.strokes[0].color, '#abcdef');
    assertEqual(Canvas.redo(), false);
    assertEqual(Canvas.strokes.length, 1);

    dom.window.close();
});

test('removeStroke and deleteStrokes also clear the redo stack', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    const a = penStroke([{ x: 0, y: 0 }]);
    const b = penStroke([{ x: 1, y: 1 }]);

    Canvas.strokes = [a, b];
    Canvas.redoStack = [{ action: 'add', stroke: penStroke([{ x: 9, y: 9 }]) }];
    Canvas.removeStroke(0);
    assertEqual(Canvas.redoStack.length, 0, 'removeStroke drops the redo future');

    Canvas.strokes = [a, b];
    Canvas.redoStack = [{ action: 'add', stroke: penStroke([{ x: 9, y: 9 }]) }];
    Canvas.deleteStrokes([0]);
    assertEqual(Canvas.redoStack.length, 0, 'deleteStrokes drops the redo future');

    dom.window.close();
});

test('undo and redo return false when their stacks are empty', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    assertEqual(Canvas.undo(), false);
    assertEqual(Canvas.redo(), false);

    Canvas.startStroke('pen', 5, 5, '#000', 1);
    Canvas.endStroke();
    assertEqual(Canvas.undo(), true);
    assertEqual(Canvas.undo(), false, 'nothing left to undo');
    assertEqual(Canvas.redo(), true);
    assertEqual(Canvas.redo(), false, 'nothing left to redo');
    assertEqual(Canvas.strokes.length, 1);

    dom.window.close();
});

test('deleteStrokes with an empty selection is a no-op', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    Canvas.strokes = [penStroke([{ x: 0, y: 0 }])];
    Canvas.deleteStrokes([]);

    assertEqual(Canvas.strokes.length, 1);
    assertEqual(Canvas.undoStack.length, 0);

    dom.window.close();
});
