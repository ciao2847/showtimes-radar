export const SITE_URL = "https://www.showtimes.com.tw";
export const API_URL = "https://capi.showtimes.com.tw/4";

export function normalizeDate(value) {
  const match = String(value || "").trim().match(/^(?:(\d{4})[-/])?(\d{1,2})[-/](\d{1,2})$/);
  if (!match) return null;
  const year = match[1] || new Date().getFullYear();
  return `${year}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

export function parseBootstrap(payload) {
  const data = payload?.payload || payload;
  const programs = new Map((data?.programs || []).map((item) => [item.id, item]));
  const cinemas = new Map((data?.corporations || []).map((item) => [item.id, item]));
  const specialIds = new Set(data?.specialProgramIds || (data?.programs || []).filter((p) => p.meta?.isSpecial).map((p) => p.id));
  const venueNames = new Map();
  const groupedEvents = Object.values(data?.eventsForCorporations || {});
  for (const group of groupedEvents) for (const venue of group.venues || []) venueNames.set(venue.id, venue.name || venue.room || "");
  const events = data?.events || groupedEvents.flatMap((group) => group.events || []);
  return events.filter((event) => specialIds.has(event.programId)).map((event) => {
    const program = programs.get(event.programId) || {};
    const cinema = cinemas.get(event.corporationId) || {};
    const started = new Date(event.startedAt);
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(started).map((part) => [part.type, part.value]));
    return {
      id: event.id,
      movie: program.name || `節目 ${event.programId}`,
      date: Number.isNaN(started.valueOf()) ? "" : `${parts.year}-${parts.month}-${parts.day}`,
      time: Number.isNaN(started.valueOf()) ? "" : `${parts.hour}:${parts.minute}`,
      room: event.meta?.venueName || event.meta?.venue || event.venueName || event.venue || venueNames.get(event.venueId) || event.meta?.format || "",
      cinema: cinema.name || `影城 ${event.corporationId}`,
      format: event.meta?.format || "",
      startedAt: event.startedAt,
      listedAt: event.listedAt,
      url: `${SITE_URL}/ticketing/cart/selectTicketTypes/${event.id}`
    };
  });
}

export async function fetchSpecialSessions(fetchImpl = fetch) {
  const response = await fetchImpl(`${API_URL}/app/bootstrap`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`秀泰場次 API 回應 ${response.status}`);
  return parseBootstrap(await response.json());
}
