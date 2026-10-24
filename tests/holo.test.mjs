// Rarity foil: print -> finish, per-print masks, light and tilt maths, the motion engine and
// arrival memory (the acceptance checklist, where a unit test can hold it).
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';

const H = createRequire(import.meta.url)('../extension/overlay/holo.js');

// Entries as the site's card database has them (site v0.205.0), plus one made-up C++ card:
// the site has no C++ print and no promo card numbers.
const DB = {
  'GD01-013': {code: 'GD01-013', rarity: 'C', variants: [{code: 'GD01-013-p1', rarity: 'C'}]},
  'GD01-088': {code: 'GD01-088', rarity: 'U', variants: [{code: 'GD01-088-p1', rarity: 'U'}, {code: 'GD01-088-p2', rarity: 'U +'}]},
  'GD01-005': {code: 'GD01-005', rarity: 'R', variants: [{code: 'GD01-005-p1', rarity: 'R +'}, {code: 'GD01-005-p2', rarity: 'R'}]},
  'GD01-001': {code: 'GD01-001', rarity: 'LR', variants: [{code: 'GD01-001-p1', rarity: 'LR +'}, {code: 'GD01-001-p2', rarity: 'LR ++'}]},
  'ST01-002': {code: 'ST01-002', rarity: 'C', variants: [{code: 'ST01-002-p1', rarity: 'C +'}, {code: 'ST01-002-p2', rarity: 'C'}]},
  'ST01-001': {code: 'ST01-001', rarity: 'LR', variants: [{code: 'ST01-001-p1', rarity: 'LR +'}, {code: 'ST01-001-p4', rarity: 'LR'}]},
  'ST05-010': {code: 'ST05-010', rarity: 'C', variants: [{code: 'ST05-010-p2', rarity: 'P'}]},
  'GD05-003': {code: 'GD05-003', rarity: 'R', variants: [{code: 'GD05-003-p1', rarity: 'LKR +'}]},
  'GD05-029': {code: 'GD05-029', rarity: 'C', variants: [{code: 'GD05-029-p1', rarity: 'LKC +'}]},
  'XX-002': {code: 'XX-002', rarity: 'C', variants: [{code: 'XX-002-p2', rarity: 'C ++'}]},
  'EXBP-001': {code: 'EXBP-001', rarity: 'EX'},
};
const url = code => `https://art.cardbattlelab.com/${code}.webp?r=3`;

test('each print gets the finish of its own printed rarity', () => {
  const finish = code => H.finish(H.printOf(url(code)), DB);
  assert.equal(finish('GD01-013'), 'c');
  assert.equal(finish('GD01-088'), 'u');
  assert.equal(finish('GD01-088-p2'), 'u-p');
  assert.equal(finish('GD01-005'), 'r');
  assert.equal(finish('GD01-005-p1'), 'r-p');
  assert.equal(finish('GD01-001'), 'lr');
  assert.equal(finish('GD01-001-p1'), 'lr-p');
  assert.equal(finish('GD01-001-p2'), 'lr-pp');
  assert.equal(finish('ST01-002-p1'), 'c-p');
  assert.equal(finish('ST01-001-p4'), 'lr');
  assert.equal(finish('ST05-010-p2'), 'p');
  assert.equal(finish('XX-002-p2'), 'c-pp');
  // A newer print the database doesn't list keeps its card's rarity.
  assert.equal(finish('GD01-001-p9'), 'lr');
  // GD05's "LK" prints are parallels of their card's rarity.
  assert.equal(finish('GD05-003-p1'), 'r-p');
  assert.equal(finish('GD05-029-p1'), 'c-p');
  // Card backs, unknown cards and unknown rarities get no finish.
  assert.equal(H.printOf('https://art.cardbattlelab.com/CardBack1.jpg'), null);
  assert.equal(H.finish(null, DB), null);
  assert.equal(finish('GD99-001'), null);
  assert.equal(finish('EXBP-001'), null);
});

