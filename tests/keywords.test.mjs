// Printed keyword parsing, against card texts in the site's own encoding.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';

const K = createRequire(import.meta.url)('../extension/overlay/keywords.js');
const card = (type, effect, extra = {}) => ({code: `T-${Math.random()}`, type, effect, ...extra});
const brief = list => list.map(e => `${e.keyword}${e.amount === null ? '' : ' ' + e.amount}`);
const badges = c => K.handBadges(K.parse(c)).map(K.label);

test('a bare keyword line is fixed and its reminder text is ignored', () => {
  const p = K.parse(card('UNIT', '&lt;Blocker&gt; (Rest this Unit to change the attack target to it.)<br>This Unit can\'t choose the enemy player as its attack target.<br>'));
  assert.deepEqual(brief(p.fixed), ['Blocker']);
  // The card view lists it by name only: an always-on keyword needs no note.
  assert.deepEqual(K.describe(p).map(l => [l.name, l.text]), [['Blocker', '']]);
  assert.deepEqual(p.conditional, []);
  assert.deepEqual(p.grants, []);
});

test('reminder text on its own line and numbered keywords', () => {
  const p = K.parse(card('UNIT', '&lt;Repair 2&gt;<br>\n(At the end of your turn, this Unit recovers the specified number of HP.)<br>'));
  assert.deepEqual(brief(p.fixed), ['Repair 2']);
});

test('Support is printed as an Activate･Main ability and is still fixed', () => {
  const p = K.parse(card('UNIT', '【Activate･Main】&lt;Support 3&gt; (Rest this Unit. 1 other friendly Unit gets AP+(specified amount) during this turn.)<br>【During Pair･(Coordinator) Pilot】【Once per Turn】When you use this Unit\'s &lt;Support&gt; to increase a (ZAFT) Unit\'s AP, set this Unit as active.<br>'));
  assert.deepEqual(brief(p.fixed), ['Support 3']);
  assert.deepEqual(p.conditional, [], 'the mention of <Support> in the second line is a reference');
});

test('During Pair, During Link and While conditions are conditional', () => {
  const pair = K.parse(card('UNIT', '【During Pair】This Unit gains &lt;Breach 3&gt;.'));
  assert.deepEqual(brief(pair.conditional), ['Breach 3']);
  assert.equal(pair.conditional[0].condition, 'During Pair');
  const link = K.parse(card('UNIT', '【During Link】This Unit gets AP+2 and &lt;Repair 1&gt;.'));
  assert.equal(link.conditional[0].condition, 'During Link');
  const ap = K.parse(card('UNIT', 'While this Unit has 5 or more AP, it gains &lt;Breach 3&gt;.'));
  assert.deepEqual(brief(ap.conditional), ['Breach 3']);
  assert.equal(ap.conditional[0].condition, 'While this Unit has 5 or more AP');
  const battle = K.parse(card('UNIT', 'During your turn, while this Unit is battling an enemy Unit that is Lv.2 or lower, it gains &lt;First Strike&gt;.'));
  assert.equal(battle.conditional[0].condition, 'During your turn; While this Unit is battling an enemy Unit that is Lv.2 or lower');
  const pilotType = K.parse(card('UNIT', '【During Pair (Orb) Pilot】This Unit gains &lt;Blocker&gt;.'));
  assert.equal(pilotType.conditional[0].condition, 'During Pair with a (Orb) Pilot');
});

test('triggered self keywords keep their timing and duration', () => {
  const p = K.parse(card('UNIT', '【During Pair】【Activate･Main】Exile 4 cards in your trash from the game: This Unit gains &lt;First Strike&gt; during this turn.'));
  assert.deepEqual(brief(p.conditional), ['First Strike']);
  assert.deepEqual(p.conditional[0].timing, ['Activate･Main: Exile 4 cards in your trash from the game']);
  assert.equal(p.conditional[0].duration, 'this turn');
  const it = K.parse(card('UNIT', '【During Link】【Attack】Choose 12 cards from your trash. Return them to their owner\'s deck and shuffle it. If you do, set this Unit as active. It gains &lt;First Strike&gt; during this turn.'));
  assert.deepEqual(brief(it.conditional), ['First Strike'], '"It" refers to this Unit, not to the chosen cards');
});

