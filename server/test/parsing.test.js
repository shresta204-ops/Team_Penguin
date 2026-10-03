import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJson } from '../gemma.js';
import { parseIssueUrl, parseRepo, findImageUrl } from '../github.js';
import { cleanPrefix, numberLines } from '../search.js';
import { diagnosisComment, askReporterComment } from '../comment.js';

test('parseJson strips code fences and surrounding text', () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJson('Sure! {"b":2} hope that helps'), { b: 2 });
  assert.throws(() => parseJson('no json here'));
});

test('parseIssueUrl accepts issue links and rejects anything else', () => {
  assert.deepEqual(parseIssueUrl('https://github.com/shresta204-ops/Team_Penguin/issues/1'), { owner: 'shresta204-ops', repo: 'Team_Penguin', number: 1 });
  assert.deepEqual(parseIssueUrl('https://github.com/a/b/issues/12#issuecomment-3'), { owner: 'a', repo: 'b', number: 12 });
  for (const bad of ['', 'nope', 'https://github.com/a/b/pull/3', 'https://gitlab.com/a/b/issues/1']) {
    assert.throws(() => parseIssueUrl(bad), (err) => err.status === 400);
  }
});

test('parseRepo accepts owner/repo, repo links and .git URLs', () => {
  for (const input of ['a/b', 'https://github.com/a/b', 'https://github.com/a/b.git', 'https://github.com/a/b/issues/4']) {
    assert.deepEqual(parseRepo(input), { owner: 'a', repo: 'b' });
  }
  assert.throws(() => parseRepo('just-a-name'), (err) => err.status === 400);
});

test('findImageUrl returns the first image, markdown or HTML', () => {
  assert.equal(findImageUrl('text ![shot](https://x.com/a.png) and <img src="https://x.com/b.png">'), 'https://x.com/a.png');
  assert.equal(findImageUrl('<img width="3" src="https://github.com/user-attachments/assets/abc"> ![x](https://x.com/b.png)'), 'https://github.com/user-attachments/assets/abc');
  assert.equal(findImageUrl('no image'), null);
});

test('cleanPrefix normalizes folder filters', () => {
  assert.equal(cleanPrefix('demo-repo'), 'demo-repo/');
  assert.equal(cleanPrefix('./demo-repo/'), 'demo-repo/');
  assert.equal(cleanPrefix('/packages/web//'), 'packages/web/');
  assert.equal(cleanPrefix('  '), '');
});

test('numberLines numbers from 1 and drops the trailing newline and CRs', () => {
  assert.deepEqual(numberLines('a\r\nb\n'), [{ n: 1, text: 'a' }, { n: 2, text: 'b' }]);
});

test('comments carry real code and only ask for missing details when asked', () => {
  const diagnosis = {
    root_cause: 'reads fullname', fix: 'use name', difficulty: 'easy', confidence: 'high',
    evidence: [{ file: 'src/D.jsx', line: 2, note: 'here', snippet: [{ n: 2, text: 'const x = user.fullname;' }] }],
    patch: { file: 'src/D.jsx', line: 2, before: 'const x = user.fullname;', after: 'const x = user.name;' },
  };
  const md = diagnosisComment({ look: { what_is_wrong: 'shows undefined' }, diagnosis, labels: ['bug', 'good first issue'], similar: [{ number: 7 }] });
  assert.match(md, /`src\/D\.jsx:2`/);
  assert.match(md, /const x = user\.fullname;/);
  assert.match(md, /- const x = user\.fullname;\n\+ const x = user\.name;/);
  assert.match(md, /Possibly related:\*\* #7/);

  const ask = askReporterComment({ look: { missing_details: ['Which page shows it?'] } });
  assert.match(ask, /Which page shows it\?/);
  assert.match(ask, /Steps to reproduce/);
  assert.doesNotMatch(ask, /Root cause/);
});