test('finish families', () => {
  assert.deepEqual(['c', 'u', 'r', 'lr', 'p', 'c-p', 'lr-p', 'p-p', 'c-pp', 'lr-pp', null].map(H.family),
    ['gloss', 'gloss', 'holo', 'holo', 'holo', 'parallel', 'parallel', 'parallel', 'special', 'special', null]);
  assert.deepEqual(['c', 'u', 'r', 'lr-pp', null].map(H.foil), [false, false, true, true, false]);
  assert.equal(H.normalize(' LR ++ '), 'LR++');
  assert.equal(H.normalize('LKU +'), 'U+');
  assert.equal(H.normalize('LKX'), 'LKX');
});

// A synthetic print: gold top-left, white top-right, dark ink below.
const W = 200, HEIGHT = 280;
function synthetic() {
  const data = new Uint8ClampedArray(W * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < W; x++) {
      const rgb = y < HEIGHT / 2 ? (x < W / 2 ? [200, 165, 70] : [245, 245, 245]) : [20, 20, 30];
      data.set([...rgb, 255], (y * W + x) * 4);
    }
  }
  return data;
}
const at = (values, fx, fy) => values[Math.floor(fy * HEIGHT) * W + Math.floor(fx * W)];

test('masks follow the printed inks', () => {
  const data = synthetic();
  const gold = [0.3, 0.3], white = [0.75, 0.3], dark = [0.5, 0.75];
  // ++: the line mask is the gold ink; the holo surface is the light areas.
  const special = H.maskValues(data, W, HEIGHT, 'special');
  assert.ok(at(special.line, ...gold) > 0.95);
  assert.ok(at(special.line, ...white) < 0.05 && at(special.line, ...dark) < 0.05);
  assert.ok(at(special.field, ...white) > 0.95);
  assert.ok(at(special.field, ...dark) < 0.25 && at(special.field, ...gold) < 0.25);
  // +: silver frame elements only, inside the card template's frame areas.
  const parallel = H.maskValues(data, W, HEIGHT, 'parallel');
  assert.ok(at(parallel.line, 0.75, 0.03) > 0.95, 'ID tab');
  assert.ok(at(parallel.line, 0.97, 0.3) > 0.95, 'right edge');
  assert.equal(at(parallel.line, ...white), 0, 'white art outside the frame');
  assert.equal(at(parallel.line, ...dark), 0);
  assert.ok(at(parallel.field, ...white) > 0.95 && at(parallel.field, ...dark) < 0.15);
  // R/LR/P: light areas only, no line mask.
  const holo = H.maskValues(data, W, HEIGHT, 'holo');
  assert.equal(holo.line, null);
  assert.ok(at(holo.field, ...white) > 0.95);
  assert.ok(at(holo.field, ...dark) < 0.01);
});

test('mask images: half-resolution field, full-resolution line, thin lines survive', () => {
  const out = H.masks(synthetic(), W, HEIGHT, 'special');
  assert.deepEqual([out.field.width, out.field.height, out.line.width, out.line.height], [100, 140, 200, 280]);
  assert.equal(H.masks(synthetic(), W, HEIGHT, 'holo').line, null);
  // A one-pixel line at x = 5 survives halving (max pooling) and widens by one for ++.
  const values = new Float32Array(10 * 4);
  for (let y = 0; y < 4; y++) values[y * 10 + 5] = 1;
  assert.deepEqual([...H.shrink(values, 10, 4, 0.5).alpha.slice(0, 5)], [0, 0, 255, 0, 0]);
  assert.deepEqual([...H.shrink(values, 10, 4, 1, 1).alpha.slice(0, 10)], [0, 0, 0, 0, 255, 255, 255, 0, 0, 0]);
});

test('masks crop like the face does', () => {
  const natural = {width: 600, height: 838};
  assert.deepEqual(H.maskFit({box: {width: 98, height: 137}, natural, fit: 'fill'}), {size: '100% 100%', position: '50% 50%'});
  assert.deepEqual(H.maskFit({box: {width: 160, height: 120}, natural, fit: 'cover', position: '50% 0%'}), {size: '100% auto', position: '50% 0%'});
  assert.deepEqual(H.maskFit({box: {width: 60, height: 140}, natural, fit: 'cover', position: '50% 50%'}), {size: 'auto 100%', position: '50% 50%'});
});