test('a Pilot\'s keyword goes to the paired Unit', () => {
  const sayla = K.parse(card('PILOT', '【Burst】Add this card to your hand.<br>While this Unit is blue, it gains &lt;Repair 1&gt;.<br>\n(At the end of your turn, this Unit recovers the specified number of HP.)<br>'));
  assert.deepEqual(sayla.fixed, []);
  assert.equal(sayla.grants.length, 1);
  assert.equal(sayla.grants[0].recipient, 'the paired Unit');
  assert.equal(sayla.grants[0].condition, 'While this Unit is blue');
  assert.equal(sayla.grants[0].conditional, true);
  assert.deepEqual(badges(card('PILOT', 'While this Unit is blue, it gains &lt;Repair 1&gt;.')), ['Conditional Repair 1']);
  const support = K.parse(card('PILOT', '【Activate･Main】&lt;Support 2&gt; (Rest this Unit. 1 other friendly Unit gets AP+(specified amount) during this turn.)'));
  assert.equal(support.grants[0].conditional, false, 'an unconditional grant is solid');
});

test('a Command grant is solid; its Main timing is not a condition', () => {
  const p = K.parse(card('COMMAND', '【Main】Choose 1 of your Units. It gains &lt;Repair 2&gt; during this turn.'));
  assert.equal(p.kind, 'command');
  assert.equal(p.grants[0].recipient, '1 of your Units');
  assert.equal(p.grants[0].duration, 'this turn');
  assert.equal(p.grants[0].conditional, false);
  assert.deepEqual(badges(card('COMMAND', '【Main】/【Action】Choose 1 friendly Unit that is Lv.2 or lower. It gains &lt;First Strike&gt; during this turn.')), ['First Strike']);
  const conditional = K.parse(card('COMMAND', '【Action】Choose 1 rested enemy Unit that is Lv.4 or lower. Return it to its owner\'s hand. Then, if there are 2 or more cards with "Awakened Potential" in their card name in your trash, you may choose 1 friendly Unit. It gains &lt;Blocker&gt; during this turn.'));
  assert.equal(conditional.grants[0].recipient, '1 friendly Unit');
  assert.equal(conditional.grants[0].conditional, true);
});

test('a Unit\'s triggered grant to another Unit is conditional', () => {
  const p = K.parse(card('UNIT', '【Deploy】Choose 1 of your Units. It gains &lt;Repair 1&gt; during this turn.'));
  assert.deepEqual(p.fixed, []);
  assert.equal(p.grants[0].conditional, true);
  assert.deepEqual(p.grants[0].timing, ['Deploy']);
  const event = K.parse(card('BASE', '【Once per Turn】When a friendly (Clan) Unit links, it gains &lt;Breach 3&gt; during this turn.'));
  assert.equal(event.grants[0].recipient, 'a friendly (Clan) Unit that links');
});

test('hybrid Command/Pilot cards are treated as Pilots', () => {
  const p = K.parse(card('COMMAND', '【Main】Choose 1 of your (MF) Units without &lt;Breach&gt;. It gains &lt;Breach 3&gt; during this turn. After activating this card\'s 【Main】, you may pair this card from your trash with one of your (MF) Units.<br>【Pilot】[Sai Saici]<br>'));
  assert.equal(p.kind, 'pilot');
  assert.equal(p.hybrid, true);
  assert.deepEqual(brief(p.grants), ['Breach 3'], '"without <Breach>" is a reference');
  assert.equal(p.grants[0].conditional, false);
});

