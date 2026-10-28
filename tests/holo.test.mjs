// Rarity foil: print -> finish, per-print masks, light and tilt maths, the motion engine and
// arrival memory (the acceptance checklist, where a unit test can hold it).
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';
import {crc32, deflateSync, inflateSync} from 'node:zlib';

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
  assert.ok(at(parallel.field, ...white) > 0.95 && at(parallel.field, ...dark) < 0.01);
  // Ink over a mirror: pale but coloured ink gets no foil; white effect text is silver.
  assert.equal(at(parallel.field, ...gold), 0, 'coloured ink keeps its colour');
  const text = new Uint8ClampedArray(data);
  for (let y = 205; y < 215; y++) for (let x = 90; x < 110; x++) text.set([250, 250, 250, 255], (y * W + x) * 4);
  assert.ok(at(H.maskValues(text, W, HEIGHT, 'parallel').line, 0.5, 0.75) > 0.95, 'white effect text');
  // R/LR/P: light areas only, no line mask.
  const holo = H.maskValues(data, W, HEIGHT, 'holo');
  assert.equal(holo.line, null);
  assert.ok(at(holo.field, ...white) > 0.95);
  assert.ok(at(holo.field, ...dark) < 0.01);
});

test('R and LR prints get their own masks', () => {
  assert.deepEqual(['r', 'lr', 'p', 'r-p', 'lr-pp', 'c'].map(H.maskKind), ['rare', 'legend', 'holo', 'parallel', 'special', 'gloss']);
  const data = synthetic(), white = [0.75, 0.3], dark = [0.5, 0.75];
  // R: the foil is under the whole face and shows most on dark blue ink. Black ink only turns
  // slate, the black frame boxes less; red ink mostly keeps its colour. The frame is a mirror.
  const rare = H.maskValues(data, W, HEIGHT, 'rare');
  assert.ok(at(rare.line, 0.5, 0.95) > 0.95, 'black bottom bar');
  // White and pale grey ink on the frame gets no glow, so pale grey numbers on a white cost box
  // stay readable.
  assert.equal(at(rare.line, 0.75, 0.03), 0, 'white ID tab');
  assert.equal(at(rare.line, ...white), 0, 'art');
  assert.equal(at(rare.line, 0.5, 0.6), 0, 'name band');
  assert.ok(at(rare.field, 0.5, 0.55) > 0.35 && at(rare.field, 0.5, 0.55) < 0.5, 'black ink in the art');
  assert.ok(at(rare.field, 0.5, 0.95) < 0.2 && at(rare.field, ...dark) < 0.2, 'black frame box and text box');
  assert.ok(at(rare.field, ...white) > 0.25 && at(rare.field, ...white) < 0.4, 'white ink');
  const ink = new Uint8ClampedArray(data);
  for (let y = 150; y < 200; y++) for (let x = 40; x < 80; x++) ink.set([220, 60, 30, 255], (y * W + x) * 4);
  for (let y = 150; y < 200; y++) for (let x = 120; x < 160; x++) ink.set([57, 60, 90, 255], (y * W + x) * 4);
  const inked = H.maskValues(ink, W, HEIGHT, 'rare').field;
  assert.ok(inked[170 * W + 60] > 0.2 && inked[170 * W + 60] < 0.35, 'red ink lights up only a little');
  assert.ok(inked[170 * W + 140] > 0.95, 'dark blue ink');
  // LR: a sheen on the art, weaker on dark ink; none on the frame. The whole frame is a
  // mirror, and there is no rainbow mask.
  const legend = H.maskValues(data, W, HEIGHT, 'legend');
  assert.ok(at(legend.field, ...white) > 0.95 && at(legend.field, ...dark) > 0.4 && at(legend.field, ...dark) < 0.6);
  assert.equal(at(legend.field, 0.75, 0.03), 0, 'ID tab');
  assert.ok(at(legend.line, 0.5, 0.95) > 0.95, 'bottom bar');
  assert.equal(at(legend.line, ...white), 0, 'art');
  const blue = new Uint8ClampedArray(data);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < 10; x++) blue.set([20, 140, 220, 255], (y * W + x) * 4);
  const edge = H.maskValues(blue, W, HEIGHT, 'legend');
  assert.ok(edge.field[100 * W + 5] === 0 && edge.line[100 * W + 5] > 0.95, 'coloured frame is a mirror');
  const out = H.masks(data, W, HEIGHT, 'legend');
  assert.deepEqual([out.line.width, out.texture], [200, null]);
  assert.equal(H.masks(data, W, HEIGHT, 'rare').texture, null);
});

