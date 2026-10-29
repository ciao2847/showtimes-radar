import { FLOW_STEPS } from "./progress.js";
import { fetchSpecialSessions, normalizeDate } from "./showtimes-api.js";
import { startBooking, cancelActiveBooking, prepareBooking } from "./booking-flow.js";

export function validateWatchConfig(input = {}) {
  const movie = String(input.movie || "").trim();
  const target = String(input.program || "").trim();
  const programId = target ? target.match(/^(?:https:\/\/www\.showtimes\.com\.tw\/programs\/)?([1-9]\d*)\/?(?:[?#].*)?$/)?.[1] : undefined;
  if (target && !programId) throw new Error("請輸入秀泰節目網址或節目 ID");
  const date = normalizeDate(input.date);
  if (!movie && !programId) throw new Error("請輸入特別場名稱關鍵字");
  if (!date) throw new Error("日期格式請使用 YYYY-MM-DD 或 M/D");
  const quantity = Number(input.quantity || 1);
  const interval = Number(input.pollIntervalSeconds || 15);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 6) throw new Error("張數必須介於 1–6 張");
  if (!Number.isFinite(interval) || interval < 5) throw new Error("掃描間隔不可少於 5 秒");
  const start = input.startAt ? new Date(input.startAt) : null;
  if (start && Number.isNaN(start.valueOf())) throw new Error("開始時間格式不正確");
  return { movie, programId, date, time: String(input.time || "").trim() || undefined, cinema: String(input.cinema || "").trim() || undefined, room: String(input.room || "").trim() || undefined, ticketKeyword: String(input.ticketKeyword || "").trim() || "全票", quantity, startAt: start?.toISOString(), pollIntervalSeconds: interval, autoOpen: input.autoOpen !== false && input.autoOpen !== "false" };
}

export function matchesSession(item, config) {
  const includes = (actual, wanted) => !wanted || String(actual || "").toLowerCase().includes(String(wanted).toLowerCase());
  return (!config.programId || String(item.programId) === config.programId) && includes(item.movie, config.movie) && item.date === config.date && includes(item.time, config.time) && includes(item.cinema, config.cinema) && includes(`${item.room} ${item.format}`, config.room);
}

export function createWatchService(deps = {}) {
  const getSessions = deps.fetchSessions || fetchSpecialSessions;
  const bookFlow = deps.startBooking || startBooking;
  const warmFlow = deps.prepareBooking || prepareBooking;
  const cancelFlow = deps.cancelBooking || cancelActiveBooking;
  const setTimer = deps.setTimeoutFn || setTimeout, clearTimer = deps.clearTimeoutFn || clearTimeout, now = deps.now || Date.now;
  let timer, preparationTimer, warmBusy = false, lastWarmAt = -Infinity, generation = 0, bookingEpoch = 0, pendingBooking = null, autoOpened = new Set();
  let state = { running: false, checks: 0, matches: [], sessionCount: 0, checkedAt: null, nextCheckAt: null, config: null, error: null, bookingActive: false, bookingStatus: null, bookingResultStatus: null, progress: null, progressLog: [] };
  const setProgress = (step, message, status = "working") => {
    if (!FLOW_STEPS.some(item => item.id === step)) return;
    if (state.progress?.step === step && state.progress?.message === message && state.progress?.status === status) return;
    const progress = { step, message, status, updatedAt: new Date(now()).toISOString() };
    state = { ...state, progress, progressLog: [...state.progressLog, progress].slice(-40) };
  };
  const snapshot = () => ({ ...state, matches: [...state.matches], progressLog: [...state.progressLog] });
  const stop = () => { generation++; if (timer) clearTimer(timer); if (preparationTimer) clearTimer(preparationTimer); timer = undefined; preparationTimer = undefined; state = { ...state, running: false, nextCheckAt: null }; if (state.progress && !state.bookingActive) setProgress(state.progress.step, "已停止監看", "paused"); return snapshot(); };
  const book = async (input) => {
    if (state.bookingActive || pendingBooking) return snapshot();
    const epoch = bookingEpoch;
    const task = {};
    pendingBooking = task;
    const isCurrent = () => epoch === bookingEpoch;
    let completed = false;
    const finish = result => {
      if (!isCurrent() || completed) return;
      completed = true;
      state = { ...state, bookingActive: result.status === "reserved", bookingStatus: result.message, bookingResultStatus: result.status };
      setProgress(result.status === "reserved" ? "confirm" : state.progress?.step || "connect", result.message, result.status === "reserved" ? "success" : "error");
    };
    state = { ...state, bookingActive: true, bookingStatus: "正在連線秀泰", bookingResultStatus: null };
    setProgress("connect", "等待 Chrome 擴充功能接收指令，請保持已登入的秀泰分頁開啟");
    try {
      const result = await bookFlow({ ...state.config, ...input,
        onProgress: progress => { if (isCurrent()) setProgress(progress.step, progress.message); },
        onStatus: message => { if (isCurrent()) state = { ...state, bookingStatus: message }; },
        onResult: finish
      });
      if (result) finish(result);
    } catch (error) {
      finish({ status: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      if (pendingBooking === task) pendingBooking = null;
      if (!isCurrent() && state.running) setProgress("search", "已切換監看條件，將查詢新電影；舊場次如已保留，請至秀泰確認或取消");
    }
    return snapshot();
  };
  const warm = async (version, session) => {
    if (version !== generation || !state.running || pendingBooking || state.bookingActive || warmBusy || now() - lastWarmAt < 8_000) return;
    warmBusy = true;
    lastWarmAt = now();
    const config = { ...state.config };
    try {
      const target = session || (await getSessions()).find(item => matchesSession(item, config));
      if (!target || version !== generation || !state.running) return;
      setProgress("search", "正在預先載入票種；尚未建立訂票或保留座位", "waiting");
      const result = await warmFlow({ ...config, url: target.url });
      if (version === generation && state.running && !pendingBooking && !state.bookingActive) setProgress("search", result?.message || "票種預載未完成，命中後會即時查詢", "waiting");
    } catch (error) {
      if (version === generation && state.running && !pendingBooking && !state.bookingActive) setProgress("search", `票種預載未完成：${error.message}；命中後會即時查詢`, "waiting");
    } finally { warmBusy = false; }
  };
  const scan = async (version) => {
    if (!state.running || version !== generation) return;
    try {
      if (!pendingBooking && !state.bookingActive && !state.bookingResultStatus) setProgress("search", "正在查詢秀泰場次與剩餘空位");
      const sessions = await getSessions();
      if (!state.running || version !== generation) return;
      const found = sessions.filter((item) => matchesSession(item, state.config));
      state = { ...state, checks: state.checks + 1, matches: found, sessionCount: sessions.length, checkedAt: new Date(now()).toISOString(), error: null };
      if (!pendingBooking && !state.bookingActive && !state.bookingResultStatus) setProgress("waiting", found.length ? `找到 ${found.length} 個符合場次，等待至少 ${state.config.quantity} 個空位${state.config.autoOpen ? "" : "；目前為手動選位模式"}` : "尚無符合名稱、日期與影城的場次，持續監看中");
      const first = found.find((x) => Number.isInteger(x.availableSeats) && x.availableSeats >= state.config.quantity && !autoOpened.has(x.id));
      if (!first && found.length && state.config.autoOpen && !state.bookingActive && !pendingBooking) void warm(version, found[0]);
      if (first && state.config.autoOpen && !state.bookingActive && !pendingBooking) {
        autoOpened.add(first.id);
        void book({ url: first.url }).then((bookingState) => {
          // Browser/profile failures are retryable. Let the next scan attempt
          // the same matching session again after the user closes login Chrome.
          if (version === generation && ["error", "busy"].includes(bookingState.bookingResultStatus)) autoOpened.delete(first.id);
        }).catch(() => { if (version === generation) autoOpened.delete(first.id); });
      }
    } catch (error) { if (version === generation && !state.bookingActive) setProgress("search", error instanceof Error ? error.message : String(error), "error"); if (version === generation) state = { ...state, checks: state.checks + 1, checkedAt: new Date(now()).toISOString(), error: error instanceof Error ? error.message : String(error) }; }
    if (state.running && version === generation) { const delay = state.config.pollIntervalSeconds * 1000; state = { ...state, nextCheckAt: new Date(now() + delay).toISOString() }; timer = setTimer(() => scan(version), delay); }
  };
  const start = (input) => {
    const config = validateWatchConfig(input);
    stop();
    bookingEpoch++;
    config.watchKey = `${now()}-${bookingEpoch}`;
    lastWarmAt = -Infinity;
    const version = generation;
    autoOpened = new Set();
    state = { ...state, running: true, checks: 0, matches: [], sessionCount: 0, checkedAt: null,
      config, error: null, bookingActive: false, bookingStatus: null, bookingResultStatus: null,
      progress: null, progressLog: [], nextCheckAt: config.startAt || new Date(now()).toISOString() };
    const delay = Math.max(0, (config.startAt ? new Date(config.startAt).valueOf() : now()) - now());
    setProgress("search", pendingBooking ? "已切換電影，等待上一筆已送出的訂票回應；新條件會繼續查詢場次" : delay > 0 ? "已排程，等待設定時間開始監看" : "準備查詢秀泰場次與空位", pendingBooking || delay > 0 ? "waiting" : "working");
    if (delay > 0 && config.autoOpen) preparationTimer = setTimer(() => warm(version), Math.max(0, delay - 8_000));
    timer = setTimer(() => scan(version), delay);
    return snapshot();
  };
  return { getState: snapshot, start, stop, book, cancelBooking: async () => { await cancelFlow(); state = { ...state, bookingActive: false, bookingStatus: "已取消訂票流程" }; return snapshot(); } };
}