test('seeded textures draw the same foil every session', () => {
  const a = H.random(11), b = H.random(11);
  const first = [a(), a(), a()];
  assert.deepEqual(first, [b(), b(), b()]);
  assert.ok(first.every(v => v >= 0 && v < 1));
  assert.notDeepEqual(first, [H.random(5)(), 0, 0]);
});

test('the resting lamp: cards catch it on the side facing the screen centre', () => {
  const view = {width: 1000, height: 800};
  assert.deepEqual(H.lamp({left: 450, top: 350, width: 100, height: 100}, view), {x: 50, y: 30});
  const left = H.lamp({left: 0, top: 350, width: 100, height: 100}, view);
  assert.ok(left.x > 80, String(left.x));
  const bottom = H.lamp({left: 450, top: 700, width: 100, height: 100}, view);
  assert.ok(bottom.y < 10, String(bottom.y));
  assert.deepEqual(H.lamp({width: 0, height: 0}, view), {x: 50, y: 30});
  // A card turned 180° (the opponent's seat) reflects the same lamp on its other end.
  const turned = H.lamp({left: 0, top: 350, width: 100, height: 100}, view, 180);
  assert.ok(Math.abs(turned.x - (100 - left.x)) < 1e-9 && Math.abs(turned.y - (100 - left.y)) < 1e-9);
});

test('pointer positions are read in the card\'s own frame', () => {
  const flat = H.frameOf({left: 100, top: 100, width: 100, height: 140}, 1.4);
  assert.deepEqual(H.localPoint(flat, 175, 135), {x: 75, y: 25});
  // Turned 180°: the screen's top-right is the card's bottom-left.
  const turned = H.frameOf({left: 100, top: 100, width: 100, height: 140}, 1.4, 180);
  const p = H.localPoint(turned, 175, 135);
  assert.ok(Math.abs(p.x - 25) < 1e-9 && Math.abs(p.y - 75) < 1e-9);
  // Turned 90° (rested): its bounding box is 140 wide, the card 100 wide.
  const rested = H.frameOf({left: 0, top: 0, width: 140, height: 100}, 1.4, 90);
  assert.ok(Math.abs(rested.width - 100) < 1e-9 && Math.abs(rested.height - 140) < 1e-9);
  assert.deepEqual(H.localPoint(flat, 0, 1000), {x: 0, y: 100}); // clamped
});

// 3×3 rotation matrices, as CSS's rotateX/rotateY/rotateZ and rotate3d() define them.
const mat = (axis, deg) => {
  const [x, y, z] = axis.map(n => n / Math.hypot(...axis)), a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
};
const times = (...ms) => ms.reduce((a, b) => a.map((row, i) => b[0].map((_, j) => row.reduce((sum, v, k) => sum + v * b[k][j], 0))));
const close = (a, b) => a.every((row, i) => row.every((v, j) => Math.abs(v - b[i][j]) < 1e-4));
const rotated = value => { const parts = value.split(' '); return mat(parts.slice(0, 3).map(Number), parseFloat(parts[3])); };

