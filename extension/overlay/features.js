// The additions the Chrome extension's settings menu turns on and off, in the menu's order.
// Every addition defaults to on. The extension's settings bridge (settings/bridge.js) writes the
// ones turned off to <html data-cbl-off="…">, space separated, where the overlay and its
// stylesheet read them. The Android app has no menu and no bridge: with no attribute on the
// page, every addition is on.
(function (root) {
  'use strict';

  const FEATURES = [
    {key: 'foil', group: 'Cards', name: 'Rarity foil',
      text: 'Each card\'s rarity finish, tilting under the pointer.'},
    {key: 'handInfo', group: 'Your hand', name: 'Hand card info',
      text: 'AP | HP, Pilot bonuses, types and keywords on your cards.'},
    {key: 'playableGlow', group: 'Your hand', name: 'Playable card glow',
      text: 'A gold glow on cards you can play; the rest dim their art.'},
    {key: 'handCount', group: 'Your hand', name: 'Hand count',
      text: 'Cards in your hand against the hand limit of 10.'},
    {key: 'fieldInfo', group: 'Board', name: 'Field card info',
      text: 'Live AP, HP, damage and keywords in play; rested Units tilt.'},
    {key: 'resourceCount', group: 'Board', name: 'Active resources',
      text: 'How many resources can still pay, beside each row.'},
    {key: 'printedAbilities', group: 'Card view', name: 'Printed abilities',
      text: 'The card\'s keywords and grants, listed under its text.'},
    {key: 'viewStats', group: 'Card view', name: 'Live AP/HP on the printed box',
      text: 'The site\'s live AP/HP box moved onto the printed one.'},
  ];
  const KEYS = FEATURES.map(f => f.key);
  // chrome.storage.sync: {features: {handInfo: false, …}}; a key that is missing is on.
  const STORAGE_KEY = 'features';
  const ATTR = 'data-cbl-off';
  // Set by the bridge before the page's scripts run and cleared once the stored settings are on
  // the page, so the overlay never draws an addition that is turned off.
  const PENDING = 'data-cbl-settings-pending';

  // The keys turned off in stored settings, in menu order.
  function off(stored) {
    const s = stored && typeof stored === 'object' ? stored : {};
    return KEYS.filter(key => s[key] === false);
  }

  // The attribute's value for those settings.
  const attr = stored => off(stored).join(' ');

  // The set of known keys turned off, from the attribute's value (null when absent).
  function parse(value) {
    return new Set(String(value || '').split(/\s+/).filter(key => KEYS.includes(key)));
  }

  const api = {FEATURES, KEYS, STORAGE_KEY, ATTR, PENDING, off, attr, parse};
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CBLFeatures = api;
})(typeof window !== 'undefined' ? window : globalThis);
