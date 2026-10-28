// Rarity foil: which finish each printed card gets, the masks that keep the foil on its
// printed inks, and the light and tilt maths. Pure functions and a time-driven motion
// engine, shared by the page runtime (foil.js) and the unit tests. The numbers come from a
// reference board holo.
(function (root) {
  'use strict';

  // Printed rarity -> finish. "+" prints are parallel artwork, "++" the gold-line special
  // parallels; promos keep their own finish. Anything else has no finish.
  const FINISHES = {C: 'c', U: 'u', R: 'r', LR: 'lr', 'C+': 'c-p', 'U+': 'u-p', 'R+': 'r-p', 'LR+': 'lr-p',
    'C++': 'c-pp', 'LR++': 'lr-pp', P: 'p', 'P+': 'p-p'};
  // A face on the site's art host: https://art.cardbattlelab.com/GD01-001-p2.webp?r=3.
  const PRINTED = /\/([A-Z][A-Z0-9]{0,11}-\d{3}(?:-p\d{1,2})?)\.(?:webp|png|jpe?g)(?:[?#]|$)/;

  const printOf = url => (PRINTED.exec(url || '') || [])[1] || null;
  const baseCode = code => String(code).replace(/-p\d+$/i, '');

  // The site spells parallels with a space ("LR +", "LR ++"). GD05's twelve "LK" prints
  // ("LKR +", "LKU +", "LKC +") are parallel artwork of R, U and C cards.
  function normalize(rarity) {
    const value = String(rarity || '').replace(/\s+/g, '').toUpperCase();
    return value.replace(/^LK(?=(?:C|U|R|LR)\+)/, '');
  }

  // The rarity of the print on screen: an alternate print's own rarity, else its card's.
  function rarityOf(code, db) {
    if (!code || !db) return null;
    const card = db[baseCode(code)];
    if (!card) return null;
    if (code !== card.code) {
      const variant = (card.variants || []).find(v => v && v.code === code);
      if (variant && variant.rarity) return normalize(variant.rarity);
    }
    return card.rarity ? normalize(card.rarity) : null;
  }
  const finish = (code, db) => FINISHES[rarityOf(code, db)] || null;

  // gloss: plain stock (C/U); holo: R/LR/P textured holo; parallel: +; special: ++.
  const family = value => !value ? null : /^[cu]$/.test(value) ? 'gloss' : /-pp$/.test(value) ? 'special'
    : /-p$/.test(value) ? 'parallel' : 'holo';
  const foil = value => Boolean(value) && family(value) !== 'gloss';
  // The masks of a finish: R and LR have their own foil layouts, the other finishes share
  // the masks of their family.
  const maskKind = value => value === 'r' ? 'rare' : value === 'lr' ? 'legend' : family(value);

  // ---- Per-print masks ------------------------------------------------------------------

  const clamp = (v, a = 0, b = 100) => Math.min(b, Math.max(a, v));
  // It runs many times for each pixel, so it is kept small enough for the engine to inline.
  const smooth = (a, b, v) => { let t = (v - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
  // Silver frame elements of parallel prints on the card template (fractions of the card):
  // cost box and numerals, left edge, ID tab, bottom trait/stat bars, right edge, name plate.
  const frameArea = (fx, fy) => (fx < 0.22 && fy < 0.17) || fx < 0.075 || (fx > 0.58 && fy < 0.052) || fy < 0.025 || fy > 0.86
    || fx > 0.945 || (fy > 0.575 && fy < 0.685 && fx > 0.1 && fx < 0.9);
  // Plain mirror areas of parallel prints: the frame elements above, a little wider round the
  // cost box, and the name plate and effect text below the art. They show no surface texture.
  const plainArea = (fx, fy) => frameArea(fx, fy) || (fx < 0.24 && fy < 0.18) || fy > 0.575;
  // The art of R and LR prints, with soft edges: 1 on the art, 0 on the frame, its tags (cost
  // box, type tab, ID tab) and the name and text below the art. Only the art shifts in hue as
  // the card turns; a tag keeps its printed colour and only gets lighter.
  const artArea = (fx, fy) => smooth(0.075, 0.095, fx) * (1 - smooth(0.925, 0.945, fx)) * smooth(0.025, 0.045, fy)
    * (1 - smooth(0.56, 0.6, fy)) * (1 - (1 - smooth(0.22, 0.25, fx)) * (1 - smooth(0.17, 0.2, fy)))
    * (1 - smooth(0.56, 0.58, fx) * (1 - smooth(0.052, 0.072, fy)));
  // Pale grey and white ink. On the frame of R and LR prints it gets no glow: the glow turned
  // the pale grey numbers of a white cost box white, so they did not show.
  const paleGrey = (L, chroma) => smooth(0.45, 0.6, L) * (1 - smooth(0.08, 0.18, chroma));
  // White tags on the frame, found from the pixels on every card: the white cost box of a white
  // card, the white AP and HP boxes of an alt-art. A point is in a white tag when most of the
  // ink around it (about 2.4 % of the card width each way) is white, so the grey numbers in
  // the tag count too. The frame glow stays off there, and the tag keeps its print.
  function whiteTags(data, W, H) {
    const r = Math.max(2, Math.round(W * 0.024)), sum = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, R = data[i] / 255, G = data[i + 1] / 255, B = data[i + 2] / 255;
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B), L = 0.299 * R + 0.587 * G + 0.114 * B;
        row += smooth(0.8, 0.92, L) * (1 - smooth(0.06, 0.14, mx - mn)) * (data[i + 3] / 255);
        sum[(y + 1) * (W + 1) + x + 1] = sum[y * (W + 1) + x + 1] + row;
      }
    }
    const tags = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
        const white = sum[y1 * (W + 1) + x1] - sum[y0 * (W + 1) + x1] - sum[y1 * (W + 1) + x0] + sum[y0 * (W + 1) + x0];
        tags[y * W + x] = smooth(0.25, 0.45, white / ((x1 - x0) * (y1 - y0)));
      }
    }
    return tags;
  }
  function hueOf(r, g, b, mx, mn) {
    if (mx === mn) return 0;
    const d = mx - mn;
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    return h < 0 ? h + 360 : h;
  }

  // RGBA pixels -> foil strength per pixel (0..1). field: where the holo surface shows;
  // line: metallic frame or line art (all foil prints but P).
  function maskValues(data, W, H, kind) {
    const field = new Float32Array(W * H), line = kind === 'holo' ? null : new Float32Array(W * H);
    const tags = kind === 'rare' || kind === 'legend' ? whiteTags(data, W, H) : null;
    for (let y = 0, i = 0; y < H; y++) {
      const fy = y / H;
      for (let x = 0; x < W; x++, i++) {
        const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const L = 0.299 * r + 0.587 * g + 0.114 * b, S = mx ? (mx - mn) / mx : 0;
        if (kind === 'holo') {
          // Bright areas carry the holo; dark ink stays dark.
          field[i] = smooth(0.14, 0.8, L);
        } else if (kind === 'rare') {
          // Real R cards: the foil is under the whole face and shows most through dark and
          // mid-tone ink, which turns from deep indigo to vivid blue. White ink hardly changes,
          // and red and orange ink mostly keep their colour (the shine layer makes them glow).
          const h = hueOf(r, g, b, mx, mn), warm = Math.max(1 - smooth(35, 55, h), smooth(320, 340, h));
          // Black and grey ink (the mech, the frame boxes, the text box) gets little of the band,
          // so it keeps its contrast. Chroma, not saturation, finds it: near black, saturation
          // is noise.
          const grey = (1 - smooth(0.04, 0.12, mx - mn)) * (1 - smooth(0.4, 0.7, L));
          const fx = x / W, frame = frameArea(fx, fy) && !(fy > 0.575 && fy < 0.685 && fx > 0.1 && fx < 0.9);
          field[i] = (0.3 + 0.7 * (1 - smooth(0.55, 0.95, L))) * (1 - grey * (frame || (fy > 0.6 && fy < 0.82) ? 0.85 : 0.55))
            * (1 - 0.7 * warm * smooth(0.25, 0.5, S) * smooth(0.25, 0.45, mx)) * (frame ? 1 - 0.8 * Math.max(paleGrey(L, mx - mn), tags[i]) : 1);
          // The frame (silver edge, cost box, black plates) glows in its own colour at the light.
          line[i] = frame ? 1 - Math.max(paleGrey(L, mx - mn), tags[i]) : 0;
        } else if (kind === 'legend') {
          // Real LR cards: a silver sheen with fine lines over the art, weaker on dark ink and
          // on strong colours. The frame and the white text keep their print. The name has no plate on LR
          // cards, so the art behind it keeps the sheen.
          const fx = x / W, frame = frameArea(fx, fy) && !(fy > 0.575 && fy < 0.685 && fx > 0.1 && fx < 0.9);
          field[i] = frame ? 0 : (0.45 + 0.55 * smooth(0.15, 0.75, L)) * (1 - 0.85 * smooth(0.3, 0.55, S))
            * (plainArea(fx, fy) ? 1 - smooth(0.75, 0.88, L) * (1 - smooth(0.12, 0.22, S)) : 1);
          // The whole frame glows in its own colour at the light: the coloured frame goes bright,
          // and the black plates stay black.
          line[i] = frame ? 1 - Math.max(paleGrey(L, mx - mn), tags[i]) : 0;
        } else if (kind === 'parallel') {
          // Ink over a mirror: only pale, unsaturated areas show the foil, so coloured and
          // dark ink keep their colour.
          field[i] = smooth(0.55, 0.85, L) * (1 - smooth(0.08, 0.18, S));
          // Silver frame: white text and the pale grey faces of the boxes. The white letters
          // of the effect text shine too.
          const grey = 1 - smooth(0.15, 0.3, S);
          if (frameArea(x / W, fy)) line[i] = smooth(0.6, 0.8, mx) * grey;
          else if (fy > 0.685 && fy < 0.82) line[i] = smooth(0.78, 0.9, mx) * grey;
        } else {
          // Gold line art, logo, frame lines and tab of ++ prints.
          const h = hueOf(r, g, b, mx, mn), warm = smooth(20, 30, h) * (1 - smooth(60, 70, h));
          const gold = warm * smooth(0.36, 0.52, mx) * smooth(0.14, 0.26, S);
          line[i] = gold;
          field[i] = (0.2 + 0.8 * smooth(0.22, 0.86, L)) * (1 - gold * 0.8);
        }
        // The scans have transparent round corners: no foil there.
        const a = data[i * 4 + 3] / 255;
        if (a < 1) {
          field[i] *= a;
          if (line) line[i] *= a;
        }
      }
    }
    return {field, line};
  }

  // Downsamples a mask into alpha bytes, keeping the strongest source pixel so thin lines
  // survive; `widen` grows lines by that many pixels.
  function shrink(values, W, H, scale, widen = 0) {
    const w = Math.round(W * scale), h = Math.round(H * scale), alpha = new Uint8ClampedArray(w * h);
    const n = Math.max(1, Math.round(1 / scale)) + widen;
    // At full size, each pixel keeps its own value.
    if (scale === 1 && widen === 0) {
      for (let i = 0; i < alpha.length; i++) alpha[i] = Math.round(Math.max(0, values[i]) * 255);
      return {width: w, height: h, alpha};
    }
    // The source columns and rows of each pixel, found one time.
    const m = n + widen, cols = new Int32Array(w * m), rows = new Int32Array(h * m);
    for (let x = 0; x < w; x++) for (let k = 0; k < m; k++) cols[x * m + k] = clamp(Math.floor(x / scale) + k - widen, 0, W - 1);
    for (let y = 0; y < h; y++) for (let j = 0; j < m; j++) rows[y * m + j] = clamp(Math.floor(y / scale) + j - widen, 0, H - 1) * W;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let j = 0; j < m; j++) {
          const row = rows[y * m + j];
          for (let k = 0; k < m; k++) v = Math.max(v, values[row + cols[x * m + k]]);
        }
        alpha[y * w + x] = Math.round(v * 255);
      }
    }
    return {width: w, height: h, alpha};
  }

  // Where the surface texture of parallel prints shows: the art, never the plain areas.
  // Quarter resolution is enough, as it follows the card template only.
  function textureMask(W, H) {
    const w = Math.max(1, Math.round(W / 4)), h = Math.max(1, Math.round(H / 4)), alpha = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) alpha[y * w + x] = plainArea((x + 0.5) / w, (y + 0.5) / h) ? 0 : 255;
    }
    return {width: w, height: h, alpha};
  }

  // The tint image gives the R and LR light its colour per point. Where the ink has a clear
  // colour, the light takes that colour: the foil under transparent ink reflects through it, so
  // a blue suit on a red card stays blue. White, grey and black ink gets neutral grey, never the
  // card's colour. Half resolution, each pixel the mean of a 2 x 2 block, so scan noise averages
  // out. The R and LR fields take only the hue of this image, and their own gradients give the
  // saturation and the light; the faint edge of the R band draws it with its colour, turned on
  // the colour wheel. alpha holds the same weight as a mask: where the ink has a colour. The
  // neutral mask (its inverse) takes the colour out of the light on neutral ink, and glow keeps
  // the glow off neutral and pale ink, so black stays black and white stays white.
  function tintImage(data, W, H) {
    const w = Math.max(1, Math.round(W / 2)), h = Math.max(1, Math.round(H / 2));
    const rgba = new Uint8ClampedArray(w * h * 4), alpha = new Uint8ClampedArray(w * h), glow = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let j = 0; j < 2; j++) {
          for (let k = 0; k < 2; k++) {
            const px = Math.min(W - 1, x * 2 + k), py = Math.min(H - 1, y * 2 + j), i = (py * W + px) * 4;
            r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3]; n++;
          }
        }
        r /= n * 255; g /= n * 255; b /= n * 255; a /= n * 255;
        // The transparent corners of the scan hold random colours: they count as neutral.
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), weight = smooth(0.04, 0.1, mx - mn) * a;
        const o = (y * w + x) * 4;
        // The ink's colour at full value, mixed into grey where the ink has little colour.
        rgba[o] = Math.round(255 * (0.5 + weight * ((mx ? r / mx : 1) - 0.5)));
        rgba[o + 1] = Math.round(255 * (0.5 + weight * ((mx ? g / mx : 1) - 0.5)));
        rgba[o + 2] = Math.round(255 * (0.5 + weight * ((mx ? b / mx : 1) - 0.5)));
        rgba[o + 3] = 255;
        alpha[y * w + x] = Math.round(255 * weight);
        // Where the ink glows at the light: coloured ink, less on pale ink (it would only turn
        // white), and never on black, grey or white ink.
        glow[y * w + x] = Math.round(255 * weight * (1 - 0.75 * smooth(0.72, 0.95, 0.299 * r + 0.587 * g + 0.114 * b)));
      }
    }
    return {width: w, height: h, rgba, alpha, glow};
  }

  // Half resolution masks of the card's shape (the scan's alpha, to keep the gloss off its
  // round corners) and, on R and LR prints, of its art (artArea), of the rest of the print
  // (frame: the frame, its tags and the text) and of the edge of the card (rim), where R and
  // LR prints catch the light.
  // The art area and the edge of the card are the same on each print of one size, so they are
  // found one time for each size.
  const templates = new Map();
  function template(W, H, w, h) {
    const key = `${W}x${H}`;
    if (!templates.has(key)) {
      const art = new Float64Array(w * h), edge = new Float64Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const fx = (x + 0.5) / w, fy = (y + 0.5) / h, i = y * w + x;
          art[i] = artArea(fx, fy);
          // About 3 % of the card width from its edge.
          edge[i] = 1 - smooth(0.018, 0.04, Math.min(fx, 1 - fx, (fy < 0.5 ? fy : 1 - fy) * H / W));
        }
      }
      if (templates.size > 8) templates.clear();
      templates.set(key, {art, edge});
    }
    return templates.get(key);
  }
  function shapeMasks(data, W, H, kind) {
    const w = Math.max(1, Math.round(W / 2)), h = Math.max(1, Math.round(H / 2)), holo = kind === 'rare' || kind === 'legend';
    const shape = new Uint8ClampedArray(w * h), art = holo ? new Uint8ClampedArray(w * h) : null;
    const frame = holo ? new Uint8ClampedArray(w * h) : null, rim = holo ? new Uint8ClampedArray(w * h) : null;
    const areas = holo ? template(W, H, w, h) : null;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = Math.min(W - 1, x * 2), py = Math.min(H - 1, y * 2), a = data[(py * W + px) * 4 + 3] / 255;
        const i = y * w + x;
        shape[i] = Math.round(255 * a);
        if (!holo) continue;
        const inArt = areas.art[i];
        art[i] = Math.round(255 * a * inArt);
        frame[i] = Math.round(255 * a * (1 - inArt));
        rim[i] = Math.round(255 * a * areas.edge[i]);
      }
    }
    const of = alpha => alpha && {width: w, height: h, alpha};
    return {shape: of(shape), art: of(art), frame: of(frame), rim: of(rim)};
  }

  // Field mask at half resolution, line mask at full resolution (++ lines widened by one);
  // parallels also get their texture mask, and R and LR prints their tint image and their art
  // and rim masks.
  function masks(data, W, H, kind) {
    const {field, line} = maskValues(data, W, H, kind);
    return {field: shrink(field, W, H, 0.5), line: line ? shrink(line, W, H, 1, kind === 'special' ? 1 : 0) : null,
      texture: kind === 'parallel' ? textureMask(W, H) : null,
      tint: kind === 'rare' || kind === 'legend' ? tintImage(data, W, H) : null, ...shapeMasks(data, W, H, kind)};
  }

  // Masks follow the visible part of the artwork when the face crops it (object-fit: cover).
  function maskFit({box, natural, fit, position}) {
    if (fit !== 'cover' || !box.width || !box.height || !natural.width || !natural.height) {
      return {size: '100% 100%', position: '50% 50%'};
    }
    const wide = box.width / box.height > natural.width / natural.height;
    return {size: wide ? '100% auto' : 'auto 100%', position: position || '50% 50%'};
  }

  // A PNG file of the pixels for the masks. The browser reads back the same pixels, and it
  // takes a few milliseconds where the browser's encoder takes about ten times as long.
  // `channels` 1 is alpha only (a palette of black at each alpha), 4 is RGBA. pngRows gives the
  // rows to compress; `zlib` is their zlib stream, or without it the rows are stored as they are.
  const CRC = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
    return t;
  })();
  function crc32(bytes, start, end) {
    let c = -1;
    for (let i = start; i < end; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return ~c >>> 0;
  }
  function pngRows(width, height, pixels, channels = 1) {
    // Each row starts with filter 0 (none).
    const line = width * channels, rows = new Uint8Array(height * (line + 1));
    for (let y = 0; y < height; y++) rows.set(pixels.subarray(y * line, (y + 1) * line), y * (line + 1) + 1);
    return rows;
  }
  // zlib data in stored blocks of at most 65535 bytes, then the Adler-32 of the rows.
  function stored(rows) {
    const size = rows.length, blocks = Math.max(1, Math.ceil(size / 65535)), out = new Uint8Array(2 + blocks * 5 + size + 4);
    out[0] = 0x78; out[1] = 0x01;
    let at = 2, a = 1, b = 0;
    for (let i = 0; i < size;) {
      const stop = Math.min(size, i + 5552);
      for (; i < stop; i++) { a += rows[i]; b += a; }
      a %= 65521; b %= 65521;
    }
    for (let i = 0; i < size; i += 65535) {
      const n = Math.min(65535, size - i);
      out.set([i + n === size ? 1 : 0, n & 255, n >>> 8, ~n & 255, (~n >>> 8) & 255], at);
      out.set(rows.subarray(i, i + n), at + 5);
      at += 5 + n;
    }
    new DataView(out.buffer).setUint32(at, (b << 16 | a) >>> 0);
    return out;
  }
  function png(width, height, channels, rows, zlib = null) {
    const data = zlib || stored(rows), palette = channels === 1 ? 12 + 768 + 12 + 256 : 0;
    const out = new Uint8Array(8 + 25 + palette + 12 + data.length + 12), view = new DataView(out.buffer);
    let at = 8;
    const chunk = (name, length, write) => {
      view.setUint32(at, length);
      const start = at + 4;
      for (let i = 0; i < 4; i++) out[start + i] = name.charCodeAt(i);
      at = start + 4;
      write();
      view.setUint32(at, crc32(out, start, at));
      at += 4;
    };
    out.set([137, 80, 78, 71, 13, 10, 26, 10]);
    chunk('IHDR', 13, () => { view.setUint32(at, width); view.setUint32(at + 4, height); out.set([8, channels === 1 ? 3 : 6, 0, 0, 0], at + 8); at += 13; });
    if (channels === 1) {
      chunk('PLTE', 768, () => { at += 768; });
      chunk('tRNS', 256, () => { for (let i = 0; i < 256; i++) out[at++] = i; });
    }
    chunk('IDAT', data.length, () => { out.set(data, at); at += data.length; });
    chunk('IEND', 0, () => {});
    return out;
  }

  // Seeded (mulberry32), so every session draws the same foil textures.
  const random = seed => () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };

  // ---- Light and tilt ----------------------------------------------------------------------

  const REST = {x: 50, y: 30};
  // Rotates a vector by -angle degrees: from screen directions into a turned card's own.
  function unturn(dx, dy, angle) {
    const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return {x: dx * c + dy * s, y: -dx * s + dy * c};
  }

  // A lamp above the player: a card's resting reflection depends on where it is on screen,
  // so cards away from the centre catch it on the side facing the centre. `angle` is the
  // card's on-screen rotation (the opponent's seat, the hand's fan, a rested Unit).
  function lamp(rect, view, angle = 0) {
    if (!rect || !rect.width || !rect.height || !view.width || !view.height) return {...REST};
    const dx = (rect.left + rect.width / 2) / view.width * 2 - 1, dy = (rect.top + rect.height / 2) / view.height * 2 - 1;
    const x = clamp(50 - dx * 38, 8, 92), y = clamp(30 - dy * 26, 6, 80);
    if (!angle) return {x, y};
    const v = unturn(x - 50, y - 50, angle);
    return {x: clamp(50 + v.x, 6, 94), y: clamp(50 + v.y, 6, 94)};
  }

  // A pointer on screen -> its position on the card in % of the card's own box. frame: the
  // card's on-screen centre, rotation and unrotated size, so a tilt never feeds back.
  function localPoint(frame, x, y) {
    const v = unturn(x - frame.cx, y - frame.cy, frame.angle || 0);
    return {x: clamp(50 + v.x / frame.width * 100), y: clamp(50 + v.y / frame.height * 100)};
  }

  // The unrotated size of a w×h-shaped box whose on-screen bounding box is W×H at `angle`.
  function frameOf(rect, aspect, angle = 0) {
    const a = angle * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    const width = rect.width / (c + aspect * s || 1);
    return {cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, angle, width, height: width * aspect};
  }

  // A whole card turns through the CSS rotate property, which the site also sets (its upright
  // opponent cards are rotate: 180deg) and which applies outside the card's own transform (a
  // rested card's turn). The tilt, rotateX(ry) rotateY(rx) in the card's own frame, is carried
  // past that transform's turn (`inner`, degrees) and composed after the site's rotate into one
  // axis and angle, so the site's rotations stay and the tilt still follows the card.
  const quat = (x, y, z, deg) => { const h = deg * Math.PI / 360, s = Math.sin(h); return [Math.cos(h), x * s, y * s, z * s]; };
  const qmul = ([aw, ax, ay, az], [bw, bx, by, bz]) => [aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw];
  const DEGREES = {deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360};
  // A computed rotate value ("none", "180deg", "z 90deg", "0 0 1 90deg") as a quaternion.
  function rotation(value) {
    const parts = String(value || 'none').trim().split(/\s+/);
    const angle = /^(-?[\d.]+(?:e-?\d+)?)(deg|rad|grad|turn)$/.exec(parts.pop() || '');
    const axis = parts.length === 3 ? parts.map(Number) : parts.length === 1 ? {x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1]}[parts[0]]
      : parts.length ? null : [0, 0, 1];
    const length = axis ? Math.hypot(...axis) : 0;
    if (!angle || !length || !Number.isFinite(length)) return [1, 0, 0, 0];
    return quat(axis[0] / length, axis[1] / length, axis[2] / length, Number(angle[1]) * DEGREES[angle[2]]);
  }
  function turn(rx, ry, inner = 0, site = 'none') {
    const tilt = qmul(quat(1, 0, 0, ry || 0), quat(0, 1, 0, rx || 0));
    let q = qmul(rotation(site), qmul(qmul(quat(0, 0, 1, inner), tilt), quat(0, 0, 1, -inner)));
    if (q[0] < 0) q = q.map(n => -n);
    const s = Math.hypot(q[1], q[2], q[3]);
    if (s < 1e-9) return '0 0 1 0deg';
    const axis = q.slice(1).map(n => (n / s).toFixed(5)).join(' ');
    return `${axis} ${(2 * Math.atan2(s, q[0]) * 180 / Math.PI).toFixed(3)}deg`;
  }

  // The site reads a card's place on screen with new DOMMatrix('rotate(' + its rotate + ')'),
  // and that text takes a 2D angle only. This writes a 3D rotate (a turning card's) as the
  // same turn in a form DOMMatrix reads, or gives null when the text has no such rotate.
  const NUMBER = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[-+]?\\d+)?';
  const AXIS_ROTATE = new RegExp(`rotate\\(\\s*(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER}(?:deg|rad|grad|turn))\\s*\\)`, 'gi');
  const NAMED_ROTATE = new RegExp(`rotate\\(\\s*([xyz])\\s+(${NUMBER}(?:deg|rad|grad|turn))\\s*\\)`, 'gi');
  function matrixText(text) {
    if (typeof text !== 'string') return null;
    const fixed = text.replace(AXIS_ROTATE, 'rotate3d($1, $2, $3, $4)')
      .replace(NAMED_ROTATE, (_, axis, angle) => `rotate${axis.toUpperCase()}(${angle})`);
    return fixed === text ? null : fixed;
  }
  // A stand-in for the DOMMatrix constructor `native`: it reads text the same way, and reads
  // text that throws only because of a 3D rotate as the same turn.
  function matrixReader(native) {
    return new Proxy(native, {construct(target, args, next) {
      try { return Reflect.construct(target, args, next); } catch (error) {
        const text = matrixText(args[0]);
        if (text === null) throw error;
        return Reflect.construct(target, [text, ...args.slice(1)], next);
      }
    }});
  }

  // The card tilts toward the pointer while the lamp's reflection moves the other way
  // across it, as on a real card, instead of a spot under the pointer.
  function aimAt(px, py, limit) {
    px = clamp(px); py = clamp(py);
    return {x: clamp(50 - (px - 50) * 0.75, 6, 94), y: clamp(50 - (py - 50) * 0.75, 6, 94), o: 1,
      rx: (50 - px) / 50 * limit || 0, ry: (py - 50) / 50 * limit || 0};
  }

  // ---- Motion: springs and the arrival sweep --------------------------------------------------

  const SWEEP_MS = 2000; // the arrival sweep at the site's default speed (2400 ÷ 1.2)
  const CASCADE_MS = 75; // between cards arriving together, at most MAX_CASCADE steps
  const MAX_CASCADE = 8;
  const MASK_WAIT = 1500; // a sweep waits this long at most for its print's masks
  const FADE_MS = 300; // a finish that waited for its masks fades in over this time
  const KEYS = ['x', 'y', 'rx', 'ry', 'o'];
  const ease = t => (1 - Math.cos(Math.PI * clamp(t, 0, 1))) / 2;
  // Strength fades in over the first third, holds, and fades out over the last third, so
  // the light leaves and rejoins its resting lamp softly.
  const envelope = t => t < 0.35 ? ease(t / 0.35) : t > 0.65 ? ease((1 - t) / 0.35) : 1;
  // The reflection circles the card clockwise from the top-left, as when tilting a real
  // card in a small circle.
  function orbit(s, t) {
    const env = envelope(t), angle = (-135 + 360 * ease(t)) * Math.PI / 180;
    return {x: s.x + (50 + 38 * Math.cos(angle) - s.x) * env, y: s.y + (50 + 40 * Math.sin(angle) - s.y) * env, o: env};
  }

  // One spring per card toward a target light and tilt; `now` is passed in, so tests drive
  // time. reduced(): prefers-reduced-motion; ratio(): the site's animation speed (1 at its
  // default, 0 when animations are off).
  function createMotion({reduced = () => false, ratio = () => 1} = {}) {
    const states = new Map();
    let last = 0;

    function state(key, rest = REST) {
      let s = states.get(key);
      if (!s) {
        s = {x: rest.x, y: rest.y, rx: 0, ry: 0, o: 0, v: {x: 0, y: 0, rx: 0, ry: 0, o: 0},
          target: {x: rest.x, y: rest.y, rx: 0, ry: 0, o: 0}, rest: {...rest}, active: false, arrive: 1,
          sweep: null, sweepT: undefined, pending: null, fade: null, wait: false};
        states.set(key, s);
      }
      return s;
    }

    // Starts the sweep, or shows the finish at once when there is no motion.
    function sweep(key, delay = 0, now = 0) {
      const s = states.get(key);
      if (!s) return;
      const duration = SWEEP_MS * ratio();
      s.pending = null;
      s.fade = null;
      s.wait = false;
      if (!(duration > 0) || reduced()) { s.arrive = 1; s.sweep = null; s.sweepT = undefined; return; }
      s.sweep = {start: now + delay, duration};
    }

    // A foil face newly arrived: its finish stays hidden until the sweep fades it in. The
    // sweep waits for the print's masks (ready()), at most MASK_WAIT.
    function arrive(key, index, now, rest) {
      const s = state(key, rest);
      if (s.active) return;
      s.arrive = 0;
      s.pending = {delay: Math.min(index, MAX_CASCADE) * CASCADE_MS * ratio(), deadline: now + MASK_WAIT};
    }
    function ready(key, now) {
      const s = states.get(key);
      if (s && s.pending) sweep(key, s.pending.delay, now);
    }
    // A new face whose masks are not ready yet: its finish stays hidden, so the plain card shows
    // and not a finish without masks. fade() shows it when the masks are ready.
    // A hover or press does not show it before then.
    function hide(key, rest) {
      const s = state(key, rest);
      if (s.pending || s.sweep) return;
      s.arrive = 0;
      s.fade = null;
      s.wait = true;
    }
    function fade(key, now) {
      const s = states.get(key);
      if (!s || !s.wait) return;
      s.wait = false;
      const duration = FADE_MS * ratio();
      if (!(duration > 0) || reduced()) { s.arrive = 1; s.fade = null; return; }
      s.fade = {start: now, from: s.arrive, duration};
    }

    // Hover or press: aiming cancels a running or still pending sweep. An arrival that still
    // waits for its masks then waits as a new face does (hide()), so no finish shows without them.
    function aim(key, px, py, limit, rest) {
      const s = state(key, rest);
      if (s.pending) s.wait = true;
      s.active = true; s.sweep = null; s.sweepT = undefined; s.pending = null;
      if (!s.wait && !s.fade) s.arrive = 1;
      s.target = aimAt(px, py, reduced() ? 0 : limit);
    }
    function release(key, rest) {
      const s = states.get(key);
      if (!s) return;
      s.active = false;
      if (rest) s.rest = {...rest};
      s.target = {...s.rest, rx: 0, ry: 0, o: 0};
    }
    // A lifted hand card catches the lamp at `o` of full strength where it is.
    function light(key, rest, o) {
      const s = state(key, rest);
      s.active = false; s.rest = {...rest};
      s.target = {...rest, rx: 0, ry: 0, o};
    }

    function step(now) {
      const dt = clamp((now - (last || now)) / 16.67, 0.5, 3);
      last = now;
      let any = false;
      for (const [key, s] of states) {
        let moving = false;
        // Interactive: stiffness .066, damping .25; after release, a softer settle.
        const stiffness = s.active ? 0.066 : 0.03, damping = s.active ? 0.25 : 0.14;
        for (const k of KEYS) {
          const v = s.v[k] + (s.target[k] - s[k]) * stiffness * dt;
          s.v[k] = v * Math.pow(1 - damping, dt);
          s[k] += s.v[k] * dt;
          if (Math.abs(s.target[k] - s[k]) > 0.02 || Math.abs(s.v[k]) > 0.02) moving = true;
          else { s[k] = s.target[k]; s.v[k] = 0; }
        }
        if (s.pending) {
          // Never leave a card unlit when its masks take long.
          if (now >= s.pending.deadline) sweep(key, 0, now);
          moving = true;
        }
        if (s.fade) {
          const t = (now - s.fade.start) / s.fade.duration;
          if (t >= 1) { s.fade = null; s.arrive = 1; } else {
            s.arrive = s.fade.from + (1 - s.fade.from) * ease(Math.max(0, t));
            moving = true;
          }
        }
        if (s.sweep) {
          const t = (now - s.sweep.start) / s.sweep.duration;
          if (t >= 1) { s.sweep = null; s.sweepT = undefined; s.arrive = 1; } else {
            s.sweepT = t < 0 ? undefined : t;
            s.arrive = t < 0 ? 0 : Math.min(1, ease(t / 0.35));
            moving = true;
          }
        }
        s.moving = moving;
        any = any || moving;
      }
      if (!any) last = 0;
      return any;
    }

    // What the stylesheet reads, for one card.
    function values(key) {
      const s = states.get(key);
      if (!s) return null;
      const sweeping = Boolean(s.sweep) && s.sweepT !== undefined;
      const lit = sweeping ? orbit(s, s.sweepT) : {x: s.x, y: s.y, o: 0};
      return {x: lit.x, y: lit.y, c: clamp(Math.hypot(lit.x - 50, lit.y - 50) / 50, 0, 1), o: clamp(s.o, 0, 1),
        rx: s.rx, ry: s.ry, sweepO: lit.o, arrive: s.arrive, sweeping,
        tilt: Math.abs(s.rx) > 0.04 || Math.abs(s.ry) > 0.04, active: s.active};
    }

    return {state, arrive, ready, hide, fade, sweep, aim, release, light, step, values,
      has: key => states.has(key), drop: key => states.delete(key), keys: () => [...states.keys()],
      // Hands a card's light, tilt and any running sweep to the element that replaced it.
      adopt(from, to) {
        const s = states.get(from);
        if (!s || from === to) return false;
        states.delete(from); states.set(to, s);
        return true;
      },
      waiting: key => Boolean(states.get(key) && (states.get(key).pending || states.get(key).sweep))};
  }

  // Which faces arrived: the face last seen arriving on each field slot. It outlives the
  // card elements the site re-renders, so showing the same face again never replays a sweep.
  function createArrivals() {
    const seen = new Map();
    return {
      arrive(slot, face) { if (seen.get(slot) === face) return false; seen.set(slot, face); return true; },
      forget(slot) { seen.delete(slot); },
      slots: () => [...seen.keys()],
    };
  }

  const api = {FINISHES, PRINTED, REST, SWEEP_MS, CASCADE_MS, MAX_CASCADE, MASK_WAIT, FADE_MS, printOf, baseCode, normalize,
    rarityOf, finish, family, foil, maskKind, smooth, frameArea, plainArea, artArea, whiteTags, hueOf, maskValues, shrink, textureMask, tintImage, masks, maskFit, pngRows, png, random, lamp,
    localPoint, frameOf, rotation, turn, matrixText, matrixReader, aimAt, ease, envelope, orbit, createMotion, createArrivals};
  root.CBLHolo = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