test('Development: no icon of its own, the unlocked keyword is conditional', () => {
  const p = K.parse(card('UNIT', '【When Paired・Development 1】You may exile the specified number of (G Generation) cards in your trash from the game. If you do, activate the following effect:<br>\n■This Unit gains &lt;High-Maneuver&gt; during this turn.<br>\n(This Unit can&#039;t be blocked.)<br>'));
  assert.deepEqual(brief(p.conditional), ['High-Maneuver']);
  assert.deepEqual(p.conditional[0].timing, ['When Paired', 'Development 1']);
  assert.deepEqual(badges(card('UNIT', '【Deploy・Development 2】You may exile 2 cards. If you do, activate the following effect:<br>■Choose 1 friendly (G Generation) Unit. It gains &lt;Breach 1&gt; during this turn.', {trait: '(G Generation)'})), ['Conditional Breach 1']);
});

test('mentions of keywords that are not abilities are ignored', () => {
  for (const effect of [
    '【Attack】Choose 1 enemy Unit with &lt;Blocker&gt; that is Lv.5 or lower. Deal 2 damage to it.',
    '【Main】Deal 2 damage to all Units with &lt;Blocker&gt;.',
    '【Once per Turn】When this Unit activates &lt;Blocker&gt;, set it as active.',
    '【Attack】Units that are Lv.7 or lower can\'t activate &lt;Blocker&gt; during this battle.',
    '【Deploy】Choose 1 enemy Unit. Deal 1 damage to it. If it has &lt;Repair&gt;, deal 3 damage instead.',
    '【Deploy】Deploy 1 [Gozzo](･AP0･HP3･&lt;Blocker&gt;) Unit token.',
    '【Deploy】Deploy 1 [Pluma]((Calamity War)･AP2･HP1･&lt;Blocker&gt;) Unit token.',
    '【Activate･Main】【Once per Turn】①：Choose 1 Unit card with &lt;Repair&gt;/&lt;Breach&gt;/&lt;Blocker&gt; from any player\'s trash. During this turn, this Unit gets AP+1 and all &lt;Repair&gt;/&lt;Breach&gt;/&lt;Blocker&gt; on that Unit card.',
  ]) {
    const p = K.parse(card('UNIT', effect));
    assert.deepEqual([...p.fixed, ...p.conditional, ...p.grants], [], effect);
  }
  const both = K.parse(card('PILOT', '【During Link】While this Unit has &lt;Repair&gt;, it gains &lt;High-Maneuver&gt;.'));
  assert.deepEqual(brief(both.grants), ['High-Maneuver']);
});

test('keywords given to enemy Units are explained but not drawn', () => {
  const p = K.parse(card('UNIT', 'During your opponent\'s turn, the enemy Unit battling this Unit gains &lt;First Strike&gt;.'));
  assert.equal(p.grants[0].enemy, true);
  assert.deepEqual(K.handBadges(p), []);
  assert.equal(K.describe(p).length, 1);
});

test('a keyword printed in brackets is still a keyword', () => {
  const p = K.parse(card('PILOT', '【Burst】Add this card to your hand.\nWhile this Unit is (Alphacide), it gains 【Repair 2】.\n(At the end of your turn, this Unit recovers the specified number of HP.)'));
  assert.deepEqual(brief(p.grants), ['Repair 2']);
  assert.equal(p.grants[0].condition, 'While this Unit is (Alphacide)');
});

test('hand badges: fixed order, solid wins over dashed, variable amounts', () => {
  assert.deepEqual(badges(card('UNIT', '&lt;Blocker&gt;<br>While a friendly Base in play, this Unit gains &lt;Suppression&gt;.<br>&lt;Repair 1&gt;')),
    ['Repair 1', 'Blocker', 'Conditional Suppression']);
  assert.deepEqual(badges(card('UNIT', '&lt;Blocker&gt;<br>【During Pair】This Unit gains &lt;Blocker&gt;.')), ['Blocker']);
  const variable = K.parse(card('UNIT', 'This Unit gains the same number of &lt;Repair 1&gt; as the number of (Calamity War) Unit tokens you have in play.'));
  assert.equal(variable.conditional[0].variable, true);
});

