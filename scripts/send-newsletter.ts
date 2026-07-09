/**
 * Weekly newsletter — "What's Trending Bangalore this week".
 *
 * Runs every Thursday from .github/workflows/newsletter.yml. Pulls the top 10
 * trending approved places (plus upcoming events) and emails every signed-up
 * user (Supabase auth users, via the service-role admin API).
 *
 * Email delivery is provider-swappable: it goes through sendEmail() below,
 * currently backed by Resend's REST API (free tier: 100 emails/day, 3,000/mo).
 * To switch providers, replace sendEmail()'s body — nothing else changes.
 *
 * Local dry run (builds the HTML, sends nothing):
 *   npx tsx scripts/send-newsletter.ts --dry-run
 *
 * Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
 *      RESEND_API_KEY, NEWSLETTER_FROM (e.g. "What's Trending Bangalore <hello@yourdomain.com>";
 *      the domain must be verified in Resend).
 */

import { fileURLToPath } from "node:url";
import { createClient, type WebSocketLikeConstructor } from "@supabase/supabase-js";
import ws from "ws"; // realtime transport: Node 20 lacks native WebSocket (unused here, but the client insists)

const APP_URL = "https://whatsupbangalore.netlify.app";
const TOP_N = 10;

interface TrendingPlace {
  id: string;
  title: string;
  description: string;
  category: string;
  area: string | null;
  vote_count: number;
  comment_count: number;
  trending_score: number;
  event_start: string | null;
  event_end: string | null;
}

const CATEGORY_EMOJI: Record<string, string> = {
  food: "🍛", drinks: "🍺", outdoors: "🌳", art_culture: "🎭",
  shopping: "🛍️", nightlife: "🌙", experience: "✨", event: "🎪",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildHtml(places: TrendingPlace[], weekOf: string): string {
  const rows = places.map((p, i) => `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #e7e5e4;">
        <div style="font-size:15px;font-weight:700;color:#1c1917;">
          ${i + 1}. ${CATEGORY_EMOJI[p.category] ?? "📍"} ${esc(p.title)}${p.area ? ` <span style="font-weight:500;color:#78716c;">· ${esc(p.area)}</span>` : ""}
        </div>
        <div style="font-size:13px;color:#57534e;margin-top:4px;line-height:1.5;">${esc(p.description).slice(0, 220)}</div>
        <div style="font-size:12px;color:#a8a29e;margin-top:4px;">▲ ${p.vote_count} · 💬 ${p.comment_count}</div>
      </td>
    </tr>`).join("");

  return `
  <div style="max-width:560px;margin:0 auto;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:24px 16px;">
    <h1 style="font-size:20px;color:#1c1917;">🔥 What's Trending Bangalore</h1>
    <p style="font-size:13.5px;color:#57534e;">The ${TOP_N} spots the city is talking about — week of ${weekOf}.</p>
    <table style="width:100%;border-collapse:collapse;">${rows}</table>
    <p style="margin-top:20px;">
      <a href="${APP_URL}" style="display:inline-block;background:#5b7553;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:13.5px;font-weight:700;">Open the map →</a>
    </p>
    <p style="font-size:11.5px;color:#a8a29e;margin-top:24px;">
      You're getting this because you signed in to What's Trending Bangalore.
    </p>
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
    .select("id, title, description, category, area, vote_count, comment_count, trending_score, event_start, event_end")
    .eq("status", "approved")
    .order("trending_score", { ascending: false })
    .limit(TOP_N * 2);
  if (error) throw error;

  // Skip events that will already be over by the time the email lands.
  const now = Date.now();
  const places = ((data ?? []) as TrendingPlace[])
    .filter((p) => p.category !== "event" || new Date(p.event_end ?? p.event_start ?? 0).getTime() > now)
    .slice(0, TOP_N);
  if (places.length === 0) {
    console.log("No trending places to send — skipping this week.");
    return;
  }

  const weekOf = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const subject = `🔥 What's trending in Bangalore — ${weekOf}`;
  const html = buildHtml(places, weekOf);

  // Recipients: everyone who has signed in (paginated admin list).
  const emails: string[] = [];
  for (let page = 1; ; page++) {
    const { data: users, error: uErr } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (uErr) throw uErr;
    for (const u of users.users) if (u.email) emails.push(u.email);
    if (users.users.length < 1000) break;
  }
  console.log(`Top ${places.length} places built; ${emails.length} recipient(s).`);

  if (dryRun) {
    console.log(`Subject: ${subject}`);
    for (const p of places) console.log(`  • ${p.title} (score ${p.trending_score})`);
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