test('a whole card turns by its tilt in its own frame and keeps the site\'s rotations', () => {
  const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  // rotate (the foil's, replacing the site's) then the site's transform turn, against the site's
  // rotate, its transform turn and then rotateX(ry) rotateY(rx) inside the card.
  for (const [rx, ry, inner, site, siteDeg] of [[-8.8, -6.6, 0, 'none', 0], [11, 4, 12, 'none', 0], [-5, 9, 90, '180deg', 180],
    [7, -7, -2.3, 'z 180deg', 180], [3, 10, 12, '0 0 1 180deg', 180], [0.5, -0.5, 0, '0.5turn', 180]]) {
    const ours = times(rotated(H.turn(rx, ry, inner, site)), mat(Z, inner));
    const wanted = times(mat(Z, siteDeg), mat(Z, inner), mat(X, ry), mat(Y, rx));
    assert.ok(close(ours, wanted), `${rx} ${ry} ${inner} ${site}: ${H.turn(rx, ry, inner, site)}`);
  }
  assert.equal(H.turn(0, 0), '0 0 1 0deg');
  // At rest an upright opponent card keeps its half turn.
  assert.ok(close(rotated(H.turn(0, 0, 12, '180deg')), mat(Z, 180)));
  assert.deepEqual(H.rotation('none'), [1, 0, 0, 0]);
  assert.deepEqual(H.rotation('bogus'), [1, 0, 0, 0]);
  assert.deepEqual(H.rotation('1 2 deg'), [1, 0, 0, 0]);
  assert.ok(Math.abs(H.rotation('x 90deg')[1] - Math.SQRT1_2) < 1e-9 && Math.abs(H.rotation('3.14159265rad')[3] - 1) < 1e-6);
});

test('aiming tilts toward the pointer while the reflection moves away from it', () => {
  const t = H.aimAt(90, 20, 11);
  assert.ok(t.x < 50 && t.y > 50);
  assert.ok(t.rx < 0 && t.ry < 0);
  assert.ok(Math.abs(t.rx + 8.8) < 1e-9 && Math.abs(t.ry + 6.6) < 1e-9);
  assert.equal(t.o, 1);
  assert.deepEqual(H.aimAt(50, 50, 11), {x: 50, y: 50, o: 1, rx: 0, ry: 0});
  assert.equal(H.aimAt(500, 50, 11).x, 12.5); // the pointer is clamped to the card
});

// Drives the engine frame by frame from `from` for `ms`.
function run(m, from, ms) {
  let now = from;
  for (; now <= from + ms; now += 16) m.step(now);
  return now;
}

test('a foil card arriving on the field sweeps once after its masks, then rests lit', () => {
  const m = H.createMotion();
  m.arrive('card', 0, 0, H.REST);
  assert.equal(m.values('card').arrive, 0, 'hidden while it waits for masks');
  run(m, 0, 200);
  assert.equal(m.values('card').arrive, 0);
  m.ready('card', 200);
  let now = 216, peak = 0, swept = false;
  for (; now < 2400; now += 16) {
    m.step(now);
    const v = m.values('card');
    if (v.sweeping) swept = true;
    peak = Math.max(peak, v.sweepO);
  }
  assert.ok(swept && peak > 0.99, 'the sweep rose to full strength');
  const end = m.values('card');
  assert.deepEqual([end.sweeping, end.arrive, end.sweepO], [false, 1, 0]);
  assert.equal(m.waiting('card'), false);
  assert.equal(run(m, now, 500) > now && m.values('card').sweeping, false, 'never again');
});

test('the sweep starts without masks after at most 1.5 s', () => {
  const m = H.createMotion();
  m.arrive('slow', 0, 0, H.REST);
  run(m, 0, H.MASK_WAIT - 20);
  assert.equal(m.values('slow').arrive, 0);
  run(m, H.MASK_WAIT - 4, 100);
  assert.ok(m.values('slow').sweeping);
});

test('cards arriving together cascade 75 ms apart, at most 8 steps', () => {
  const m = H.createMotion();
  for (let i = 0; i < 10; i++) { m.arrive(i, i, 0, H.REST); m.ready(i, 0); }
  const starts = [...Array(10).keys()].map(i => {
    for (let now = 0; now < 1000; now += 1) { m.step(now); if (m.values(i).sweeping) return now; }
    return null;
  });
  assert.deepEqual(starts.slice(0, 3), [0, 75, 150]);
  assert.equal(starts[8], 600);
  assert.equal(starts[9], 600);
});

test('hovering or pressing before the masks cancels the sweep and lights the card', () => {
  const m = H.createMotion();
  m.arrive('card', 0, 0, H.REST);
  m.aim('card', 70, 40, 11);
  assert.equal(m.values('card').arrive, 1);
  m.ready('card', 50);
  const now = run(m, 50, 300);
  assert.equal(m.values('card').sweeping, false);
  assert.ok(m.values('card').o > 0.9 && m.values('card').tilt);
  // Release: back flat at the resting lamp on the softer spring.
  m.release('card', {x: 40, y: 35});
  run(m, now, 4000);
  const v = m.values('card');
  assert.deepEqual([v.x, v.y, v.rx, v.ry, v.o, v.tilt], [40, 35, 0, 0, 0, false]);
});

