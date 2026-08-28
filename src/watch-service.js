import { fetchSpecialSessions, normalizeDate } from "./showtimes-api.js";
import { startBooking, cancelActiveBooking } from "./booking-flow.js";

export function validateWatchConfig(input = {}) {
  const movie = String(input.movie || "").trim();
  const date = normalizeDate(input.date);
  if (!movie) throw new Error("請輸入特別場名稱關鍵字");
  if (!date) throw new Error("日期格式請使用 YYYY-MM-DD 或 M/D");
  const quantity = Number(input.quantity || 1);
  const interval = Number(input.pollIntervalSeconds || 15);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 6) throw new Error("張數必須介於 1–6 張");
  if (!Number.isFinite(interval) || interval < 5) throw new Error("掃描間隔不可少於 5 秒");
  const start = input.startAt ? new Date(input.startAt) : null;
  if (start && Number.isNaN(start.valueOf())) throw new Error("開始時間格式不正確");
  return { movie, date, time: String(input.time || "").trim() || undefined, cinema: String(input.cinema || "").trim() || undefined, room: String(input.room || "").trim() || undefined, ticketKeyword: String(input.ticketKeyword || "").trim() || "全票", quantity, seatPreference: input.seatPreference || "middleBack", preferAisle: input.preferAisle === true || input.preferAisle === "true", startAt: start?.toISOString(), pollIntervalSeconds: interval, autoOpen: input.autoOpen !== false && input.autoOpen !== "false" };
}

export function matchesSession(item, config) {
  const includes = (actual, wanted) => !wanted || String(actual || "").toLowerCase().includes(String(wanted).toLowerCase());
  return includes(item.movie, config.movie) && item.date === config.date && includes(item.time, config.time) && includes(item.cinema, config.cinema) && includes(`${item.room} ${item.format}`, config.room);
}

export function createWatchService(deps = {}) {
  const getSessions = deps.fetchSessions || fetchSpecialSessions;
  const bookFlow = deps.startBooking || startBooking;
  const cancelFlow = deps.cancelBooking || cancelActiveBooking;
  const setTimer = deps.setTimeoutFn || setTimeout, clearTimer = deps.clearTimeoutFn || clearTimeout, now = deps.now || Date.now;
  let timer, generation = 0, autoOpened = new Set();
  let state = { running: false, checks: 0, matches: [], sessionCount: 0, checkedAt: null, nextCheckAt: null, config: null, error: null, bookingActive: false, bookingStatus: null, bookingResultStatus: null };
  const snapshot = () => ({ ...state, matches: [...state.matches] });
  const stop = () => { generation++; if (timer) clearTimer(timer); timer = undefined; state = { ...state, running: false, nextCheckAt: null }; return snapshot(); };
  const book = async (input) => {
    state = { ...state, bookingActive: true, bookingStatus: "正在開啟秀泰訂票頁", bookingResultStatus: null };
    const result = await bookFlow({ ...state.config, ...input, onStatus: (message) => { state = { ...state, bookingStatus: message }; }, onResult: (result) => { state = { ...state, bookingActive: false, bookingStatus: result.message, bookingResultStatus: result.status }; } });
    if (!["paymentOpened", "manualCheckout"].includes(result?.status)) state = { ...state, bookingActive: false };
    return snapshot();
  };
  const scan = async (version) => {
    if (!state.running || version !== generation) return;
    try {
      const sessions = await getSessions();
      if (!state.running || version !== generation) return;
      const found = sessions.filter((item) => matchesSession(item, state.config));
      state = { ...state, checks: state.checks + 1, matches: found, sessionCount: sessions.length, checkedAt: new Date(now()).toISOString(), error: null };
      const first = found.find((x) => !autoOpened.has(x.id));
      if (first && state.config.autoOpen) {
        autoOpened.add(first.id);
        void book({ url: first.url }).then((bookingState) => {
          // Browser/profile failures are retryable. Let the next scan attempt
          // the same matching session again after the user closes login Chrome.
          if (["error", "busy"].includes(bookingState.bookingResultStatus)) autoOpened.delete(first.id);
        }).catch(() => { autoOpened.delete(first.id); });
      }
    } catch (error) { if (version === generation) state = { ...state, checks: state.checks + 1, checkedAt: new Date(now()).toISOString(), error: error instanceof Error ? error.message : String(error) }; }
    if (state.running && version === generation) { const delay = state.config.pollIntervalSeconds * 1000; state = { ...state, nextCheckAt: new Date(now() + delay).toISOString() }; timer = setTimer(() => scan(version), delay); }
  };
  const start = (input) => { stop(); const config = validateWatchConfig(input); generation++; const version = generation; autoOpened = new Set(); state = { ...state, running: true, checks: 0, matches: [], config, error: null, nextCheckAt: config.startAt || new Date(now()).toISOString() }; const delay = Math.max(0, (config.startAt ? new Date(config.startAt).valueOf() : now()) - now()); timer = setTimer(() => scan(version), delay); return snapshot(); };
  return { getState: snapshot, start, stop, book, cancelBooking: async () => { await cancelFlow(); state = { ...state, bookingActive: false, bookingStatus: "已取消訂票流程" }; return snapshot(); } };
}
