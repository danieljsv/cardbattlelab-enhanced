// Card info at a glance: printed info on your hand cards, live state on every Unit and
// Base in play, each player's active resource count, your hand's count against the hand
// limit, a "Printed abilities" list in the site's card view, and every face-up card's
// rarity foil (foil.js). Runs in the page's own world (Chrome MAIN-world content script, or
// the Android WebView) because it reads the site's card database and board snapshot.
// Display only. Each addition can be turned off in the extension's settings (features.js).
(function () {
  'use strict';
  if (window.__cblOverlays) return;
  const K = window.CBLKeywords, ICONS = window.CBLIcons, L = window.CBLLayout, R = window.CBLResources, F = window.CBLFoil;
  const H = window.CBLHandCount, FEATURES = window.CBLFeatures;
  if (!K || !ICONS || !L || !R || !F || !H || !FEATURES) return;

  const HAND = '.hand-row[data-hand-player="p1"]';
  const FIELD_UNITS = '.play-area [data-slot] > .card[data-instance-id], .play-area [data-slot] > .play-stack[data-instance-id]';
  const BASES = '.card[data-base-player][data-instance-id]';
  const RESOURCE_ROWS = '.resources-row[data-res-player]';
  const OWN = 'cbl-ov';
  const FADE_DELAY = 120;
  const REST_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square" aria-hidden="true"><path d="M4.6 15.4A7.6 7.6 0 1 1 17.8 18"/><path d="M4.4 9.6v6h6"/></svg>';

  // ---- Guarded DOM writes: a same-value write still wakes the site's observers. ----

  function setAttr(el, name, value) {
    if (value === null || value === undefined || value === false) {
      if (el.hasAttribute(name)) el.removeAttribute(name);
      return;
    }
    const text = value === true ? '' : String(value);
    if (el.getAttribute(name) !== text) el.setAttribute(name, text);
  }
  function setClass(el, name, on) { if (el.classList.contains(name) !== Boolean(on)) el.classList.toggle(name, Boolean(on)); }
  function setStyle(el, name, value) { if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value); }
  function setHTML(el, html) { if (el.__cblHtml !== html) { el.innerHTML = html; el.__cblHtml = html; } }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

  // ---- Settings: the additions turned off in the extension's menu ----------------------------

  // The extension's settings bridge writes them to <html>; the Android app has none, so
  // everything is on there. Turning one off removes what it drew on the next update.
  let off = new Set();
  const on = key => !off.has(key);
  const readSettings = () => { off = FEATURES.parse(document.documentElement.getAttribute(FEATURES.ATTR)); };

  function ownOverlay(host, kind) {
    let el = host.__cblOverlay;
    if (!el || el.parentNode !== host) {
      el = document.createElement('div');
      el.className = `${OWN} ${kind}`;
      host.appendChild(el);
      host.__cblOverlay = el;
    }
    return el;
  }
  function dropOverlay(host) {
    const el = host.__cblOverlay;
    if (el && el.parentNode) el.parentNode.removeChild(el);
    host.__cblOverlay = null;
  }

  // ---- Site data ----------------------------------------------------------------

  // By the code on the card element, snapshot or card view; an alternate-art code
  // (ST01-001-p1) resolves to its base card.
  const printedCard = code => K.printed(window.__cardByCode, code);

  // The live card object the site rendered, matched by seat, instance id and code.
  function liveCard(side, iid, code) {
    const other = side === 'p1' ? 'p2' : 'p1';
    const snap = window.__lastBoardSnap;
    for (const s of [side, other]) {
      const seat = snap && snap[s];
      if (!seat) continue;
      const pool = [].concat(seat.play_area || [], seat.base || []);
      for (const c of pool) if (c && String(c.instance_id) === String(iid) && (!code || c.code === code)) return c;
    }
    const map = window.__pbInstanceMap;
    for (const s of [side, other]) {
      const c = map && map[s] && map[s][iid];
      if (c && (!code || c.code === code)) return c;
    }
    return null;
  }

  // ---- Pieces of markup ------------------------------------------------------------

  const amountText = b => (b.amount === null || b.amount === undefined ? '' : String(b.amount));
  function circle(b, extraClass = '') {
    const chip = amountText(b) ? `<b class="cbl-chip">${esc(amountText(b))}</b>` : '';
    return `<span class="cbl-kw${b.conditional ? ' cond' : ''}${extraClass}" data-kw="${esc(b.keyword)}">${ICONS[b.keyword] || ''}${chip}</span>`;
  }
  const names = list => list.map(K.label).join(', ');

  // ---- Hand: printed information -------------------------------------------------

  function handModel(card) {
    const parsed = K.forCard(card);
    const badges = K.handBadges(parsed);
    const num = v => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));
    const signed = v => (v >= 0 ? `+${v}` : String(v));
    const model = {kind: parsed.kind, badges, label: '', short: '', stats: null, tag: false};
    if (parsed.kind === 'unit') model.stats = {ap: String(num(card.ap)), hp: String(num(card.hp)), aria: `Printed AP ${num(card.ap)}; HP ${num(card.hp)}`};
    else if (parsed.kind === 'pilot') {
      model.label = 'PILOT';
      model.short = 'PLT';
      model.stats = {ap: signed(num(card.ap)), hp: signed(num(card.hp)), aria: `Pilot bonus AP ${signed(num(card.ap))}; HP ${signed(num(card.hp))}`};
    } else if (parsed.kind === 'base') {
      model.label = 'BASE';
      model.short = 'BASE';
      model.stats = {hp: String(num(card.hp)), aria: `Printed HP ${num(card.hp)}`};
    } else if (parsed.kind === 'command') model.tag = true;
    return model;
  }

  function handMarkup(model) {
    const kws = model.badges.length
      ? `<span class="cbl-kws" role="img" aria-label="${esc(`Printed abilities: ${names(model.badges)}`)}"></span>`
      : '<span class="cbl-kws" aria-hidden="true"></span>';
    const label = model.label ? `<span class="cbl-type ${model.kind}">${model.label}</span>` : '';
    let stats = '';
    if (model.tag) stats = '<span class="cbl-tag" role="img" aria-label="Command">COMMAND</span>';
    else if (model.stats && model.stats.ap !== undefined) {
      stats = `<span class="cbl-stats" role="img" aria-label="${esc(model.stats.aria)}"><b class="cbl-ap">${esc(model.stats.ap)}</b><i></i><b class="cbl-hp">${esc(model.stats.hp)}</b></span>`;
    } else if (model.stats) stats = `<span class="cbl-stats" role="img" aria-label="${esc(model.stats.aria)}"><b class="cbl-hp">${esc(model.stats.hp)}</b></span>`;
    return `<div class="cbl-foot">${label}${kws}${stats}</div>`;
  }

  // Widths in card units, measured once per markup at the current scale. Measuring
  // rewrites the footer, so the card's fit is applied again afterwards.
  const measures = new Map();
  function measure(root, model, width) {
    const key = handMarkup(model);
    let m = measures.get(key);
    if (m) return m;
    root.__cblFit = null;
    const unit = width / 100;
    const foot = root.firstElementChild;
    const statsEl = foot.querySelector('.cbl-stats, .cbl-tag');
    const labelEl = foot.querySelector('.cbl-type');
    root.removeAttribute('data-narrow');
    m = {label: null};
    if (labelEl) {
      // The last fit may have hidden or shortened the label.
      labelEl.style.display = '';
      labelEl.textContent = model.short;
      labelEl.setAttribute('data-size', 'short');
      const short = labelEl.offsetWidth / unit;
      labelEl.textContent = model.label;
      labelEl.removeAttribute('data-size');
      m.label = {full: labelEl.offsetWidth / unit, short};
    }
    if (model.tag) {
      statsEl.removeAttribute('data-size');
      statsEl.textContent = 'COMMAND';
      const full = statsEl.offsetWidth / unit;
      statsEl.textContent = 'CMD';
      const short = statsEl.offsetWidth / unit;
      statsEl.setAttribute('data-size', 'tiny');
      const tiny = statsEl.offsetWidth / unit;
      statsEl.removeAttribute('data-size');
      statsEl.textContent = 'COMMAND';
      m.tag = {full, short, tiny};
    } else if (statsEl) {
      const wide = statsEl.offsetWidth / unit;
      root.setAttribute('data-narrow', '');
      const narrow = statsEl.offsetWidth / unit;
      root.removeAttribute('data-narrow');
      m.box = {wide, narrow};
    } else m.box = {wide: 0, narrow: 0};
    // Fonts settle after the first paint; only cache real measurements.
    if (width > 0 && (m.tag ? m.tag.full > 0 : m.box.wide > 0 || !statsEl)) measures.set(key, m);
    return m;
  }

  function dropHandCard(cardEl) {
    const root = cardEl.__cblOverlay;
    if (root && root.__cblFadeTimer) { clearTimeout(root.__cblFadeTimer); root.__cblFadeTimer = null; }
    dropOverlay(cardEl);
    setClass(cardEl, 'cbl-host', false);
  }

  // A hand card's footer markup and measurements, or null when it gets no footer. `glow`
  // marks a known card for the playable-card glow, with or without its footer.
  function prepareHandCard(cardEl, info, glow) {
    const code = cardEl.getAttribute('data-cc');
    const card = printedCard(code) || liveCard('p1', cardEl.getAttribute('data-instance-id'), code);
    setClass(cardEl, 'cbl-glow', glow && Boolean(card));
    if (!card || !info) { dropHandCard(cardEl); return null; }
    const width = cardEl.offsetWidth;
    if (!width) return null;
    setClass(cardEl, 'cbl-host', true);
    const root = ownOverlay(cardEl, 'cbl-hand');
    const model = handModel(card);
    const markup = handMarkup(model);
    if (root.__cblMarkup !== markup) { setHTML(root, markup); root.__cblMarkup = markup; root.__cblFit = null; }
    setStyle(root, '--u', `${(width / 100).toFixed(3)}px`);
    return {cardEl, root, model, m: measure(root, model, width)};
  }

  function renderHandCard({cardEl, root, model, m}, visible, narrow) {
    const f = L.fit({visible, box: m.box, tag: m.tag, label: m.label, count: model.badges.length, narrow});
    const fitKey = JSON.stringify([visible.toFixed(1), f]);
    if (root.__cblFit !== fitKey) {
      root.__cblFit = fitKey;
      setAttr(root, 'data-mode', f.mode);
      setAttr(root, 'data-narrow', f.narrow);
      setAttr(root, 'data-small', f.small);
      setStyle(root, 'width', `${visible.toFixed(2)}%`);
      const foot = root.firstElementChild;
      const label = foot.querySelector('.cbl-type');
      if (label) {
        label.textContent = f.label === 'short' ? model.short : model.label;
        setAttr(label, 'data-size', f.label === 'short' ? 'short' : null);
        label.style.display = f.label ? '' : 'none';
      }
      const tag = foot.querySelector('.cbl-tag');
      if (tag) {
        tag.textContent = f.tag === 'full' ? 'COMMAND' : 'CMD';
        setAttr(tag, 'data-size', f.tag === 'tiny' ? 'tiny' : null);
      }
      const shown = model.badges.slice(0, f.shown);
      let html = shown.map(b => circle(b)).join('');
      if (f.more) html += `<span class="cbl-kw more">+${f.more}</span>`;
      setHTML(foot.querySelector('.cbl-kws'), html);
    }
    handleDrag(cardEl, root);
  }

  // The site has no drag copy: dragging (or tapping) a card to play lifts it in place
  // and draws an aim line, and reordering moves the card itself. The lifted card keeps
  // its footer for a moment, then fades it out.
  const lifted = el => el.classList.contains('cmd-drag-lift') || el.classList.contains('hand-reorder-drag');
  function handleDrag(cardEl, root) {
    const dragging = lifted(cardEl);
    if (dragging && !root.__cblFadeTimer && !root.classList.contains('cbl-fading')) {
      root.__cblFadeTimer = setTimeout(() => { root.__cblFadeTimer = null; setClass(root, 'cbl-fading', true); }, FADE_DELAY);
    } else if (!dragging) {
      if (root.__cblFadeTimer) { clearTimeout(root.__cblFadeTimer); root.__cblFadeTimer = null; }
      setClass(root, 'cbl-fading', false);
    }
  }

  function updateHand() {
    const info = on('handInfo'), glow = on('playableGlow');
    for (const row of document.querySelectorAll(HAND)) {
      const cards = [...row.children].filter(c => c.classList.contains('card') && c.hasAttribute('data-cc') && !c.classList.contains('card-hidden'));
      if (!info) { cards.forEach(c => prepareHandCard(c, info, glow)); continue; }
      const geometry = cards.map(c => ({
        left: c.offsetLeft,
        width: c.offsetWidth,
        // A focused or lifted card sits above its neighbours.
        raised: c.classList.contains('card-detail-focus') || lifted(c),
      }));
      const visible = L.strips(geometry);
      // One AP | HP orientation for the hand (the right-most card always side by side),
      // decided on its resting layout so lifting or focusing a card never flips every footer.
      const resting = L.strips(geometry.map(g => ({...g, raised: false})));
      const footers = cards.map(c => prepareHandCard(c, info, glow));
      const narrow = L.handNarrows(footers.map((f, i) => ({visible: resting[i], box: f && f.m.box})));
      footers.forEach((f, i) => { if (f) renderHandCard(f, visible[i], narrow[i]); });
    }
  }

  // ---- Field: live state ------------------------------------------------------------

  function badgeMarkup(live, base) {
    const hp = Number(live.current_hp ?? live.hp_max ?? 0);
    const max = Number(live.hp_max ?? hp);
    const hurt = hp < max;
    const hpHtml = `<small>HP</small><span class="cbl-hpv"><b class="cbl-hp${hurt ? ' hurt' : ''}">${hp}</b>${hurt ? `<span class="cbl-max">/${max}</span>` : ''}</span>`;
    const aria = hurt ? `HP ${hp} of ${max}` : `HP ${hp}`;
    if (base) return `<span class="cbl-badge" role="img" aria-label="${aria}">${hpHtml}</span>`;
    const ap = Number(live.ap ?? 0);
    return `<span class="cbl-badge" role="img" aria-label="AP ${ap}; ${aria}"><small>AP</small><b class="cbl-ap">${ap}</b>${hpHtml}</span>`;
  }

  function renderField(host, base) {
    const side = (host.closest('[data-player]') || host).getAttribute('data-player')
      || host.getAttribute('data-base-player') || 'p1';
    const code = host.getAttribute('data-cc');
    const live = liveCard(side, host.getAttribute('data-instance-id'), code);
    if (!live) { dropOverlay(host); setClass(host, 'cbl-field-host', false); return; }
    const width = host.offsetWidth;
    if (!width) return;
    setClass(host, 'cbl-field-host', true);
    const root = ownOverlay(host, 'cbl-field');
    setStyle(root, '--u', `${(width / 100).toFixed(3)}px`);
    const kws = base ? [] : K.active(live, printedCard);
    const rested = !base && Boolean(live.tapped);
    // Four icons at most, like the hand: three and a "+N" when there are more.
    const shown = kws.length > L.MAX_CIRCLES ? kws.slice(0, L.MAX_CIRCLES - 1) : kws;
    const more = kws.length - shown.length;
    const kwsHtml = kws.length
      ? `<span class="cbl-kws" role="img" aria-label="${esc(`Active keywords: ${names(kws)}`)}">${shown.map(b => circle(b)).join('')}`
        + `${more ? `<span class="cbl-kw more">+${more}</span>` : ''}</span>` : '';
    const html = `<div class="cbl-live">${kwsHtml}${badgeMarkup(live, base)}</div>`
      + (base ? '' : `<span class="cbl-rest" role="img" aria-label="Rested">${REST_ICON}</span>`);
    setAttr(root, 'data-rested', rested);
    if (root.__cblHtml === html) return;
    setHTML(root, html);
    // Too many icons for one row beside the badge: icons move above it. Sizes scale
    // with --u, so the answer only changes with the markup.
    const row = root.firstElementChild;
    if (row && kws.length) setAttr(row, 'data-stack', row.offsetWidth > width * 0.94);
  }

  function updateField() {
    if (!on('fieldInfo')) {
      document.querySelectorAll('.cbl-field-host').forEach(el => { dropOverlay(el); setClass(el, 'cbl-field-host', false); });
      return;
    }
    document.querySelectorAll(FIELD_UNITS).forEach(el => renderField(el, false));
    document.querySelectorAll(BASES).forEach(el => renderField(el, true));
  }

  // ---- Resources: how many can still pay -----------------------------------------------

  // Orbitron's figures sit unevenly in their advance, so each number is centred by its ink,
  // three parts by its weight and one by its bounding box (see inkOffset in resources.js).
  const INK_WEIGHT = 0.75;
  const inkOffsets = new Map();
  let inkCanvas = null;
  function inkOffset(text) {
    let offset = inkOffsets.get(text);
    if (offset) return offset;
    const size = 100, pen = 25, width = size * (text.length + 1), height = size * 1.5;
    inkCanvas = inkCanvas || document.createElement('canvas');
    inkCanvas.width = width;
    inkCanvas.height = height;
    const ctx = inkCanvas.getContext('2d', {willReadFrequently: true});
    ctx.font = `900 ${size}px Orbitron`;
    ctx.fillText(text, pen, size);
    const m = ctx.measureText(text);
    const data = ctx.getImageData(0, 0, width, height).data;
    let sum = 0, moment = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]) { sum += data[i]; moment += data[i] * ((i >> 2) % width); }
    if (!sum || m.fontBoundingBoxAscent === undefined) return '0em 0em';
    const o = R.inkOffset({advance: m.width, left: m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight,
      ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent, fontAscent: m.fontBoundingBoxAscent,
      fontDescent: m.fontBoundingBoxDescent, mass: moment / sum - pen}, size, INK_WEIGHT);
    offset = `${o.x}em ${o.y}em`;
    // Measured with a fallback font until Orbitron loads; only keep Orbitron's.
    if (!document.fonts || document.fonts.check(ctx.font)) inkOffsets.set(text, offset);
    return offset;
  }

  const boxOf = el => ({left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight});

  function setBox(el, left, top, width, height) {
    setStyle(el, 'left', `${left}px`);
    setStyle(el, 'top', `${top}px`);
    setStyle(el, 'width', `${width}px`);
    setStyle(el, 'height', `${height}px`);
  }

  const visibleRect = el => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 ? r : null; };
  // The numbers in a line of the level label on screen ("LVL 4", "3 RESOURCES", "+1 EX"),
  // or the whole line when it has none.
  function numberRects(line) {
    const rects = [];
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const m of node.data.matchAll(/\d+/g)) {
        const range = document.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const r = visibleRect(range);
        if (r) rects.push(r);
      }
    }
    return rects.length ? rects : [visibleRect(line)];
  }

  // The site rebuilds each resource row as it renders, so the readout is added again to
  // every new row before it is painted.
  function updateResources() {
    const button = document.querySelector('.pb-pass-btn');
    const bounds = {left: 0, top: 0, right: innerWidth, bottom: innerHeight};
    const shown = [];
    if (!on('resourceCount')) {
      document.querySelectorAll(RESOURCE_ROWS).forEach(dropOverlay);
      for (const tab of tabs.values()) tab.remove();
      tabs.clear();
      return;
    }
    for (const row of document.querySelectorAll(RESOURCE_ROWS)) {
      const label = row.querySelector(':scope > .res-row-label');
      const cards = [...row.querySelectorAll(':scope > .card')];
      if (!label || !label.offsetParent || !cards.length) { dropOverlay(row); continue; }
      const c = R.count(cards.map(el => ({ex: el.classList.contains('ex-resource'), rested: el.classList.contains('tapped')})));
      const root = ownOverlay(row, 'cbl-res');
      const text = String(c.active);
      setHTML(root, `<span class="cbl-res-cell" role="img" aria-label="${esc(R.describe(c))}"><b>${text}</b></span>`);
      setStyle(root.firstElementChild.firstElementChild, 'translate', inkOffset(text));
      setAttr(root, 'data-spent', !c.active);
      setAttr(root, 'data-wide', c.active > 9);
      const style = getComputedStyle(label);
      const font = parseFloat(style.fontSize);
      const rect = label.getBoundingClientRect();
      const em = font * rect.width / label.offsetWidth; // one em of the label, on screen
      const last = cards[cards.length - 1];
      const afterScale = Math.max(1, last.offsetWidth * R.CARD_SHARE / (R.HEX.width * font));
      const shields = document.querySelector(`.shields-pile[data-shields-player="${row.getAttribute('data-res-player')}"]`);
      // Cards where the row lays them out, not where they are drawn: a resource flying in
      // from the deck is already the row's last card.
      const rowRect = row.getBoundingClientRect();
      const turned = R.turned(boxOf(label), rect, rowRect, row.offsetWidth);
      const laid = el => R.layoutRect(boxOf(el), rowRect, row.offsetWidth, {turned, rested: el.classList.contains('tapped')});
      const spot = R.place({label: rect, first: laid(cards[0]), last: laid(last), row: rowRect,
        size: {width: R.HEX.width * em, height: R.HEX.height * em}, gap: R.GAP * em, afterScale,
        obstacles: [shields, button].filter(Boolean).map(el => el.getBoundingClientRect()), bounds});
      setAttr(root, 'data-place', spot.at);
      // The opponent's seat is turned 180° and the site turns its label back upright; the
      // readout turns the same way.
      setStyle(root, 'rotate', style.rotate);
      setStyle(root, 'font-size', `${font * spot.scale}px`);
      if (spot.at === 'after') {
        // A box just past the last card (a rested card is turned 90°), the hexagon centred in it.
        const half = (last.classList.contains('tapped') ? last.offsetHeight : last.offsetWidth) / 2;
        setBox(root, last.offsetLeft + last.offsetWidth / 2 + half, last.offsetTop, (R.HEX.width + 2 * R.GAP) * font * spot.scale, last.offsetHeight);
        setStyle(root, 'translate', 'none');
      } else {
        // The label's own box, so the hexagon sits beside or above it in its coordinates.
        setBox(root, label.offsetLeft, label.offsetTop, label.offsetWidth, label.offsetHeight);
        setStyle(root, 'translate', style.translate);
      }
      // What the player reads beside the cards: the label's numbers and the hexagon's.
      const lines = label.children.length ? [...label.children] : [label];
      shown.push({seat: row.getAttribute('data-res-player'), c, level: R.level((label.firstElementChild || label).textContent, c), em,
        parts: [...lines.flatMap(numberRects), visibleRect(root.firstElementChild.firstElementChild)].filter(Boolean)});
    }
    updateTabs(shown, bounds);
  }

  // ---- Resources under an effect panel ------------------------------------------------

  // While a player chooses (a target, a card to discard, the hand limit) or aims a card, the
  // site draws the card's text in a panel over or just above that player's resource row: a
  // fixed copy on <body>. Mostly it covers only the cards, and the level label and hexagon
  // stay in view. When it hides one of their numbers, a small tab just outside the panel
  // repeats that row's hexagon and level. Refusals ("Level too low.") get no tab.
  const PANELS = '.pb-effect-context-overlay:not(.pb-fizzle)';
  // The site's targets and their labels, a played Command's card, the action button, and the
  // AP/HP of Units and Bases in play (the overlay's badge and the site's box).
  const TAB_OBSTACLES = '.lab-targetable, .fx-ret-label, .command-reveal, #pbActionFloat, .cbl-field .cbl-live, .stat-overlay';
  // The tab is a small aside: half the size of the row's hexagon, in em of the label on screen,
  // or of this share of one line of the panel's text on screen if that is larger (the
  // desktop's label is far smaller than its panel's text). One line, not the panel's height,
  // so a long text wrapped over several lines keeps the tab its one-line size.
  const TAB_SCALE = 0.5;
  const TAB_LINE_SHARE = 0.75;
  const tabs = new Map();
  // A line of the panel's text on screen: its line height, times the scale the site draws it at.
  function panelLine(el, rect) {
    const style = getComputedStyle(el);
    const line = parseFloat(style.lineHeight) || 1.2 * parseFloat(style.fontSize) || 0;
    return el.offsetHeight ? line * rect.height / el.offsetHeight : 0;
  }
  function updateTabs(rows, bounds) {
    const lines = new Map();
    const panels = [...document.querySelectorAll(PANELS)].map(el => {
      const r = visibleRect(el);
      if (r) lines.set(r, panelLine(el, r));
      return r;
    }).filter(Boolean);
    // One tab per row, by seat and the row's place among that seat's rows: the site
    // rebuilds a row as it renders, and the tab stays.
    const places = {};
    const keyed = rows.map(row => ({...row, key: `${row.seat}:${places[row.seat] = (places[row.seat] ?? -1) + 1}`}));
    const keys = new Set();
    for (const row of keyed) {
      const panel = panels.find(p => R.hides(p, row.parts));
      if (!panel) continue;
      const key = row.key;
      keys.add(key);
      let tab = tabs.get(key);
      if (!tab || !tab.isConnected) {
        tab = document.createElement('div');
        tab.className = `${OWN} cbl-res-tab`;
        tab.setAttribute('data-seat', row.seat);
        tab.setAttribute('role', 'img');
        document.body.appendChild(tab);
        tabs.set(key, tab);
      }
      const text = String(row.c.active);
      setAttr(tab, 'aria-label', R.describeTab(row.level, row.c));
      setHTML(tab, `<span class="cbl-res-cell"><b>${text}</b></span><span class="cbl-res-lvl">LVL ${row.level}</span>`);
      setStyle(tab.firstElementChild.firstElementChild, 'translate', inkOffset(text));
      setAttr(tab, 'data-spent', !row.c.active);
      setAttr(tab, 'data-wide', row.c.active > 9);
      const em = TAB_SCALE * Math.max(row.em, TAB_LINE_SHARE * lines.get(panel));
      setStyle(tab, 'font-size', `${em.toFixed(2)}px`);
      const obstacles = [...document.querySelectorAll(TAB_OBSTACLES)].map(visibleRect).filter(Boolean)
        .concat(panels.filter(p => p !== panel));
      const spot = R.dock({panel, size: {width: tab.offsetWidth, height: tab.offsetHeight}, gap: R.GAP * em, obstacles, bounds});
      setAttr(tab, 'data-dock', spot.at);
      setStyle(tab, 'left', `${spot.left.toFixed(1)}px`);
      setStyle(tab, 'top', `${spot.top.toFixed(1)}px`);
    }
    for (const [key, tab] of tabs) if (!keys.has(key)) { tab.remove(); tabs.delete(key); }
  }

  // ---- Hand count: cards in your hand against the hand limit ---------------------------

  // A small label outside the top-left corner of the hand's frame, in the level label's type
  // and size, so it reads like the site's own labels. The site rebuilds the seat's play area
  // (frame, hand and resource row) as it renders, so the label is added again to each new one.
  const COUNT_GAP = 0.35; // em
  // What the label must not cover: the level label and its hexagon, the Shield pile and Base
  // slot beside the hand, and the action button.
  const COUNT_OBSTACLES = '.res-row-label, .cbl-res-cell, .shield-col .slot-art, .shield-col .shield-frame, .shield-col .shield-empty, .shield-col .card';
  function updateHandCount() {
    const shown = on('handCount');
    for (const row of document.querySelectorAll(HAND)) {
      const wrap = row.parentElement;
      if (!wrap.matches('.play-area-wrap')) continue;
      if (shown) countHand(row, wrap);
      else dropOverlay(wrap);
    }
  }
  function countHand(row, wrap) {
    if (!row.offsetParent) { dropOverlay(wrap); return; }
    const outline = wrap.querySelector(':scope > .hand-outline');
    const frame = visibleRect(outline && outline.offsetWidth ? outline : row);
    if (!frame || !wrap.offsetWidth) { dropOverlay(wrap); return; }
    const n = row.querySelectorAll(':scope > .card').length;
    const root = ownOverlay(wrap, 'cbl-hand-count');
    setAttr(root, 'role', 'img');
    setAttr(root, 'aria-label', H.describe(n));
    setAttr(root, 'data-state', H.state(n));
    setHTML(root, `<b>${n}</b><small>/${H.LIMIT}</small>`);
    const label = wrap.querySelector('.res-row-label');
    const card = row.querySelector(':scope > .card');
    const font = label ? parseFloat(getComputedStyle(label).fontSize) : card ? card.offsetWidth * 0.18 : 12;
    setStyle(root, 'font-size', `${font.toFixed(2)}px`);
    // The play area is drawn scaled; positions are in its own pixels.
    const area = wrap.getBoundingClientRect();
    const scale = area.width / wrap.offsetWidth;
    const board = wrap.closest('.player-board') || wrap;
    const obstacles = [...board.querySelectorAll(COUNT_OBSTACLES), ...document.querySelectorAll('.pb-pass-btn')]
      .map(visibleRect).filter(Boolean);
    const spot = H.place({frame, size: {width: root.offsetWidth * scale, height: root.offsetHeight * scale},
      gap: COUNT_GAP * font * scale, obstacles, bounds: {left: 0, top: 0, right: innerWidth, bottom: innerHeight}});
    setAttr(root, 'data-at', spot.at);
    setStyle(root, 'left', `${((spot.left - area.left) / scale).toFixed(1)}px`);
    setStyle(root, 'top', `${((spot.top - area.top) / scale).toFixed(1)}px`);
  }

  // ---- Card view: printed abilities --------------------------------------------------

  function updateViewer() {
    if (!on('printedAbilities')) { document.querySelectorAll('.cbl-abilities').forEach(el => el.remove()); return; }
    for (const inner of document.querySelectorAll('#cardViewer .duo-in, .duo-panel .duo-in')) {
      const codeText = (inner.querySelector('.duo-code') || {}).textContent || '';
      const code = codeText.split('/')[0].trim();
      const card = printedCard(code);
      let section = inner.querySelector(':scope > .cbl-abilities');
      const lines = card ? K.describe(K.forCard(card)) : [];
      if (!lines.length) { if (section) section.remove(); continue; }
      if (section && section.getAttribute('data-code') === code) continue;
      if (!section) {
        section = document.createElement('section');
        section.className = 'cbl-abilities';
        // After the site's Trait/Link/AP/HP row, so that row stays where the site puts it.
        const anchor = inner.querySelector(':scope > .duo-foot') || inner.querySelector(':scope > .duo-effect');
        if (anchor && anchor.nextSibling) inner.insertBefore(section, anchor.nextSibling);
        else inner.appendChild(section);
      }
      section.setAttribute('data-code', code);
      section.innerHTML = '<b>Printed abilities</b><ul>' + lines.map(l => {
        const cond = l.kind === 'conditional' || l.kind === 'granted-conditional';
        return `<li class="${cond ? 'cond' : ''}"><span>${ICONS[l.keyword] || ''}</span><div><strong>${esc(l.name)}</strong>${l.text ? ` <em>${esc(l.text)}</em>` : ''}</div></li>`;
      }).join('') + '</ul>';
    }
  }

  // ---- Scheduling ----------------------------------------------------------------------

  function update() {
    if (!window.__cardByCode || waiting()) return;
    try { updateHand(); } catch (e) { report(e); }
    try { updateField(); } catch (e) { report(e); }
    try { updateResources(); } catch (e) { report(e); }
    try { updateHandCount(); } catch (e) { report(e); }
    try { updateViewer(); } catch (e) { report(e); }
    try { syncFoil(); } catch (e) { report(e); }
  }
  // Turning the foil off removes every finish once; turning it on lights the cards again.
  let foilLit = false;
  function syncFoil() {
    if (!foil) return;
    if (on('foil')) { foilLit = true; foil.sync(); }
    else if (foilLit) { foilLit = false; foil.clear(); }
  }
  let reported = 0;
  function report(error) { if (reported++ < 5) console.warn('[card info overlay]', error); }

  let frame = 0, foil = null;
  const later = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; update(); }); };

  // The site refits a resource row's width (its style) after building it, moving the label.
  // It adds, moves and removes its effect panel on <body>.
  // The card view's art (.duo-art) changes face in place in the deck builder. The site sizes
  // the hand's frame from the play area's style.
  const WATCHED = '.card, .play-stack, .hand-row, .play-area-wrap, [data-slot], .stack-unit, .resources-row, #cardViewer, .duo-in, .duo-art';
  // The floating card view (phone layouts) is rebuilt and shown in place; moving or resizing
  // it (its style) needs no update.
  const FLOAT_VIEW = '#cardDetailV2';
  const PANEL = '.pb-effect-context';
  function relevant(records) {
    let now = false, soon = false;
    for (const r of records) {
      const t = r.target;
      if (t.nodeType !== 1 || (t.closest && t.closest(`.${OWN}, .cbl-abilities, .cbl-holo, .fx-ret`))) continue;
      if (r.type === 'childList') {
        const nodes = [...r.addedNodes, ...r.removedNodes].filter(n => n.nodeType === 1 && !n.classList.contains(OWN)
          && !n.matches('.cbl-abilities, .cbl-holo, .cbl-tilt-pad, .cbl-move-grip'));
        if (!nodes.length) continue;
        // New card elements get their overlay before the next paint.
        if (nodes.some(n => n.matches(`${WATCHED}, ${PANEL}`) || n.querySelector(WATCHED)) || t.closest(FLOAT_VIEW)) now = true;
        else if (t.closest(WATCHED + ', #board, #inspector')) soon = true;
      } else if (t.matches(`${WATCHED}, ${PANEL}`) || (r.attributeName === 'src' && t.closest(`${WATCHED}, ${FLOAT_VIEW}`))
        || (r.attributeName === 'class' && t.matches(FLOAT_VIEW))) soon = true;
    }
    return now ? 'now' : soon ? 'soon' : null;
  }

  // The bridge marks the page until the stored settings are on it, so an addition turned off
  // never shows for a moment. A bridge that never answers stops holding the overlay back.
  const SETTINGS_WAIT = 2000;
  let settingsWaited = false;
  const waiting = () => !settingsWaited && document.documentElement.hasAttribute(FEATURES.PENDING);

  function start() {
    readSettings();
    new MutationObserver(() => { readSettings(); later(); })
      .observe(document.documentElement, {attributes: true, attributeFilter: [FEATURES.ATTR, FEATURES.PENDING]});
    setTimeout(() => { settingsWaited = true; later(); }, SETTINGS_WAIT);
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(window.__CBL_OVERLAY_CSS || '');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    } catch (e) { report(e); }
    try { foil = F.create({onError: report}); window.__cblOverlays.holo = foil; } catch (e) { report(e); }
    const observer = new MutationObserver(records => {
      const when = relevant(records);
      if (when === 'now') { update(); observer.takeRecords(); }
      else if (when === 'soon') later();
    });
    observer.observe(document.body, {subtree: true, childList: true, attributes: true,
      // src: a card face swapped in place shows its own print's finish.
      attributeFilter: ['class', 'style', 'src', 'data-cc', 'data-chp', 'data-ctap', 'data-instance-id']});
    // A new board snapshot can change keywords without touching the DOM.
    let snap = null;
    setInterval(() => { if (window.__lastBoardSnap !== snap) { snap = window.__lastBoardSnap; later(); } }, 400);
    addEventListener('resize', later);
    // Widths measured with a fallback font are re-measured once the site's fonts load.
    if (document.fonts) document.fonts.addEventListener('loadingdone', () => { measures.clear(); inkOffsets.clear(); later(); });
    later();
  }

  window.__cblOverlays = {version: 1, update, liveCard, off: () => [...off]};
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, {once: true});
})();
