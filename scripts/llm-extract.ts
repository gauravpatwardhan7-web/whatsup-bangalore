/**
 * Shared place-extraction call, used by both ingest-reddit.ts and
 * ingest-youtube.ts: Gemini first, falling back to Mistral for a chunk when
 * Gemini's daily free-tier quota is exhausted or its calls keep failing.
 *
 * Both use "-latest" model aliases (not pinned snapshots) — Google sunset
 * gemini-2.5-flash outright in prod (404, not a quota issue) on 2026-07-10,
 * which is exactly the class of breakage an alias avoids.
 *
 * Mistral is optional: without MISTRAL_API_KEY set, a failed Gemini chunk is
 * just skipped, same as before this fallback existed.
 */

import { GoogleGenAI, Type } from "@google/genai";
import { CATEGORIES } from "../lib/ds";

const CATEGORY_KEYS = Object.keys(CATEGORIES);
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || "mistral-large-latest";

export interface Candidate {
  post_number: number;
  name: string;
  category: string;
  reason: string;
  is_event: boolean;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Parse the model's response into candidates, tolerating the ways structured
// output occasionally arrives dirty: markdown ```json fences, or leading/trailing
// prose around the object. Returns null when nothing parseable is found.
export function parseCandidates(text: string | undefined): Candidate[] | null {
  if (!text) return null;
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const tryParse = (s: string): Candidate[] | null => {
    try {
      const parsed = JSON.parse(s) as { places?: Candidate[] };
      return Array.isArray(parsed.places) ? parsed.places : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(cleaned);
  if (direct) return direct;
  // Fallback: extract the outermost {...} and try that.
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) return tryParse(cleaned.slice(start, end + 1));
  return null;
}

const GEMINI_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    places: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          post_number: { type: Type.INTEGER },
          name: { type: Type.STRING },
          category: { type: Type.STRING, enum: CATEGORY_KEYS },
          reason: { type: Type.STRING },
          is_event: { type: Type.BOOLEAN },
        },
        required: ["post_number", "name", "category", "reason", "is_event"],
        propertyOrdering: ["post_number", "name", "category", "reason", "is_event"],
      },
    },
  },
  required: ["places"],
};

// Plain-JSON-Schema equivalent for Mistral's strict structured outputs (not
// the Gemini-SDK Type.* shape above). additionalProperties:false + every
// property in `required` is what Mistral's strict mode expects.
const MISTRAL_SCHEMA = {
  type: "object",
  properties: {
    places: {
      type: "array",
      items: {
        type: "object",
        properties: {
          post_number: { type: "integer" },
          name: { type: "string" },
          category: { type: "string", enum: CATEGORY_KEYS },
          reason: { type: "string" },
          is_event: { type: "boolean" },
        },
        required: ["post_number", "name", "category", "reason", "is_event"],
        additionalProperties: false,
      },
    },
  },
  required: ["places"],
  additionalProperties: false,
};

type GeminiResult = { ok: true; candidates: Candidate[] } | { ok: false };

async function callGemini(
  ai: GoogleGenAI,
  model: string,
  systemPrompt: string,
  userContent: string,
): Promise<GeminiResult> {
  // A rate-limit (429), transient error, or an unparseable body on one chunk
  // shouldn't abort the whole run. Retry with backoff (honoring the API's
  // retryDelay when given); after the last attempt, hand off to the caller
  // (which may fall back to Mistral) so the chunks that did parse still write.
  for (let attempt = 1; attempt <= 3; attempt++) {
    let text: string | undefined;
    try {
      const resp = await ai.models.generateContent({
        model,
        contents: userContent,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          responseSchema: GEMINI_SCHEMA,
          temperature: 0,
        },
      });
      text = resp.text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit = /\b429\b|RESOURCE_EXHAUSTED|quota/i.test(msg);
      // A per-day quota can't clear by waiting — bail fast rather than burn minutes.
      const isDailyQuota = /PerDay|RequestsPerDay|free_tier_requests/i.test(msg);
      if (isDailyQuota) {
        console.warn("  Gemini daily free-tier quota exhausted for this chunk.");
        return { ok: false };
      }
      if (attempt === 3 || !isRateLimit) {
        console.warn(`  Gemini extraction call failed (attempt ${attempt}): ${msg.slice(0, 160)}`);
        return { ok: false };
      }
      const retryMs = /"retryDelay":"(\d+)/.exec(msg)?.[1];
      const waitMs = retryMs ? Number(retryMs) * 1000 + 1000 : 5000 * attempt;
      console.warn(`  Gemini rate-limited (attempt ${attempt}) — waiting ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs);
      continue;
    }

    const parsed = parseCandidates(text);
    if (parsed) return { ok: true, candidates: parsed };
    if (attempt === 3) {
      console.warn("  couldn't parse Gemini's extraction JSON after 3 attempts.");
      return { ok: false };
    }
    console.warn(`  couldn't parse Gemini's extraction JSON (attempt ${attempt}) — retrying`);
    await sleep(1500 * attempt);
  }
  return { ok: false };
}

// Mistral's free tier is 2 requests/minute — throttle fallback calls so a run
// with several failed Gemini chunks doesn't 429 Mistral too.
let lastMistralCallAt = 0;
const MISTRAL_MIN_GAP_MS = 30_000;

async function callMistral(apiKey: string, systemPrompt: string, userContent: string): Promise<Candidate[]> {
  const wait = MISTRAL_MIN_GAP_MS - (Date.now() - lastMistralCallAt);
  if (wait > 0) await sleep(wait);
  lastMistralCallAt = Date.now();

  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MISTRAL_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: { name: "extraction", schema: MISTRAL_SCHEMA, strict: true },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Mistral chat/completions failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const json = await res.json() as { choices?: { message?: { content?: string } }[] };
  const text = json.choices?.[0]?.message?.content;
  return parseCandidates(text) ?? [];
}

// Gemini first; on quota exhaustion or repeated failure, fall back to Mistral
// (when MISTRAL_API_KEY is set) before giving up on the chunk.
export async function extractCandidates(
  ai: GoogleGenAI,
  geminiModel: string,
  systemPrompt: string,
  userContent: string,
): Promise<Candidate[]> {
  const geminiResult = await callGemini(ai, geminiModel, systemPrompt, userContent);
  if (geminiResult.ok) return geminiResult.candidates;

  const mistralKey = process.env.MISTRAL_API_KEY;
  if (!mistralKey) {
    console.warn("  No MISTRAL_API_KEY set — skipping chunk.");
    return [];
  }
  console.warn(`  Falling back to Mistral (${MISTRAL_MODEL}) for this chunk…`);
  try {
    const candidates = await callMistral(mistralKey, systemPrompt, userContent);
    console.warn(`  Mistral fallback: extracted ${candidates.length} candidate(s).`);
    return candidates;
  } catch (err) {
    console.warn(`  Mistral fallback failed — skipping chunk: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}
