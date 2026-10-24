#!/usr/bin/env node
// Version, changelog and release notes for the release workflow.
//
//   node .github/scripts/release.mjs plan [--date YYYY-MM-DD]
//       Print the release plan as JSON: the first-parent commits since the last v* tag,
//       their bumps and the next version. With no tag yet, the first release uses the
//       manifest version as it is.
//   node .github/scripts/release.mjs apply PLAN.json NOTES.md
//       Write the planned version to the extension manifest, the Android build and
//       CHANGELOG.md, and the release notes to NOTES.md.
//   node .github/scripts/release.mjs set-version X.Y.Z
//       Write a version and its versionCode without a changelog.
//
// Commit titles set the bump: "feat: …" is a minor release, "fix: …" or "perf: …" a patch
// release, and "feat!: …" or "fix!: …" a major release. Other titles do not release.
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST = 'extension/manifest.json';
const GRADLE = 'android/app/build.gradle';
const CHANGELOG = 'CHANGELOG.md';
const ORDER = ['none', 'patch', 'minor', 'major'];

export function bumpOf(title) {
  const m = /^(feat|fix|perf)(!?):\s/.exec(title);
  if (!m) return 'none';
  if (m[2]) return m[1] === 'perf' ? 'none' : 'major';
  return m[1] === 'feat' ? 'minor' : 'patch';
}

export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`not a MAJOR.MINOR.PATCH version: ${v}`);
  return m.slice(1).map(Number);
}

export function nextVersion(current, bump) {
  const [a, b, c] = parseVersion(current);
  if (bump === 'major') return `${a + 1}.0.0`;
  if (bump === 'minor') return `${a}.${b + 1}.0`;
  if (bump === 'patch') return `${a}.${b}.${c + 1}`;
  return null;
}

// Increases with the version while minor and patch stay below 1000.
export function versionCode(version) {
  const [a, b, c] = parseVersion(version);
  if (b >= 1000 || c >= 1000) throw new Error(`minor/patch must stay below 1000: ${version}`);
  return a * 1_000_000 + b * 1000 + c;
}

// first: no release yet, so the manifest version is released as it is.
export function plan({current, commits, date, first = false}) {
  const releasing = commits.map(c => ({...c, bump: bumpOf(c.title)})).filter(c => c.bump !== 'none');
  const bump = releasing.reduce((best, c) => ORDER.indexOf(c.bump) > ORDER.indexOf(best) ? c.bump : best, 'none');
  const next = first ? (releasing.length ? current : null) : nextVersion(current, bump);
  return {current, bump: first ? 'first' : bump, next, versionCode: next && versionCode(next), date, commits: releasing};
}

// One changelog line per released commit title, without its type prefix.
export function changelogEntry(p) {
  const lines = p.commits.map(c => {
    const text = c.title.replace(/^[a-z]+!?:\s*/, '');
    return `- ${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  });
  return `## ${p.next} — ${p.date}\n\n${lines.join('\n')}\n`;
}

// An entry already there for the version (the first release's, written by hand) stays as it is.
export function insertChangelog(changelog, entry) {
  if (changelog.includes(entry.slice(0, entry.indexOf(' —') + 2))) return changelog;
  const at = changelog.search(/^## /m);
  if (at < 0) return `${changelog.trimEnd()}\n\n${entry}`;
  return `${changelog.slice(0, at)}${entry}\n${changelog.slice(at)}`;
}

// The commit bodies become the release notes.
export function releaseNotes(p) {
  if (p.commits.length === 1) return `${p.commits[0].body.trim() || p.commits[0].title}\n`;
  return p.commits.map(c => `### ${c.title}\n\n${c.body.trim()}`.trim()).join('\n\n') + '\n';
}

export function setVersionText({manifest, gradle}, version) {
  const code = versionCode(version);
  const m = manifest.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);
  const g = gradle.replace(/versionCode \d+/, `versionCode ${code}`).replace(/versionName (['"])[^'"]+\1/, (_, q) => `versionName ${q}${version}${q}`);
  if (m === manifest && !manifest.includes(`"${version}"`)) throw new Error('manifest version not found');
  if (!/versionCode \d+/.test(gradle) || !/versionName ['"]/.test(gradle)) throw new Error('build.gradle version not found');
  return {manifest: m, gradle: g};
}

function git(cwd, ...args) {
  return execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
}

export function readCommits(cwd, range) {
  const out = git(cwd, 'log', '--first-parent', '--reverse', '--format=%H%x1f%s%x1f%b%x1e', range);
  return out.split('\x1e').map(r => r.trim()).filter(Boolean).map(r => {
    const [sha, title, body = ''] = r.split('\x1f');
    return {sha, title, body};
  });
}

// The latest v* tag, or null before the first release.
export function lastTag(cwd) {
  try {
    return git(cwd, 'describe', '--tags', '--match', 'v[0-9]*', '--abbrev=0', 'HEAD').trim();
  } catch {
    return null;
  }
}

export function planRepo({cwd = ROOT, date}) {
  const tag = lastTag(cwd);
  if (tag) return {...plan({current: tag.slice(1), commits: readCommits(cwd, `${tag}..HEAD`), date}), range: `${tag}..HEAD`};
  const current = JSON.parse(readFileSync(join(cwd, MANIFEST), 'utf8')).version;
  return {...plan({current, commits: readCommits(cwd, 'HEAD'), date, first: true}), range: 'HEAD'};
}

function read(rel) { return readFileSync(join(ROOT, rel), 'utf8'); }
function write(rel, text) { writeFileSync(join(ROOT, rel), text); }

function main([cmd, ...args]) {
  const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  if (cmd === 'plan') {
    const date = opt('--date') ?? new Date().toISOString().slice(0, 10);
    process.stdout.write(JSON.stringify(planRepo({date}), null, 1) + '\n');
  } else if (cmd === 'apply') {
    const p = JSON.parse(readFileSync(args[0], 'utf8'));
    if (!p.next) throw new Error('the plan has no release');
    const v = setVersionText({manifest: read(MANIFEST), gradle: read(GRADLE)}, p.next);
    write(MANIFEST, v.manifest); write(GRADLE, v.gradle);
    write(CHANGELOG, insertChangelog(read(CHANGELOG), changelogEntry(p)));
    writeFileSync(args[1], releaseNotes(p));
  } else if (cmd === 'set-version') {
    const v = setVersionText({manifest: read(MANIFEST), gradle: read(GRADLE)}, args[0]);
    write(MANIFEST, v.manifest); write(GRADLE, v.gradle);
    console.log(`version -> ${args[0]} (code ${versionCode(args[0])})`);
  } else {
    console.error('usage: release.mjs plan [--date D] | apply PLAN.json NOTES.md | set-version X.Y.Z');
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