test('parsing is cached per card text', () => {
  const c = {code: 'X-1', type: 'UNIT', effect: '&lt;Blocker&gt;'};
  assert.equal(K.forCard(c), K.forCard({...c}));
  assert.notEqual(K.forCard(c), K.forCard({...c, effect: '&lt;Repair 1&gt;'}));
});

// ---- Live keywords of Units in play ------------------------------------------------

const DB = {
  'U-BLOCK': {code: 'U-BLOCK', type: 'UNIT', effect: '&lt;Blocker&gt;'},
  'U-REPAIR': {code: 'U-REPAIR', type: 'UNIT', effect: '&lt;Repair 2&gt;'},
  'U-PAIR': {code: 'U-PAIR', type: 'UNIT', effect: '【During Pair】This Unit gains &lt;High-Maneuver&gt;.'},
  'U-AP': {code: 'U-AP', type: 'UNIT', effect: 'While this Unit has 5 or more AP, it gains &lt;Breach 3&gt;.'},
  'P-SUPPORT': {code: 'P-SUPPORT', type: 'PILOT', effect: '【Activate･Main】&lt;Support 2&gt; (Rest this Unit. 1 other friendly Unit gets AP+(specified amount) during this turn.)'},
  'P-BLUE': {code: 'P-BLUE', type: 'PILOT', effect: 'While this Unit is blue, it gains &lt;Repair 1&gt;.'},
};
const lookup = code => DB[code] || null;
const live = (code, extra = {}) => ({code, granted_keywords: [], passive_bonuses: [], paired: false, linked: false, pilot: null, ...extra});
const shown = list => list.map(b => `${b.keyword}${b.amount === null ? '' : ' ' + b.amount}`);

test('a printed always-on keyword shows as soon as the Unit is in play', () => {
  assert.deepEqual(shown(K.active(live('U-BLOCK'), lookup)), ['Blocker']);
});

test('keywords granted by other cards come from the engine, with their numbers', () => {
  const unit = live('U-BLOCK', {granted_keywords: [{kw: 'repair', n: 2, name: 'Repair Order'}, {kw: 'first_strike', name: 'X'}]});
  assert.deepEqual(shown(K.active(unit, lookup)), ['Repair 2', 'Blocker', 'First Strike']);
  assert.deepEqual(shown(K.active(live('U-BLOCK'), lookup)), ['Blocker'], 'gone when the engine drops it at end of turn');
});

test('copies of a numbered keyword add up', () => {
  const unit = live('U-REPAIR', {granted_keywords: [{kw: 'repair', n: 1, name: 'Pilot'}]});
  assert.deepEqual(shown(K.active(unit, lookup)), ['Repair 3']);
});

test('conditional abilities follow the engine\'s passive bonuses', () => {
  const off = live('U-AP', {passive_bonuses: [{desc: '<Breach 3>', condition: 'while 5 or more AP', source: 'self', active: false}]});
  assert.deepEqual(shown(K.active(off, lookup)), []);
  const on = live('U-AP', {passive_bonuses: [{desc: 'gains Breach 3', condition: 'while 5 or more AP', source: 'self', active: true}]});
  assert.deepEqual(shown(K.active(on, lookup)), ['Breach 3']);
  const stat = live('U-BLOCK', {passive_bonuses: [{desc: 'AP+2', condition: 'while Linked', source: 'self', active: true}]});
  assert.deepEqual(shown(K.active(stat, lookup)), ['Blocker'], 'stat bonuses add no icon');
});

