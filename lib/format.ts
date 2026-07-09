export function timeAgo(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  const days = Math.floor(seconds / 86400);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function formatEventWindow(start: string, end: string | null): string {
  const s = new Date(start);
  const day = s.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  const st = s.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  if (!end) return `${day}, ${st}`;
  const e = new Date(end);
  const et = e.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  return `${day}, ${st} – ${et}`;
}

// An event is over once its end has passed (or its start, when it has no end).
export function isPastEvent(p: { category: string; event_start: string | null; event_end: string | null }): boolean {
  if (p.category !== "event") return false;
  const cutoff = p.event_end ?? p.event_start;
  if (!cutoff) return false;
  return new Date(cutoff).getTime() < Date.now();
}

// "This weekend" = from now through the end of the coming Sunday.
export function isThisWeekend(eventStart: string | null): boolean {
  if (!eventStart) return false;
  const start = new Date(eventStart);
  const now = new Date();
  const endOfSunday = new Date(now);
  const daysUntilSunday = (7 - now.getDay()) % 7;
  endOfSunday.setDate(now.getDate() + daysUntilSunday);
  endOfSunday.setHours(23, 59, 59, 999);
  return start >= now && start <= endOfSunday;
}
