// Resource readout: how many of a player's resources are active (not rested), so how much
// they can still pay this turn. Counts the cards the site draws in the resource row, EX
// Resources included, like the site's level. While one of the site's effect panels is over
// a player's row, a tab beside the panel repeats that player's count and level.
(function (root) {
  'use strict';

  // The hexagon's size and its distance from what it sits beside, in em of the label's
  // font (.cbl-res-cell in overlay.css).
  const HEX = {width: 2.6, height: 2.25};
  const GAP = 0.4;
  // Above the label the hexagon shrinks to fit the row, down to this share of its size.
  const MIN_SCALE = 0.6;
  // Past the last card it takes this share of a card's width, if that is larger.
  const CARD_SHARE = 0.8;

  // cards: [{ex, rested}], one per card in a resource row.
  function count(cards) {
    const active = cards.filter(c => !c.rested);
    return {total: cards.length, active: active.length, exActive: active.filter(c => c.ex).length};
  }

  // The readout's accessible name: "3 of 4 resources active, including 1 EX Resource".
  function describe({total, active, exActive}) {
    const ex = exActive ? `, including ${exActive} EX Resource${exActive === 1 ? '' : 's'}` : '';
    return `${active} of ${total} resource${total === 1 ? '' : 's'} active${ex}`;
  }

  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  // Where the readout sits, from on-screen rectangles ({left, right, top, bottom}):
  //   label: the level label; first, last: the row's first and last cards; row: the row
  //   size: the hexagon's {width, height}; gap: its distance from the label or the card
  //   afterScale: its size past the last card, against `size`
  //   obstacles: what it must not cover (the seat's Shield pile, the action button)
  //   bounds: the viewport
  // It stays within the row's height, so it never reaches into the field or a hand. In
  // order: beside the label, away from the cards ('left' or 'right'); past the last card
  // ('after'); above the label, shrunk to the room there ('top'). `scale` sizes the hexagon.
  function place({label, first, last, row, size, gap, afterScale = 1, obstacles = [], bounds}) {
    const clear = r => r.left >= bounds.left && r.right <= bounds.right && r.top >= row.top - 0.5
      && r.bottom <= row.bottom + 0.5 && !obstacles.some(o => overlaps(o, r));
    // The gap stays clear on both sides of the hexagon.
    const reach = k => k * (size.width + 2 * gap);
    const spot = (from, cy, k) => ({left: from, right: from + reach(k), top: cy - k * size.height / 2, bottom: cy + k * size.height / 2});
    const cardsRight = label.left + label.right < first.left + first.right;
    if (clear(spot(cardsRight ? label.left - reach(1) : label.right, (label.top + label.bottom) / 2, 1))) {
      return {at: cardsRight ? 'left' : 'right', scale: 1};
    }
    const k = afterScale;
    if (clear(spot(cardsRight ? last.right : last.left - reach(k), (last.top + last.bottom) / 2, k))) return {at: 'after', scale: k};
    const room = (label.top - row.top) / (size.height + gap);
    return {at: 'top', scale: Math.max(MIN_SCALE, Math.min(1, room))};
  }

  // A box laid out in a row ({left, top, width, height} in the row's own pixels) on screen,
  // from the row's on-screen rectangle and its own width. Transforms on the box don't count:
  // a resource flying in from the deck is already the row's last card, drawn far from its
  // slot until it lands. `rested` turns the box 90° about its centre, as the site turns a
  // rested card; `turned` is a row drawn turned 180° (the opponent's seat).
  function layoutRect(box, row, width, {rested = false, turned = false} = {}) {
    const b = rested
      ? {left: box.left + (box.width - box.height) / 2, top: box.top + (box.height - box.width) / 2, width: box.height, height: box.width}
      : box;
    const s = (row.right - row.left) / width;
    if (!turned) return {left: row.left + b.left * s, right: row.left + (b.left + b.width) * s, top: row.top + b.top * s, bottom: row.top + (b.top + b.height) * s};
    return {left: row.right - (b.left + b.width) * s, right: row.right - b.left * s, top: row.bottom - (b.top + b.height) * s, bottom: row.bottom - b.top * s};
  }

  // Whether a row is drawn turned 180°: its label's centre on screen is where the turned
  // layout puts it. (The site turns the label itself back upright about its own centre.)
  function turned(labelBox, labelRect, row, width) {
    const middle = r => (r.left + r.right) / 2, at = middle(labelRect);
    return Math.abs(at - middle(layoutRect(labelBox, row, width, {turned: true}))) < Math.abs(at - middle(layoutRect(labelBox, row, width)));
  }

  // How far to move a number, in em, so its ink sits in the middle of its line box (line
  // height 1). From canvas TextMetrics at `size` px: advance, left, right, ascent, descent
  // (the ink's bounding box), fontAscent, fontDescent, and `mass`, the ink's horizontal
  // centre of mass from the pen position. Across, the centre blends the ink's bounding box
  // and its weight by `weight`: Orbitron's 1 is a heavy stem right of its box centre with a
  // thin flag. Down, it is the bounding box, since the figures share one height.
  function inkOffset(m, size, weight) {
    const box = (m.right - m.left) / 2;
    const x = (m.advance / 2 - ((1 - weight) * box + weight * m.mass)) / size;
    const baseline = (size + m.fontAscent - m.fontDescent) / 2;
    const y = (size / 2 - baseline - (m.descent - m.ascent) / 2) / size;
    return {x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000};
  }

  // The level the site's label shows on its first line ("LVL 4"), or the row's card count
  // when it shows none.
  function level(labelText, c) {
    const m = /LVL\s*(\d+)/i.exec(labelText || '');
    return m ? Number(m[1]) : c.total;
  }

  // The tab's accessible name while an effect panel hides the row's label: "Level 4; 3 of 4
  // resources active, including 1 EX Resource".
  function describeTab(lvl, c) { return `Level ${lvl}; ${describe(c)}`; }

  // Whether an effect panel hides what a row shows beside its cards. Parts are the on-screen
  // rectangles of the numbers the player reads there: the level and the counts in the level
  // label ("LVL 4", "3 RESOURCES", "+1 EX") and the hexagon's; the panel hides them when it
  // covers at least half of one. A panel over the cards alone, or over just the label's
  // letters, leaves them readable.
  const HIDDEN_SHARE = 0.5;
  function hides(panel, parts) {
    const area = r => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
    return parts.some(p => {
      const whole = area(p);
      if (!whole) return false;
      const shared = area({left: Math.max(p.left, panel.left), right: Math.min(p.right, panel.right),
        top: Math.max(p.top, panel.top), bottom: Math.min(p.bottom, panel.bottom)});
      return shared >= HIDDEN_SHARE * whole;
    });
  }

  // Where the tab sits around an effect panel ({left, right, top, bottom} on screen):
  //   size: the tab's {width, height}; gap: its distance from the panel
  //   obstacles: what it should not cover (the site's targets and their labels, the action button)
  //   bounds: the viewport
  // In order: above the panel at its left then its right end, below it the same way, then
  // beside it. It takes the first spot inside the viewport that covers nothing, otherwise the
  // spot inside the viewport that covers the least, otherwise the first spot moved onto the
  // screen. Returns {at, left, top}.
  function dock({panel, size, gap, obstacles = [], bounds}) {
    const {width: w, height: h} = size;
    const middle = (panel.top + panel.bottom - h) / 2;
    const spots = [
      ['above-start', panel.left, panel.top - gap - h], ['above-end', panel.right - w, panel.top - gap - h],
      ['below-start', panel.left, panel.bottom + gap], ['below-end', panel.right - w, panel.bottom + gap],
      ['before', panel.left - gap - w, middle], ['after', panel.right + gap, middle],
    ].map(([at, left, top]) => ({at, left, top}));
    const box = s => ({left: s.left, right: s.left + w, top: s.top, bottom: s.top + h});
    const inside = s => { const b = box(s); return b.left >= bounds.left && b.right <= bounds.right && b.top >= bounds.top && b.bottom <= bounds.bottom; };
    const covered = s => {
      const b = box(s);
      return obstacles.reduce((sum, o) => sum + Math.max(0, Math.min(b.right, o.right) - Math.max(b.left, o.left))
        * Math.max(0, Math.min(b.bottom, o.bottom) - Math.max(b.top, o.top)), 0);
    };
    const fits = spots.filter(inside);
    // Nowhere inside the viewport: above the panel's start, moved onto the screen.
    if (!fits.length) {
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      return {...spots[0], left: clamp(spots[0].left, bounds.left, bounds.right - w), top: clamp(spots[0].top, bounds.top, bounds.bottom - h)};
    }
    let best = fits[0], least = covered(best);
    for (const s of fits) {
      const area = covered(s);
      if (area === 0) return s;
      if (area < least) { best = s; least = area; }
    }
    return best;
  }

  const api = {HEX, GAP, MIN_SCALE, CARD_SHARE, count, describe, place, layoutRect, turned, inkOffset, level, describeTab, hides, dock};
  root.CBLResources = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