test('pairing: the Pilot\'s unconditional grant and During Pair keywords, never twice', () => {
  const paired = live('U-PAIR', {paired: true, pilot: {code: 'P-SUPPORT', name: 'Nena Trinity'}});
  assert.deepEqual(shown(K.active(paired, lookup)), ['Support 2', 'High-Maneuver']);
  assert.deepEqual(shown(K.active(live('U-PAIR'), lookup)), [], 'nothing once the Pilot leaves');
  const reported = live('U-PAIR', {paired: true, pilot: {code: 'P-SUPPORT'},
    granted_keywords: [{kw: 'support', n: 2, name: 'Nena Trinity'}],
    passive_bonuses: [{desc: '<High-Maneuver>', condition: 'while Paired', source: 'self', active: true}]});
  assert.deepEqual(shown(K.active(reported, lookup)), ['Support 2', 'High-Maneuver'], 'the engine\'s report is not doubled');
  const conditional = live('U-BLOCK', {paired: true, pilot: {code: 'P-BLUE'}});
  assert.deepEqual(shown(K.active(conditional, lookup)), ['Blocker'], 'a conditional Pilot grant waits for the engine');
});

// ---- Review findings on PR #2 ---------------------------------------------------------

test('a keyword printed in square brackets with its reminder text is the card\'s own (Gundam X)', () => {
  const gundamX = card('UNIT', '[Suppression] (Damage to Shields by an attack is dealt to the first 2 cards simultaneously.)<br>【During Link】During your turn, while there are 7 or more cards in your trash, all your other (Vulture) Units get AP+2.<br>');
  assert.deepEqual(brief(K.parse(gundamX).fixed), ['Suppression']);
  assert.deepEqual(badges(gundamX), ['Suppression']);
  assert.deepEqual(shown(K.active(live('GX'), code => (code === 'GX' ? gundamX : null))), ['Suppression']);
  // Names in brackets stay names.
  for (const effect of ['【Deploy】Deploy 1 [Gozzo](･AP0･HP3･&lt;Blocker&gt;) Unit token.', '【Main】Draw 1.<br>【Pilot】[Sai Saici]<br>']) {
    const p = K.parse(card('COMMAND', effect));
    assert.deepEqual([...p.fixed, ...p.conditional, ...p.grants], [], effect);
  }
});

test('a Unit draws no circle for a keyword it gives only to other cards', () => {
  const kikeroga = card('UNIT', 'All your Unit tokens gain &lt;Breach 1&gt;.', {trait: '(Zeon)'});
  assert.deepEqual(badges(kikeroga), [], 'Kikeroga is not a token');
  assert.equal(K.describe(K.parse(kikeroga)).length, 1, 'still explained in the card view');
  assert.deepEqual(badges(card('UNIT TOKEN', 'All your Unit tokens gain &lt;Breach 1&gt;.')), ['Breach 1'], 'a token can receive it');
  const coreFighter = card('UNIT', 'While this Unit is rested, all your (League Militaire) Unit tokens gain &lt;Blocker&gt;.', {trait: '(League Militaire) (Victory Type)'});
  assert.deepEqual(badges(coreFighter), []);
  const plutone = card('UNIT', '【Once per Turn】When another Unit attacks an enemy Unit, if this Unit is rested, the attacking Unit gains &lt;Breach 2&gt; during this battle.', {trait: '(G Generation)'});
  assert.deepEqual(badges(plutone), []);
  assert.deepEqual(badges(card('UNIT', '【When Linked】Choose 1 of your other Units. It gains &lt;Repair 2&gt; during this turn.')), []);
  const otherTrait = card('UNIT', '【Once per Turn】When you place an EX Resource, choose 1 of your (AGE System) Units. It gains &lt;Breach 2&gt; during this turn.', {trait: '(Earth Federation)', color: 'Green'});
  assert.deepEqual(badges(otherTrait), [], 'the card lacks the trait');
});

