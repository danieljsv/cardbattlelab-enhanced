// The extension's settings menu (toolbar popup and options page): one switch per addition in
// features.js, saved in chrome.storage.sync. The settings bridge passes changes on to open
// game tabs.
(function () {
  'use strict';
  const F = window.CBLFeatures;
  const storage = window.chrome && chrome.storage && chrome.storage.sync;
  const list = document.getElementById('features');
  const all = document.getElementById('all');
  let stored = {};

  function render() {
    const off = new Set(F.off(stored));
    for (const input of list.querySelectorAll('input')) input.checked = !off.has(input.name);
    all.hidden = !off.size;
  }

  function save(next) {
    stored = next;
    render();
    if (storage) storage.set({[F.STORAGE_KEY]: stored});
  }

  let group = null;
  for (const f of F.FEATURES) {
    if (!group || group.dataset.group !== f.group) {
      group = document.createElement('section');
      group.dataset.group = f.group;
      const heading = document.createElement('h2');
      heading.textContent = f.group;
      group.appendChild(heading);
      list.appendChild(group);
    }
    const row = document.createElement('label');
    row.className = 'feature';
    const text = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = f.name;
    const note = document.createElement('small');
    note.textContent = f.text;
    text.append(name, note);
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.name = f.key;
    input.checked = true;
    input.addEventListener('change', () => save({...stored, [f.key]: input.checked}));
    row.append(text, input);
    group.appendChild(row);
  }
  all.addEventListener('click', () => save(Object.fromEntries(F.KEYS.map(key => [key, true]))));

  if (storage) {
    storage.get(F.STORAGE_KEY).then(result => { stored = result[F.STORAGE_KEY] || {}; render(); });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes[F.STORAGE_KEY]) { stored = changes[F.STORAGE_KEY].newValue || {}; render(); }
    });
  }
  render();
})();
