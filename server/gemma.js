// The whole Gemma 4 integration: image + text in, parsed JSON out.
import { createHash } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';

export const MODEL = process.env.GEMMA_MODEL || 'gemma-4-26b-a4b-it';

let client;
function getClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw httpError(500, 'Missing Gemini API key. Add GEMINI_API_KEY to server/.env and restart the server.');
  }
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

// Some Gemma ids reject JSON mode; we fall back to prompt + fence stripping.
let jsonModeSupported = true;

// Same prompt + same image = same answer: re-triaging an issue returns at once (kept until restart).
const cache = new Map();

export async function askGemma({ prompt, images = [], system }) {
  const key = createHash('sha256').update(JSON.stringify([MODEL, system, prompt, images.map((i) => i.data)])).digest('hex');
  if (cache.has(key)) return structuredClone(cache.get(key));
  const answer = await askUncached({ prompt, images, system });
  cache.set(key, answer);
  return structuredClone(answer);
}

async function askUncached({ prompt, images, system }) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = await generate({ prompt, images, system });
    try {
      return parseJson(text);
    } catch {
      if (attempt === 2) {
        throw httpError(502, 'Gemma returned text that is not valid JSON (after one retry). Click "Triage issue" again.');
      }
    }
  }
}

async function generate({ prompt, images, system }) {
  const parts = [
    ...images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
    // Gemma on the Gemini API has no system role, so the system text leads the prompt.
    { text: system ? `${system}\n\n${prompt}` : prompt },
  ];
  const request = {
    model: MODEL,
    contents: [{ role: 'user', parts }],
    config: { temperature: 0.2, ...(jsonModeSupported && { responseMimeType: 'application/json' }) },
  };
  try {
    const res = await getClient().models.generateContent(request);
    return res.text ?? '';
  } catch (err) {
    if (jsonModeSupported && err.status === 400 && /json|mime/i.test(err.message)) {
      jsonModeSupported = false;
      return generate({ prompt, images, system });
    }
    throw explain(err);
  }
}

export function parseJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    // Last resort: take the outermost {...} block.
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('no JSON object');
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

function explain(err) {
  if (err.status === 429) return httpError(429, 'Gemini API rate limit reached. Wait a minute and try again, or load a saved result.');
  if (err.status === 404) return httpError(502, `Model "${MODEL}" is not available on this key. Set GEMMA_MODEL in server/.env to a valid Gemma 4 id.`);
  if (err.status === 400 && /api key/i.test(err.message)) return httpError(500, 'Gemini rejected the API key. Check GEMINI_API_KEY in server/.env.');
  return httpError(502, `Gemini API error: ${String(err.message).split('\n')[0].slice(0, 200)}`);
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status, expose: true });
}