test('R and LR masks keep the foil off the round corners and the hue shift on the art', () => {
  const data = synthetic();
  // A transparent corner, as on the scans: its colour is random and must not count.
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) data.set([254, 0, 0, 0], (y * W + x) * 4);
  const rare = H.maskValues(data, W, HEIGHT, 'rare');
  assert.equal(rare.field[0], 0, 'field');
  assert.equal(rare.line[W + 1], 0, 'frame');
  const tint = H.tintImage(data, W, HEIGHT);
  assert.equal(tint.alpha[0], 0, 'no colour from the corner');
  const out = H.masks(data, W, HEIGHT, 'rare'), half = (m, fx, fy) => m.alpha[Math.floor(fy * m.height) * m.width + Math.floor(fx * m.width)];
  assert.equal(half(out.shape, 0, 0), 0, 'shape: corner');
  assert.equal(half(out.shape, 0.5, 0.5), 255, 'shape: face');
  // Only the art shifts in hue; the cost box, the type tab, the ID tab and the text keep their colour.
  for (const [fx, fy, name] of [[0.1, 0.08, 'cost box'], [0.03, 0.4, 'type tab'], [0.75, 0.02, 'ID tab'], [0.5, 0.8, 'text']]) {
    assert.equal(half(out.art, fx, fy), 0, name);
    assert.equal(half(out.frame, fx, fy), 255, name);
  }
  assert.equal(half(out.art, 0.5, 0.3), 255, 'art');
  assert.equal(half(out.frame, 0.5, 0.3), 0, 'art');
  // The rim is the thin edge of the card.
  assert.ok(half(out.rim, 0.5, 0.005) > 200 && half(out.rim, 0.99, 0.5) > 200, 'edge');
  assert.equal(half(out.rim, 0.5, 0.3), 0, 'inside');
  assert.equal(H.masks(data, W, HEIGHT, 'parallel').art, null);
});

test('white tags on the frame keep their print on any card', () => {
  // A dark frame with a white box in the bottom right and grey numbers in the box, as the AP and
  // HP boxes of an alt-art.
  const data = new Uint8ClampedArray(W * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < W; x++) {
      const box = x > 150 && x < 190 && y > 245 && y < 275, digit = box && x > 165 && x < 170 && y > 252 && y < 268;
      data.set([...(digit ? [120, 118, 120] : box ? [250, 242, 248] : [30, 30, 60]), 255], (y * W + x) * 4);
    }
  }
  const tags = H.whiteTags(data, W, HEIGHT);
  assert.ok(tags[260 * W + 168] > 0.95, 'grey number in the white box');
  assert.equal(tags[100 * W + 100], 0, 'dark ink');
  for (const kind of ['rare', 'legend']) {
    const {line} = H.maskValues(data, W, HEIGHT, kind);
    assert.ok(line[260 * W + 168] < 0.05 && line[250 * W + 155] < 0.05, `${kind}: no glow in the white box`);
    assert.ok(line[260 * W + 5] > 0.95, `${kind}: the dark frame glows`);
  }
});

