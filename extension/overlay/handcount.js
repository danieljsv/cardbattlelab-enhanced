// Hand count: how many cards are in your hand against the hand limit, in a small label at
// the top-left corner of the hand's frame. Yellow at the limit, red over it. Display only:
// the site still asks for the discard at the end of the turn.
(function (root) {
  'use strict';

  // The site's hand limit (HAND_LIMIT in its match script, v0.213.0): at the end of the
  // turn a player holding more discards down to it.
  const LIMIT = 10;

  // 'over' above the limit, 'full' at it, otherwise null.
  function state(n, limit = LIMIT) {
    return n > limit ? 'over' : n === limit ? 'full' : null;
  }

  // The label's accessible name: "7 of 10 cards in hand", with the limit when it is reached.
  function describe(n, limit = LIMIT) {
    const cards = `${n} of ${limit} card${limit === 1 ? '' : 's'} in hand`;
    const s = state(n, limit);
    if (s === 'full') return `${cards}, at the hand limit`;
    if (s === 'over') return `${cards}, ${n - limit} over the hand limit`;
    return cards;
  }

  // Where the label sits, from on-screen rectangles ({left, right, top, bottom}):
  //   frame: the hand's frame; size: the label's {width, height}; gap: its distance from the frame
  //   obstacles: what it must not cover (the level label and its hexagon, the Shield pile,
  //   the action button); bounds: the viewport
  // Outside the frame's top-left corner, where no hand card goes: beside it, level with the
  // frame's top edge ('left', the phone layout), then above it, level with the frame's left
  // edge ('above', the desktop). It takes the first spot inside the viewport that covers
  // nothing, otherwise the one that covers the least, otherwise the first moved onto the
  // screen. Returns {at, left, top}.
  function place({frame, size, gap, obstacles = [], bounds}) {
    const {width: w, height: h} = size;
    const spots = [
      {at: 'left', left: frame.left - gap - w, top: frame.top},
      {at: 'above', left: frame.left, top: frame.top - gap - h},
    ];
    const box = s => ({left: s.left, right: s.left + w, top: s.top, bottom: s.top + h});
    const inside = s => { const b = box(s); return b.left >= bounds.left && b.right <= bounds.right && b.top >= bounds.top && b.bottom <= bounds.bottom; };
    const covered = s => {
      const b = box(s);
      return obstacles.reduce((sum, o) => sum + Math.max(0, Math.min(b.right, o.right) - Math.max(b.left, o.left))
        * Math.max(0, Math.min(b.bottom, o.bottom) - Math.max(b.top, o.top)), 0);
    };
    const fits = spots.filter(inside);
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

  const api = {LIMIT, state, describe, place};
  root.CBLHandCount = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
