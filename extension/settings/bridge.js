// Settings bridge: carries the additions turned off in the extension's menu to the page, where
// the overlay (a MAIN-world script, without extension APIs) and its stylesheet read them from
// <html data-cbl-off="…">. Runs in the extension's isolated world before the page's scripts,
// and follows changes made in the menu while the game is open.
(function () {
  'use strict';
  const F = globalThis.CBLFeatures;
  const html = document.documentElement;
  if (!F || !html) return;
  html.setAttribute(F.PENDING, '');
  function apply(stored) {
    const value = F.attr(stored);
    if (value) html.setAttribute(F.ATTR, value);
    else html.removeAttribute(F.ATTR);
    html.removeAttribute(F.PENDING);
  }
  chrome.storage.sync.get(F.STORAGE_KEY).then(result => apply(result[F.STORAGE_KEY]), () => apply(null));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[F.STORAGE_KEY]) apply(changes[F.STORAGE_KEY].newValue);
  });
})();
