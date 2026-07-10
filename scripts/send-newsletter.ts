/**
 * Weekly newsletter — "Your Bangalore weekend, sorted".
 *
 * Runs every Thursday from .github/workflows/newsletter.yml. Instead of a raw
 * top-10 dump, it curates ONE standout place per section (Eat / Drink / Do /
 * See) plus a couple of compact runners-up per section and upcoming events.
 * For each headline pick, an LLM editorial pass (Gemini, Mistral fallback —
 * same providers as ingestion) turns the raw data into what a reader actually
 * needs to decide and to enjoy the visit: a written-for-humans blurb, 2-3
 * practical "know before you go" tips, and a "good for" tag. Without an LLM
 * key (or on failure) the email still builds from the stored descriptions.
 *
 * Email delivery is provider-swappable: it goes through sendEmail() below,
 * currently backed by Resend's REST API (free tier: 100 emails/day, 3,000/mo).
 * To switch providers, replace sendEmail()'s body — nothing else changes.
 *
 * Local dry run (builds the HTML, sends nothing):
 *   npx tsx scripts/send-newsletter.ts --dry-run
 * Write the HTML to a file to eyeball it in a browser:
 *   npx tsx scripts/send-newsletter.ts --dry-run --html-out /tmp/newsletter.html
 *
 * Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
 *      RESEND_API_KEY, NEWSLETTER_FROM (e.g. "What's Trending Bangalore <hello@yourdomain.com>";
 *      the domain must be verified in Resend),
 *      GEMINI_API_KEY (or GEMINI_TEST_API_KEY locally), MISTRAL_API_KEY (both optional).
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient, type WebSocketLikeConstructor } from "@supabase/supabase-js";
import { GoogleGenAI, Type } from "@google/genai";
import ws from "ws"; // realtime transport: Node 20 lacks native WebSocket (unused here, but the client insists)
import { curate, SECTIONS, type Section } from "../lib/newsletter";

const APP_URL = "https://whatsupbangalore.netlify.app";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || "mistral-large-latest";

interface TrendingPlace {
  id: string;
  title: string;
  description: string;
  category: string;
  area: string | null;
  lat: number;
  lng: number;
  image_url: string | null;
  website: string | null;
  rating: number | null;
  rating_count: number | null;
  price_level: number | null;
  vote_count: number;
  comment_count: number;
  trending_score: number;
  event_start: string | null;
  event_end: string | null;
}

interface Mention {
  place_id: string;
  platform: string;
  url: string | null;
  title: string | null;
  engagement_score: number;
}

interface Editorial {
  blurb: string;      // 2-3 sentences, insider voice
  tips: string[];     // 2-3 practical "know before you go" lines
  good_for: string;   // e.g. "lazy Sunday breakfast", "date night"
}

interface Pick_ {
  place: TrendingPlace;
  section: Section;
  mention: Mention | null;
  editorial: Editorial | null;
}

// Curation (section picks, runners-up, events) lives in ../lib/newsletter so the
// on-site /newsletter page renders the exact same picks. Here we only add the
// email-specific per-pick fields (buzz mention + LLM editorial).

async function attachBuzz(supabase: SupabaseClient, picks: Pick_[]): Promise<void> {
  if (picks.length === 0) return;
  const { data } = await supabase
    .from("mentions")
    .select("place_id, platform, url, title, engagement_score")
    .in("place_id", picks.map((p) => p.place.id))
    .gt("mentioned_at", new Date(Date.now() - 21 * 86400_000).toISOString())
    .order("engagement_score", { ascending: false });
  for (const pick of picks) {
    pick.mention = (data as Mention[] | null)?.find(
      (m) => m.place_id === pick.place.id && m.title && m.url) ?? null;
  }
}

// ── editorial pass ───────────────────────────────────────────────────────────
// One structured LLM call for all headline picks. The prompt is grounded: the
// model may only state specifics (dishes, timings, booking) it is confident
// hold for this exact place; otherwise it gives honest category-level advice.
// Any failure leaves editorial=null and the stored description carries the card.

const EDITOR_SYSTEM_PROMPT = `You are the editor of a small, trusted weekly guide to Bangalore weekends. Your readers are locals deciding where to spend Saturday. For each place you receive (with its category, area, Google rating, price level 1-4, stored description, and the social-media post that made it trend), write:

- "blurb": 2-3 sentences in a warm, specific, insider voice. Rewrite — don't repeat — the stored description. Say what the place is actually like and who will love it. No marketing clichés ("hidden gem", "must-visit", "nestled"), no exclamation marks.
- "tips": 2-3 short practical tips (each under 16 words) that help someone enjoy the visit: best time or day to go, what to order or do first, whether to book, how long to plan, what to bring. Only state a specific fact (a dish name, an opening time) if you are confident it is true of this exact, well-known place; otherwise give honest practical advice for this kind of place. Never invent prices or phone numbers.
- "good_for": a 2-4 word tag for the ideal occasion, e.g. "lazy Sunday breakfast", "first date", "family outing".

Indian English is fine. Return JSON only.`;

const EDITORIAL_GEMINI_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    entries: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          blurb: { type: Type.STRING },
          tips: { type: Type.ARRAY, items: { type: Type.STRING } },
          good_for: { type: Type.STRING },
        },
        required: ["id", "blurb", "tips", "good_for"],
        propertyOrdering: ["id", "blurb", "tips", "good_for"],
      },
    },
  },
  required: ["entries"],
};

const EDITORIAL_MISTRAL_SCHEMA = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          blurb: { type: "string" },
          tips: { type: "array", items: { type: "string" } },
          good_for: { type: "string" },
        },
        required: ["id", "blurb", "tips", "good_for"],
        additionalProperties: false,
      },
    },
  },
  required: ["entries"],
  additionalProperties: false,
};

function parseEditorial(text: string | undefined): Map<string, Editorial> | null {
  if (!text) return null;
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as { entries?: ({ id: string } & Editorial)[] };
    if (!Array.isArray(parsed.entries)) return null;
    const map = new Map<string, Editorial>();
    for (const e of parsed.entries) {
      if (e.id && e.blurb && Array.isArray(e.tips)) {
        map.set(e.id, { blurb: e.blurb, tips: e.tips.filter(Boolean).slice(0, 3), good_for: e.good_for ?? "" });
      }
    }
    return map.size ? map : null;
  } catch {
    return null;
  }
}

function editorialInput(picks: Pick_[]): string {
  return JSON.stringify(picks.map(({ place: p, mention }) => ({
    id: p.id,
    name: p.title,
    category: p.category,
    area: p.area,
    google_rating: p.rating,
    rating_count: p.rating_count,
    price_level: p.price_level,
    stored_description: p.description,
    trending_because: mention?.title ?? null,
    trending_platform: mention?.platform ?? null,
  })), null, 1);
}

async function writeEditorial(picks: Pick_[]): Promise<void> {
  if (picks.length === 0) return;
  const input = editorialInput(picks);
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_TEST_API_KEY;
  let map: Map<string, Editorial> | null = null;

  if (geminiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const resp = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: input,
        config: {
          systemInstruction: EDITOR_SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseSchema: EDITORIAL_GEMINI_SCHEMA,
          temperature: 0.4,
        },
      });
      map = parseEditorial(resp.text);
    } catch (err) {
      console.warn(`  Gemini editorial pass failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`);
    }
  }

  const mistralKey = process.env.MISTRAL_API_KEY;
  if (!map && mistralKey) {
    console.warn(`  Falling back to Mistral (${MISTRAL_MODEL}) for the editorial pass…`);
    try {
      const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${mistralKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MISTRAL_MODEL,
          messages: [
            { role: "system", content: EDITOR_SYSTEM_PROMPT },
            { role: "user", content: input },
          ],
          temperature: 0.4,
          response_format: {
            type: "json_schema",
            json_schema: { name: "editorial", schema: EDITORIAL_MISTRAL_SCHEMA, strict: true },
          },
        }),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      const json = await res.json() as { choices?: { message?: { content?: string } }[] };
      map = parseEditorial(json.choices?.[0]?.message?.content);
    } catch (err) {
      console.warn(`  Mistral editorial pass failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (!map) {
    if (!geminiKey && !mistralKey) console.log("  No LLM key set — using stored descriptions as-is.");
    return;
  }
  for (const pick of picks) pick.editorial = map.get(pick.place.id) ?? null;
}

// ── rendering ────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const PLATFORM_LABEL: Record<string, string> = {
  reddit: "on Reddit", instagram: "on Instagram", x: "on X", news: "in the news", youtube: "on YouTube",
};

// palette — matches the app's warm stone + sage tokens (lib/ds.ts)
const INK = "#1c1917", MUTED = "#57534e", FAINT = "#a8a29e";
const SAGE = "#5b7553", SAGE_DEEP = "#465c40", CREAM = "#faf7f2", LINE = "#e7e2da", TIPBG = "#f4f1ea";
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function stars(rating: number): string {
  return "★".repeat(Math.round(rating)) + "☆".repeat(5 - Math.round(rating));
}

function metaRow(p: TrendingPlace): string {
  const bits: string[] = [];
  if (p.rating) {
    bits.push(`<span style="color:#b7791f;">${stars(p.rating)}</span> <b>${p.rating.toFixed(1)}</b>${p.rating_count ? ` <span style="color:${FAINT};">(${p.rating_count.toLocaleString("en-IN")} reviews)</span>` : ""}`);
  }
  if (p.price_level != null && p.price_level > 0) {
    bits.push(`<span style="color:${MUTED};">${"₹".repeat(p.price_level)}</span><span style="color:${LINE};">${"₹".repeat(4 - p.price_level)}</span>`);
  }
  if (p.vote_count > 0) bits.push(`<span style="color:${MUTED};">▲ ${p.vote_count} locals</span>`);
  return bits.length
    ? `<div style="font-size:13px;margin-top:6px;font-family:${SANS};">${bits.join('<span style="color:' + LINE + ';">&nbsp;&nbsp;·&nbsp;&nbsp;</span>')}</div>`
    : "";
}

function tipsBox(e: Editorial | null): string {
  if (!e || e.tips.length === 0) return "";
  const rows = e.tips.map((t) =>
    `<tr><td style="vertical-align:top;color:${SAGE};font-weight:700;padding:3px 8px 3px 0;">→</td>
     <td style="padding:3px 0;font-size:13.5px;color:${MUTED};line-height:1.55;">${esc(t)}</td></tr>`).join("");
  return `
    <div style="margin-top:14px;background:${TIPBG};border-radius:10px;padding:14px 16px;font-family:${SANS};">
      <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${SAGE_DEEP};font-weight:700;">Know before you go</div>
      <table style="border-collapse:collapse;margin-top:6px;">${rows}</table>
    </div>`;
}

function buzzLine(m: Mention | null): string {
  if (!m) return "";
  const where = PLATFORM_LABEL[m.platform] ?? `on ${m.platform}`;
  return `
    <div style="margin-top:12px;padding:10px 14px;background:${CREAM};border-left:3px solid ${SAGE};font-family:${SANS};">
      <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${SAGE};font-weight:700;">Why it&rsquo;s buzzing</div>
      <div style="font-size:13px;color:${MUTED};margin-top:3px;line-height:1.5;">
        &ldquo;${esc(m.title!)}&rdquo; — <a href="${esc(m.url!)}" style="color:${SAGE};">the thread ${where}</a>
      </div>
    </div>`;
}

function actionLinks(p: TrendingPlace): string {
  const dirs = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
  const links = [
    `<a href="${dirs}" style="display:inline-block;background:${SAGE};color:#ffffff;text-decoration:none;padding:8px 16px;border-radius:8px;font-weight:700;">Directions&nbsp;→</a>`,
    p.website ? `<a href="${esc(p.website)}" style="display:inline-block;border:1.5px solid ${LINE};color:${SAGE_DEEP};text-decoration:none;padding:7px 16px;border-radius:8px;font-weight:700;">Website</a>` : "",
    `<a href="${APP_URL}" style="color:${FAINT};text-decoration:none;">On the map&nbsp;→</a>`,
  ].filter(Boolean);
  return `<div style="font-size:13px;margin-top:16px;font-family:${SANS};">${links.join("&nbsp;&nbsp;&nbsp;")}</div>`;
}

function pickCard(pick: Pick_, alternates: TrendingPlace[]): string {
  const { place: p, section, editorial: e } = pick;
  const def = SECTIONS[section];
  const photo = p.image_url
    ? `<img src="${esc(p.image_url)}" alt="${esc(p.title)}" width="568" style="width:100%;max-width:568px;height:auto;border-radius:12px;display:block;" />`
    : "";
  const goodFor = e?.good_for
    ? `<span style="display:inline-block;background:${CREAM};border:1px solid ${LINE};color:${SAGE_DEEP};font-size:11.5px;font-weight:700;padding:3px 10px;border-radius:999px;font-family:${SANS};margin-left:8px;vertical-align:middle;">${esc(e.good_for)}</span>`
    : "";
  const also = alternates.length
    ? `<div style="margin-top:14px;font-family:${SANS};font-size:13px;color:${MUTED};line-height:1.7;">
        <span style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${FAINT};font-weight:700;">Also on the radar&nbsp;&nbsp;</span>
        ${alternates.map((a) =>
          `<b style="color:${INK};">${esc(a.title)}</b>${a.area ? ` <span style="color:${FAINT};">(${esc(a.area)})</span>` : ""}${a.rating ? ` <span style="color:#b7791f;">★</span> ${a.rating.toFixed(1)}` : ""}`,
        ).join('<span style="color:' + LINE + ';">&nbsp;·&nbsp;</span>')}
      </div>`
    : "";
  return `
  <tr><td style="padding:30px 0 4px;">
    <div style="font-size:12px;letter-spacing:2.5px;text-transform:uppercase;color:${SAGE};font-weight:700;font-family:${SANS};">
      ${def.label} <span style="color:${FAINT};font-weight:400;letter-spacing:0;text-transform:none;">— ${def.lede}</span>
    </div>
    <h2 style="font-family:${SERIF};font-size:25px;line-height:1.2;color:${INK};margin:8px 0 2px;">${esc(p.title)}${goodFor}</h2>
    ${p.area ? `<div style="font-size:13px;color:${FAINT};font-family:${SANS};">${esc(p.area)}</div>` : ""}
    ${metaRow(p)}
    ${photo ? `<div style="margin-top:14px;">${photo}</div>` : ""}
    <p style="font-size:15.5px;color:${MUTED};line-height:1.7;margin:14px 0 0;font-family:${SERIF};">${esc(e?.blurb ?? p.description)}</p>
    ${tipsBox(e)}
    ${buzzLine(pick.mention)}
    ${actionLinks(p)}
    ${also}
    <div style="border-bottom:1px solid ${LINE};margin-top:30px;"></div>
  </td></tr>`;
}

function eventRow(p: TrendingPlace): string {
  const fmt = (d: string) => new Date(d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  const when = p.event_start
    ? fmt(p.event_start) + (p.event_end && p.event_end !== p.event_start ? ` – ${fmt(p.event_end)}` : "")
    : "";
  return `
    <div style="padding:12px 0;border-bottom:1px solid ${LINE};font-family:${SANS};">
      <span style="display:inline-block;min-width:110px;font-size:12px;font-weight:700;color:${SAGE};">${when}</span>
      <span style="font-size:14px;font-weight:700;color:${INK};">${esc(p.title)}</span>
      ${p.area ? `<span style="font-size:13px;color:${FAINT};"> · ${esc(p.area)}</span>` : ""}
      <div style="font-size:13px;color:${MUTED};margin-top:3px;line-height:1.5;">${esc(p.description).slice(0, 160)}</div>
    </div>`;
}

export function buildHtml(
  picks: Pick_[],
  runnersUp: Partial<Record<Section, TrendingPlace[]>>,
  events: TrendingPlace[],
  weekOf: string,
): string {
  return `
  <meta charset="utf-8" />
  <div style="background:${CREAM};padding:24px 0;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;padding:36px 32px 24px;font-family:${SANS};">
    <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${FAINT};text-align:center;">What&rsquo;s Trending Bangalore</div>
    <h1 style="font-family:${SERIF};font-size:32px;line-height:1.15;color:${INK};text-align:center;margin:10px 0 6px;">Your weekend, sorted.</h1>
    <p style="font-size:14px;color:${MUTED};text-align:center;margin:0;line-height:1.6;">
      Not a top-10 list — ${picks.length} place${picks.length === 1 ? "" : "s"} the city is actually talking about, one for every mood,<br/>with what to know before you go.
      <br/><span style="color:${FAINT};font-size:12.5px;">Week of ${weekOf}</span>
    </p>
    <table style="width:100%;border-collapse:collapse;">${picks.map((p) => pickCard(p, runnersUp[p.section] ?? [])).join("")}</table>
    ${events.length ? `
    <div style="margin-top:26px;">
      <div style="font-size:12px;letter-spacing:2.5px;text-transform:uppercase;color:${SAGE};font-weight:700;">This weekend</div>
      ${events.map(eventRow).join("")}
    </div>` : ""}
    <p style="text-align:center;margin:32px 0 8px;">
      <a href="${APP_URL}" style="display:inline-block;background:${SAGE};color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:700;">Explore the full map →</a>
    </p>
    <p style="font-size:12.5px;color:${FAINT};text-align:center;line-height:1.6;">
      Found somewhere great? <a href="${APP_URL}" style="color:${SAGE};">Add it to the map</a> and it might headline next week.
    </p>
    <p style="font-size:11px;color:${FAINT};text-align:center;margin-top:20px;border-top:1px solid ${LINE};padding-top:14px;">
      You're getting this because you signed in to What's Trending Bangalore.
    </p>
  </div>
  </div>`;
}

// ── provider-swappable email send (currently Resend) ─────────────────────────
async function sendEmail(apiKey: string, from: string, to: string[], subject: string, html: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    // One To recipient per send would leak nothing, but batching via bcc keeps
    // us inside the free tier; Resend supports up to 50 bcc per call.
    body: JSON.stringify({ from, to: from, bcc: to, subject, html }),
  });
  if (!res.ok) {
    throw new Error(`Resend send failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
}

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

async function main() {
  const dryRunFlag = process.argv.includes("--dry-run");
  const htmlOutIdx = process.argv.indexOf("--html-out");
  const htmlOut = htmlOutIdx >= 0 ? process.argv[htmlOutIdx + 1] : null;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.NEWSLETTER_FROM || "What's Trending Bangalore <onboarding@resend.dev>";
  const dryRun = dryRunFlag || !supabaseUrl || !serviceKey || !resendKey;

  console.log(`Newsletter — ${dryRun ? "DRY RUN (no sends)" : "LIVE"}`);
  if (dryRun && !dryRunFlag) {
    if (!resendKey) console.log("  (RESEND_API_KEY unset → sends skipped)");
    if (!supabaseUrl || !serviceKey) console.log("  (Supabase service-role env unset)");
  }

  if (!supabaseUrl || !serviceKey) return;
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false }, realtime: { transport: ws as unknown as WebSocketLikeConstructor } });

  const { data, error } = await supabase
    .from("places_with_stats")
    .select("id, title, description, category, area, lat, lng, image_url, website, rating, rating_count, price_level, vote_count, comment_count, trending_score, event_start, event_end")
    .eq("status", "approved")
    .order("trending_score", { ascending: false })
    .limit(60);
  if (error) throw error;

  const curation = curate((data ?? []) as TrendingPlace[]);
  const { runnersUp, events } = curation;
  const picks: Pick_[] = curation.picks.map((p) => ({ ...p, mention: null, editorial: null }));
  if (picks.length === 0 && events.length === 0) {
    console.log("Nothing worth curating this week — skipping.");
    return;
  }
  await attachBuzz(supabase, picks);
  await writeEditorial(picks);

  const weekOf = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const subject = `Your Bangalore weekend, sorted — ${picks.map((p) => p.place.title).slice(0, 2).join(", ")} & more`;
  const html = buildHtml(picks, runnersUp, events, weekOf);
  if (htmlOut) {
    writeFileSync(htmlOut, html);
    console.log(`HTML written to ${htmlOut}`);
  }

  // Recipients: everyone who has signed in (paginated admin list).
  const emails: string[] = [];
  for (let page = 1; ; page++) {
    const { data: users, error: uErr } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (uErr) throw uErr;
    for (const u of users.users) if (u.email) emails.push(u.email);
    if (users.users.length < 1000) break;
  }
  console.log(`${picks.length} pick(s) + ${events.length} event(s); ${emails.length} recipient(s).`);

  if (dryRun) {
    console.log(`Subject: ${subject}`);
    for (const p of picks) {
      console.log(`  [${p.section}] ${p.place.title} (score ${p.place.trending_score}, ★${p.place.rating ?? "–"})${p.editorial ? ` — "${p.editorial.good_for}", ${p.editorial.tips.length} tip(s)` : " — no editorial (fallback text)"}`);
    }
    for (const e of events) console.log(`  [event] ${e.title} (${e.event_start})`);
    return;
  }

  for (const group of chunk(emails, 50)) {
    await sendEmail(resendKey!, from, group, subject, html);
    console.log(`  sent to ${group.length} recipient(s)`);
  }
  console.log("Done.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