test('the tint image keeps clear ink colours and gives neutral ink a neutral grey', () => {
  const W2 = 4, H2 = 2, px = new Uint8ClampedArray(W2 * H2 * 4);
  // Left 2 x 2 block dark blue ink, right block near-black ink with a little scan noise.
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) px.set(x < 2 ? [20, 40, 90, 255] : [12 + x, 10, 14 - x, 255], (y * W2 + x) * 4);
  const tint = H.tintImage(px, W2, H2);
  assert.deepEqual([tint.width, tint.height], [2, 1]);
  const [r, g, b] = tint.rgba.slice(0, 3);
  assert.ok(b === 255 && r < 70 && g > r && g < b, `dark blue ink stays blue: ${[r, g, b]}`);
  // A black box goes steel at the light, never the card's colour.
  assert.deepEqual([...tint.rgba.slice(4, 7)], [128, 128, 128], 'near-black ink gets neutral grey');
  assert.deepEqual([...tint.alpha], [255, 0], 'the ink weight: coloured ink only');
  assert.deepEqual([...tint.glow], [255, 0], 'dark blue ink glows at the light, black ink does not');
  const pale = H.tintImage(new Uint8ClampedArray([235, 225, 200, 255]), 1, 1);
  assert.ok(pale.alpha[0] === 255 && pale.glow[0] < 140, `pale ink glows less, so it never turns white: ${pale.glow[0]}`);
  assert.ok(H.masks(px, W2, H2, 'rare').tint && H.masks(px, W2, H2, 'legend').tint);
  assert.equal(H.masks(px, W2, H2, 'parallel').tint, null);
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

test('masks of a print do not depend on the prints of other sizes made before', () => {
  const small = synthetic(), first = H.masks(small, W, HEIGHT, 'rare');
  const big = new Uint8ClampedArray(W * 2 * HEIGHT * 2 * 4).fill(200);
  H.masks(big, W * 2, HEIGHT * 2, 'legend');
  const again = H.masks(small, W, HEIGHT, 'rare');
  for (const name of ['shape', 'art', 'frame', 'rim']) assert.deepEqual(again[name], first[name], name);
});

// Reads a PNG file: checks each chunk's CRC and gives the header, the palette alpha and the rows.
function readPng(file) {
  const bytes = Buffer.from(file), chunks = {}, data = [];
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at), name = bytes.toString('ascii', at + 4, at + 8);
    assert.equal(bytes.readUInt32BE(at + 8 + length), crc32(bytes.subarray(at + 4, at + 8 + length)), `${name} CRC`);
    if (name === 'IDAT') data.push(bytes.subarray(at + 8, at + 8 + length));
    else chunks[name] = bytes.subarray(at + 8, at + 8 + length);
    at += 12 + length;
  }
  return {header: chunks.IHDR, alpha: chunks.tRNS, rows: inflateSync(Buffer.concat(data)), end: 'IEND' in chunks};
}

test('mask files keep each pixel as it is', () => {
  for (const [width, height, channels] of [[300, 419, 1], [600, 838, 4], [1, 1, 1], [7, 3, 4]]) {
    const pixels = new Uint8ClampedArray(width * height * channels).map((_, i) => (i * 2654435761 >>> 13) & 255);
    const rows = H.pngRows(width, height, pixels, channels), line = width * channels;
    // Stored rows, and rows compressed as the browser's CompressionStream does.
    for (const file of [H.png(width, height, channels, rows), H.png(width, height, channels, rows, deflateSync(rows))]) {
      const png = readPng(file);
      assert.ok(png.end);
      assert.deepEqual([png.header.readUInt32BE(0), png.header.readUInt32BE(4), png.header[8], png.header[9]],
        [width, height, 8, channels === 1 ? 3 : 6]);
      // Alpha masks: a palette of black, where entry i has alpha i.
      if (channels === 1) assert.deepEqual([...png.alpha], Array.from({length: 256}, (_, i) => i));
      assert.equal(png.rows.length, height * (line + 1));
      for (let y = 0; y < height; y++) {
        assert.equal(png.rows[y * (line + 1)], 0);
        assert.ok(png.rows.subarray(y * (line + 1) + 1, (y + 1) * (line + 1)).equals(Buffer.from(pixels.buffer, y * line, line)), `row ${y}`);
      }
    }
  }
});

