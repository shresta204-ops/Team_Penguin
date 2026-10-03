// Builders for the draft triage comment (markdown). The maintainer edits it before posting.

const FOOTER = '\n---\n<sub>Drafted by TraceLens with Gemma 4, reviewed by a maintainer before posting.</sub>\n';

export function diagnosisComment({ look, diagnosis, labels, similar = [] }) {
  const out = [];
  out.push('### Triage');
  out.push('');
  out.push(`**What is wrong:** ${look.what_is_wrong || 'n/a'}`);
  if (look.expected_result) out.push(`**Expected:** ${look.expected_result}`);
  out.push('');
  out.push(`**Root cause:** ${diagnosis.root_cause || 'Not determined.'}`);
  out.push('');

  if (diagnosis.evidence.length) {
    out.push('**Evidence**');
    out.push('');
    for (const ev of diagnosis.evidence) {
      out.push(`- \`${ev.file}:${ev.line}\`${ev.note ? ` - ${ev.note}` : ''}`);
      out.push('');
      out.push(`  \`\`\`${fenceLang(ev.file)}`);
      for (const l of ev.snippet) out.push(`  ${String(l.n).padStart(3)}  ${l.text}`);
      out.push('  ```');
      out.push('');
    }
  } else {
    out.push('**Evidence:** no code location could be confirmed in the fetched files.');
    out.push('');
  }

  out.push(`**Suggested fix:** ${diagnosis.fix || 'n/a'}`);
  out.push('');
  if (diagnosis.patch) {
    const p = diagnosis.patch;
    out.push(`\`${p.file}:${p.line}\``);
    out.push('```diff');
    out.push(`- ${p.before}`);
    out.push(`+ ${p.after}`);
    out.push('```');
    out.push('');
  }
  if (similar.length) {
    out.push(`**Possibly related:** ${similar.map((i) => `#${i.number}`).join(', ')}`);
    out.push('');
  }
  out.push(`**Difficulty:** ${diagnosis.difficulty} · **Confidence:** ${diagnosis.confidence}`);
  if (labels.length) out.push(`**Suggested labels:** ${labels.map((l) => `\`${l}\``).join(', ')}`);
  if (labels.includes('good first issue')) {
    out.push('');
    out.push('This looks like a good first issue: the fix is small and the file above is the place to start.');
  }
  out.push(FOOTER);
  return out.join('\n');
}

export function askReporterComment({ look }) {
  const defaults = ['Which page or screen this happens on', 'Steps to reproduce', 'What you expected to see instead'];
  const asked = look.missing_details?.length ? look.missing_details : defaults;
  // Always cover page, steps and expected result.
  const extra = defaults.filter((d) => !asked.some((a) => sameTopic(a, d)));

  return [
    'Thanks for the report! We looked at the screenshot but could not tell what is going wrong yet, and we would rather ask than guess.',
    '',
    'Could you add the following?',
    '',
    ...[...asked, ...extra].map((d) => `- ${capitalize(d)}`),
    '',
    'A screenshot that shows the broken part (with the page URL visible, if possible) helps a lot.',
    FOOTER,
  ].join('\n');
}

function sameTopic(a, b) {
  const topics = [/page|screen|url|route/i, /step|reproduc/i, /expect/i];
  return topics.some((t) => t.test(a) && t.test(b));
}

function capitalize(s) {
  const t = String(s).trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function fenceLang(file) {
  const ext = file.split('.').pop();
  return { js: 'js', jsx: 'jsx', ts: 'ts', tsx: 'tsx', vue: 'vue', svelte: 'svelte', html: 'html', css: 'css' }[ext] || '';
}
