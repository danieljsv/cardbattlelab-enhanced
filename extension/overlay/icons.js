// Keyword glyphs drawn for this project: angular HUD strokes in the spirit of Card Battle
// Lab's chamfered panels and hexagon counters. One glyph per keyword, shared by the hand
// circles, the field icons and the card view.
(function (root) {
  'use strict';
  const svg = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false">${body}</svg>`;
  const ICONS = {
    // Hex nut with a medic cross: the Unit restores itself.
    Repair: svg('<path d="M12 2.8 19.9 7.4v9.2L12 21.2 4.1 16.6V7.4Z"/><path d="M12 8.2v7.6M8.2 12h7.6"/>'),
    // An arrow punching through a wall: damage carries on to the shield area.
    Breach: svg('<path d="M12.6 3h3.8v5.6h-3.8zM12.6 15.4h3.8V21h-3.8z" stroke-width="1.8"/><path d="M2.4 12H20.6M17.2 8.6l3.4 3.4-3.4 3.4"/>'),
    // Two stacked rank chevrons: rest to boost another Unit.
    Support: svg('<path d="M5.5 11.5 12 5l6.5 6.5"/><path d="M5.5 18.5 12 12l6.5 6.5"/>'),
    // Faceted mobile-suit shield with a centre ridge.
    Blocker: svg('<path d="M12 2.6 19.6 5.4V12L12 21.4 4.4 12V5.4Z"/><path d="M12 2.6v18.8" stroke-width="1.6"/>'),
    // Beam saber: hilt, guard and a long blade cutting in first.
    'First Strike': svg('<path d="M8 16 20.6 3.4" stroke-width="2.4"/><path d="M5.2 13.2l5.6 5.6"/><path d="M3.4 20.6 7 17" stroke-width="3.2"/>'),
    // A flight path vaulting over a blocking post: can't be blocked.
    'High-Maneuver': svg('<path d="M3.4 17.6C5.6 6.4 16.4 6 19 15.4"/><path d="M15.2 14.2l3.9 2.2 1.9-4"/><path d="M11.2 13.6v7.4" stroke-width="2.6"/>'),
    // One shot forking into two shield plates at once.
    Suppression: svg('<path d="M2.6 12H8l4.8-5.2M8 12l4.8 5.2"/><path d="M15.6 3.6h4.6v6.2h-4.6zM15.6 14.2h4.6v6.2h-4.6z" stroke-width="1.8"/>'),
  };
  root.CBLIcons = ICONS;
  if (typeof module === 'object' && module.exports) module.exports = ICONS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
