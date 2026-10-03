// The trust guarantees: Gemma may only cite fetched files, and code shown is always real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ground, groundPatch } from '../pipeline.js';

const dashboard = [
  "import { useState } from 'react';",
  '',
  'export default function Dashboard({ user }) {',
  '  return (',
  '    <main>',
  '      <h2 className="welcome">{`Welcome back, ${user.fullname}!`}</h2>',
  '    </main>',
  '  );',
  '}',
  '',
].join('\n');
const files = new Map([['src/Dashboard.jsx', dashboard]]);

const diagnosis = (evidence, extra = {}) => ({
  root_cause: 'x', fix: 'y', labels: [], difficulty: 'easy', confidence: 'high', patch: null, evidence, ...extra,
});

test('drops evidence for files that were not fetched', () => {
  const g = ground(diagnosis([
    { file: 'src/Dashboard.jsx', line: 6, note: 'real' },
    { file: 'src/hooks/useUser.js', line: 3, note: 'hallucinated' },
  ]), files);
  assert.equal(g.evidence.length, 1);
  assert.equal(g.evidence[0].file, 'src/Dashboard.jsx');
  assert.equal(g.dropped, 1);
});

test('forces low confidence when no evidence survives', () => {
  const g = ground(diagnosis([{ file: 'nope.js', line: 1 }]), files);
  assert.equal(g.evidence.length, 0);
  assert.equal(g.confidence, 'low');
});

test('clamps line numbers to the file and ignores the trailing newline', () => {
  const g = ground(diagnosis([{ file: 'src/Dashboard.jsx', line: 999 }]), files);
  assert.equal(g.evidence[0].line, 9);
  const low = ground(diagnosis([{ file: 'src/Dashboard.jsx', line: -4 }]), files);
  assert.equal(low.evidence[0].line, 1);
});

test('snippets come from the file, never from the model', () => {
  const g = ground(diagnosis([{ file: './src/Dashboard.jsx', line: 6, code: 'MODEL MADE THIS UP' }]), files);
  const ev = g.evidence[0];
  assert.equal(ev.code, undefined);
  assert.equal(ev.snippet.find((l) => l.n === 6).text, '      <h2 className="welcome">{`Welcome back, ${user.fullname}!`}</h2>');
  assert.ok(ev.snippet.every((l) => dashboard.split('\n')[l.n - 1] === l.text));
});

test('a patch is kept only when its before-line really exists', () => {
  const before = '<h2 className="welcome">{`Welcome back, ${user.fullname}!`}</h2>';
  const p = groundPatch({ file: 'src/Dashboard.jsx', line: 2, before, after: '<h2 className="welcome">{`Welcome back, ${user.name}!`}</h2>' }, files);
  assert.equal(p.line, 6, 'moves to the line where the text really is');
  assert.ok(p.before.startsWith('      <h2'), 'before is the real line, indentation included');
  assert.ok(p.after.startsWith('      <h2') && p.after.includes('user.name'), 'after keeps the indentation');

  assert.equal(groundPatch({ file: 'src/Dashboard.jsx', line: 6, before: 'invented()', after: 'x' }, files), null);
  assert.equal(groundPatch({ file: 'other.js', line: 6, before, after: 'x' }, files), null);
  assert.equal(groundPatch({ file: 'src/Dashboard.jsx', line: 6, before, after: before }, files), null, 'no-op patch');
  assert.equal(groundPatch(null, files), null);
});
