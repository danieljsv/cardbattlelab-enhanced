// Hand footer fitting: footers stay inside each card's uncovered strip.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';

const L = createRequire(import.meta.url)('../extension/overlay/layout.js');
// Widths measured in a live match (card units, Orbitron at the overlay's sizes).
// Orbitron has no tabular figures: a 2 is about twice as wide as a 1.
const UNIT = {box: {wide: 35.4, narrow: 17}};
const LABEL = {full: 35.3, short: 22.9}; // PILOT, PLT (tight letter spacing)
const PILOT = {box: {wide: 43.4, narrow: 23}, label: LABEL}; // +2 | +1
const KIRA = {box: {wide: 49.8, narrow: 23}, label: LABEL}; // +2 | +2
const COMMAND = {tag: {full: 58, short: 30, tiny: 13}};

// A hand of `n` cards laid out like the site: cards 94 wide, `step` apart.
const hand = (n, step, width = 94) => Array.from({length: n}, (_, i) => ({left: i * step, width}));

test('spread hand: every card has its whole width and a full footer', () => {
  const visible = L.strips(hand(5, 82));
  assert.ok(visible.slice(0, -1).every(v => v > 80), String(visible));
  assert.equal(visible[4], 100);
  const f = L.fit({visible: visible[0], ...UNIT, count: 2});
  assert.deepEqual([f.mode, f.narrow, f.shown, f.more], ['row', false, 2, 0]);
});

test('the right-most and the raised card keep the full width', () => {
  const cards = hand(11, 40);
  cards[3].raised = true;
  const visible = L.strips(cards);
  assert.equal(visible[10], 100);
  assert.equal(visible[3], 100);
  assert.ok(visible[2] < 45);
});

test('the strip ends where the next card starts, minus the rotation margin', () => {
  const [first] = L.strips(hand(2, 47));
  assert.equal(first, 50 - L.STRIP_MARGIN);
});

test('10-11 cards: footers fit the exposed strip, circles move up when needed', () => {
  const visible = L.strips(hand(11, 61))[0]; // ~65 units exposed
  const one = L.fit({visible, ...UNIT, count: 1});
  assert.equal(one.mode, 'row', 'stats and one circle side by side');
  assert.equal(one.shown, 1);
  const two = L.fit({visible, ...UNIT, count: 2});
  assert.equal(two.mode, 'stack', 'two circles go to a second row above the stats');
  assert.equal(two.shown, 2);
  const pilot = L.fit({visible, ...PILOT, count: 1});
  assert.equal(pilot.narrow, false);
  assert.equal(pilot.mode, 'stack');
  assert.equal(pilot.label, 'full');
});

test('circles shrink slightly before any is dropped', () => {
  // 3 circles beside the stats need 3*(21+2) = 69 with full circles, 61.5 when small.
  const f = L.fit({visible: 36 + 61.5 + L.PAD + L.EDGE + 0.5, ...UNIT, count: 3});
  assert.deepEqual([f.mode, f.small, f.shown], ['row', true, 3]);
});

test('more than four keywords, or too little room: "+N" summarises the rest', () => {
  const many = L.fit({visible: 100, ...UNIT, count: 6});
  assert.equal(many.shown + 1, L.MAX_CIRCLES);
  assert.equal(many.more, 6 - many.shown);
  const narrow = L.fit({visible: 30, ...UNIT, count: 3});
  assert.equal(narrow.shown, 0);
  assert.equal(narrow.more, 3, 'one "+3" circle');
});

test('15+ cards: AP and HP stack vertically and labels too long even as PLT hide', () => {
  const visible = L.strips(hand(16, 26))[0]; // ~23 units exposed
  const unit = L.fit({visible, ...UNIT, count: 2});
  assert.equal(unit.narrow, true);
  assert.equal(unit.mode, 'stack');
  assert.equal(unit.shown + (unit.more ? 1 : 0) <= 1, true, 'at most one circle fits above');
  const pilot = L.fit({visible, ...PILOT, count: 0});
  assert.equal(pilot.narrow, true);
  assert.equal(pilot.label, null);
});

test('one card too narrow for AP | HP side by side stacks the whole hand', () => {
  // A strip of 52 units falls between the +2 | +1 and +2 | +2 needs.
  const visible = 52;
  const others = [{visible, box: UNIT.box}, {visible, box: PILOT.box}, {visible: 100, box: UNIT.box}];
  assert.equal(L.handNarrow(others), false);
  const hand = [...others, {visible, box: KIRA.box}];
  const narrow = L.handNarrow(hand);
  assert.equal(narrow, true);
  for (const kind of [UNIT, PILOT, KIRA]) {
    for (const v of [visible, 100]) assert.equal(L.fit({visible: v, ...kind, narrow}).narrow, true);
  }
  assert.equal(L.fit({visible, ...KIRA, narrow}).label, 'full', 'a stacked Pilot keeps PILOT');
});