test('the surface texture of + prints stays on the art, off the frame, corners and text', () => {
  assert.equal(H.masks(synthetic(), W, HEIGHT, 'special').texture, null);
  const tex = H.masks(synthetic(), W, HEIGHT, 'parallel').texture;
  assert.deepEqual([tex.width, tex.height], [50, 70]);
  const at = (fx, fy) => tex.alpha[Math.floor(fy * tex.height) * tex.width + Math.floor(fx * tex.width)];
  // The art keeps its relief.
  for (const [fx, fy] of [[0.5, 0.3], [0.3, 0.45], [0.8, 0.2]]) assert.equal(at(fx, fy), 255, `${fx},${fy}`);
  // Cost box, ID tab, edges, name plate, effect text and the bottom tabs are plain mirror.
  for (const [fx, fy] of [[0.1, 0.08], [0.23, 0.17], [0.8, 0.03], [0.03, 0.4], [0.97, 0.4], [0.5, 0.62], [0.5, 0.75], [0.15, 0.9]]) {
    assert.equal(at(fx, fy), 0, `${fx},${fy}`);
  }
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

test('hovering or pressing before the masks cancels the sweep, then fades the finish in with them', () => {
  const m = H.createMotion();
  m.arrive('card', 0, 0, H.REST);
  m.aim('card', 70, 40, 11);
  // No finish without its masks while it is hovered.
  run(m, 0, 2000);
  assert.equal(m.values('card').arrive, 0);
  m.ready('card', 2000);
  m.fade('card', 2000);
  m.step(2000 + H.FADE_MS / 2);
  const half = m.values('card').arrive;
  assert.ok(half > 0.3 && half < 0.9, `half way: ${half}`);
  const now = run(m, 2000 + H.FADE_MS / 2, 300);
  assert.equal(m.values('card').arrive, 1);
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

test('a new face that waits for its masks stays plain, then fades its finish in', () => {
  const m = H.createMotion();
  m.hide('card', H.REST);
  assert.equal(m.values('card').arrive, 0, 'hidden while it waits');
  // A hover or press while it waits does not show a finish without its masks.
  m.aim('card', 70, 40, 11);
  run(m, 0, 500);
  assert.equal(m.values('card').arrive, 0);
  m.fade('card', 500);
  m.step(500 + H.FADE_MS / 2);
  const half = m.values('card').arrive;
  assert.ok(half > 0.3 && half < 0.9, `half way: ${half}`);
  m.step(500 + H.FADE_MS);
  assert.equal(m.values('card').arrive, 1);
  assert.equal(m.step(500 + H.FADE_MS + 16) && m.values('card').sweeping, false, 'no sweep');
  // A face that did not wait (masks ready at once) never fades.
  m.fade('card', 2000);
  m.step(2016);
  assert.equal(m.values('card').arrive, 1);
});

test('the fade leaves an arrival to its sweep, and is instant without motion', () => {
  const m = H.createMotion();
  m.arrive('card', 0, 0, H.REST);
  m.hide('card', H.REST);
  m.ready('card', 0);
  m.fade('card', 0);
  run(m, 0, 100);
  assert.ok(m.values('card').sweeping, 'the sweep runs');
  const reduced = H.createMotion({reduced: () => true});
  reduced.hide('card', H.REST);
  reduced.fade('card', 0);
  assert.equal(reduced.values('card').arrive, 1);
  const instant = H.createMotion({ratio: () => 0});
  instant.hide('card', H.REST);
  instant.fade('card', 0);
  assert.equal(instant.values('card').arrive, 1);
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
