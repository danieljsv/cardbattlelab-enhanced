// Settings menu: the additions it turns on and off, and how the setting reaches the page.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';

const F = createRequire(import.meta.url)('../extension/overlay/features.js');
const read = name => readFileSync(new URL(`../extension/overlay/${name}`, import.meta.url), 'utf8');

test('one switch per addition, every key unique', () => {
  assert.deepEqual(F.KEYS, ['foil', 'handInfo', 'playableGlow', 'handCount', 'fieldInfo', 'resourceCount',
    'printedAbilities', 'viewStats']);
  for (const f of F.FEATURES) {
    assert.ok(f.group && f.name && f.text, f.key);
    assert.match(f.key, /^[a-zA-Z]+$/); // safe in a space-separated attribute and a CSS selector
  }
});

test('everything is on by default: only an explicit false turns an addition off', () => {
  assert.deepEqual(F.off(undefined), []);
  assert.deepEqual(F.off(null), []);
  assert.deepEqual(F.off({}), []);
  assert.deepEqual(F.off('handInfo'), []);
  assert.deepEqual(F.off({handInfo: true, foil: 0, fieldInfo: null}), []);
  // In menu order, whatever order they were saved in; unknown keys are ignored.
  assert.deepEqual(F.off({handInfo: false, foil: false, retired: false}), ['foil', 'handInfo']);
  assert.equal(F.attr({handInfo: false, foil: false}), 'foil handInfo');
  assert.equal(F.attr({}), '');
});

test('the page attribute reads back as the set turned off', () => {
  assert.deepEqual([...F.parse(null)], []); // the Android app: no attribute, all on
  assert.deepEqual([...F.parse('')], []);
  assert.deepEqual([...F.parse(' handInfo  foil retired ')], ['handInfo', 'foil']); // as written
  for (const key of F.KEYS) assert.deepEqual([...F.parse(F.attr({[key]: false}))], [key]);
});

test('the overlay and its stylesheet check every switch they draw for', () => {
  const js = read('overlay.js');
  const css = read('overlay.css');
  for (const key of F.KEYS) {
    assert.ok(js.includes(`on('${key}')`) || css.includes(`[${F.ATTR}~="${key}"]`), key);
  }
});