test('an 8-card hand with a +2 | +2 Pilot keeps AP | HP side by side', () => {
  // An 8-card hand from a phone test: cards about 268 px wide, 157 px apart (58.6% exposed).
  const visible = L.strips(hand(8, 157, 268));
  const items = [KIRA, UNIT, PILOT, UNIT].map((kind, i) => ({visible: visible[i * 2], box: kind.box}));
  assert.equal(L.handNarrow(items), false);
  // The site's 8-card hands at 1280×720 (113 wide, 66 apart) and 412×915 portrait (140 wide,
  // 78 apart) too.
  assert.equal(L.handNarrow([{visible: L.strips(hand(2, 66, 113))[0], box: KIRA.box}]), false);
  assert.equal(L.handNarrow([{visible: L.strips(hand(2, 78, 140))[0], box: KIRA.box}]), false);
});

test('the right-most card keeps AP | HP side by side when the hand stacks', () => {
  const visible = 52; // fits +2 | +1, not +2 | +2
  const items = [{visible, box: KIRA.box}, {visible, box: PILOT.box}, {visible, box: undefined}, {visible: 100, box: UNIT.box}];
  assert.deepEqual(L.handNarrows(items), [true, true, true, false]);
  assert.deepEqual(L.handNarrows(items.slice(1)), [false, false, false], 'without Kira nothing stacks');
  assert.deepEqual(L.handNarrows([]), []);
  // The right-most card without a stats box (a Command) changes nothing for the others.
  assert.deepEqual(L.handNarrows([...items.slice(0, 2), {visible: 100, box: undefined}]), [true, true, false]);
});

test('Command tags never decide the hand and keep their own fit', () => {
  assert.equal(L.handNarrow([{visible: 20, box: undefined}, {visible: 100, box: UNIT.box}]), false);
  const f = L.fit({visible: 40, ...COMMAND, narrow: true});
  assert.deepEqual([f.narrow, f.tag], [false, 'short']);
});

test('alone, a card is its own hand', () => {
  assert.equal(L.fit({visible: 52, ...KIRA}).narrow, true);
  assert.equal(L.fit({visible: 52, ...PILOT}).narrow, false);
});

test('labels shorten to PLT, then hide, only for want of room', () => {
  const at = avail => L.fit({visible: avail + L.PAD + L.EDGE, ...PILOT, narrow: true}).label;
  assert.equal(at(LABEL.full), 'full');
  assert.equal(at(LABEL.full - 0.1), 'short');
  assert.equal(at(LABEL.short), 'short');
  assert.equal(at(LABEL.short - 0.1), null);
  assert.equal(L.fit({visible: 100, ...UNIT}).label, null, 'Units have no label');
});

test('a stacked card with room keeps circles beside the stats, left of the label', () => {
  const wide = L.fit({visible: 100, ...UNIT, count: 2, narrow: true});
  assert.deepEqual([wide.mode, wide.shown], ['row', 2]);
  // 53 units: one circle fits beside the thin box, not beside the PILOT label above it.
  const bare = L.fit({visible: 57, box: PILOT.box, count: 1, narrow: true});
  assert.equal(bare.mode, 'row');
  const labelled = L.fit({visible: 57, ...PILOT, count: 1, narrow: true});
  assert.deepEqual([labelled.mode, labelled.label], ['stack', 'full']);
});

test('Command tags shorten to CMD, then stack vertically', () => {
  assert.equal(L.fit({visible: 100, ...COMMAND}).tag, 'full');
  assert.equal(L.fit({visible: 40, ...COMMAND}).tag, 'short');
  assert.equal(L.fit({visible: 20, ...COMMAND}).tag, 'tiny');
});

test('a footer never needs more room than its strip', () => {
  for (let visible = 10; visible <= 100; visible += 0.5) {
    for (const kind of [UNIT, PILOT, KIRA, COMMAND]) {
      for (let count = 0; count <= 7; count++) {
        for (const narrow of [undefined, true]) {
          const f = L.fit({visible, ...kind, count, narrow});
          const avail = visible - L.PAD - L.EDGE;
          const d = f.small ? L.CIRCLE_SMALL : L.CIRCLE;
          const circles = f.shown + (f.more ? 1 : 0);
          const circlesWidth = circles ? circles * d + (circles - 1) * L.GAP : 0;
          const box = kind.tag ? kind.tag[f.tag] : f.narrow ? kind.box.narrow : kind.box.wide;
          const label = f.label ? kind.label[f.label] : 0;
          const column = Math.max(box, label);
          const need = f.mode === 'row' ? circlesWidth + (circles ? L.GAP : 0) + column : Math.max(circlesWidth, column);
          const context = JSON.stringify({visible, kind, count, narrow, f, need, avail});
          // A strip narrower than even the stacked box is the only allowed overflow.
          if (box <= avail) assert.ok(need <= avail + 1e-9, context);
          assert.ok(label <= avail, context);
          assert.ok(circles <= L.MAX_CIRCLES);
        }
      }
    }
  }
});
