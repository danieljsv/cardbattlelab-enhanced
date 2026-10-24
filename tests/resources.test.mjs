// Resource readout: the active count, where the hexagon goes and how its number is centred.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';

const R = createRequire(import.meta.url)('../extension/overlay/resources.js');
const res = (rested = false) => ({ex: false, rested});
const ex = (rested = false) => ({ex: true, rested});

test('counts active resources, EX Resources included like the level', () => {
  assert.deepEqual(R.count([ex(), res(true), res(true), res()]), {total: 4, active: 2, exActive: 1});
  assert.deepEqual(R.count([res(), res(), res()]), {total: 3, active: 3, exActive: 0});
  assert.deepEqual(R.count([ex(true), res(true)]), {total: 2, active: 0, exActive: 0});
  assert.deepEqual(R.count([]), {total: 0, active: 0, exActive: 0});
});

test('describes the count for assistive technology', () => {
  assert.equal(R.describe(R.count([ex(), res(true), res(true), res()])), '2 of 4 resources active, including 1 EX Resource');
  assert.equal(R.describe(R.count([res(true)])), '0 of 1 resource active');
  assert.equal(R.describe(R.count([ex(), ex(), res()])), '3 of 3 resources active, including 2 EX Resources');
});

// On-screen rectangles measured in real matches (CSS pixels), [left, right, top, bottom].
const rect = ([left, right, top, bottom]) => ({left, right, top, bottom});
const layout = (em, viewport, parts) => {
  const r = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Array.isArray(v) && typeof v[0] === 'number' ? rect(v) : v]));
  return {label: r.label, first: r.first, last: r.last, row: r.row, afterScale: r.afterScale ?? 1,
    size: {width: R.HEX.width * em, height: R.HEX.height * em}, gap: R.GAP * em,
    obstacles: [r.shields, r.button].filter(Boolean), bounds: {left: 0, top: 0, right: viewport[0], bottom: viewport[1]}};
};
const PHONE = [844, 390], PORTRAIT = [412, 905], DESKTOP = [1280, 720];

test('landscape phone: beside the label, away from the cards, on both seats', () => {
  const button = [618, 716.5, 287, 309.9];
  // Your label sits left of your cards; the opponent's seat is turned, so theirs sits right.
  assert.deepEqual(R.place(layout(8, PHONE, {label: [342.2, 396.4, 285.4, 310.6], first: [400.8, 420.4, 284.3, 311.8],
    last: [443.5, 463.2, 284.3, 311.8], row: [296.1, 724.9, 281.6, 314.4], shields: [215.4, 289.9, 267.5, 385.6], button})), {at: 'left', scale: 1});
  assert.deepEqual(R.place(layout(8, PHONE, {label: [613, 667.1, 83.6, 100.4], first: [585.1, 612.5, 82.2, 101.8],
    last: [565.4, 592.9, 82.2, 101.8], row: [296.1, 724.9, 75.6, 108.4], shields: [731, 805.6, 4.4, 122.5], button})), {at: 'right', scale: 1});
});

test('portrait phone: past the last card, inside the row, never into the field or a hand', () => {
  // The Shield pile sits right beside the label. Reported on a phone: above the label, your
  // hexagon crossed into the field and the opponent's hid under their hand.
  const button = [272.9, 404.5, 859.6, 902.7], afterScale = 1.085;
  const you = R.place(layout(8, PORTRAIT, {label: [71.3, 126.1, 699.3, 716.1], first: [131.6, 159.8, 687.9, 727.4],
    last: [151.8, 180, 687.9, 727.4], row: [95.5, 377.4, 683, 732.3], shields: [13.5, 57.3, 506.2, 726.8], button, afterScale}));
  assert.deepEqual(you, {at: 'after', scale: afterScale});
  const them = R.place(layout(8, PORTRAIT, {label: [285.9, 334, 136, 161.2], first: [252.2, 280.4, 128.9, 168.4],
    last: [230.1, 258.3, 128.9, 168.4], row: [34.6, 316.5, 124, 173.3], shields: [354.7, 398.5, 129.5, 350.2], button, afterScale}));
  assert.deepEqual(them, {at: 'after', scale: afterScale});
  // Ten Resources: past the last card is beyond the row's end, still on screen.
  assert.equal(R.place(layout(8, PORTRAIT, {label: [71.3, 126.1, 699.3, 716.1], first: [131.6, 159.8, 687.9, 727.4],
    last: [349, 377.4, 687.9, 727.4], row: [95.5, 377.4, 683, 732.3], shields: [13.5, 57.3, 506.2, 726.8], button, afterScale})).at, 'after');
});

