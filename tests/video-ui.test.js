const { loadApp, test, assert, assertEqual } = require('./harness');
const { makeFakePlayer, makeFactory } = require('./fake-yt');

const ID = 'dQw4w9WgXcQ';
const URL = 'https://www.youtube.com/watch?v=' + ID;

const el = (dom, id) => dom.window.document.getElementById(id);

function withFakePlayer(window) {
    const fake = makeFakePlayer({ duration: 200 });
    window.Video.playerFactory = makeFactory(fake);
    return fake;
}

function typeUrl(dom, value) {
    const input = el(dom, 'video-url');
    input.value = value;
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    return input;
}

test('the Embed button embeds the pasted URL', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const fake = withFakePlayer(window);

    typeUrl(dom, URL);
    el(dom, 'video-embed-btn').click();

    assertEqual(window.Canvas.strokes.length, 1);
    assertEqual(window.Canvas.strokes[0].type, 'video');
    assertEqual(window.Canvas.strokes[0].videoId, ID);
    assertEqual(fake.videoId, ID, 'the player was pointed at it');

    window.Video.teardown();
    dom.window.close();
});

test('the input is cleared after a successful embed', async () => {
    const dom = await loadApp();
    const { window } = dom;
    withFakePlayer(window);

    const input = typeUrl(dom, URL);
    el(dom, 'video-embed-btn').click();

    assertEqual(input.value, '', 'ready for the next paste');

    window.Video.teardown();
    dom.window.close();
});

test('pressing Enter in the URL field embeds', async () => {
    const dom = await loadApp();
    const { window } = dom;
    withFakePlayer(window);

    const input = typeUrl(dom, URL);
    input.dispatchEvent(new window.KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));

    assertEqual(window.Canvas.strokes.length, 1);
    assertEqual(window.Canvas.strokes[0].videoId, ID);

    window.Video.teardown();
    dom.window.close();
});

test('an unrecognised link shows an inline error and embeds nothing', async () => {
    const dom = await loadApp();
    const { window } = dom;
    withFakePlayer(window);

    typeUrl(dom, 'https://vimeo.com/12345');
    el(dom, 'video-embed-btn').click();

    const error = el(dom, 'video-error');
    assert(!error.classList.contains('hidden'), 'the error is visible');
    assert(error.textContent.length > 0);
    assertEqual(window.Canvas.strokes.length, 0, 'nothing was added');

    dom.window.close();
});

test('editing the URL clears a previous error', async () => {
    const dom = await loadApp();
    const { window } = dom;
    withFakePlayer(window);

    typeUrl(dom, 'nope');
    el(dom, 'video-embed-btn').click();
    const error = el(dom, 'video-error');
    assert(!error.classList.contains('hidden'));

    typeUrl(dom, URL);
    assert(error.classList.contains('hidden'), 'the error clears as soon as you retype');

    dom.window.close();
});

test('an empty URL field is treated as an error rather than an embed', async () => {
    const dom = await loadApp();
    const { window } = dom;
    withFakePlayer(window);

    el(dom, 'video-embed-btn').click();

    assertEqual(window.Canvas.strokes.length, 0);
    assert(!el(dom, 'video-error').classList.contains('hidden'));

    dom.window.close();
});

test('the Remove button removes the video undoably', async () => {
    const dom = await loadApp();
    const { window } = dom;
    withFakePlayer(window);

    typeUrl(dom, URL);
    el(dom, 'video-embed-btn').click();
    assertEqual(window.Canvas.strokes.length, 1);

    el(dom, 'video-remove-btn').click();

    assertEqual(window.Canvas.strokes.length, 0);
    assertEqual(window.Video.player, null);

    window.Canvas.undo();
    assertEqual(window.Canvas.strokes.length, 1, 'removal is undoable');

    window.Video.teardown();
    dom.window.close();
});

test('Remove with no video does nothing and does not throw', async () => {
    const dom = await loadApp();
    const { window } = dom;

    el(dom, 'video-remove-btn').click();

    assertEqual(window.Canvas.strokes.length, 0);

    dom.window.close();
});

test('embedding a second URL replaces the first video', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const fake = withFakePlayer(window);

    typeUrl(dom, URL);
    el(dom, 'video-embed-btn').click();

    typeUrl(dom, 'https://youtu.be/aBcDeFgHiJk');
    el(dom, 'video-embed-btn').click();

    assertEqual(window.Canvas.strokes.length, 1, 'still exactly one video');
    assertEqual(window.Canvas.strokes[0].videoId, 'aBcDeFgHiJk');
    assertEqual(fake.destroyed, false, 'the player is re-pointed, not rebuilt');

    window.Video.teardown();
    dom.window.close();
});

test('typing in the URL field does not trigger canvas shortcuts', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Tools = window.Tools;

    Canvas.strokes = [{ type: 'pencil', points: [{ x: 0, y: 0 }], color: '#000', size: 3, opacity: 1 }];
    Tools.selectedStrokes = [0];

    const input = el(dom, 'video-url');
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));

    assertEqual(Canvas.strokes.length, 1, 'Backspace must edit the text, not the drawing');

    dom.window.close();
});
