#!/usr/bin/env node
// Checks that every translation key used in src/ exists in both locales, that both locales have the
// same keys, and that plural keys have the forms each language needs.
// Usage: node scripts/check-i18n.mjs [--list]   (--list prints the keys found in code)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const LOCALES = { 'sr-Latn': ['one', 'few', 'other'], en: ['one', 'other'] };
const SUFFIX = /_(zero|one|two|few|many|other)$/;

function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}
function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|mjs)$/.test(f) ? [p] : [];
  });
}

const locales = Object.fromEntries(Object.keys(LOCALES).map((l) => [l, flatten(JSON.parse(readFileSync(join(root, `src/i18n/locales/${l}.json`), 'utf8')))]));
const namespaces = new Set([...locales['sr-Latn'].keys()].map((k) => k.split('.')[0]));
const baseKeys = (m) => new Set([...m.keys()].map((k) => k.replace(SUFFIX, '')));
const bases = Object.fromEntries(Object.entries(locales).map(([l, m]) => [l, baseKeys(m)]));

const used = new Map(); // key -> first file
const prefixes = new Map(); // dynamic `ns.x.${...}` prefixes
const NS_RE = /^(errors|validation|nav|common|auth|household|settings|tasks|status|priority|categories|recurrence|filters|rooms|cleaning|shopping|meals|budget|vehicles|pets|plants|calendar|dashboard|notifications|activity|files|units|languages|roles|welcome|join|app|offline|workload|setup|pwa)\./;
for (const f of files(join(root, 'src'))) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/['"]([a-z][a-zA-Z]*\.[a-zA-Z0-9_.]+)['"]/g)) {
    if (NS_RE.test(m[1]) && !/\.(tsx?|json|svg|png|css|js)$/.test(m[1])) if (!used.has(m[1])) used.set(m[1], f.slice(root.length));
  }
  for (const m of src.matchAll(/`([a-z][a-zA-Z]*(?:\.[a-zA-Z0-9_]+)*)\.\$\{/g)) {
    if (NS_RE.test(m[1] + '.')) prefixes.set(m[1], f.slice(root.length));
  }
}

if (process.argv.includes('--list')) {
  console.log([...used.keys()].sort().join('\n'));
  console.log('\n# dynamic prefixes\n' + [...prefixes.keys()].sort().join('\n'));
  process.exit(0);
}

const problems = [];
for (const [key, file] of used) {
  for (const l of Object.keys(LOCALES)) if (!bases[l].has(key)) problems.push(`missing in ${l}: ${key}  (${file})`);
}
for (const [p, file] of prefixes) {
  for (const l of Object.keys(LOCALES)) {
    if (![...bases[l]].some((k) => k.startsWith(p + '.'))) problems.push(`missing group in ${l}: ${p}.*  (${file})`);
  }
}
const [a, b] = Object.keys(LOCALES);
for (const k of bases[a]) if (!bases[b].has(k)) problems.push(`only in ${a}: ${k}`);
for (const k of bases[b]) if (!bases[a].has(k)) problems.push(`only in ${b}: ${k}`);
for (const [l, forms] of Object.entries(LOCALES)) {
  const m = locales[l];
  const plural = new Set([...m.keys()].filter((k) => SUFFIX.test(k)).map((k) => k.replace(SUFFIX, '')));
  for (const base of plural) for (const f of forms) if (!m.has(`${base}_${f}`)) problems.push(`plural form missing in ${l}: ${base}_${f}`);
  for (const [k, v] of m) if (typeof v !== 'string' || !v.trim()) problems.push(`empty value in ${l}: ${k}`);
}
// placeholders must match between languages
for (const [k, v] of locales[a]) {
  const other = locales[b].get(k) ?? locales[b].get(k.replace(SUFFIX, '_other'));
  if (typeof other !== 'string') continue;
  const vars = (s) => [...s.matchAll(/\{\{(\w+)/g)].map((x) => x[1]).filter((x) => x !== 'count').sort().join(',');
  if (vars(v) !== vars(other)) problems.push(`placeholders differ: ${k}  (${vars(v)} vs ${vars(other)})`);
}

void namespaces;
if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`i18n OK: ${used.size} static keys, ${prefixes.size} dynamic groups, ${bases[a].size} keys per locale`);