test('desktop: past the last card until the action button covers it, then above the label inside the row', () => {
  const mine = {label: [368.3, 426.3, 534.7, 560.7], first: [434.5, 471.3, 522, 573.5], row: [392.5, 887.5, 517, 578.4],
    shields: [301.3, 381, 490.6, 711.7], button: [707, 879, 528, 568], afterScale: 1.385};
  assert.deepEqual(R.place(layout(8.28, DESKTOP, {...mine, last: [514.6, 551.4, 522, 573.5]})), {at: 'after', scale: 1.385});
  const late = R.place(layout(8.28, DESKTOP, {...mine, last: [662, 699, 522, 573.5]}));
  assert.equal(late.at, 'top');
  // Shrunk so the hexagon and its gap fit between the row's top and the label.
  assert.ok(late.scale > 0.8 && late.scale < 0.82, String(late.scale));
  assert.deepEqual(R.place(layout(8.28, DESKTOP, {label: [832.1, 890, 163.6, 180.9], first: [779.7, 831.1, 153.9, 190.7],
    last: [750.3, 787, 146.5, 198], row: [392.5, 887.5, 141.6, 203], shields: [899, 978.7, 8.3, 229.4], afterScale: 1.385})), {at: 'after', scale: 1.385});
});

test('only obstacles in the way count, and every spot stays within the row and the viewport', () => {
  const base = {label: [100, 150, 50, 80], first: [155, 180, 45, 85], last: [185, 210, 45, 85], row: [90, 400, 40, 90]};
  assert.equal(R.place(layout(10, [500, 500], base)).at, 'left');
  assert.equal(R.place(layout(10, [500, 500], {...base, shields: [40, 60, 100, 200]})).at, 'left'); // below the row
  assert.equal(R.place(layout(10, [500, 500], {...base, shields: [40, 80, 0, 200]})).at, 'after'); // beside the label
  assert.equal(R.place(layout(10, [220, 500], {...base, shields: [40, 80, 0, 200]})).at, 'top'); // past the viewport
  // A hexagon taller than the row never fits beside or after; above, it shrinks to the minimum.
  assert.deepEqual(R.place(layout(30, [500, 500], base)), {at: 'top', scale: R.MIN_SCALE});
});

// Layout boxes ([left, top, width, height] in the row's own pixels) and rows measured in a
// portrait match (412×905): your row upright, the opponent's turned 180°.
const box = ([left, top, width, height]) => ({left, top, width, height});
const PORTRAIT_ROWS = {
  p1: {row: [95.5, 377.4, 683, 732.3], label: box([-44, 45, 99, 46]), labelRect: [71.3, 126.1, 695.1, 720.3], first: box([65, 9, 51, 71]), last: box([137, 9, 51, 71])},
  p2: {row: [34.6, 316.5, 124, 173.3], label: box([-44, 45, 99, 30]), labelRect: [285.9, 340.7, 140.2, 157], first: box([65, 9, 51, 71]), last: box([102, 9, 51, 71])},
};
const near = (actual, expected) => ['left', 'right', 'top', 'bottom'].forEach(k => assert.ok(Math.abs(actual[k] - expected[k]) < 0.5, `${k}: ${actual[k]} vs ${expected[k]}`));

test('maps a laid-out card to the screen, upright or turned, and turns a rested card', () => {
  const {p1, p2} = PORTRAIT_ROWS;
  assert.equal(R.turned(p1.label, rect(p1.labelRect), rect(p1.row), 510), false);
  assert.equal(R.turned(p2.label, rect(p2.labelRect), rect(p2.row), 510), true);
  // The site draws these cards at these rectangles.
  near(R.layoutRect(p1.first, rect(p1.row), 510), rect([131.6, 159.8, 687.9, 727.4]));
  near(R.layoutRect(p1.last, rect(p1.row), 510), rect([171.4, 199.6, 687.9, 727.4]));
  near(R.layoutRect(p2.first, rect(p2.row), 510, {turned: true}), rect([252.2, 280.4, 128.9, 168.4]));
  near(R.layoutRect(p2.last, rect(p2.row), 510, {turned: true}), rect([232, 260.2, 128.9, 168.4]));
  // Rested: the same centre, width and height swapped.
  near(R.layoutRect(box([0, 0, 40, 60]), rect([0, 100, 0, 100]), 100, {rested: true}), rect([-10, 50, 10, 50]));
});

test('a resource flying in from the deck leaves the hexagon past its slot', () => {
  // A case found in review: while the new resource flies in, the row's last card is drawn far
  // outside the row. Its drawn rectangle sent the hexagon above the label; its layout does not.
  const button = [272.9, 404.5, 859.6, 902.7];
  for (const [side, flying, shields] of [['p1', [355, 398, 440, 501], [13.5, 57.3, 506.2, 726.8]], ['p2', [14, 57, 356, 417], [354.7, 398.5, 129.5, 350.2]]]) {
    const r = PORTRAIT_ROWS[side], turned = side === 'p2', row = rect(r.row);
    const parts = {label: r.labelRect, row: r.row, shields, button, afterScale: 1.085,
      first: R.layoutRect(r.first, row, 510, {turned})};
    assert.equal(R.place(layout(8, PORTRAIT, {...parts, last: flying})).at, 'top', `${side}: drawn rectangle`);
    assert.deepEqual(R.place(layout(8, PORTRAIT, {...parts, last: R.layoutRect(r.last, row, 510, {turned})})), {at: 'after', scale: 1.085}, side);
  }
});

