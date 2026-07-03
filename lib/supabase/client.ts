import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Mock mode: no Supabase project configured yet. The app runs fully
// with local seed data; votes/comments live in memory for the session.
export const MOCK_MODE = !url || !anonKey;

export function supabaseBrowser() {
  if (MOCK_MODE) throw new Error("Supabase is not configured (mock mode)");
  return createBrowserClient(url!, anonKey!);
}
