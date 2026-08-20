#!/usr/bin/env node
// Strips credentials and instance-specific fields from an n8n workflow export,
// then warns about anything left over that looks like a real ID or secret.
// Exits 1 on any warning so it can gate a commit.
//
// Usage: node scripts/sanitize.mjs input.raw.json output.json

import { readFileSync, writeFileSync } from 'node:fs';

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/sanitize.mjs <input.raw.json> <output.json>');
  process.exit(2);
}

let workflow;
try {
  workflow = JSON.parse(readFileSync(inputPath, 'utf8'));
} catch (err) {
  console.error(`Cannot read ${inputPath}: ${err.message}`);
  process.exit(2);
}

/* ---------- strip ---------- */

const strippedTopLevel = [];

for (const key of ['pinData', 'id', 'versionId', 'tags', 'active']) {
  if (key in workflow) {
    delete workflow[key];
    strippedTopLevel.push(key);
  }
}

if (workflow.meta && 'instanceId' in workflow.meta) {
  delete workflow.meta.instanceId;
  strippedTopLevel.push('meta.instanceId');
  if (Object.keys(workflow.meta).length === 0) delete workflow.meta;
}

const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
let credentialsRemoved = 0;
let webhookIdsRemoved = 0;

for (const node of nodes) {
  if (node && typeof node === 'object') {
    if ('credentials' in node) { delete node.credentials; credentialsRemoved++; }
    if ('webhookId' in node) { delete node.webhookId; webhookIdsRemoved++; }
  }
}

/* ---------- scan ---------- */

// Matched text that is obviously a stand-in, not a real value.
const LOOKS_LIKE_PLACEHOLDER = /placeholder|replace_?with|your[_ -]|example\.(com|org)|dummy|xxxx/i;

const PATTERNS = [
  { kind: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: 'bearer token', re: /bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi },
  {
    kind: 'api key',
    re: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|\bxox[baprse]-[A-Za-z0-9-]{10,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAIza[A-Za-z0-9_-]{20,}|\bAKIA[A-Z0-9]{12,}|\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./g,
  },
  { kind: 'url with query string', re: /https?:\/\/[^\s"'<>]+\?[^\s"'<>]+/g },
];

// Word-ish tokens, checked one by one for shape-based IDs.
const TOKEN = /[A-Za-z0-9_-]+/g;

const warnings = [];
const seen = new Set();

function warn(kind, path, match) {
  if (LOOKS_LIKE_PLACEHOLDER.test(match)) return;
  const key = `${kind}|${path}|${match}`;
  if (seen.has(key)) return;
  seen.add(key);
  warnings.push({ kind, path, match });
}

function scanString(value, path) {
  for (const { kind, re } of PATTERNS) {
    for (const match of value.match(re) ?? []) warn(kind, path, match);
  }

  for (const token of value.match(TOKEN) ?? []) {
    if (token.length === 44 && /[A-Za-z]/.test(token) && /[0-9]/.test(token)) {
      warn('google sheets document id', path, token);
    }
    if (/^-?[0-9]{9,}$/.test(token)) {
      warn('bare numeric id (telegram chat id?)', path, token);
    }
  }
}

function walk(value, path) {
  if (typeof value === 'string') {
    scanString(value, path);
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      walk(child, path ? `${path}.${key}` : key);
    }
  }
}

walk(workflow, '');

/* ---------- write + report ---------- */

writeFileSync(outputPath, `${JSON.stringify(workflow, null, 2)}\n`);

const truncate = (s) => (s.length > 120 ? `${s.slice(0, 117)}...` : s);

for (const { kind, path, match } of warnings) {
  console.warn(`WARNING  [${kind}]  ${path}\n         ${truncate(match)}`);
}

console.log(`\n${inputPath} -> ${outputPath}`);
console.log(`  nodes:              ${nodes.length}`);
console.log(`  credentials removed: ${credentialsRemoved} node(s)`);
console.log(`  webhookId removed:   ${webhookIdsRemoved} node(s)`);
console.log(`  top-level stripped:  ${strippedTopLevel.join(', ') || 'nothing'}`);

if (warnings.length > 0) {
  console.log(`  warnings:            ${warnings.length} (nothing was modified - fix by hand)`);
  process.exit(1);
}

console.log('  warnings:            none');