// Orbitron at 100 px in a live match: advance, ink box, ink centre of mass, font box.
const metrics = (advance, left, right, mass) => ({advance, left, right, mass, ascent: 72, descent: 0, fontAscent: 101, fontDescent: 24});

test('centres a number by its ink: a 1 moves left to its stem, round figures barely move', () => {
  const one = R.inkOffset(metrics(39.1, 0, 39, 27.3), 100, 0.75);
  assert.deepEqual(one, {x: -0.058, y: -0.025});
  const zero = R.inkOffset(metrics(83.4, -5, 77, 40.6), 100, 0.75);
  assert.ok(Math.abs(zero.x) <= 0.01, String(zero.x));
  // Without weight the ink's bounding box is centred: a 1's box is already in the middle.
  assert.equal(R.inkOffset(metrics(39.1, 0, 39, 27.3), 100, 0).x, 0.001);
  // The figures sit low in their line box: they move up by the same amount.
  assert.equal(zero.y, -0.025);
});

// ---- Tab beside an effect panel ----

test('reads the level from the label\'s first line, else counts the row', () => {
  const c = R.count([ex(), res(true), res()]);
  assert.equal(R.level('LVL 4', c), 4);
  assert.equal(R.level('', c), 3);
  assert.equal(R.describeTab(4, c), 'Level 4; 2 of 3 resources active, including 1 EX Resource');
});

// Measured on site v0.211.0, phone 844×390: Airframe Seizure's discard prompt at level 2.
const PANEL = rect([424, 597, 288, 303]);
const TAB = {width: 60, height: 21};
const dockAt = (obstacles, panel = PANEL, bounds = {left: 0, top: 0, right: 844, bottom: 390}) =>
  R.dock({panel, size: TAB, gap: 3.2, obstacles: obstacles.map(rect), bounds});

test('a panel hides the row only when it covers a number in its label or hexagon', () => {
  // Phone, your seat: the numbers in "LVL 2", "1 RESOURCE", "+1 EX" (right-aligned beside the
  // cards, so the level sits at the cards-side end), and the hexagon's.
  const level = [390, 396, 285, 294], parts = [level, [349, 354, 294, 302], [381, 386, 302, 311], [332, 340, 291, 305]].map(rect);
  // Over the cards only (the discard prompt), or over just the label's letters: all readable.
  assert.equal(R.hides(PANEL, parts), false);
  assert.equal(R.hides(rect([397, 597, 284, 312]), parts), false);
  // Over just the level digit: hidden, though it is only the end of its line.
  assert.equal(R.hides(rect([389, 597, 284, 312]), parts), true);
  // Over less than half of it: still readable.
  assert.equal(R.hides(rect([394, 597, 284, 312]), parts), false);
  // A long text from the left of the row: it hides them all.
  assert.equal(R.hides(rect([180, 597, 288, 303]), parts), true);
  // Desktop: a panel just above the row covers nothing of it.
  assert.equal(R.hides(rect([473, 807, 493, 522]), [rect([440, 446, 535, 544])]), false);
  assert.equal(R.hides(PANEL, []), false);
});

test('docks above the panel at its start, clear of the site\'s targets', () => {
  // The hand's discard targets sit just below; nothing above.
  const hand = [[339, 385, 316, 390], [388, 434, 316, 390], [437, 483, 316, 390]];
  const spot = dockAt(hand);
  assert.equal(spot.at, 'above-start');
  assert.ok(spot.top + TAB.height <= PANEL.top && spot.left === PANEL.left);
  // A Unit's AP/HP in the leftmost field slot sits above the start (tester's phone run).
  assert.equal(dockAt([...hand, [416, 441, 263, 272]]).at, 'above-end');
  // The lifted command's label sits above the start: the end is clear.
  assert.equal(dockAt([...hand, [425, 448, 273, 283]]).at, 'above-end');
});

test('goes below or beside the panel when above is taken or off screen', () => {
  assert.equal(dockAt([[400, 620, 250, 287]]).at, 'below-start');
  // A panel at the top of the screen: above is outside the viewport.
  assert.equal(dockAt([], rect([424, 597, 4, 19])).at, 'below-start');
  assert.equal(dockAt([[424, 597, 250, 287], [424, 597, 304, 340]]).at, 'before');
});

test('with every spot covered, takes the one inside the viewport that covers least', () => {
  const big = [0, 844, 0, 287], below = [0, 844, 304, 390], left = [0, 423, 287, 304], right = [598, 640, 287, 304];
  assert.equal(dockAt([big, below, left, right]).at, 'after');
  // Nowhere inside the viewport: the first spot, moved onto the screen.
  assert.deepEqual(R.dock({panel: rect([0, 844, 0, 390]), size: TAB, gap: 3, bounds: {left: 0, top: 0, right: 844, bottom: 390}}),
    {at: 'above-start', left: 0, top: 0});
});
