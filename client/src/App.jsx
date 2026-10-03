import React, { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Icon, GithubMark, Spark, Penguin } from './icons.jsx';

export const APP_NAME = 'TraceLens';
const TAGLINE = 'See the bug. Trace the code.';
const TEAM = 'Team Penguin';

const STEPS = ['Issue & screenshot', 'Gemma analysis', 'Code search', 'Diagnosis', 'Triage comment'];
const STAGE_STEP = { fetching: 0, looking: 1, searching: 2, diagnosing: 3 };

export default function App() {
  const [view, setView] = useState('home');
  const [model, setModel] = useState('');
  const [issueUrl, setIssueUrl] = useState('');
  const [upload, setUpload] = useState(null); // { name, mimeType, data }
  const [stage, setStage] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [comment, setComment] = useState('');
  const [labels, setLabels] = useState([]);

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then((h) => setModel(h.model)).catch(() => setModel('server offline'));
    const saved = new URLSearchParams(location.search).get('saved');
    if (saved) runTriage({ saved });
  }, []);

  const busy = stage !== null;

  function show(r) {
    setResult(r);
    setIssueUrl(r.issue.url);
    setComment(r.comment);
    setLabels(r.labels);
    setView('home');
  }

  async function runTriage(body) {
    setError(null);
    setResult(null);
    setStage('fetching');
    try {
      const res = await fetch('/api/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) throw new Error(`Server returned ${res.status}. Is the server running on port 8787?`);
      let final = null;
      await readLines(res.body, (msg) => {
        if (msg.stage) setStage(msg.stage);
        if (msg.result || msg.error) final = msg;
      });
      if (!final) throw new Error('The server closed the connection early. Check the server log and try again.');
      if (final.error) return setError({ message: final.error, needsUpload: final.needsUpload });
      const r = { ...final.result, finishedAt: Date.now() };
      show(r);
      setHistory((h) => [r, ...h.filter((x) => x.issue.url !== r.issue.url)].slice(0, 8));
    } catch (err) {
      setError({ message: err.message || 'Could not reach the server. Start it with "npm start" in server/.' });
    } finally {
      setStage(null);
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    if (!issueUrl.trim()) return setError({ message: 'Paste a GitHub issue link first, like https://github.com/owner/repo/issues/12.' });
    runTriage(upload ? { issueUrl, imageBase64: upload.data, mimeType: upload.mimeType } : { issueUrl });
  }

  const repoName = useMemo(() => issueUrl.match(/github\.com\/([\w.-]+\/[\w.-]+)/)?.[1] || 'No repository', [issueUrl]);

  return (
    <div className="shell">
      <Sidebar view={view} setView={setView} historyCount={history.length} />

      <div className="content">
        <header className="topbar">
          <span className="topbar-item"><GithubMark /> {repoName}</span>
          <span className="topbar-item secondary">Model <code>{model || '...'}</code></span>
          <span className="topbar-item"><span className="avatar">TP</span> {TEAM}</span>
        </header>

        <div className="columns">
          <main className="main">
            {view === 'home' && (
              <>
                <div className="hero">
                  <h1>Welcome back, {TEAM}</h1>
                  <p>Turn screenshot-only GitHub issues into grounded diagnoses with Gemma 4.</p>
                </div>

                <TriageForm
                  issueUrl={issueUrl} setIssueUrl={setIssueUrl} busy={busy} onSubmit={onSubmit}
                  upload={upload} setUpload={setUpload} setError={setError} highlightUpload={error?.needsUpload}
                />

                {error && (
                  <div className="error" role="alert">
                    <Icon name="alert" /> <span><strong>Error:</strong> {error.message}</span>
                    {!error.needsUpload && issueUrl && (
                      <button type="button" className="link" onClick={() => runTriage({ issueUrl, saved: true })}>Load saved result for this issue</button>
                    )}
                  </div>
                )}

                {(busy || result) && (
                  <TriageResult
                    key={result ? result.issue.url + result.finishedAt : 'busy'}
                    result={result} stage={stage} comment={comment} setComment={setComment} labels={labels}
                  />
                )}
              </>
            )}

            {view === 'recent' && <RecentIssues history={history} onOpen={show} />}
            {view === 'help' && <Help />}
          </main>

          <aside className="rail">
            <AiCard model={model} />
            {result && view === 'home' && (
              <>
                <CommentCard comment={comment} setComment={setComment} mode={result.mode} />
                <LabelsCard labels={labels} setLabels={setLabels} />
                {result.diagnosis && <ContributorCard diagnosis={result.diagnosis} labels={labels} />}
              </>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function Sidebar({ view, setView, historyCount }) {
  const items = [
    { id: 'home', icon: 'home', label: 'Home' },
    { id: 'recent', icon: 'clock', label: `Recent issues${historyCount ? ` (${historyCount})` : ''}` },
    { id: 'help', icon: 'book', label: 'Help & docs' },
  ];
  return (
    <nav className="sidebar">
      <div className="brand">
        <Penguin />
        <div>
          <div className="brand-name">{APP_NAME}</div>
          <div className="brand-tag">{TAGLINE}</div>
        </div>
      </div>
      <ul className="nav">
        {items.map((it) => (
          <li key={it.id}>
            <button type="button" className={view === it.id ? 'nav-item active' : 'nav-item'} onClick={() => setView(it.id)}>
              <Icon name={it.icon} /> {it.label}
            </button>
          </li>
        ))}
      </ul>
      <div className="sidebar-foot">
        <div className="powered">
          <Spark size={28} />
          <div>
            <strong>Powered by Gemma 4</strong>
            <div className="secondary small">Multimodal AI for grounded bug triage</div>
          </div>
        </div>
        <div className="team"><Penguin size={28} /> {TEAM}</div>
      </div>
    </nav>
  );
}

function TriageForm({ issueUrl, setIssueUrl, busy, onSubmit, upload, setUpload, setError, highlightUpload }) {
  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return setUpload(null);
    if (!file.type.startsWith('image/')) return setError({ message: 'That file is not an image. Choose a PNG or JPEG screenshot.' });
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
    setUpload({ name: file.name, mimeType: file.type, data: String(dataUrl).split(',')[1] });
  }

  return (
    <section className="card">
      <h2>Triage a GitHub issue</h2>
      <p className="secondary">Paste a GitHub issue URL. If the screenshot cannot be downloaded, upload it below.</p>
      <form className="url-row" onSubmit={onSubmit}>
        <label className="url-field">
          <Icon name="link" />
          <span className="sr-only">GitHub issue link</span>
          <input type="url" placeholder="https://github.com/org/repo/issues/123" value={issueUrl}
            onChange={(e) => setIssueUrl(e.target.value)} disabled={busy} />
        </label>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Triaging...' : 'Triage issue'} <Icon name="arrow" />
        </button>
      </form>
      <div className={highlightUpload ? 'upload-row attention' : 'upload-row'}>
        <span className="field-label">Or upload a screenshot</span>
        <label className="upload-box">
          <Icon name="upload" />
          <span>{upload ? upload.name : 'Choose an image (used instead of the issue image)'}</span>
          <input type="file" accept="image/*" onChange={onFile} disabled={busy} />
        </label>
        {upload && <button type="button" className="link" onClick={() => setUpload(null)}>Remove</button>}
      </div>
    </section>
  );
}

function TriageResult({ result, stage, comment, setComment, labels }) {
  const [activeFile, setActiveFile] = useState(result?.diagnosis?.evidence[0]?.file || result?.matches[0]?.file || null);
  const [post, setPost] = useState(null); // { kind, text, url }
  const [posting, setPosting] = useState(false);

  async function postToGithub() {
    setPosting(true);
    setPost(null);
    try {
      const res = await fetch('/api/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueUrl: result.issue.url, comment, labels }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const applied = data.labels.length ? ` Labels applied: ${data.labels.join(', ')}.` : '';
      setPost({ kind: data.labelError ? 'error' : 'ok', text: `Posted to GitHub.${applied}${data.labelError ? ` ${data.labelError}` : ''}`, url: data.commentUrl });
    } catch (err) {
      setPost({ kind: 'error', text: err.message || 'Posting failed. Check the server log.' });
    } finally {
      setPosting(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(comment);
      setPost({ kind: 'ok', text: 'Comment copied to the clipboard.' });
    } catch {
      setPost({ kind: 'error', text: 'Could not copy. Select the draft text and press Ctrl+C.' });
    }
  }

  const ask = result?.mode === 'ask_reporter';
  const current = result ? 4 : STAGE_STEP[stage] ?? 0;
  const status = !result
    ? { cls: 'chip blue', text: 'Analyzing' }
    : ask ? { cls: 'chip amber', text: 'Needs more information' } : { cls: 'chip green', text: 'Analysis complete' };

  return (
    <section className="card result">
      <div className="result-head">
        <h2>Triage result</h2>
        <span className={status.cls}>{result && <Icon name="check" size={14} />}{status.text}</span>
        {result && (
          <button type="button" className="primary push" onClick={postToGithub} disabled={posting}>
            <GithubMark /> {posting ? 'Posting...' : 'Post to GitHub'}
          </button>
        )}
      </div>
      {result && (
        <p className="secondary small result-meta">
          {new Date(result.finishedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          {' · '}triage took {seconds(result.elapsedMs)} with <code>{result.model}</code>{result.fromSaved && ' · loaded from a saved result'}
        </p>
      )}
      {post && (
        <p className={post.kind === 'error' ? 'notice error-text' : 'notice ok-text'}>
          {post.text} {post.url && <a href={post.url} target="_blank" rel="noreferrer">Open the comment on GitHub</a>}
        </p>
      )}

      <ol className="stepper">
        {STEPS.map((label, i) => {
          const skipped = ask && (i === 2 || i === 3);
          const state = skipped ? 'skipped' : i < current ? 'done' : i === current ? 'current' : 'todo';
          return (
            <li key={label} className={`step ${state}`}>
              <span className="dot">{state === 'done' ? <Icon name="check" size={14} /> : skipped ? '–' : i + 1}</span>
              <span className="step-label">{label}{skipped && ' (skipped)'}</span>
            </li>
          );
        })}
      </ol>

      {!result && <p className="secondary working">{workingText(stage)}</p>}

      {result && (
        <>
          <div className="grid3">
            <IssueOverview result={result} />
            <GemmaSees look={result.look} />
            <RepoSearch result={result} activeFile={activeFile} setActiveFile={setActiveFile} />
          </div>

          {result.diagnosis && (
            <EvidenceAndDiagnosis result={result} activeFile={activeFile} setActiveFile={setActiveFile} />
          )}

          <div className="grid2 actions-row">
            <div className="action-card">
              <Icon name="alert" className="amber-icon" />
              <div>
                <strong>Not enough information?</strong>
                <p className="secondary small">Replace the draft with a polite request for the page, steps to reproduce and expected result.</p>
                <button type="button" className="outline" onClick={() => setComment(result.askComment || result.comment)} disabled={!result.askComment && !ask}>
                  Request more details <Icon name="chevron" size={14} />
                </button>
              </div>
            </div>
            <div className="action-card">
              <Icon name="shield" />
              <div>
                <strong>Grounding check</strong>
                <p className="secondary small">{groundingText(result)}</p>
              </div>
            </div>
            <div className="action-card">
              <Icon name="layers" />
              <div>
                <strong>Similar issues</strong>
                {result.similar?.length ? (
                  <ul className="similar">
                    {result.similar.map((i) => (
                      <li key={i.number}>
                        <a href={i.url} target="_blank" rel="noreferrer">#{i.number} {i.title}</a>
                        <span className={`chip ${i.state === 'open' ? 'green' : 'grey'}`}>{i.state}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="secondary small">{result.mode === 'ask_reporter'
                    ? 'Not checked: there is no on-screen text to search for yet.'
                    : 'No other issue in this repo mentions the same on-screen text.'}</p>
                )}
              </div>
            </div>
            <div className="action-card">
              <Icon name="copy" />
              <div>
                <strong>Copy comment</strong>
                <p className="secondary small">Copy the draft to your clipboard to post it by hand.</p>
                <button type="button" className="outline" onClick={copy}>Copy to clipboard</button>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function IssueOverview({ result }) {
  const [zoom, setZoom] = useState(false);
  return (
    <div className="sub-card">
      <h3><GithubMark /> 1. Issue overview</h3>
      <div className="secondary small">GitHub issue #{result.issue.number}</div>
      <a className="issue-link" href={result.issue.url} target="_blank" rel="noreferrer">
        {result.issue.title} <Icon name="external" size={14} />
      </a>
      {result.issue.body && <p className="issue-body">{result.issue.body}</p>}
      <div className="field-label">Screenshot</div>
      <button type="button" className="shot" onClick={() => setZoom(true)} title="Click to enlarge">
        <Screenshot src={result.screenshot} box={result.look.problem_box} alt="Screenshot from the issue" />
      </button>
      {result.look.problem_box && <p className="secondary small box-note"><span className="box-key" /> Where Gemma sees the problem</p>}
      {zoom && (
        <div className="lightbox" onClick={() => setZoom(false)} role="dialog" aria-label="Screenshot">
          <div className="lightbox-inner">
            <Screenshot src={result.screenshot} box={result.look.problem_box} alt="Screenshot from the issue, enlarged" />
          </div>
          <button type="button" className="lightbox-close" aria-label="Close"><Icon name="x" /></button>
        </div>
      )}
    </div>
  );
}

// Screenshot with Gemma's problem box ([ymin, xmin, ymax, xmax], 0-1000) drawn on top.
function Screenshot({ src, box, alt }) {
  return (
    <span className="shot-frame">
      <img src={src} alt={alt} />
      {box && (
        <span className="problem-box" style={{
          top: `${box[0] / 10}%`, left: `${box[1] / 10}%`,
          height: `${(box[2] - box[0]) / 10}%`, width: `${(box[3] - box[1]) / 10}%`,
        }} />
      )}
    </span>
  );
}

function GemmaSees({ look }) {
  return (
    <div className="sub-card">
      <h3><Spark size={18} /> 2. What Gemma 4 sees</h3>
      <div className="field-label">Visible text (extracted)</div>
      {look.on_screen_text.length
        ? <div className="quotes">{look.on_screen_text.map((t, i) => <mark key={i} className="quote">"{t}"</mark>)}</div>
        : <p className="secondary small">No fixed on-screen text identified.</p>}
      <div className="field-label">Observation</div>
      <p className="small">{look.what_is_wrong || 'Nothing clearly wrong is visible in the screenshot.'}</p>
      {look.expected_result && (<><div className="field-label">Expected</div><p className="small">{look.expected_result}</p></>)}
      {look.keywords.length > 0 && (
        <>
          <div className="field-label">Keywords</div>
          <div className="chips">{look.keywords.map((k) => <span key={k} className="chip blue">{k}</span>)}</div>
        </>
      )}
      {look.enough_info
        ? <span className="chip green spaced"><Icon name="check" size={14} /> Enough information</span>
        : (
          <>
            <span className="chip amber spaced"><Icon name="alert" size={14} /> Not enough information</span>
            {look.missing_details.length > 0 && <ul className="small missing">{look.missing_details.map((d) => <li key={d}>{d}</li>)}</ul>}
          </>
        )}
    </div>
  );
}

function RepoSearch({ result, activeFile, setActiveFile }) {
  const [all, setAll] = useState(false);
  const cited = new Set((result.diagnosis?.evidence || []).map((e) => e.file));
  const list = all ? result.matches : result.matches.slice(0, 3);
  return (
    <div className="sub-card">
      <h3><Icon name="search" /> 3. Repository search</h3>
      {result.mode === 'ask_reporter' ? (
        <p className="secondary small">No search ran: Gemma asked the reporter for more details instead of guessing.</p>
      ) : result.matches.length === 0 ? (
        <p className="secondary small">No fetched file contains the on-screen text.</p>
      ) : (
        <>
          <div className="field-label">Matched files</div>
          <ul className="file-list">
            {list.map((m) => {
              const strength = matchStrength(m, cited);
              const line = result.diagnosis?.evidence.find((e) => e.file === m.file)?.line || m.matchedLines[0];
              return (
                <li key={m.file}>
                  <button type="button" className={m.file === activeFile ? 'file-item active' : 'file-item'} onClick={() => setActiveFile(m.file)}>
                    <span className="file-path">
                      <Icon name="file" size={15} />
                      <span>
                        <span className="file-name">{m.file.split('/').pop()}</span>
                        <span className="file-dir">{m.file.split('/').slice(0, -1).join('/') || '/'}</span>
                      </span>
                    </span>
                    <span className="file-meta">
                      <span className="secondary small">{line ? `Line ${line}` : m.importedBy ? 'Imported' : ''}</span>
                      <span className={`chip ${strength.cls}`}>{strength.text}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {result.matches.length > 3 && (
            <button type="button" className="outline full" onClick={() => setAll(!all)}>
              {all ? 'Show top matches' : `View all matched files (${result.matches.length})`} <Icon name="chevron" size={14} />
            </button>
          )}
          {result.search && <p className="secondary small">Searched {result.search.fetched} of {result.search.sourceFiles} source files.</p>}
        </>
      )}
    </div>
  );
}

function EvidenceAndDiagnosis({ result, activeFile, setActiveFile }) {
  const { diagnosis, matches } = result;
  const active = matches.find((m) => m.file === activeFile) || matches[0];
  const cited = new Set(diagnosis.evidence.map((e) => e.file));
  return (
    <div className="sub-card wide">
      <h3><Icon name="layers" /> 4. Code evidence & diagnosis</h3>
      <div className="evidence-grid">
        {active ? (
          <CodeView key={active.file} match={active} strength={matchStrength(active, cited)}
            focusLines={diagnosis.evidence.filter((e) => e.file === active.file).map((e) => e.line)} />
        ) : <p className="secondary">No matched code to show.</p>}

        <div className="diagnosis">
          <h4><Spark size={18} /> Gemma 4 diagnosis</h4>
          <div className="dx-item">
            <div className="field-label">Root cause</div>
            <p>{diagnosis.root_cause}</p>
          </div>
          <div className="dx-item">
            <div className="field-label">Evidence</div>
            {diagnosis.evidence.length === 0 && <p className="secondary small">No cited line survived the grounding check.</p>}
            <ul className="evidence">
              {diagnosis.evidence.map((e) => (
                <li key={e.file + e.line}>
                  <button type="button" className="link mono" onClick={() => setActiveFile(e.file)}>{e.file}:{e.line}</button>
                  {e.note && <span className="small"> {e.note}</span>}
                </li>
              ))}
            </ul>
          </div>
          <div className="dx-item">
            <div className="field-label">Suggested fix</div>
            <p className="fix">{diagnosis.fix}</p>
            {diagnosis.patch && (
              <div className="diff" aria-label="Suggested change">
                <div className="diff-head mono">{diagnosis.patch.file}:{diagnosis.patch.line}</div>
                <div className="diff-line del"><span>-</span>{diagnosis.patch.before.trim()}</div>
                <div className="diff-line add"><span>+</span>{diagnosis.patch.after.trim()}</div>
                <div className="diff-note secondary small">The removed line is checked against the real file.</div>
              </div>
            )}
          </div>
          <div className="dx-pair">
            <div><div className="field-label">Difficulty</div><span className={`chip ${levelColor(diagnosis.difficulty, true)}`}>{cap(diagnosis.difficulty)}</span></div>
            <div><div className="field-label">Confidence</div><span className={`chip ${levelColor(diagnosis.confidence)}`}>{cap(diagnosis.confidence)}</span></div>
          </div>
          {diagnosis.confidence === 'low' && <p className="secondary small">Low confidence: check the code yourself before acting on this.</p>}
        </div>
      </div>
    </div>
  );
}

// Lines around matches and cited lines; the whole file on request.
function CodeView({ match, focusLines, strength }) {
  const [whole, setWhole] = useState(false);
  const focusRef = useRef(null);
  const marks = new Set(match.matchedLines);
  const focus = new Set(focusLines);

  const visible = useMemo(() => {
    if (whole) return match.lines.map((l) => l.n);
    const keep = new Set();
    for (const n of [...focusLines, ...match.matchedLines]) {
      for (let k = n - 3; k <= n + 3; k++) if (k >= 1 && k <= match.lines.length) keep.add(k);
    }
    if (keep.size === 0) for (let k = 1; k <= Math.min(12, match.lines.length); k++) keep.add(k);
    return [...keep].sort((a, b) => a - b);
  }, [whole, match, focusLines]);

  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [whole]);

  const rows = [];
  let prev = 0;
  let focusAssigned = false;
  for (const n of visible) {
    if (n > prev + 1) rows.push(<div key={`gap${n}`} className="code-gap">...</div>);
    const line = match.lines[n - 1];
    const isFocus = focus.has(n);
    rows.push(
      <div key={n} className={isFocus ? 'code-line focus' : 'code-line'} ref={isFocus && !focusAssigned ? focusRef : null}>
        <span className="ln">{n}</span>
        <span className="lt">{marks.has(n) ? highlight(line.text, match.terms) : line.text || ' '}</span>
        {isFocus && <span className="issue-tag">← Issue</span>}
      </div>,
    );
    if (isFocus) focusAssigned = true;
    prev = n;
  }

  return (
    <div className="code-card">
      <div className="code-head">
        <span className="mono">{match.file}</span>
        <span className={`chip ${strength.cls}`}>{strength.text}</span>
        {focusLines[0] && <span className="chip grey">Line {focusLines[0]}</span>}
      </div>
      <div className="code">{rows}</div>
      <button type="button" className="link code-foot" onClick={() => setWhole(!whole)}>
        {whole ? 'Show matched lines only' : 'View full file'} <Icon name="arrow" size={14} />
      </button>
    </div>
  );
}

function AiCard({ model }) {
  const points = [
    'Understands screenshots and visual context',
    'Finds the code that renders the broken text',
    'Cites only real lines from your repository',
    'Suggests a fix, labels and difficulty',
    'Asks the reporter instead of guessing',
    'Posts nothing without your approval',
  ];
  return (
    <section className="card ai-card">
      <div className="ai-head">
        <Spark size={30} />
        <div>
          <h2>AI-powered triage</h2>
          <div className="secondary small">Built with Gemma 4 via the Gemini API</div>
        </div>
      </div>
      <ul className="checks">
        {points.map((p) => <li key={p}><span className="check-dot"><Icon name="check" size={12} /></span>{p}</li>)}
      </ul>
      <div className="model-pill"><Spark size={18} /> <code>{model || 'Gemma 4'}</code></div>
    </section>
  );
}

function CommentCard({ comment, setComment, mode }) {
  const ref = useRef(null);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState(false);
  const html = useMemo(() => (preview ? DOMPurify.sanitize(marked.parse(comment, { gfm: true, breaks: true })) : ''), [preview, comment]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(comment);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* the textarea stays selectable */ }
  }
  return (
    <section className="card">
      <div className="rail-head">
        <h2>Triage comment (draft)</h2>
        <div className="seg">
          <button type="button" className={preview ? 'seg-btn' : 'seg-btn on'} onClick={() => { setPreview(false); setTimeout(() => ref.current?.focus()); }}>Edit</button>
          <button type="button" className={preview ? 'seg-btn on' : 'seg-btn'} onClick={() => setPreview(true)}>Preview</button>
        </div>
      </div>
      {mode === 'ask_reporter' && <p className="secondary small">Asks the reporter for details. No diagnosis.</p>}
      <div className="draft">
        <button type="button" className="icon-btn" onClick={copy} title="Copy comment" aria-label="Copy comment">
          {copied ? <Icon name="check" size={16} /> : <Icon name="copy" size={16} />}
        </button>
        <label htmlFor="comment" className="sr-only">Draft comment</label>
        {preview
          ? <div className="md-preview" dangerouslySetInnerHTML={{ __html: html }} />
          : <textarea id="comment" ref={ref} value={comment} onChange={(e) => setComment(e.target.value)} rows={20} />}
      </div>
      <p className="secondary small">Edit freely. Nothing is posted until you click Post to GitHub.</p>
    </section>
  );
}

function LabelsCard({ labels, setLabels }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  function add(e) {
    e.preventDefault();
    const name = text.trim().toLowerCase();
    if (name && !labels.includes(name)) setLabels([...labels, name]);
    setText('');
    setAdding(false);
  }
  return (
    <section className="card">
      <h2>Suggested labels</h2>
      <div className="chips">
        {labels.map((l) => (
          <span key={l} className={`chip label ${labelColor(l)}`}>
            {l}
            <button type="button" aria-label={`Remove ${l}`} onClick={() => setLabels(labels.filter((x) => x !== l))}><Icon name="x" size={12} /></button>
          </span>
        ))}
        {adding ? (
          <form onSubmit={add} className="add-label">
            <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={add} placeholder="label name" />
          </form>
        ) : (
          <button type="button" className="outline small-btn" onClick={() => setAdding(true)}><Icon name="plus" size={12} /> Add label</button>
        )}
      </div>
      <p className="secondary small">Only labels that exist on the repo are applied ("bug" and "good first issue" are created if missing).</p>
    </section>
  );
}

function ContributorCard({ diagnosis, labels }) {
  const files = new Set(diagnosis.evidence.map((e) => e.file)).size;
  return (
    <section className="card">
      <h2>Contributor info</h2>
      <dl className="info">
        <div><dt><Icon name="gauge" /> Difficulty</dt><dd><span className={`chip ${levelColor(diagnosis.difficulty, true)}`}>{cap(diagnosis.difficulty)}</span></dd></div>
        <div><dt><Icon name="shield" /> Confidence</dt><dd><span className={`chip ${levelColor(diagnosis.confidence)}`}>{cap(diagnosis.confidence)}</span></dd></div>
        <div><dt><Icon name="file" /> Files affected</dt><dd>{files}</dd></div>
        <div><dt><Icon name="layers" /> Cited lines</dt><dd>{diagnosis.evidence.length}</dd></div>
      </dl>
      {labels.includes('good first issue') && (
        <div className="first-timers"><Icon name="check" size={16} /> Good for first-time contributors</div>
      )}
    </section>
  );
}

function RecentIssues({ history, onOpen }) {
  return (
    <section className="card">
      <h2>Recent issues</h2>
      {history.length === 0 ? (
        <p className="secondary">No issues triaged in this session yet.</p>
      ) : (
        <ul className="recent">
          {history.map((h) => (
            <li key={h.issue.url}>
              <button type="button" className="file-item" onClick={() => onOpen(h)}>
                <span><strong>#{h.issue.number}</strong> {h.issue.title}</span>
                <span className="file-meta">
                  <span className="secondary small">{seconds(h.elapsedMs)}</span>
                  {h.mode === 'diagnosis'
                    ? <span className={`chip ${levelColor(h.diagnosis?.confidence)}`}>{cap(h.diagnosis?.confidence)} confidence</span>
                    : <span className="chip amber">Asked reporter</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Help() {
  return (
    <section className="card help">
      <h2>How {APP_NAME} works</h2>
      <ol>
        <li>Paste a GitHub issue link and click <strong>Triage issue</strong>. If the screenshot cannot be downloaded, upload it.</li>
        <li>Gemma 4 reads the screenshot: what is wrong, the expected result and the fixed on-screen text.</li>
        <li>{APP_NAME} searches the repo (up to 80 source files) for that text and follows imports one level.</li>
        <li>Gemma 4 reads the screenshot plus the numbered code and names the root cause, file and line.</li>
        <li>The grounding check drops citations outside the fetched files and shows only real code lines.</li>
        <li>Edit the draft comment and labels, then click <strong>Post to GitHub</strong>.</li>
      </ol>
      <p className="secondary">If the screenshot is not enough, {APP_NAME} drafts a question to the reporter instead of guessing.
        Replay a saved result with <code>?saved=owner-repo-number</code>.</p>
    </section>
  );
}

function matchStrength(m, cited) {
  if (cited.has(m.file) || m.terms.length >= 2) return { cls: 'green', text: 'High match' };
  if (m.terms.length === 1) return { cls: 'amber', text: 'Medium match' };
  if (m.importedBy) return { cls: 'grey', text: 'Imported' };
  return { cls: 'grey', text: 'Keyword' };
}

function groundingText(result) {
  if (!result.diagnosis) return 'No code was cited, so there was nothing to check.';
  const kept = result.diagnosis.evidence.length;
  const dropped = result.diagnosis.dropped || 0;
  return `${kept} cited line${kept === 1 ? '' : 's'} verified against fetched files${dropped ? `, ${dropped} citation${dropped === 1 ? '' : 's'} dropped` : ', none dropped'}. Code shown is the real file text.`;
}

function workingText(stage) {
  return {
    fetching: 'Fetching the issue and its screenshot...',
    looking: 'Gemma 4 is reading the screenshot...',
    searching: 'Searching the repository for the on-screen text...',
    diagnosing: 'Gemma 4 is diagnosing the matched code...',
  }[stage] || 'Working...';
}

function levelColor(level, difficulty = false) {
  if (difficulty) return { easy: 'green', medium: 'amber', hard: 'red' }[level] || 'grey';
  return { high: 'green', medium: 'amber', low: 'red' }[level] || 'grey';
}

function labelColor(name) {
  if (name === 'bug') return 'red';
  if (name === 'good first issue') return 'green';
  return 'blue';
}

function highlight(text, terms) {
  if (!terms?.length) return text;
  const re = new RegExp(`(${terms.map(escapeRe).join('|')})`, 'gi');
  return text.split(re).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part));
}

async function readLines(body, onMessage) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (line) onMessage(JSON.parse(line));
    }
    if (done) break;
  }
  if (buffer.trim()) onMessage(JSON.parse(buffer));
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
