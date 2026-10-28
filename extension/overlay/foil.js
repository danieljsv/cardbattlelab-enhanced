// Rarity foil on the page: lights every face-up card on the board and in the card view with
// the finish of its printed rarity (holo.js has the maths, holo.css the finishes). It reads
// public card faces and observes pointers passively: it never clicks, captures, prevents
// or delays the site's input, and it adds only data attributes and one layer box per face.
// The one exception is the floating card view's art, which gets a pad the site's own
// data-cd-no-drag keeps out of the panel drag, so a press there tilts the card.
// Light and tilt reach the stylesheet through per-card rules in an adopted stylesheet, so
// no card's inline style is touched and no write wakes the site's observers. A tilting
// board or hand card turns whole, frame, glow and badges with its art, as a card in the hand
// would, and a paired Unit turns with its Pilot; its layout box stays where it is. The card
// views turn their art box whole too.
(function () {
  'use strict';
  const H = window.CBLHolo;
  if (!H || window.CBLFoil) return;

  const FIELD_FACES = '.play-area [data-slot] :is(.card, .stack-unit, .stack-pilot) > img.card-art';
  const BASE_FACES = '.card[data-base-player] > img.card-art';
  const HAND_FACES = '.hand-row[data-hand-player="p1"] > .card:not(.card-hidden) > img.card-art';
  // The site's docked card view, wherever it docks: the match's #cardViewer and the deck
  // builder's #dmCardDetail. Not the copy the site fades out when the view changes face (a deep
  // clone marked .cd-ghost), which already carries the old face's layers.
  const VIEW_ART = '.duo-panel:not(.cd-ghost *) > .duo-art';
  const VIEW_FACES = `${VIEW_ART} > img`;
  // The floating card view (a long press on phone layouts, or the site's floating detail
  // setting): the large art in art mode, the thumbnail in info mode.
  const FLOAT_ART = '#cardDetailV2 :is(.big, .cd-art)';
  const FLOAT_FACES = `${FLOAT_ART} > img`;
  const HAND = '.hand-row[data-hand-player="p1"]';
  const LIMIT = {board: 11, view: 14, float: 14};
  // Perspective per px of face width, and texture scale against 155 px faces.
  const PERSPECTIVE = {board: 560 / 155, view: 900 / 220, float: 900 / 220};
  const TEXTURE_WIDTH = 155;
  const LIFTED_LIGHT = 0.55;

  function create({onError = () => {}} = {}) {
    const doc = document, win = window;
    const reducedQuery = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : {matches: false};
    // The site's animation speed (its tick speed): 1 at the default, 0 when animations are off.
    const ratio = () => {
      try {
        const scale = win.__gameAnimMs;
        return typeof scale === 'function' ? scale(1000, {min: 0, max: 1e9}) / 1000 : 1;
      } catch (e) { return 1; }
    };
    const motion = H.createMotion({reduced: () => reducedQuery.matches, ratio});
    const arrivals = H.createArrivals();
    const now = () => win.performance.now();

    // ---- The site's reading of turning cards ------------------------------------------------

    // The site measures hand cards and Units with new DOMMatrix('rotate(' + rotate + ')'). That
    // throws on the 3D rotate of a turning card, so a click on a tilted hand card locked the match.
    // While the foil is on, DOMMatrix reads such a rotate as the same turn. Other text is unchanged.
    const natives = new Map(), readers = new Map();
    function readTurns(on) {
      for (const name of ['DOMMatrix', 'DOMMatrixReadOnly']) {
        if (on && !natives.has(name) && typeof win[name] === 'function') {
          const reader = H.matrixReader(win[name]);
          natives.set(name, win[name]);
          readers.set(name, reader);
          win[name] = reader;
        } else if (!on && natives.has(name)) {
          // If other code replaced the constructor after us, keep its version.
          if (win[name] === readers.get(name)) win[name] = natives.get(name);
          natives.delete(name);
          readers.delete(name);
        }
      }
    }

    // ---- Owned stylesheet: textures and one rule per lit face -------------------------------

    let sheet = null, serial = 0;
    const rules = new Map();
    function ensureSheet() {
      if (sheet && doc.adoptedStyleSheets.includes(sheet)) return sheet;
      if (!sheet) sheet = new CSSStyleSheet();
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
      return sheet;
    }
    function ruleFor(node) {
      let rule = rules.get(node);
      if (!rule) {
        const css = ensureSheet(), id = String(++serial);
        node.setAttribute('data-cbl-holo-id', id);
        rule = css.cssRules[css.insertRule(`[data-cbl-holo-id="${id}"]{}`, css.cssRules.length)];
        rules.set(node, rule);
      }
      return rule;
    }
    function setVar(node, name, value) {
      const rule = ruleFor(node);
      if (rule.style.getPropertyValue(name) !== value) rule.style.setProperty(name, value);
    }
    function dropRule(node) {
      for (const map of [rules, stages]) {
        const rule = map.get(node);
        map.delete(node);
        const index = rule && sheet ? [...sheet.cssRules].indexOf(rule) : -1;
        if (index >= 0) sheet.deleteRule(index);
      }
    }
    // A card turning whole takes its perspective from its parent, centred on the card, through
    // a rule that applies only while it turns (the rotate property has no perspective of its own;
    // a lifted hand card stops turning, as holo.css says). The parents the site gives its cards
    // hold nothing positioned that this containing block would move. The perspective also makes
    // the parent a stacking context, where the site's z-indexes order its cards only among
    // themselves, so the rule lifts the parent to its highest card's level: every card stays
    // above what it covered at rest, the hand's frame (a later .hand-outline) among it.
    const stages = new Map();
    function stage(node) {
      const parent = node.parentElement;
      if (!parent) return;
      ruleFor(node);
      const id = node.getAttribute('data-cbl-holo-id');
      let rule = stages.get(node);
      if (!rule) {
        // Without :has() the card still turns, only without perspective.
        try {
          const css = ensureSheet();
          rule = css.cssRules[css.insertRule(`:has(> [data-cbl-holo-id="${id}"][data-cbl-holo-turn]:not(.cmd-drag-lift, .hand-reorder-drag)){}`,
            css.cssRules.length)];
        } catch (e) { return; }
        stages.set(node, rule);
      }
      // The card's centre in its parent's border box (offsets ignore transforms).
      const own = node.offsetParent === parent;
      const x = (own ? parent.clientLeft : -parent.offsetLeft) + node.offsetLeft + node.offsetWidth / 2;
      const y = (own ? parent.clientTop : -parent.offsetTop) + node.offsetTop + node.offsetHeight / 2;
      rule.style.setProperty('perspective', ruleFor(node).style.getPropertyValue('--cbl-holo-p') || '560px');
      rule.style.setProperty('perspective-origin', `${x.toFixed(1)}px ${y.toFixed(1)}px`);
      // The site's card parents are positioned, flex or grid items, so a z-index applies.
      let lift = 0;
      for (const child of parent.children) lift = Math.max(lift, parseInt(win.getComputedStyle(child).zIndex, 10) || 0);
      if (lift > 0) rule.style.setProperty('z-index', String(lift)); else rule.style.removeProperty('z-index');
    }
    function setAttr(el, name, on, value = '') {
      if (!on) { if (el.hasAttribute(name)) el.removeAttribute(name); return; }
      if (el.getAttribute(name) !== value) el.setAttribute(name, value);
    }

    // ---- Procedural foil textures (shared, generated once, seeded) --------------------------

    const canvas = (w, h) => { const c = doc.createElement('canvas'); c.width = w; c.height = h; return c; };
    // Every texture and mask URL, revoked by clear().
    const urls = new Set();
    const blobUrl = (c, ...type) => new Promise(resolve => c.toBlob(b => {
      const url = b ? URL.createObjectURL(b) : null;
      if (url) urls.add(url);
      resolve(url);
    }, ...(type.length ? type : ['image/png'])));
    // Chrome writes WebP at quality 1 without loss and off the main thread, so the faces are
    // ready sooner and are smaller than PNG. A probe checks one time that each opaque pixel comes
    // back the same; if not, the faces stay PNG.
    let faceType = null;
    function faceFormat() {
      if (faceType) return faceType;
      const c = canvas(16, 1), x = c.getContext('2d'), img = x.createImageData(16, 1);
      for (let i = 0; i < 16; i++) img.data.set([(i * 89 + 7) & 255, (i * 41 + 200) & 255, (i * 157 + 31) & 255, 255], i * 4);
      x.putImageData(img, 0, 0);
      // The blob is read as it is: the site does not let the page fetch blob URLs.
      faceType = new Promise(resolve => c.toBlob(resolve, 'image/webp', 1))
        .then(b => b && b.type === 'image/webp' ? createImageBitmap(b) : null)
        .then(bitmap => {
          if (!bitmap) return ['image/png'];
          const check = canvas(16, 1).getContext('2d', {willReadFrequently: true});
          check.drawImage(bitmap, 0, 0);
          return check.getImageData(0, 0, 16, 1).data.every((v, i) => v === img.data[i]) ? ['image/webp', 1] : ['image/png'];
        })
        .catch(() => ['image/png']);
      return faceType;
    }
    // The masks are written as PNG files here (H.png): this is much quicker than the browser's
    // encoder, which compresses them on the main thread. The pixels are the same. The rows are
    // compressed with the browser's zlib (CompressionStream), which is fast on smooth masks, so
    // the masks that stay in memory for the session are small. Without it, the rows are stored.
    const deflate = typeof CompressionStream === 'function'
      ? rows => new Response(new Blob([rows]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()
        .then(b => new Uint8Array(b), () => null)
      : () => Promise.resolve(null);
    async function pngUrl(width, height, pixels, channels = 1) {
      const rows = H.pngRows(width, height, pixels, channels), file = H.png(width, height, channels, rows, await deflate(rows));
      const url = URL.createObjectURL(new Blob([file], {type: 'image/png'}));
      urls.add(url);
      return url;
    }
    // Frosted holo texture (R/LR/P): two octaves of soft grain around neutral grey, each
    // upscaled from a tile padded with its own wrapped edges so smoothing crosses the seams.
    function grain(S = 512) {
      const c = canvas(S, S), x = c.getContext('2d'), rnd = H.random(11);
      x.fillStyle = 'rgb(128,128,128)'; x.fillRect(0, 0, S, S);
      for (const [n, alpha] of [[128, 0.85], [256, 0.55]]) {
        const values = new Uint8ClampedArray(n * n);
        for (let i = 0; i < values.length; i++) values[i] = 128 + (rnd() + rnd() + rnd() - 1.5) * 150;
        const padded = canvas(n + 2, n + 2), px = padded.getContext('2d'), img = px.createImageData(n + 2, n + 2);
        for (let y = 0; y < n + 2; y++) {
          for (let xx = 0; xx < n + 2; xx++) {
            const v = values[((y + n - 1) % n) * n + (xx + n - 1) % n], i = (y * (n + 2) + xx) * 4;
            img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
          }
        }
        px.putImageData(img, 0, 0);
        x.globalAlpha = alpha; x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
        x.drawImage(padded, 1, 1, n, n, 0, 0, S, S);
      }
      x.globalAlpha = 1;
      return c;
    }
    // Embossed surface (+ parallels): the fine grain of the real cards' stock, a cross weave
    // (stronger along the rows) with tiny pebbles, shaded around neutral grey by a light from
    // the top left (side 1) or the top right (side -1). Both sides draw the same relief. The
    // relief keeps only its fine detail, so it never forms large cells. Wrapped at the edges.
    function emboss(side, S = 256, count = 9000, seed = 5) {
      const rnd = H.random(seed), height = new Float32Array(S * S), at = (x, y) => ((y + S) % S) * S + (x + S) % S;
      // Threads about 2 px apart (120 per tile); their phase wobbles along each thread and
      // differs from thread to thread, so the weave never reads as straight lines.
      const f = Math.PI * 240 / S, turn = Array.from({length: 6}, () => rnd() * Math.PI * 2);
      const wobble = (t, u, o) => 1.2 * Math.sin(Math.PI * 10 * t / S + turn[o]) + 0.9 * Math.sin(Math.PI * 26 * t / S + turn[o + 1] + u * 0.7)
        + 0.6 * Math.sin(Math.PI * 4 * u / S + turn[o + 2]);
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) height[y * S + x] = 0.3 * Math.cos(f * y + wobble(x, y, 0)) + 0.25 * Math.cos(f * x + wobble(y, x, 3));
      }
      for (let i = 0; i < count; i++) {
        const cx = rnd() * S, cy = rnd() * S, r = 0.5 + rnd() * 0.4, a = 0.5 + rnd() * 0.5;
        for (let y = Math.floor(cy) - 2; y <= Math.floor(cy) + 2; y++) {
          for (let x = Math.floor(cx) - 2; x <= Math.floor(cx) + 2; x++) height[at(x, y)] += a * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (r * r));
        }
      }
      // High pass: minus the 7 x 7 local mean.
      const mean = new Float32Array(S * S), row = new Float32Array(S * S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let t = 0; for (let k = -3; k <= 3; k++) t += height[at(x + k, y)]; row[y * S + x] = t / 7; }
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let t = 0; for (let k = -3; k <= 3; k++) t += row[at(x, y + k)]; mean[y * S + x] = t / 7; }
      // A slope facing the light is bright. The shading is scaled to a fixed contrast.
      const shade = new Float32Array(S * S);
      let sum = 0;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const h = (px, py) => height[at(px, py)] - mean[at(px, py)];
          const v = (h(x + 1, y) - h(x - 1, y)) * side + (h(x, y + 1) - h(x, y - 1));
          shade[y * S + x] = v; sum += v * v;
        }
      }
      const gain = 30 / Math.sqrt(sum / (S * S) || 1);
      const c = canvas(S, S), x = c.getContext('2d'), img = x.createImageData(S, S);
      for (let i = 0; i < S * S; i++) {
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 128 + shade[i] * gain; img.data[i * 4 + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      return c;
    }
    // Fine fingerprint lines (LR): the real cards' foil has fine parallel lines that bend
    // into arcs and whorls. The lines follow the contours of a slow wave field, so they stay
    // about 3 px apart (about 1.1 px on screen at the 155 px face) and wrap at the edges.
    // Each wave's sine splits into a column part and a row part (sin(A + B)), both from tables,
    // and the final cosine comes from a table too, so no pixel calls Math.sin or Math.cos.
    function fingerprint(S = 1024) {
      const c = canvas(S, S), x = c.getContext('2d'), img = x.createImageData(S, S), rnd = H.random(41);
      const waves = [[1, 2, 24], [2, -1, 18], [3, 1, 11], [-1, 3, 10], [2, 3, 6], [5, -4, 4], [-6, 5, 3.5], [7, 3, 3]].map(([a, b, amp]) => [a, b, amp, rnd() * Math.PI * 2]);
      const n = waves.length, sx = new Float32Array(n * S), cx = new Float32Array(n * S), sy = new Float32Array(n), cy = new Float32Array(n);
      waves.forEach(([a, , amp], k) => {
        for (let xx = 0; xx < S; xx++) { const t = 2 * Math.PI * a * xx / S; sx[k * S + xx] = amp * Math.sin(t); cx[k * S + xx] = amp * Math.cos(t); }
      });
      const N = 4096, shade = new Uint8ClampedArray(N);
      for (let i = 0; i < N; i++) shade[i] = 128 + 36 * Math.cos(2 * Math.PI * i / N);
      for (let y = 0; y < S; y++) {
        waves.forEach(([, b, , turn], k) => { const t = 2 * Math.PI * b * y / S + turn; sy[k] = Math.sin(t); cy[k] = Math.cos(t); });
        for (let xx = 0; xx < S; xx++) {
          let phase = (150 * xx + 300 * y) / S;
          for (let k = 0, j = xx; k < n; k++, j += S) phase += sx[j] * cy[k] + cx[j] * sy[k];
          const i = (y * S + xx) * 4;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = shade[Math.round((phase - Math.floor(phase)) * N) & (N - 1)]; img.data[i + 3] = 255;
        }
      }
      x.putImageData(img, 0, 0);
      return c;
    }
    // Sparse white glints with a few four-point flares.
    function glints(S = 512) {
      const c = canvas(S, S), x = c.getContext('2d'), rnd = H.random(23);
      for (let i = 0; i < 520; i++) {
        const px = rnd() * S, py = rnd() * S, r = 0.7 + rnd() * 1.3, a = 0.35 + rnd() * 0.65;
        x.fillStyle = `rgba(255,255,255,${a})`; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
        if (rnd() < 0.06) {
          const len = 5 + rnd() * 9, g = x.createRadialGradient(px, py, 0, px, py, len);
          g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
          x.fillStyle = g; x.fillRect(px - len, py - 0.6, len * 2, 1.2); x.fillRect(px - 0.6, py - len, 1.2, len * 2);
        }
      }
      return c;
    }
    // Mosaic cells (++ backgrounds): brick-offset tiles of random brightness.
    function mosaic(cw = 20, ch = 14, cols = 24, rows = 30) {
      const S = [cw * cols, ch * rows], c = canvas(...S), x = c.getContext('2d'), rnd = H.random(31);
      x.fillStyle = 'rgb(104,104,104)'; x.fillRect(0, 0, ...S);
      for (let r = 0; r < rows; r++) {
        for (let k = 0; k <= cols; k++) {
          const v = Math.round(96 + rnd() * 84), left = k * cw - (r % 2 ? cw / 2 : 0);
          x.fillStyle = `rgb(${v},${v},${v})`;
          for (const ox of [0, S[0]]) x.fillRect(left + 1 + ox - S[0] * (left + cw > S[0] ? 1 : 0), r * ch + 1, cw - 2, ch - 2);
        }
      }
      return c;
    }
    // The textures are made when the page is idle, one in each idle period, so the first foil
    // card does not wait for them and no long task stops the page. When a card needs them first,
    // they are made without a wait for idle time. clear() starts a new epoch, and textures of an
    // old epoch are not added.
    let epoch = 0, needed = false;
    const idle = () => new Promise(resolve => !needed && typeof win.requestIdleCallback === 'function'
      ? win.requestIdleCallback(() => resolve(), {timeout: 300}) : setTimeout(resolve, 0));
    async function made(makers) {
      const list = [];
      for (const make of makers) { await idle(); list.push(blobUrl(make())); }
      return Promise.all(list);
    }
    // The flags tell that a texture set is in the sheet, so a print with its masks ready shows
    // its finish at once.
    let textures = null, lines = null, texturesReady = false, linesReady = false;
    function ensureTextures() {
      if (textures) return textures;
      const at = epoch;
      textures = made([grain, () => emboss(1), () => emboss(-1), glints, mosaic]).then(list => {
        if (at !== epoch || list.some(url => !url)) return;
        const [frost, reliefL, reliefR, glint, cells] = list;
        ensureSheet().insertRule(`:root{--cbl-holo-tex-grain:url("${frost}");--cbl-holo-tex-emboss:url("${reliefL}");`
          + `--cbl-holo-tex-emboss-2:url("${reliefR}");--cbl-holo-tex-glint:url("${glint}");--cbl-holo-tex-mosaic:url("${cells}")}`, 0);
        texturesReady = true;
      }).catch(onError);
      return textures;
    }
    // Only LR prints use the line texture.
    function ensureLines() {
      if (lines) return lines;
      const at = epoch;
      lines = made([fingerprint]).then(([url]) => {
        if (at === epoch && url) { ensureSheet().insertRule(`:root{--cbl-holo-tex-lines:url("${url}")}`, 0); linesReady = true; }
      }).catch(onError);
      return lines;
    }

    // ---- Per-print masks ------------------------------------------------------------------------

    // The art host and the Android app answer CORS requests, so the print's own pixels can be
    // read; anything unreadable keeps the unmasked finish. The site's own <img> load is cached
    // without CORS headers (and without Vary: Origin), so the read skips the HTTP cache and
    // leaves it as it was.
    async function pixels(face) {
      try {
        const response = await fetch(face, {mode: 'cors', credentials: 'omit', cache: 'no-store'});
        return response.ok ? await createImageBitmap(await response.blob()) : null;
      } catch (e) { return null; }
    }
    function imageCanvas(image) {
      const c = canvas(image.width, image.height), x = c.getContext('2d'), img = x.createImageData(image.width, image.height);
      img.data.set(image.rgba);
      x.putImageData(img, 0, 0);
      return c;
    }
    function alphaCanvas(mask) {
      const c = canvas(mask.width, mask.height), x = c.getContext('2d'), img = x.createImageData(mask.width, mask.height);
      for (let i = 0; i < mask.alpha.length; i++) img.data[i * 4 + 3] = mask.alpha[i];
      x.putImageData(img, 0, 0);
      return c;
    }
    const maskUrl = mask => pngUrl(mask.width, mask.height, mask.alpha);
    // Draws a source through each [filter, composite] step in turn, on a canvas of its size.
    // A step can draw another image (a mask) in place of the source, scaled to the canvas.
    function paint(source, steps) {
      const c = canvas(source.width, source.height), x = c.getContext('2d');
      for (const [filter, op, image = source] of steps) { x.filter = filter; x.globalCompositeOperation = op; x.drawImage(image, 0, 0, c.width, c.height); }
      return c;
    }
    // The R and LR layers draw the face again through fixed filters (holo.css). Each filtered
    // face is made here one time, so a turning card only moves masks and runs no filter on each
    // frame. Keep these filters equal to the ones in holo.css, which show until the masks are
    // ready. The colour shift layers are made with their colour blend over the face and then
    // the ink filter, as they show inside the ink layer. The shift layers and the edge of the R
    // band are cut to the art, so the frame and its tags keep their colour.
    const INK = 'saturate(1.18) contrast(1.1) brightness(.94)';
    // A short pause between the steps of a print lets the page draw a frame.
    const pause = () => new Promise(resolve => setTimeout(resolve, 0));
    // A print made ahead of time (prepare()) stops at its next step when a card needs the
    // queue. Its files are revoked.
    const STOP = new Error('stopped');
    const check = control => { if (control && control.stop) throw STOP; };
    function revoke(list) {
      for (const url of list) if (url) { URL.revokeObjectURL(url); urls.delete(url); }
    }
    const filesOf = mask => mask ? [...Object.values(mask).filter(v => typeof v === 'string'), ...Object.values(mask.baked || {})] : [];
    async function bakeFaces(bitmap, tint, art, kind, control) {
      const shift = deg => paint(paint(bitmap, [['none', 'source-over'], [`hue-rotate(${deg}deg) saturate(1.2)`, 'color']]),
        [[INK, 'source-over'], ['none', 'destination-in', art]]);
      const faces = {
        'ink': () => paint(bitmap, [[INK, 'source-over']]),
        'shift-a': () => shift(-25), 'shift-b': () => shift(25),
        'shine': () => paint(bitmap, [['saturate(1.6) brightness(.45)', 'source-over']]),
        'frame': () => paint(bitmap, [['saturate(1.3) brightness(.56)', 'source-over']]),
      };
      // R prints: the faint edge of the band, from the tint image.
      if (kind === 'rare') faces.edge = () => paint(tint, [['hue-rotate(60deg) saturate(.55) brightness(.34)', 'source-over'], ['none', 'destination-in', art]]);
      // Each face is drawn in its own step. The encodes run together, so the faces are ready sooner.
      const names = Object.keys(faces), pending = [], type = await faceFormat();
      try {
        for (const name of names) { check(control); pending.push(blobUrl(faces[name](), ...type)); await pause(); }
      } catch (e) { revoke(await Promise.all(pending)); throw e; }
      const list = await Promise.all(pending);
      return list.every(Boolean) ? Object.fromEntries(names.map((name, i) => [name, list[i]])) : null;
    }
    const BAKED = ['ink', 'shift-a', 'shift-b', 'shine', 'frame', 'edge'];
    async function buildMasks(bitmap, kind, control) {
      const W = bitmap.width, Hh = bitmap.height;
      if (!W || !Hh) return null;
      check(control);
      const c = canvas(W, Hh), ctx = c.getContext('2d', {willReadFrequently: true});
      ctx.drawImage(bitmap, 0, 0);
      const out = H.masks(ctx.getImageData(0, 0, W, Hh).data, W, Hh, kind);
      await pause();
      check(control);
      const files = {
        field: maskUrl(out.field), line: out.line && maskUrl(out.line), texture: out.texture && maskUrl(out.texture),
        tint: out.tint && pngUrl(out.tint.width, out.tint.height, out.tint.rgba, 4),
        glow: out.tint && maskUrl({...out.tint, alpha: out.tint.glow}),
        // Where the ink has little colour, the neutral mask takes the colour out of the light.
        neutral: out.tint && maskUrl({...out.tint, alpha: out.tint.alpha.map(a => 255 - a)}),
        shape: maskUrl(out.shape), rim: out.rim && maskUrl(out.rim), frame: out.frame && maskUrl(out.frame),
      };
      const names = Object.keys(files), made = Promise.all(names.map(name => files[name] || null));
      let baked = null;
      try {
        await pause();
        if (out.tint) baked = await bakeFaces(bitmap, imageCanvas(out.tint), alphaCanvas(out.art), kind, control);
      } catch (e) { revoke(await made); throw e; }
      const list = await made, mask = Object.fromEntries(names.map((name, i) => [name, list[i]]));
      return !out.tint || baked ? {...mask, baked} : null;
    }
    // maskCache holds each print's job, and built holds the masks of each finished job, so a
    // print shown again gets its finish in the same frame.
    const maskCache = new Map(), built = new Map();
    // Prints made ahead of time (prepare()) that no card used yet, oldest first: key -> control.
    const prepared = new Map();
    let queue = Promise.resolve(), running = null;
    function maskFor(face, kind, ahead = false) {
      const key = `${kind} ${face}`;
      if (!ahead) {
        // A card uses a print made ahead, and stops any other that is not made yet.
        const early = prepared.get(key);
        prepared.delete(key);
        if (early && early.stop) maskCache.delete(key);
        for (const [other, control] of prepared) if (!built.has(other)) control.stop = true;
      }
      if (!maskCache.has(key)) {
        const control = ahead ? {stop: false} : null;
        if (control) prepared.set(key, control);
        // One print at a time, 16 ms apart, keeps mask work off the board's busy frames.
        const job = queue.then(() => { running = key; check(control); return pixels(face); })
          .then(bitmap => bitmap ? buildMasks(bitmap, kind, control).finally(() => bitmap.close && bitmap.close()) : null)
          .catch(() => null)
          .then(mask => {
            if (running === key) running = null;
            if (maskCache.get(key) !== job) revoke(filesOf(mask));
            else if (control && control.stop && !mask) { maskCache.delete(key); prepared.delete(key); }
            else {
              if (control) control.stop = false;
              built.set(key, mask);
            }
            return mask;
          });
        queue = job.then(() => new Promise(resolve => setTimeout(resolve, 16)));
        maskCache.set(key, job);
      }
      return maskCache.get(key);
    }
    function applyMask(node, mask) {
      setVar(node, '--cbl-holo-mask-field', `url("${mask.field}")`);
      setVar(node, '--cbl-holo-mask-line', mask.line ? `url("${mask.line}")` : 'none');
      setVar(node, '--cbl-holo-mask-texture', mask.texture ? `url("${mask.texture}")` : 'none');
      // R and LR light in the colour of each ink.
      setVar(node, '--cbl-holo-mask-tint', mask.tint ? `url("${mask.tint}")` : 'none');
      setVar(node, '--cbl-holo-mask-glow', mask.glow ? `url("${mask.glow}")` : 'none');
      setVar(node, '--cbl-holo-mask-neutral', mask.neutral ? `url("${mask.neutral}")` : 'none');
      setVar(node, '--cbl-holo-mask-shape', `url("${mask.shape}")`);
      setVar(node, '--cbl-holo-mask-rim', mask.rim ? `url("${mask.rim}")` : 'none');
      setVar(node, '--cbl-holo-mask-frame', mask.frame ? `url("${mask.frame}")` : 'none');
      for (const name of BAKED) setVar(node, `--cbl-holo-baked-${name}`, mask.baked && mask.baked[name] ? `url("${mask.baked[name]}")` : 'none');
      setAttr(node, 'data-cbl-holo-mask', true, 'ready');
    }
    let waiting = 0;
    function requestMask(node, face, value) {
      const kind = H.maskKind(value);
      if (kind === 'gloss' || !face) return;
      // The finish shows when its masks and textures are all ready, as one change.
      needed = true;
      const show = mask => {
        if (mask) { masks.set(node, mask); applyMask(node, mask); }
        // An arrival sweep waits for the masks, so it shows the real finish; any other card
        // that waited fades its finish in.
        motion.ready(node, now());
        motion.fade(node, now());
        schedule();
      };
      const key = `${kind} ${face}`, job = maskFor(face, kind);
      if (built.has(key) && texturesReady && (kind !== 'legend' || linesReady)) { show(built.get(key)); return; }
      // Until then the finish stays hidden: the plain art shows, not a finish without its masks.
      motion.hide(node, lampOf(node));
      write(node);
      waiting++;
      Promise.all([job, ensureTextures(), kind === 'legend' && ensureLines()]).then(([mask]) => {
        if (!node.isConnected || faces.get(node) !== face) return;
        // The same face with another finish (no new masks) shows that finish now.
        if (node.getAttribute('data-cbl-holo') !== value) { motion.fade(node, now()); schedule(); return; }
        show(mask);
      }).catch(onError).finally(() => { waiting--; });
    }

    // ---- Prints made ahead of time -------------------------------------------------------------

    // While the page is still, the foil prints it shows on screen (a deck list, the deck
    // builder's grid) get their masks, one at a time, so a card opened from there shows its
    // finish at once. A card that needs the queue stops this work (maskFor()). Each print
    // blocks the page for a moment (its mask step cannot be cut), so one starts only when the
    // page is idle and STILL_MS after the last press, wheel or scroll. At most PREPARED prints
    // that no card used stay in memory (about 1.6 MB each at 600 x 838). Then the work stops:
    // a print is never removed to make room, so a scroll through a long list costs at most
    // PREPARED prints, each read one time.
    const PREPARED = 12, STILL_MS = 1000;
    let preparing = false, moved = -Infinity;
    const still = () => { moved = now(); };
    for (const type of ['pointerdown', 'wheel', 'scroll']) win.addEventListener(type, still, {capture: true, passive: true});
    const later = typeof win.requestIdleCallback === 'function' ? fn => win.requestIdleCallback(fn) : fn => setTimeout(fn, 500);
    function prepare() {
      if (preparing || cleared || prepared.size >= PREPARED) return;
      preparing = true;
      later(() => { preparing = false; try { prepareNext(); } catch (e) { onError(e); } });
    }
    function prepareNext() {
      const db = win.__cardByCode;
      if (cleared || !db || doc.hidden || prepared.size >= PREPARED) return;
      const wait = moved + STILL_MS - now();
      if (wait > 0 || waiting || running) { setTimeout(prepare, Math.max(wait, 500)); return; }
      for (const img of doc.images) {
        const face = source(img), code = H.printOf(face);
        if (!code || !img.complete || !img.naturalWidth) continue;
        const value = H.finish(code, db), kind = H.maskKind(value);
        if (!H.foil(value) || kind === 'gloss' || maskCache.has(`${kind} ${face}`)) continue;
        const r = img.getBoundingClientRect();
        if (r.width < 24 || r.bottom < 0 || r.right < 0 || r.top > win.innerHeight || r.left > win.innerWidth) continue;
        maskFor(face, kind, true).then(prepare);
        return;
      }
    }

    // ---- Where a card is on screen ----------------------------------------------------------------

    // The turn of an element's own transform, in degrees.
    function turnOf(cs) {
      if (!cs.transform || cs.transform === 'none') return 0;
      const m = new DOMMatrixReadOnly(cs.transform);
      return Math.atan2(m.b, m.a) * 180 / Math.PI;
    }
    // A card (with its partners in a paired Unit's stack) turning whole wears the foil's rotate;
    // the site's own was read while it was flat.
    const siteRotates = new WeakMap();
    const siteRotate = (el, cs) => el.hasAttribute('data-cbl-holo-turn') && siteRotates.has(el) ? siteRotates.get(el) : cs.rotate;
    // The card's rotation on screen: the hand's fan, a rested Unit, a turned seat.
    function screenAngle(node) {
      let angle = 0;
      for (let el = node; el && el.nodeType === 1 && el !== doc.documentElement; el = el.parentElement) {
        const cs = win.getComputedStyle(el);
        angle += turnOf(cs);
        const rotate = /^(?:z\s+|0 0 1\s+)?(-?[\d.]+)deg$/.exec(siteRotate(el, cs) || '');
        if (rotate) angle += Number(rotate[1]);
      }
      return angle;
    }
    const kindOf = node => node.matches('.duo-art') ? 'view' : node.matches(FLOAT_ART) ? 'float' : 'board';
    // A paired Unit and its Pilot lie on the table as one: both turn together about the stack's
    // centre, so the Pilot's dark frame, which sits behind the Unit, never shows around a turning
    // Unit. The stack itself never turns: the site measures it with a 2D-only reading of its
    // rotate (its attack brackets), which a 3D turn would break. Its Unit leads (aims, and writes
    // the turn); both faces catch the same light.
    const stackOf = node => node.matches('.stack-unit, .stack-pilot') && node.parentElement && node.parentElement.matches('.play-stack')
      ? node.parentElement : null;
    const facesOf = node => { const stack = stackOf(node); return stack ? [...stack.children].filter(c => marked.has(c)) : [node]; };
    const leadOf = node => { const faces = facesOf(node); return faces.find(c => c.matches('.stack-unit')) || faces[0] || node; };
    // Every lit box turns whole, so it is measured while flat and kept while it turns. The
    // floating view's panel can move or be resized under a turning card (its grip, a pinch),
    // and then the card is measured again.
    const frames = new WeakMap();
    function frameOf(node) {
      const v = motion.values(node), panel = kindOf(node) === 'float' && node.closest('#cardDetailV2');
      const key = panel ? Object.values(panel.getBoundingClientRect().toJSON()).join() : '';
      const kept = frames.get(node);
      if (v && v.tilt && kept && kept.key === key) return kept.frame;
      const rect = node.getBoundingClientRect();
      const aspect = node.offsetWidth ? node.offsetHeight / node.offsetWidth : 1.4;
      const frame = H.frameOf(rect, aspect, screenAngle(node));
      frames.set(node, {frame, key});
      return frame;
    }
    function lampOf(node) {
      return H.lamp(node.getBoundingClientRect(), {width: win.innerWidth, height: win.innerHeight}, screenAngle(node));
    }

    // ---- Springs to stylesheet --------------------------------------------------------------

    function write(node) {
      const v = motion.values(node);
      if (!v) return;
      setVar(node, '--cbl-holo-x', `${v.x.toFixed(2)}%`);
      setVar(node, '--cbl-holo-y', `${v.y.toFixed(2)}%`);
      setVar(node, '--cbl-holo-fx', (v.x / 100).toFixed(4));
      setVar(node, '--cbl-holo-fy', (v.y / 100).toFixed(4));
      setVar(node, '--cbl-holo-c', v.c.toFixed(3));
      setVar(node, '--cbl-holo-o', v.o.toFixed(3));
      setVar(node, '--cbl-holo-rx', `${v.rx.toFixed(2)}deg`);
      setVar(node, '--cbl-holo-ry', `${v.ry.toFixed(2)}deg`);
      setVar(node, '--cbl-holo-sweep-o', v.sweepO.toFixed(3));
      setVar(node, '--cbl-holo-arrive', v.arrive.toFixed(3));
      // A board or hand card turns whole; a paired one turns with its Pilot and the card info
      // overlay's badges, each about the stack's centre. Their site rotate is read and the
      // perspective set up while they are still flat, before the turn flag puts the foil's
      // rotate on them.
      if (kindOf(node) === 'board' && leadOf(node) === node) {
        const stack = stackOf(node);
        const parts = stack ? [...stack.children].filter(c => marked.has(c) || c.classList.contains('cbl-ov')) : [node];
        if (v.tilt) {
          if (!node.hasAttribute('data-cbl-holo-turn')) {
            for (const part of parts) siteRotates.set(part, win.getComputedStyle(part).rotate || 'none');
            stage(node);
          }
          for (const part of parts) {
            const cs = win.getComputedStyle(part);
            if (stack) setVar(part, '--cbl-holo-origin', `${(stack.clientWidth / 2 - part.offsetLeft).toFixed(1)}px ${(stack.clientHeight / 2 - part.offsetTop).toFixed(1)}px`);
            setVar(part, '--cbl-holo-turn', H.turn(v.rx, v.ry, turnOf(cs), siteRotates.get(part)));
          }
        }
        for (const part of parts) setAttr(part, 'data-cbl-holo-turn', v.tilt);
      }
      setAttr(node, 'data-cbl-holo-tilt', v.tilt);
      setAttr(node, 'data-cbl-holo-active', v.active);
      setAttr(node, 'data-cbl-holo-sweep', v.sweeping);
    }
    let frame = 0;
    function step() {
      frame = 0;
      const moving = motion.step(now());
      // A removed card waits for the next sync(), which forgets it or hands its light to the
      // element that replaced it.
      for (const node of motion.keys()) if (node.isConnected) write(node);
      if (moving) schedule();
    }
    function schedule() { if (!frame) frame = win.requestAnimationFrame(step); }

    // ---- Faces ---------------------------------------------------------------------------------

    const marked = new Set(), faces = new WeakMap(), masks = new WeakMap(), fits = new WeakMap();
    // The element last shown in each board slot, so a rebuilt one can take over its light.
    const slotNodes = new Map();
    // The requested src names the print even before a replacement image loads.
    const source = img => img && img.getAttribute('src') ? img.src : null;
    const lifted = el => el.classList.contains('cmd-drag-lift') || el.classList.contains('hand-reorder-drag');

    function layers(node) {
      let box = node.__cblHolo;
      if (!box || box.parentNode !== node) {
        box = doc.createElement('span');
        box.className = 'cbl-holo';
        box.setAttribute('aria-hidden', 'true');
        for (const part of ['ink', 'shine', 'field', 'line', 'glare', 'keep']) {
          const layer = doc.createElement('i');
          layer.className = `cbl-holo-${part}`;
          box.append(layer);
        }
        node.appendChild(box);
        node.__cblHolo = box;
      }
      return box;
    }

    // The layer box covers the art exactly, and textures and perspective follow its size.
    function fit(node, img, kind) {
      const key = [img.offsetLeft, img.offsetTop, img.offsetWidth, img.offsetHeight, img.naturalWidth, img.naturalHeight].join();
      if (fits.get(node) === key) return;
      fits.set(node, key);
      const style = win.getComputedStyle(img), width = img.offsetWidth;
      const f = H.maskFit({box: {width, height: img.offsetHeight}, natural: {width: img.naturalWidth, height: img.naturalHeight},
        fit: style.objectFit, position: style.objectPosition});
      setVar(node, '--cbl-holo-mask-size', f.size);
      setVar(node, '--cbl-holo-mask-position', f.position);
      // The card view's art fills its box; so does the floating view's, which the site
      // resizes with no change the page observes, so its layer box stays at 100 %.
      if (kind !== 'view' && kind !== 'float') {
        setVar(node, '--cbl-holo-left', `${img.offsetLeft}px`);
        setVar(node, '--cbl-holo-top', `${img.offsetTop}px`);
        setVar(node, '--cbl-holo-width', `${width}px`);
        setVar(node, '--cbl-holo-height', `${img.offsetHeight}px`);
      }
      setVar(node, '--cbl-holo-k', Math.min(1.6, Math.max(0.8, width / TEXTURE_WIDTH)).toFixed(3));
      setVar(node, '--cbl-holo-p', `${Math.round(Math.max(1, width) * PERSPECTIVE[kind in PERSPECTIVE ? kind : 'board'])}px`);
    }

    // The deck builder keeps its card view's face while the builder is hidden, so that view was
    // last fitted at no size; it is fitted again as soon as it has one.
    const resized = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
      try {
        for (const {target} of entries) {
          const img = target.querySelector(':scope > img');
          if (marked.has(target) && img) fit(target, img, kindOf(target));
        }
      } catch (e) { onError(e); }
    }) : null;

    // The site drags the floating view's whole panel from its art, so a press there could
    // never tilt the card. A pad over the art opts out of that drag (data-cd-no-drag, as the
    // site marks its own tray); in art mode a grip in the bottom-right corner keeps moving
    // the panel, and in info mode the panel's text does.
    function zones(node) {
      const own = (key, className, on) => {
        let el = node[key];
        if (on && (!el || el.parentNode !== node)) {
          el = doc.createElement('span');
          el.className = className;
          el.setAttribute('aria-hidden', 'true');
          if (className === 'cbl-tilt-pad') el.setAttribute('data-cd-no-drag', '1');
          node.appendChild(el);
          node[key] = el;
        } else if (!on && el) {
          if (el.parentNode === node) el.remove();
          node[key] = null;
        }
      };
      const float = node.matches(FLOAT_ART);
      own('__cblPad', 'cbl-tilt-pad', float);
      own('__cblGrip', 'cbl-move-grip', float && node.matches('.big'));
    }

    function forget(node) {
      marked.delete(node);
      if (resized) resized.unobserve(node);
      faces.delete(node);
      masks.delete(node);
      fits.delete(node);
      motion.drop(node);
      dropRule(node);
      if (hover === node) hover = null;
      if (press && press.node === node) press = null;
      if (node.isConnected) {
        if (node.__cblHolo && node.__cblHolo.parentNode === node) node.__cblHolo.remove();
        for (const key of ['__cblPad', '__cblGrip']) if (node[key] && node[key].parentNode === node) node[key].remove();
        for (const name of ['data-cbl-holo', 'data-cbl-holo-id', 'data-cbl-holo-mask', 'data-cbl-holo-tilt', 'data-cbl-holo-turn', 'data-cbl-holo-active', 'data-cbl-holo-sweep']) {
          setAttr(node, name, false);
        }
      }
      node.__cblHolo = node.__cblPad = node.__cblGrip = null;
      node.__cblLifted = false;
    }
    // The card info overlay's badges that turned with a paired Unit keep their rule and flags
    // until no face beside them is lit any more.
    function forgetPartners() {
      for (const el of [...rules.keys()]) {
        if (marked.has(el) || (el.isConnected && el.parentElement && [...el.parentElement.children].some(c => marked.has(c)))) continue;
        dropRule(el);
        if (el.isConnected) for (const name of ['data-cbl-holo-id', 'data-cbl-holo-turn']) setAttr(el, name, false);
      }
    }

    let arrivalsNow = 0;
    // One lit face: its finish, layers, masks and, for a foil card newly played to the field,
    // its arrival sweep. `slot` names where it arrived (null: never sweeps).
    function present(node, img, face, value, kind, slot) {
      if (!value) { if (marked.has(node)) forget(node); return false; }
      layers(node);
      zones(node);
      setAttr(node, 'data-cbl-holo', true, value);
      marked.add(node);
      if (faces.get(node) !== face) {
        faces.set(node, face);
        masks.delete(node);
        setAttr(node, 'data-cbl-holo-mask', false);
        setVar(node, '--cbl-holo-mask-field', 'none');
        setVar(node, '--cbl-holo-mask-line', 'none');
        setVar(node, '--cbl-holo-mask-texture', 'none');
        setVar(node, '--cbl-holo-mask-tint', 'none');
        setVar(node, '--cbl-holo-mask-glow', 'none');
        setVar(node, '--cbl-holo-mask-neutral', 'none');
        setVar(node, '--cbl-holo-mask-shape', 'none');
        setVar(node, '--cbl-holo-mask-rim', 'none');
        setVar(node, '--cbl-holo-mask-frame', 'none');
        for (const name of BAKED) setVar(node, `--cbl-holo-baked-${name}`, 'none');
        // The ink and shine layers of R and LR prints draw the face again, with richer colour.
        setVar(node, '--cbl-holo-face', `url(${JSON.stringify(face)})`);
        // Cards arriving together sweep in a short cascade; their finish stays hidden until
        // the sweep fades it in. Only arrivals sweep: the same face shown again never does,
        // but a new element for it (a Pilot pairing rebuilds the Unit as a stack) keeps the
        // light and any sweep of the element it replaced.
        if (slot && H.foil(value) && arrivals.arrive(slot.key, slot.face)) {
          motion.arrive(node, arrivalsNow++, now(), lampOf(node));
          write(node);
          schedule();
        } else if (slot && slotNodes.get(slot.key) !== node && motion.adopt(slotNodes.get(slot.key), node)) {
          write(node);
          schedule();
        }
        if (slot) slotNodes.set(slot.key, node);
        requestMask(node, face, value);
      }
      fit(node, img, kind);
      if (kind === 'view' && resized) resized.observe(node);
      if (!img.complete) whenLoaded(img);
      return true;
    }
    // A face still loading has no size yet: fit it, or drop a broken one, once it settles.
    // After clear() (the foil turned off) it waits for the next sync() from outside instead.
    const loading = new WeakSet();
    let cleared = false;
    function whenLoaded(img) {
      if (loading.has(img)) return;
      loading.add(img);
      const done = () => { loading.delete(img); if (cleared) return; try { sync(); } catch (e) { onError(e); } };
      img.addEventListener('load', done, {once: true});
      img.addEventListener('error', done, {once: true});
    }

    function slotOf(host, face, kind) {
      const seatEl = host.closest('[data-player], [data-play-player], [data-base-player]');
      const seat = seatEl ? seatEl.getAttribute('data-player') || seatEl.getAttribute('data-play-player') || seatEl.getAttribute('data-base-player') : '?';
      const card = host.closest('[data-instance-id]');
      const id = card ? card.getAttribute('data-instance-id') : '';
      if (kind === 'base') return {key: `${seat}:base`, face: `${face}#${id}`};
      const slotEl = host.closest('[data-slot]');
      const role = host.classList.contains('stack-pilot') ? 'pilot' : 'unit';
      return {key: `${seat}:${slotEl ? slotEl.getAttribute('data-slot') : '?'}:${role}`, face: `${face}#${id}`};
    }

    function faceOf(host, img) {
      const face = source(img);
      if (!face) return {face: null, code: null};
      // An image that failed shows the site's fallback text, which gets no finish.
      if (img.complete && !img.naturalWidth) return {face, code: null};
      const coded = host.closest('[data-cc]');
      return {face, code: H.printOf(face) || (coded ? coded.getAttribute('data-cc') : null)};
    }

    let hover = null, press = null;

    function sync() {
      const db = win.__cardByCode;
      if (!db) return;
      ensureSheet();
      const seen = new Set(), slots = new Set();
      arrivalsNow = 0;
      const visit = (selector, kind) => {
        for (const img of doc.querySelectorAll(selector)) {
          const host = img.parentElement;
          if (!host || seen.has(host)) continue;
          const {face, code} = faceOf(host, img);
          const value = H.finish(code, db);
          const played = kind === 'field' || kind === 'base';
          const slot = played && value ? slotOf(host, face, kind) : null;
          if (slot) slots.add(slot.key);
          if (present(host, img, face, value, kind, slot)) {
            seen.add(host);
            if (kind === 'hand') liftLight(host);
          }
        }
      };
      visit(FIELD_FACES, 'field');
      visit(BASE_FACES, 'base');
      visit(HAND_FACES, 'hand');
      visit(VIEW_FACES, 'view');
      visit(FLOAT_FACES, 'float');
      for (const node of [...marked]) if (!seen.has(node)) forget(node);
      forgetPartners();
      // A slot left empty on the board forgets its face, so a new card there arrives again;
      // leaving the board keeps them, so returning to it replays no sweep.
      const screen = doc.getElementById('playScreen');
      if (screen && screen.classList.contains('active')) for (const key of arrivals.slots()) if (!slots.has(key)) arrivals.forget(key);
      for (const key of [...slotNodes.keys()]) if (!slots.has(key)) slotNodes.delete(key);
      // Foil cards at rest still show the lamp; the light moves only on input.
      for (const node of seen) {
        if (H.foil(node.getAttribute('data-cbl-holo')) && !motion.has(node)) { motion.state(node, lampOf(node)); write(node); }
      }
      prepare();
    }

    // The lifted hand card (the site has no drag copy) catches the lamp where it is.
    function liftLight(node) {
      const up = lifted(node);
      if (up && !node.__cblLifted) { node.__cblLifted = true; motion.light(node, lampOf(node), LIFTED_LIGHT); schedule(); }
      else if (!up && node.__cblLifted) { node.__cblLifted = false; motion.release(node, lampOf(node)); schedule(); }
    }

    // ---- Pointer observation ---------------------------------------------------------------------

    const inHand = node => Boolean(node.closest(HAND));
    function targetOf(el) {
      if (!el || !el.closest) return null;
      const art = el.closest(VIEW_ART);
      if (art) return marked.has(art) ? art : null;
      // The floating view tilts under its pad only: its grip, stats and buttons are the site's.
      const float = el.closest(FLOAT_ART);
      if (float) return marked.has(float) && el.closest('.cbl-tilt-pad') ? float : null;
      const face = el.closest('.stack-unit, .stack-pilot, .card');
      return face && marked.has(face) ? leadOf(face) : null;
    }
    function follow(node, e) {
      // The floating view may have been resized or zoomed since it was fitted, and a card view
      // fitted while hidden (the deck builder's, after leaving the builder) has no size yet.
      const kind = kindOf(node);
      if (kind !== 'board') { const img = node.querySelector(':scope > img'); if (img) fit(node, img, kind); }
      const f = frameOf(node);
      if (!f.width || !f.height) return;
      const p = H.localPoint(f, e.clientX, e.clientY);
      for (const face of facesOf(node)) motion.aim(face, p.x, p.y, LIMIT[kindOf(face)], motion.has(face) ? undefined : lampOf(face));
      schedule();
    }
    function release(node) {
      if (!node) return;
      for (const face of facesOf(node)) {
        if (!motion.has(face)) continue;
        if (face.__cblLifted) motion.light(face, lampOf(face), LIFTED_LIGHT);
        else motion.release(face, lampOf(face));
      }
      schedule();
    }
    const dragging = () => Boolean(doc.querySelector(`${HAND} > .card.cmd-drag-lift, ${HAND} > .card.hand-reorder-drag`));

    function onMove(e) {
      if (press && e.pointerId === press.id) {
        if (!press.node.isConnected) { press = null; return; }
        follow(press.node, e);
        return;
      }
      // While a hand card is lifted, it catches the light instead of anything hovered.
      if (dragging()) { if (hover) { release(hover); hover = null; } return; }
      if (e.pointerType !== 'mouse' || press) return;
      const target = targetOf(e.target);
      if (target !== hover) { release(hover); hover = target; }
      if (hover) follow(hover, e);
    }
    function onDown(e) {
      const target = targetOf(e.target);
      // Pressing a hand card may start a drag: it does not stay tilted.
      if (e.pointerType === 'mouse') { if (target && inHand(target)) { release(hover); hover = null; } return; }
      // A held finger on a hand card is the site's tap, drag or reorder gesture.
      if (!target || inHand(target) || !e.isPrimary) return;
      if (hover) { release(hover); hover = null; }
      press = {id: e.pointerId, node: target};
      follow(target, e);
    }
    function onUp(e) {
      if (!press || e.pointerId !== press.id) return;
      const node = press.node;
      press = null;
      release(node);
    }
    const passive = {capture: true, passive: true};
    // Window capture sees the pointer before the site's own handlers; nothing is prevented.
    const guard = fn => e => { try { fn(e); } catch (error) { onError(error); } };
    win.addEventListener('pointermove', guard(onMove), passive);
    win.addEventListener('pointerdown', guard(onDown), passive);
    win.addEventListener('pointerup', guard(onUp), passive);
    win.addEventListener('pointercancel', guard(onUp), passive);
    doc.addEventListener('pointerout', guard(e => { if (!e.relatedTarget && hover) { release(hover); hover = null; } }), {passive: true});
    win.addEventListener('blur', guard(() => {
      if (hover) { release(hover); hover = null; }
      if (press) { release(press.node); press = null; }
    }));

    // Explicit light for presentation tools such as the showcase.
    const api = {
      sync() {
        cleared = false;
        readTurns(true);
        sync();
        // Make the textures before the first foil card needs them.
        if (win.__cardByCode) { ensureTextures(); ensureLines(); }
      },
      finish: code => H.finish(code, win.__cardByCode),
      tilt(node, x, y) {
        if (!marked.has(node)) return;
        for (const face of facesOf(leadOf(node))) motion.aim(face, x, y, LIMIT[kindOf(face)], lampOf(face));
        schedule();
      },
      rest(node) { release(node); },
      sweep(node) {
        if (!marked.has(node) || !H.foil(node.getAttribute('data-cbl-holo'))) return;
        motion.state(node, lampOf(node)).arrive = 0;
        motion.sweep(node, 0, now());
        write(node);
        schedule();
      },
      values: node => motion.values(node),
      // The file type of the filtered faces: ['image/webp', 1] or ['image/png'].
      faceType: () => faceFormat(),
      masks: face => ['holo', 'rare', 'legend', 'parallel', 'special'].map(kind => maskCache.get(`${kind} ${face}`)).find(Boolean) || null,
      // Removes every finish, rule and texture, and revokes their URLs. Slots keep their
      // last arrived face, so the next sync() replays no sweep. Nothing lights again until it.
      clear() {
        cleared = true;
        readTurns(false);
        for (const node of [...marked]) forget(node);
        forgetPartners();
        for (const node of motion.keys()) motion.drop(node);
        if (sheet) {
          doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter(s => s !== sheet);
          sheet = null;
        }
        rules.clear();
        stages.clear();
        maskCache.clear();
        built.clear();
        prepared.clear();
        textures = lines = null;
        texturesReady = linesReady = false;
        epoch++;
        needed = false;
        for (const url of urls) URL.revokeObjectURL(url);
        urls.clear();
      },
    };
    return api;
  }

  window.CBLFoil = {create};
})();
