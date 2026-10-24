// Hand footer fitting. Every length is in card units: 1 = 1% of the card's width, so
// the same numbers hold at any board scale.
(function (root) {
  'use strict';

  const PAD = 3;          // footer inset from the card's bottom edge and the strip's end
  const EDGE = 1;         // footer inset from the card's own left edge, which nothing covers
  const GAP = 1.8;        // between circles, and between circles and the stats box
  const CIRCLE = 20;      // keyword circle diameter
  const CIRCLE_SMALL = 17.5;
  const MAX_CIRCLES = 4;
  // The next card's edge is rotated slightly in the fanned hand; keep this much clear.
  // The site turns neighbours about 1° apart around their bottom centres, which moves
  // that edge under half a unit at footer height.
  const STRIP_MARGIN = 1;

  // Visible width of each card in a hand row, left to right. A card is covered by the
  // card to its right, so its strip ends where the next card starts.
  function strips(cards) {
    return cards.map((card, i) => {
      if (card.raised || i === cards.length - 1) return 100;
      const next = cards[i + 1];
      if (!card.width) return 0;
      const exposed = (next.left - card.left) / card.width * 100 - STRIP_MARGIN;
      return Math.max(0, Math.min(100, exposed));
    });
  }

  const room = visible => Math.max(0, visible - PAD - EDGE);

  // Whether a hand stacks AP above HP: as soon as one card's stats don't fit side by side
  // in its strip, the hand stacks, so its footers never mix both.
  //   items: [{visible, box}] per card; cards without a stats box (Commands) don't count.
  function handNarrow(items) {
    return items.some(({visible, box}) => Boolean(box && box.wide) && room(visible) < box.wide);
  }

  // Each card's orientation in a stacked or side-by-side hand: the right-most card shows
  // its whole width, so it always keeps AP | HP side by side.
  function handNarrows(items) {
    const narrow = handNarrow(items);
    return items.map((_, i) => narrow && i < items.length - 1);
  }

  // How a footer fits a strip `visible` units wide.
  //   box: {wide, narrow} widths of the stats box (AP | HP side by side, or stacked)
  //   tag: {full, short, tiny} widths of a Command tag (instead of `box`)
  //   label: {full, short} widths of the PILOT/PLT or BASE label, or null
  //   count: number of keyword circles wanted
  //   narrow: the hand's handNarrow() decision (alone, the card is its own hand)
  function fit({visible, box, tag, label = null, count = 0, narrow = handNarrow([{visible, box}])}) {
    const avail = room(visible);
    let boxWidth, tagSize = null;
    if (tag) {
      tagSize = avail >= tag.full ? 'full' : avail >= tag.short ? 'short' : 'tiny';
      boxWidth = tag[tagSize];
      narrow = false;
    } else boxWidth = narrow ? box.narrow : box.wide;
    // The label sits above the stats; it shortens, then hides, only for want of room.
    const labelSize = !label ? null : label.full <= avail ? 'full' : label.short <= avail ? 'short' : null;
    const result = {mode: 'row', narrow, small: false, tag: tagSize, shown: 0, more: 0, label: labelSize};
    if (!count) return result;
    // In a row the circles sit left of the column holding the label and the stats.
    const column = Math.max(boxWidth, labelSize ? label[labelSize] : 0);
    const rowCap = d => Math.max(0, Math.floor((avail - column) / (d + GAP)));
    const stackCap = d => Math.max(0, Math.floor((avail + GAP) / (d + GAP)));
    // Same row, then smaller circles, then a second row; the first that shows every
    // circle wins. Otherwise the roomiest option shows what fits and a "+N" circle.
    const options = [
      {mode: 'row', small: false, cap: rowCap(CIRCLE)},
      {mode: 'row', small: true, cap: rowCap(CIRCLE_SMALL)},
      {mode: 'stack', small: false, cap: stackCap(CIRCLE)},
      {mode: 'stack', small: true, cap: stackCap(CIRCLE_SMALL)},
    ].map(o => ({...o, cap: Math.min(MAX_CIRCLES, o.cap)}));
    let pick = count <= MAX_CIRCLES ? options.find(o => o.cap >= count) : null;
    if (!pick) pick = options.reduce((best, o) => (o.cap > best.cap ? o : best));
    result.mode = pick.mode;
    result.small = pick.small;
    if (pick.cap >= count) result.shown = count;
    else if (pick.cap >= 1) { result.shown = pick.cap - 1; result.more = count - result.shown; }
    return result;
  }

  const api = {PAD, EDGE, GAP, CIRCLE, CIRCLE_SMALL, MAX_CIRCLES, STRIP_MARGIN, strips, handNarrow, handNarrows, fit};
  root.CBLLayout = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