test('no motion: no sweep and no tilt, but the light still answers the pointer', () => {
  const reduced = H.createMotion({reduced: () => true});
  reduced.arrive('card', 0, 0, H.REST);
  reduced.ready('card', 0);
  assert.equal(reduced.values('card').arrive, 1);
  assert.equal(reduced.waiting('card'), false);
  reduced.aim('card', 90, 90, 11);
  run(reduced, 0, 1500);
  const v = reduced.values('card');
  assert.deepEqual([v.rx, v.ry, v.tilt], [0, 0, false]);
  assert.ok(v.o > 0.99 && v.x < 30 && v.y < 30);
  // The site's animations switched off (instant speed): the finish simply appears.
  const instant = H.createMotion({ratio: () => 0});
  instant.arrive('card', 0, 0, H.REST);
  instant.ready('card', 0);
  assert.deepEqual([instant.values('card').arrive, instant.waiting('card')], [1, false]);
});

test('the site\'s animation speed scales the sweep and cascade', () => {
  const m = H.createMotion({ratio: () => 0.5});
  m.arrive('a', 1, 0, H.REST);
  m.ready('a', 0);
  let start = null, end = null;
  for (let now = 0; now < 3000; now += 1) {
    m.step(now);
    const v = m.values('a');
    if (v.sweeping && start === null) start = now;
    if (start !== null && !v.sweeping && end === null) end = now;
  }
  assert.equal(start, 38); // 75 ms × 0.5, rounded up to the next millisecond step
  assert.equal(end - start, 1000);
});

test('a lifted hand card is lit at 55 % where it is; cleared cards drop their state', () => {
  const m = H.createMotion();
  m.light('hand', {x: 60, y: 20}, 0.55);
  run(m, 0, 3000);
  const v = m.values('hand');
  assert.deepEqual([v.x, v.y, v.o, v.tilt], [60, 20, 0.55, false]);
  m.drop('hand');
  assert.equal(m.values('hand'), null);
  assert.equal(m.step(5000), false, 'the loop stops when nothing moves');
});

test('arrival memory: only new faces on a slot sweep, across re-renders and board changes', () => {
  const a = H.createArrivals();
  assert.equal(a.arrive('p1:0:unit', 'GD01-001.webp#15'), true);
  assert.equal(a.arrive('p1:0:unit', 'GD01-001.webp#15'), false, 're-rendered, same face');
  assert.equal(a.arrive('p1:0:pilot', 'GD01-087.webp#22'), true, 'a Pilot pairs');
  assert.equal(a.arrive('p1:0:unit', 'GD01-001.webp#31'), true, 'another copy deployed there');
  a.forget('p1:0:unit');
  assert.deepEqual(a.slots(), ['p1:0:pilot']);
  assert.equal(a.arrive('p1:0:unit', 'GD01-001.webp#31'), true);
});

test('a card rebuilt mid-sweep (a Pilot pairing) keeps its sweep on the new element', () => {
  const m = H.createMotion();
  m.arrive('card', 0, 0, H.REST);
  m.ready('card', 0);
  run(m, 0, 500);
  assert.ok(m.values('card').sweeping);
  assert.equal(m.adopt('card', 'stack-unit'), true);
  assert.equal(m.values('card'), null);
  assert.ok(m.values('stack-unit').sweeping, 'the sweep carries on');
  const now = run(m, 516, 2000);
  assert.deepEqual([m.values('stack-unit').sweeping, m.values('stack-unit').arrive], [false, 1]);
  assert.equal(m.adopt('gone', 'other'), false);
  assert.equal(m.adopt('stack-unit', 'stack-unit'), false);
  assert.equal(m.step(now + 16), false);
});
