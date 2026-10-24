// Hand count: the state against the hand limit, its accessible name and where the label goes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';

const H = createRequire(import.meta.url)('../extension/overlay/handcount.js');

test('the hand limit is the site\'s 10: yellow at it, red over it', () => {
  assert.equal(H.LIMIT, 10);
  assert.equal(H.state(0), null);
  assert.equal(H.state(9), null);
  assert.equal(H.state(10), 'full');
  assert.equal(H.state(11), 'over');
  assert.equal(H.state(16), 'over');
});

test('describes the count for assistive technology', () => {
  assert.equal(H.describe(7), '7 of 10 cards in hand');
  assert.equal(H.describe(10), '10 of 10 cards in hand, at the hand limit');
  assert.equal(H.describe(12), '12 of 10 cards in hand, 2 over the hand limit');
});

// On-screen rectangles measured in real matches (CSS pixels), [left, right, top, bottom].
const rect = ([left, right, top, bottom]) => ({left, right, top, bottom});
const placeAt = (frame, size, gap, obstacles, [width, height]) =>
  H.place({frame: rect(frame), size: {width: size[0], height: size[1]}, gap, obstacles: obstacles.map(rect),
    bounds: {left: 0, top: 0, right: width, bottom: height}});

test('landscape phone: beside the frame\'s top-left corner, clear of the level label and the Shield pile', () => {
  // The level label and its hexagon sit just above the frame's corner; the Shield pile is left of it.
  const seat = [[342, 396.4, 285.4, 310.6], [317.9, 338.7, 288.9, 306.9], [232, 273, 321, 385]];
  // Six cards: the site narrows the frame around them.
  assert.deepEqual(placeAt([328.2, 692.7, 314.4, 390], [14, 8], 2.8, seat, [844, 390]), {at: 'left', left: 311.4, top: 314.4});
  // Ten cards: the frame spans the play area, and the label still clears the Shield pile.
  const full = placeAt([296.1, 724.9, 314.4, 390], [17.5, 8], 2.8, seat, [844, 390]);
  assert.equal(full.at, 'left');
  assert.ok(full.left > 273, String(full.left));
});

test('desktop: above the frame\'s top-left corner when the Shield pile is beside it', () => {
  const seat = [[400.3, 458.5, 534.7, 560.7], [441.1, 458.6, 516.6, 531.7], [302, 380, 502, 701]];
  const spot = placeAt([392.5, 887.5, 578.4, 720], [18, 9], 2.6, seat, [1280, 720]);
  assert.deepEqual(spot, {at: 'above', left: 392.5, top: 578.4 - 2.6 - 9});
});

test('covers the least when every spot is taken, and stays on screen', () => {
  const frame = [100, 400, 200, 300];
  // Both spots taken; the one above is covered less.
  assert.equal(placeAt(frame, [20, 10], 2, [[60, 99, 180, 260], [100, 110, 185, 190]], [500, 500]).at, 'above');
  // A frame at the screen's top-left corner: neither spot is on screen, so the first moves onto it.
  assert.deepEqual(placeAt([0, 300, 0, 100], [20, 10], 2, [], [500, 500]), {at: 'left', left: 0, top: 0});
  // Only the spot above is on screen.
  assert.equal(placeAt([10, 300, 50, 100], [20, 10], 2, [], [500, 500]).at, 'above');
});
