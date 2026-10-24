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

  // ---- Per-print masks ------------------------------------------------------------------

  const clamp = (v, a = 0, b = 100) => Math.min(b, Math.max(a, v));
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  // Silver frame elements of parallel prints on the card template (fractions of the card):
  // cost box and numerals, left edge, ID tab, bottom trait/stat bars, right edge, name plate.
  const frameArea = (fx, fy) => (fx < 0.22 && fy < 0.17) || fx < 0.075 || (fx > 0.58 && fy < 0.052) || fy > 0.86
    || fx > 0.945 || (fy > 0.575 && fy < 0.685 && fx > 0.1 && fx < 0.9);
  function hueOf(r, g, b, mx, mn) {
    if (mx === mn) return 0;
    const d = mx - mn;
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    return h < 0 ? h + 360 : h;
  }

  // RGBA pixels -> foil strength per pixel (0..1). field: where the holo surface shows;
  // line: metallic frame or line art (parallels and special parallels only).
  function maskValues(data, W, H, kind) {
    const field = new Float32Array(W * H), line = kind === 'holo' ? null : new Float32Array(W * H);
    for (let y = 0, i = 0; y < H; y++) {
      const fy = y / H;
      for (let x = 0; x < W; x++, i++) {
        const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const L = 0.299 * r + 0.587 * g + 0.114 * b, S = mx ? (mx - mn) / mx : 0;
        if (kind === 'holo') {
          // Bright areas carry the holo; dark ink stays dark.
          field[i] = smooth(0.14, 0.8, L);
        } else if (kind === 'parallel') {
          // Glitter covers the art, strongest where it is pale.
          field[i] = 0.12 + 0.88 * smooth(0.1, 0.74, L);
          if (frameArea(x / W, fy)) line[i] = smooth(0.66, 0.88, mx) * (1 - smooth(0.1, 0.22, S));
        } else {
          // Gold line art, logo, frame lines and tab of ++ prints.
          const h = hueOf(r, g, b, mx, mn), warm = smooth(20, 30, h) * (1 - smooth(60, 70, h));
          const gold = warm * smooth(0.36, 0.52, mx) * smooth(0.14, 0.26, S);
          line[i] = gold;
          field[i] = (0.2 + 0.8 * smooth(0.22, 0.86, L)) * (1 - gold * 0.8);
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
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = Math.floor(x / scale), sy = Math.floor(y / scale);
        let v = 0;
        for (let j = -widen; j < n; j++) {
          for (let k = -widen; k < n; k++) {
            const px = clamp(sx + k, 0, W - 1), py = clamp(sy + j, 0, H - 1);
            v = Math.max(v, values[py * W + px]);
          }
        }
        alpha[y * w + x] = Math.round(v * 255);
      }
    }
    return {width: w, height: h, alpha};
  }

  // Field mask at half resolution, line mask at full resolution (++ lines widened by one).
  function masks(data, W, H, kind) {
    const {field, line} = maskValues(data, W, H, kind);
    return {field: shrink(field, W, H, 0.5), line: line ? shrink(line, W, H, 1, kind === 'special' ? 1 : 0) : null};
  }

  // Masks follow the visible part of the artwork when the face crops it (object-fit: cover).
  function maskFit({box, natural, fit, position}) {
    if (fit !== 'cover' || !box.width || !box.height || !natural.width || !natural.height) {
      return {size: '100% 100%', position: '50% 50%'};
    }
    const wide = box.width / box.height > natural.width / natural.height;
    return {size: wide ? '100% auto' : 'auto 100%', position: position || '50% 50%'};
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
          sweep: null, sweepT: undefined, pending: null};
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

    // Hover or press: aiming cancels a running or still pending sweep.
    function aim(key, px, py, limit, rest) {
      const s = state(key, rest);
      s.active = true; s.sweep = null; s.sweepT = undefined; s.arrive = 1; s.pending = null;
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

    return {state, arrive, ready, sweep, aim, release, light, step, values,
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

  const api = {FINISHES, PRINTED, REST, SWEEP_MS, CASCADE_MS, MAX_CASCADE, MASK_WAIT, printOf, baseCode, normalize,
    rarityOf, finish, family, foil, smooth, frameArea, hueOf, maskValues, shrink, masks, maskFit, random, lamp,
    localPoint, frameOf, rotation, turn, aimAt, ease, envelope, orbit, createMotion, createArrivals};
  root.CBLHolo = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
