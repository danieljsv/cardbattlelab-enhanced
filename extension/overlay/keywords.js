// Printed keyword abilities, parsed once per card text into structured data.
// Display only: legality always comes from the site's engine.
(function (root) {
  'use strict';

  // One fixed order everywhere (hand circles, field icons, inspector list).
  const KEYWORDS = ['Repair', 'Breach', 'Support', 'Blocker', 'First Strike', 'High-Maneuver', 'Suppression'];
  const NUMBERED = new Set(['Repair', 'Breach', 'Support']);
  const KEYWORD_RE = /<(Repair|Breach|Support|Blocker|First Strike|High-Maneuver|Suppression)(?:\s+(\d+))?>|【(Repair|Breach|Support|Blocker|First Strike|High-Maneuver|Suppression)(?:\s+(\d+))?】/g;
  const TOKEN_AT = new RegExp(KEYWORD_RE.source, 'y');
  const HAS_KEYWORD = new RegExp(KEYWORD_RE.source);
  const VERSION = 1;

  const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#039': "'"};

  function decode(html) {
    return String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#039);/gi, (whole, name) => {
        if (name[0] === '#') {
          const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
          return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
        }
        return ENTITIES[name.toLowerCase()] ?? whole;
      })
      .replace(/・/g, '･')
      // One card (Gundam X) prints its keyword as "[Suppression] (reminder…)". Like the
      // engine, a bracketed keyword counts only when its reminder text follows, so names
      // such as "[Gozzo](･AP0･HP3)" or "【Pilot】[Sai Saici]" stay names.
      .replace(/\[(Repair|Breach|Support|Blocker|First Strike|High-Maneuver|Suppression)(\s+\d+)?\](?=\s*\()/g, '<$1$2>');
  }

  // "Lv.3" would end a sentence for the clause rules below, so the dot is swapped for a
  // one-dot leader while parsing and restored in every string the parser returns.
  const LV_DOT = '\u2024';
  const protectLv = text => text.replace(/\bLv\./g, `Lv${LV_DOT}`);
  const restoreLv = text => text.split(LV_DOT).join('.');

  // Index just past the parenthesis that closes the one at `open`, or -1.
  function closeParen(text, open) {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')' && --depth === 0) return i + 1;
    }
    return -1;
  }

  // Remove reminder text after keywords and the stat lines of Unit tokens, whose
  // keywords belong to the token rather than to this card.
  function stripNoise(line) {
    let out = '';
    for (let i = 0; i < line.length;) {
      if (line[i] === '[') {
        const end = line.indexOf(']', i);
        if (end > i && line[end + 1] === '(') {
          const close = closeParen(line, end + 1);
          if (close > 0) { out += line.slice(i, end + 1); i = close; continue; }
        }
      }
      TOKEN_AT.lastIndex = i;
      const m = TOKEN_AT.exec(line);
      if (!m) { out += line[i++]; continue; }
      out += m[0];
      i += m[0].length;
      const open = i + line.slice(i).match(/^\s*/)[0].length;
      if (line[open] === '(') {
        const close = closeParen(line, open);
        // Reminder text is a sentence; a trait such as "(Zeon)" never ends with a period.
        if (close > 0 && /\.\s*\)$/.test(line.slice(open, close))) i = close;
      }
    }
    return out.trim();
  }

  function keywordOf(token) {
    const m = /^(?:<|【)(Repair|Breach|Support|Blocker|First Strike|High-Maneuver|Suppression)(?:\s+(\d+))?(?:>|】)$/.exec(token);
    return m ? {keyword: m[1], amount: m[2] === undefined ? null : Number(m[2])} : null;
  }

  // Leading 【…】 tags, except a keyword written in brackets (one card prints 【Repair 2】).
  function splitTags(line) {
    const tags = [];
    let rest = line;
    for (;;) {
      // "【Main】/【Action】" lists two timings for one effect.
      const m = /^\/?【([^】]*)】/.exec(rest);
      if (!m || keywordOf(m[0].replace(/^\//, ''))) break;
      tags.push(m[1].trim());
      rest = rest.slice(m[0].length);
    }
    return {tags, body: rest.trim()};
  }

  function describeTags(tags) {
    const during = [], triggers = [], plays = [];
    for (const tag of tags) {
      const parts = tag.split('･').map(s => s.trim()).filter(Boolean);
      const head = parts[0] || '';
      const during_ = /^During (Pair|Link)\b\s*(.*)$/.exec(head);
      if (during_) {
        const requirement = [during_[2], ...parts.slice(1)].filter(Boolean).join(' ');
        during.push(`During ${during_[1]}${requirement ? ` with a ${requirement}` : ''}`);
        continue;
      }
      if (head === 'Activate') { triggers.push(`Activate･${parts.slice(1).join('･') || 'Main'}`); continue; }
      if (head === 'Main' || head === 'Action') { plays.push(head); continue; }
      const development = parts.slice(1).filter(p => /^Development \d+$/.test(p));
      const requirement = parts.slice(1).filter(p => !/^Development \d+$/.test(p)).join(' ');
      triggers.push(requirement ? `${head} with a ${requirement}` : head, ...development);
    }
    return {during, triggers, plays};
  }

  const CONDITION_RE = /\b(?:While|If|When|Whenever|During your turn|During your opponent's turn|During your opponent’s turn)\b[^,.]*/gi;

  function conditionsIn(span) {
    const out = [];
    for (const m of span.matchAll(CONDITION_RE)) {
      const text = m[0].trim();
      if (/^during this (turn|battle)$/i.test(text)) continue;
      out.push(text.replace(/^./, c => c.toUpperCase()));
    }
    return out;
  }

  // What "it"/"they" refers to: the last Unit named before `limit` in the line.
  function antecedent(body, limit) {
    const text = body.slice(0, limit);
    let best = null;
    const consider = (index, value) => { if (!best || index >= best.index) best = {index, ...value}; };
    for (const m of text.matchAll(/\bthis Unit\b|\bthis is\b|\bthis(?=\s+(?:gains?|gets?)\b)/gi)) consider(m.index, {self: true});
    for (const m of text.matchAll(/\bchoose\s+((?:up to\s+)?(?:\d+(?:\s+to\s+\d+)?|a number of)\b[^.]*?\bUnits?\b(?!\s+cards?)[^.]*)/gi)) {
      consider(m.index, {self: false, recipient: m[1].trim()});
    }
    for (const m of text.matchAll(/\bwhen\s+((?:a|an|another|one of your)\s+[^,.]*?\bUnits?)\s+(links|attacks|is deployed|are deployed)/gi)) {
      consider(m.index, {self: false, recipient: `${m[1]} that ${m[2]}`});
    }
    return best;
  }

  // Classify one keyword occurrence. Returns null for references such as
  // "an enemy Unit with <Blocker>" or "can't activate <Blocker>".
  function classify(body, token, previousRef) {
    const before = body.slice(0, token.index);
    if (previousRef && /^\s*\/\s*$/.test(body.slice(previousRef.end, token.index))) return null;
    const variable = /\bgains?\s+the same number of\s*$/i.test(before);
    if (!variable && /(?:\bwith|\bwithout|\bhas|\bhave|\bactivates?|\bUnit's|\bUnit’s|\ball|\bof)\s*$/i.test(before)) return {ref: true};
    const bare = body.replace(KEYWORD_RE, '').replace(/[\s/･,.]/g, '') === '';
    if (bare) return {self: true, bare: true, conditionSpan: ''};
    const boundary = Math.max(before.lastIndexOf('. '), before.lastIndexOf(', '), before.lastIndexOf('; '), before.lastIndexOf(': '), before.lastIndexOf('：'));
    const clause = before.slice(boundary + 1);
    const verbs = [...clause.matchAll(/\b(gains?|gets?)\b/gi)];
    if (!verbs.length) return {ref: true};
    const verb = verbs[verbs.length - 1];
    const subject = clause.slice(0, verb.index).replace(/\band\s*$/i, '').trim().replace(/^(then|also)\s+/i, '');
    const verbAt = boundary + 1 + verb.index;
    const sentenceStart = before.lastIndexOf('. ') + 1;
    let target;
    if (/^(this Unit|this)$/i.test(subject) || (!subject && /^gets?$/i.test(verb[1]) && /\bthis Unit\b[^.]*$/i.test(before))) target = {self: true};
    else if (/^(it|they)$/i.test(subject) || !subject) {
      const found = antecedent(body, boundary + 1);
      target = found ? (found.self ? {self: true} : {self: false, recipient: found.recipient, at: found.index}) : {self: true};
    } else target = {self: false, recipient: subject};
    // Conditions come from the sentence up to the verb, plus the sentence that chose the Unit.
    const spanStart = target.at === undefined ? sentenceStart : Math.min(sentenceStart, body.lastIndexOf('. ', target.at) + 1);
    const after = body.slice(token.end);
    const duration = (/^[^.]*?\bduring this (turn|battle)\b/i.exec(after) || /\bduring this (turn|battle)\b/i.exec(body.slice(sentenceStart, verbAt)) || [])[1] || '';
    return {...target, variable, duration, conditionSpan: body.slice(spanStart, verbAt)};
  }

  function cardKind(card) {
    const type = String(card && card.type || '').toUpperCase();
    const text = decode(card && card.effect);
    if (type === 'COMMAND' && /【Pilot】/.test(text)) return {kind: 'pilot', hybrid: true};
    if (type === 'PILOT') return {kind: 'pilot', hybrid: false};
    if (type === 'COMMAND') return {kind: 'command', hybrid: false};
    if (type === 'BASE') return {kind: 'base', hybrid: false};
    if (type.startsWith('UNIT')) return {kind: 'unit', hybrid: false, token: type.includes('TOKEN')};
    return {kind: type.toLowerCase() || 'unknown', hybrid: false};
  }

  // Whether a Unit card's grant can land on the card itself. "Other", "another", Unit
  // tokens (on a card that is not a token), "the attacking Unit" when another Unit
  // attacks, or a trait, colour or level the card lacks rule it out. A Base is never a
  // Unit. Grants that can't reach the card are listed in the card view, not drawn.
  function reachesSelf(grant, card, kind) {
    if (kind === 'base') return false;
    const recipient = grant.recipient;
    const own = String(card.trait || '').toLowerCase();
    if (/\b(other|another)\b/i.test(recipient)) return false;
    if (/\battacking Unit\b/i.test(recipient) && /\banother\b/i.test(grant.condition)) return false;
    if (/\btokens?\b/i.test(recipient) && !/TOKEN/i.test(card.type || '')) return false;
    const traits = [...recipient.matchAll(/\(([^()]+)\)/g)].map(m => `(${m[1].toLowerCase()})`);
    if (traits.length && !traits.some(t => own.includes(t))) return false;
    const colour = /\b(white|blue|green|red|purple)\b/i.exec(recipient.replace(/\([^()]*\)/g, ''));
    if (colour && card.color && colour[1].toLowerCase() !== String(card.color).toLowerCase()) return false;
    const level = Number(card.level);
    const lower = /\bLv\.(\d+) or lower\b/i.exec(recipient), higher = /\bLv\.(\d+) or higher\b/i.exec(recipient);
    if (Number.isFinite(level) && ((lower && level > Number(lower[1])) || (higher && level < Number(higher[1])))) return false;
    return true;
  }

  function parse(card) {
    const {kind, hybrid} = cardKind(card);
    const command = String(card && card.type || '').toUpperCase() === 'COMMAND';
    const result = {version: VERSION, kind, hybrid, fixed: [], conditional: [], grants: []};
    let inherited = [];
    for (const raw of decode(card && card.effect).split('\n')) {
      let line = raw.trim();
      if (!line || /^\(.*\)$/.test(line) && closeParen(line, 0) === line.length) continue;
      let tags;
      if (line[0] === '■') { line = line.slice(1).trim(); tags = inherited; }
      const split = splitTags(line);
      if (!tags) { tags = split.tags; if (tags.length) inherited = tags; }
      let body = protectLv(stripNoise(split.body));
      const {during, triggers, plays} = describeTags(tags);
      // The Activate cost before "：" is part of the timing, not the sentence.
      let cost = '';
      const colon = /^([^：]*?)\s*(?:：|:\s)/.exec(body);
      if (colon && triggers.some(t => t.startsWith('Activate')) && !HAS_KEYWORD.test(colon[1])) { cost = colon[1]; body = body.slice(colon[0].length); }
      let previousRef = null;
      for (const m of body.matchAll(KEYWORD_RE)) {
        const token = {index: m.index, end: m.index + m[0].length};
        const keyword = m[1] || m[3];
        const amountText = m[2] ?? m[4];
        const amount = amountText === undefined ? null : Number(amountText);
        const c = classify(body, token, previousRef);
        if (!c || c.ref) { previousRef = token; continue; }
        previousRef = null;
        // A Command's 【Main】/【Action】 is how it is played, not a condition.
        const timing = [...triggers.map((t, i) => (i === 0 && cost ? `${t}: ${cost}` : t)), ...plays.filter(() => !command)];
        const sentenceConditions = conditionsIn(c.conditionSpan);
        // <Support N> is always printed as an 【Activate･Main】 ability.
        const supportLine = c.bare && keyword === 'Support' && triggers.length === 1 && triggers[0] === 'Activate･Main' && !during.length;
        const condition = [...during, ...sentenceConditions].join('; ');
        const restricted = !supportLine && Boolean(during.length || timing.length || sentenceConditions.length || c.variable);
        const entry = {keyword, amount, condition: restoreLv(condition), timing: supportLine ? [] : timing.map(restoreLv),
          duration: c.duration ? `this ${c.duration}` : '', source: line};
        if (c.variable) entry.variable = true;
        // A Pilot's "this Unit" is the Unit it pairs with.
        if (c.self && kind === 'pilot') result.grants.push({...entry, recipient: 'the paired Unit', conditional: restricted});
        else if (c.self && kind !== 'command') ((restricted || c.duration) ? result.conditional : result.fixed).push(entry);
        else {
          const recipient = restoreLv(c.recipient || 'a Unit');
          const grant = {...entry, recipient, conditional: restricted};
          if (/\benemy\b/i.test(recipient)) grant.enemy = true;
          // A Command's or Pilot's grant is what the card does; a Unit's or Base's may go
          // only to other cards.
          if (kind === 'unit' || kind === 'base') grant.reachesSelf = !grant.enemy && reachesSelf(grant, card, kind);
          result.grants.push(grant);
        }
      }
    }
    return result;
  }

  // Alternate-art printings have codes of their own (ST01-001-p1) that the site's card
  // database lists under the base card's `variants`, not as keys; the printed card is the
  // base card's. Same rule as the site's own baseCode().
  const baseCode = code => String(code ?? '').replace(/-p\d+$/i, '');
  function printed(db, code) {
    if (!db || !code) return null;
    return db[code] || db[baseCode(code)] || null;
  }

  const cache = new Map();
  // Parsed once per card text; a changed card database text gets a fresh parse.
  function forCard(card) {
    if (!card) return null;
    const key = JSON.stringify([card.code || '', card.type || '', card.effect || '']);
    let parsed = cache.get(key);
    if (!parsed) { parsed = parse(card); cache.set(key, parsed); }
    return parsed;
  }

  // Hand circles: fixed and unconditional grants are solid, the rest dashed. The
  // same keyword and number shown both ways keeps only the solid circle. A Unit or Base
  // shows only grants that can reach the card itself.
  function handBadges(parsed) {
    if (!parsed) return [];
    const out = [];
    const add = (e, conditional) => {
      const prev = out.find(b => b.keyword === e.keyword && b.amount === e.amount);
      if (prev) prev.conditional = prev.conditional && conditional;
      else out.push({keyword: e.keyword, amount: e.amount, conditional});
    };
    parsed.fixed.forEach(e => add(e, false));
    parsed.conditional.forEach(e => add(e, true));
    // Keywords handed to enemy Units, or only to other cards, are explained in the card
    // view, not drawn as circles.
    parsed.grants.forEach(e => { if (!e.enemy && e.reachesSelf !== false) add(e, e.conditional); });
    return sortBadges(out);
  }

  function sortBadges(list) {
    return list.sort((a, b) => KEYWORDS.indexOf(a.keyword) - KEYWORDS.indexOf(b.keyword) || (a.amount ?? -1) - (b.amount ?? -1));
  }

  function label(badge) {
    return `${badge.conditional ? 'Conditional ' : ''}${badge.keyword}${badge.amount === null || badge.amount === undefined ? '' : ` ${badge.amount}`}`;
  }

  // One line per printed ability for the full card view.
  function describe(parsed) {
    if (!parsed) return [];
    const lines = [];
    const name = e => `${e.keyword}${e.amount === null ? (e.variable ? ' N' : '') : ` ${e.amount}`}`;
    const words = (e, extra) => [extra, e.condition, e.timing.length ? `Timing: ${e.timing.join(', ')}` : '', e.duration ? `Lasts ${e.duration}` : '', e.variable ? 'Amount varies' : '']
      .filter(Boolean).join('. ');
    parsed.fixed.forEach(e => lines.push({keyword: e.keyword, name: name(e), kind: 'fixed', text: ''}));
    parsed.conditional.forEach(e => lines.push({keyword: e.keyword, name: name(e), kind: 'conditional', text: words(e, '')}));
    parsed.grants.forEach(e => lines.push({keyword: e.keyword, name: name(e), kind: e.conditional ? 'granted-conditional' : 'granted',
      text: words(e, `Gives it to ${e.recipient}`)}));
    return lines;
  }

  // ---- Live keywords of a Unit in play ----------------------------------------------

  const canonical = (() => {
    const index = new Map(KEYWORDS.map(k => [k.toLowerCase().replace(/[\s_-]+/g, ''), k]));
    return text => index.get(String(text || '').toLowerCase().replace(/[\s_-]+/g, '')) || null;
  })();
  const KEYWORD_IN_TEXT = /\b(Repair|Breach|Support|Blocker|First[\s_-]?Strike|High[\s_-]?Maneuver|Suppression)\b(?:[\s>]*(\d+))?/gi;

  // Keywords a Unit in play has right now, from the site's board snapshot. The engine
  // lists keywords given by other cards (granted_keywords) and the card's conditional
  // static abilities with their state (passive_bonuses); printed always-on keywords are
  // the card's own and are not listed. `lookup(code)` returns a printed card.
  function active(live, lookup) {
    const found = new Map();
    const add = (keyword, amount, source) => {
      if (!keyword) return;
      const n = amount === undefined || amount === null || amount === '' ? null : Number(amount);
      const prev = found.get(keyword);
      if (!prev) found.set(keyword, {keyword, amount: n, sources: [source]});
      else {
        // Copies of Repair, Breach and Support add up (rules 13-1-1 to 13-1-3).
        if (n !== null) prev.amount = (prev.amount || 0) + n;
        prev.sources.push(source);
      }
    };
    const printed = lookup(live.code);
    const parsed = printed ? forCard(printed) : null;
    for (const g of live.granted_keywords || []) add(canonical(g.kw || g.keyword || g.name), g.n ?? g.amount, g.name || 'granted');
    const reported = new Set(found.keys());
    for (const pb of live.passive_bonuses || []) {
      for (const m of String(pb.desc || '').matchAll(KEYWORD_IN_TEXT)) {
        reported.add(canonical(m[1]));
        if (pb.active !== false) add(canonical(m[1]), m[2], pb.source || 'passive');
      }
    }
    // Pairing and linking are engine state. When the engine lists nothing for a keyword
    // that depends only on them, the paired Pilot's unconditional grant and the Unit's
    // plain "During Pair"/"During Link" keyword apply while the pair or link holds.
    const fallback = [];
    if (parsed && (live.paired || live.pilot)) {
      fallback.push(...parsed.conditional.filter(e => e.condition === 'During Pair' && !e.timing.length && !e.duration));
      const pilot = live.pilot && lookup(live.pilot.code);
      if (pilot) fallback.push(...forCard(pilot).grants.filter(g => g.recipient === 'the paired Unit' && !g.conditional && !g.duration));
    }
    if (parsed && live.linked) fallback.push(...parsed.conditional.filter(e => e.condition === 'During Link' && !e.timing.length && !e.duration));
    for (const e of fallback) if (!reported.has(e.keyword)) add(e.keyword, e.amount, 'pair');
    if (parsed) for (const e of parsed.fixed) add(e.keyword, e.amount, 'printed');
    return sortBadges([...found.values()]);
  }

  const api = {VERSION, KEYWORDS, NUMBERED, decode, parse, baseCode, printed, forCard, handBadges, sortBadges, label, describe, cardKind, active, canonical};
  root.CBLKeywords = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
