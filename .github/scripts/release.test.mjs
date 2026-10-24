import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {bumpOf, nextVersion, versionCode, plan, planRepo, changelogEntry, insertChangelog, releaseNotes, setVersionText} from './release.mjs';

test('commit title prefixes set the release', () => {
  assert.equal(bumpOf('feat: show card previews'), 'minor');
  assert.equal(bumpOf('fix: keep the hand visible'), 'patch');
  assert.equal(bumpOf('perf: faster board sync'), 'patch');
  assert.equal(bumpOf('feat!: new board'), 'major');
  assert.equal(bumpOf('fix!: drop old settings'), 'major');
  for (const t of ['docs: readme', 'build: gradle', 'ci: x', 'refactor: y', 'chore: z', 'test: t',
    'Release 0.9.0', 'perf!: x', 'feature: x', 'feat(board): scoped', 'fixes: x', 'Feat: x'])
    assert.equal(bumpOf(t), 'none', t);
});

test('next version and a versionCode that always increases', () => {
  assert.equal(nextVersion('0.8.9', 'minor'), '0.9.0');
  assert.equal(nextVersion('0.8.9', 'patch'), '0.8.10');
  assert.equal(nextVersion('0.8.9', 'major'), '1.0.0');
  assert.equal(nextVersion('0.8.9', 'none'), null);
  assert.equal(versionCode('1.0.0'), 1000000);
  const seq = ['0.8.10', '0.8.11', '0.9.0', '0.9.1', '0.10.0', '1.0.0', '1.0.1', '2.0.0'];
  for (let i = 1; i < seq.length; i++) assert.ok(versionCode(seq[i]) > versionCode(seq[i - 1]), seq[i]);
  assert.throws(() => versionCode('0.1000.0'));
});

test('the highest bump of several commits wins; others are ignored', () => {
  const p = plan({current: '1.0.0', date: '2026-10-10', commits: [
    {sha: 'a', title: 'fix: a', body: 'A body'},
    {sha: 'b', title: 'docs: b', body: ''},
    {sha: 'c', title: 'feat: c', body: 'C body'}]});
  assert.equal(p.bump, 'minor');
  assert.equal(p.next, '1.1.0');
  assert.deepEqual(p.commits.map(c => c.sha), ['a', 'c']);
  assert.equal(changelogEntry(p), '## 1.1.0 — 2026-10-10\n\n- A\n- C\n');
  assert.equal(releaseNotes(p), '### fix: a\n\nA body\n\n### feat: c\n\nC body\n');
  assert.equal(plan({current: '1.0.0', date: 'd', commits: [{sha: 'b', title: 'docs: b', body: ''}]}).next, null);
});

test('one released commit: its body is the release notes', () => {
  const p = plan({current: '1.0.0', date: 'd', commits: [{sha: 'a', title: 'fix: hand', body: 'Details.\n'}]});
  assert.equal(releaseNotes(p), 'Details.\n');
  assert.equal(releaseNotes({commits: [{title: 'fix: hand', body: ''}]}), 'fix: hand\n');
});

test('the changelog entry goes above the newest release', () => {
  const log = '# Changelog\n\nIntro.\n\n## 0.8.9 — 2026-10-06\n\n- old\n';
  assert.equal(insertChangelog(log, '## 0.9.0 — d\n\n- new\n'),
    '# Changelog\n\nIntro.\n\n## 0.9.0 — d\n\n- new\n\n## 0.8.9 — 2026-10-06\n\n- old\n');
  assert.equal(insertChangelog('# Changelog\n\nIntro.\n', '## 1.0.0 — d\n\n- first\n'),
    '# Changelog\n\nIntro.\n\n## 1.0.0 — d\n\n- first\n');
  const first = '# Changelog\n\n## 1.0.0 — 2026-10-24\n\n- First release\n';
  assert.equal(insertChangelog(first, '## 1.0.0 — 2026-10-25\n\n- other\n'), first);
});

test('version files get the version and its versionCode', () => {
  const out = setVersionText({manifest: '{\n  "manifest_version": 3,\n  "name": "x",\n  "version": "1.0.0"\n}\n',
    gradle: "        versionCode 1000000\n        versionName '1.0.0'\n"}, '1.2.0');
  assert.match(out.manifest, /"version": "1.2.0"/);
  assert.match(out.manifest, /"manifest_version": 3/);
  assert.equal(out.gradle, "        versionCode 1002000\n        versionName '1.2.0'\n");
});

test('the first release uses the manifest version, then each tag is the baseline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-'));
  const git = (...a) => execFileSync('git', a, {cwd: dir, stdio: 'ignore',
    env: {...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t'}});
  try {
    git('init', '-q');
    git('commit', '-q', '--allow-empty', '-m', 'Initial commit');
    mkdirSync(join(dir, 'extension'));
    writeFileSync(join(dir, 'extension/manifest.json'), '{\n  "manifest_version": 3,\n  "version": "1.0.0"\n}\n');
    git('add', '-A'); git('commit', '-qm', 'docs: add the manifest');
    assert.equal(planRepo({cwd: dir, date: 'd'}).next, null); // nothing to release yet
    git('commit', '-q', '--allow-empty', '-m', 'feat: first features', '-m', 'Body.');
    const first = planRepo({cwd: dir, date: 'd'});
    assert.equal(first.next, '1.0.0');
    assert.deepEqual(first.commits.map(c => c.title), ['feat: first features']);
    git('tag', 'v1.0.0');
    git('commit', '-q', '--allow-empty', '-m', 'fix: later');
    const later = planRepo({cwd: dir, date: 'd'});
    assert.equal(later.range, 'v1.0.0..HEAD');
    assert.equal(later.next, '1.0.1');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