test('a Unit still draws grants that can reach it, and a Base never does', () => {
  const gundam = card('UNIT', 'All your (white Base Team) Units gain &lt;Repair 1&gt;.', {trait: '(Earth Federation) (white Base Team)', color: 'Blue'});
  assert.deepEqual(badges(gundam), ['Repair 1'], 'the trait is the card\'s own; "white" there is no colour');
  assert.deepEqual(badges(card('UNIT', '【Deploy】Choose 1 of your Units. It gains &lt;Repair 1&gt; during this turn.')), ['Conditional Repair 1']);
  assert.deepEqual(badges(card('UNIT', 'While this Unit is rested, all Units gain &lt;Blocker&gt;.')), ['Conditional Blocker']);
  assert.deepEqual(badges(card('UNIT', '【Deploy】Choose 1 friendly Unit that is Lv.2 or lower. It gains &lt;First Strike&gt; during this turn.', {level: 4})), [], 'too high a level');
  const base = card('BASE', '【Once per Turn】When a friendly (Clan) Unit links, it gains &lt;Breach 3&gt; during this turn.', {trait: '(Clan) (Stronghold)'});
  assert.deepEqual(badges(base), []);
  assert.equal(K.describe(K.parse(base))[0].text.startsWith('Gives it to a friendly (Clan) Unit that links'), true);
  assert.deepEqual(badges(card('COMMAND', '【Main】Choose 1 of your other Units. It gains &lt;Repair 2&gt; during this turn.')), ['Repair 2'], 'a Command\'s grant is what it does');
});

// ---- Issue #10: alternate-art printings -------------------------------------------------

// The site's database keys base codes and lists alternate art under `variants`; hands, the
// field, the snapshot and the card view carry the printing's own code (ST01-001-p1).
const PRINTED = {
  'ST01-001': {code: 'ST01-001', type: 'UNIT', ap: 3, hp: 4, effect: '&lt;Repair 2&gt; (At the end of your turn, this Unit recovers the specified number of HP.)<br>',
    variants: [{code: 'ST01-001-p1', rarity: 'LR +'}, {code: 'ST01-001-p8', rarity: 'LR +'}]},
  'ST01-008': {code: 'ST01-008', type: 'UNIT', ap: 1, hp: 1, effect: '&lt;Blocker&gt; (Rest this Unit to change the attack target to it.)<br>'},
  'GD04-089': DB['P-SUPPORT'],
};

test('an alternate-art code resolves to its base card\'s printed data', () => {
  assert.equal(K.baseCode('ST01-001-p1'), 'ST01-001');
  assert.equal(K.baseCode('EB01-001-p12'), 'EB01-001');
  assert.equal(K.baseCode('ST01-001'), 'ST01-001');
  assert.equal(K.printed(PRINTED, 'ST01-001'), PRINTED['ST01-001']);
  assert.equal(K.printed(PRINTED, 'ST01-001-p1'), PRINTED['ST01-001']);
  assert.equal(K.printed(PRINTED, 'ST01-001-p8'), PRINTED['ST01-001']);
  assert.equal(K.printed({...PRINTED, 'ST01-001-p1': {code: 'own'}}, 'ST01-001-p1').code, 'own', 'an exact key wins');
  for (const code of ['ST99-001-p1', 'ST01-001-x1', '', null, undefined]) assert.equal(K.printed(PRINTED, code), null, String(code));
  assert.equal(K.printed(null, 'ST01-001'), null, 'before the site loads its database');
});

test('alternate-art Units in play keep their printed keywords and their Pilot\'s grant', () => {
  const lookupPrinted = code => K.printed(PRINTED, code);
  assert.deepEqual(shown(K.active(live('ST01-001-p1'), lookupPrinted)), ['Repair 2']);
  assert.deepEqual(shown(K.active(live('ST01-008-p2'), lookupPrinted)), ['Blocker']);
  const paired = live('ST01-001-p1', {paired: true, pilot: {code: 'GD04-089-p1', name: 'Nena Trinity'}});
  assert.deepEqual(shown(K.active(paired, lookupPrinted)), ['Repair 2', 'Support 2']);
});
