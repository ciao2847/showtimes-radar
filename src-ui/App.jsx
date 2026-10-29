import { useEffect, useState, useRef } from "react";
import { FLOW_STEPS } from "../src/progress.js";
const initial = {
  movie: "",
  date: new Date().toISOString().slice(0, 10),
  time: "",
  cinema: "",
  room: "",
  ticketKeyword: "全票",
  quantity: "2",
  startAt: "",
  pollIntervalSeconds: "15",
  autoOpen: true,
};
const field =
  "w-full border border-line bg-[#21172b] px-3 py-3 text-sm outline-none transition focus:border-acid focus:shadow-[0_0_0_3px_#a970ff22]";
async function api(path, options) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "操作失敗");
  return data;
}
function Field({ label, children }) {
  return (
    <label className="grid gap-2 text-xs text-muted">
      <span>{label}</span>
      {children}
    </label>
  );
}
function FlowProgress({ status }) {
  const progress = status.progress;
  const current = FLOW_STEPS.findIndex(step => step.id === progress?.step);
  const time = value => new Date(value).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
  return (
    <div className="my-5 border border-line bg-[#17121e] p-4">
      <div className="mb-4 flex items-center justify-between gap-3 text-xs">
        <b>執行進度</b>
        <span className={progress?.status === "error" ? "text-red-400" : "text-acid"}>
          {progress?.status === "error" ? "需要處理" : progress?.status === "paused" ? "已停止監看" : progress?.step === "confirm" ? "座位已保留" : status.running || status.bookingActive ? "執行中" : "尚未開始"}
        </span>
      </div>
      <ol className="grid grid-cols-3 gap-2 max-sm:grid-cols-2" aria-label="訂票流程">
        {FLOW_STEPS.map((step, index) => {
          const active = index === current;
          const done = index < current;
          const failed = active && progress?.status === "error";
          return <li key={step.id} aria-current={active ? "step" : undefined} className={`flex items-center gap-2 border p-2 text-xs ${failed ? "border-red-400 bg-red-400/10 text-red-300" : active ? "border-acid bg-acid/10 text-acid" : done ? "border-green-400/30 text-green-300" : "border-line text-muted"}`}>
            <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${active && progress?.status === "working" ? "animate-pulse" : ""}`}>{failed ? "!" : done ? "✓" : index + 1}</span>
            {step.label}
          </li>;
        })}
      </ol>
      <p role="status" aria-live="polite" className={`mt-4 text-sm ${progress?.status === "error" ? "text-red-300" : "text-acid"}`}>{progress?.message || "設定名稱與張數後開始監看"}</p>
      {status.running && status.nextCheckAt && !status.bookingActive && <p className="mt-2 text-xs text-muted">下次掃描 {time(status.nextCheckAt)}</p>}
      {!!status.progressLog?.length && <details open className="mt-4 text-xs text-muted">
        <summary className="cursor-pointer">執行紀錄（{status.progressLog.length}）</summary>
        <ol className="mt-3 grid max-h-48 gap-2 overflow-auto">
          {[...status.progressLog].reverse().map((entry, index) => <li key={`${entry.updatedAt}-${index}`} className={entry.status === "error" ? "text-red-300" : ""}><time>{time(entry.updatedAt)}</time> · {entry.message}</li>)}
        </ol>
      </details>}
    </div>
  );
}
export default function App() {
  const statusRequest = useRef(0);
  const statusUpdating = useRef(false);
  const [form, setForm] = useState(initial),
    [status, setStatus] = useState({ matches: [] }),
    [auth, setAuth] = useState({ status: "unknown" }),
    [error, setError] = useState("");
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const refresh = async () => {
    if (statusUpdating.current) return;
    const request = ++statusRequest.current;
    const [s, a] = await Promise.all([api("/api/status"), api("/api/auth")]);
    if (request !== statusRequest.current) return;
    setStatus(s);
    setAuth(a);
  };
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, []);
  const start = async (e) => {
    e.preventDefault();
    setError("");
    ++statusRequest.current;
    statusUpdating.current = true;
    try {
      setStatus(
        await api("/api/watch", { method: "POST", body: JSON.stringify(form) }),
      );
    } catch (e) {
      setError(e.message);
    } finally { statusUpdating.current = false; }
  };
  const stop = async () =>
    setStatus(await api("/api/watch", { method: "DELETE" }));
  const login = async () => {
    await api("/api/auth/login", { method: "POST", body: "{}" });
    refresh();
  };
  return (
    <div className="min-h-screen">
      <header className="fixed inset-x-0 top-0 z-20 flex h-20 items-center justify-between border-b border-line bg-[#0d0b12]/95 px-[5vw]">
        <div className="flex items-center gap-3 font-black tracking-widest">
          <span className="grid h-10 w-10 place-items-center bg-acid text-xl text-black">
            秀
          </span>
          SHOWTIMES <b className="text-acid">RADAR</b>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span
            className={`h-2 w-2 rounded-full ${auth.status === "loggedIn" ? "bg-green-400" : "bg-gray-500"}`}
          />
          <span>{auth.message}</span>
          <button
            onClick={login}
            className="border border-line px-3 py-2 hover:border-acid"
          >
            登入秀泰
          </button>
        </div>
      </header>
      <main className="mx-auto w-[min(1300px,92vw)] pt-32 pb-12">
        <p className="text-xs font-bold tracking-[.3em] text-acid">
          SPECIAL EVENT TICKETS
        </p>
        <h1 className="my-5 text-[clamp(48px,7vw,94px)] font-black leading-none tracking-[-.06em]">
          特別場，<span className="text-acid">準時出手。</span>
        </h1>
        <p className="mb-10 text-muted">
          以有票為優先：依名稱查詢場次與空位，空位足夠就自動選票、保留座位，成功後開啟訂單確認。
        </p>
        <div className="grid grid-cols-[.9fr_1.1fr] gap-5 max-lg:grid-cols-1">
          <form onSubmit={start} className="border border-line bg-panel p-7">
            <h2 className="mb-7 text-sm tracking-widest">01 / 目標設定</h2>
            <Field label="特別場名稱搜尋">
              <input
                required
                className={`${field} text-lg`}
                value={form.movie}
                onChange={(e) => update("movie", e.target.value)}
                placeholder="例如：泥面人"
              />
            </Field>
            <div className="mt-5 grid grid-cols-2 gap-4 max-sm:grid-cols-1">
              <Field label="日期">
                <input
                  type="date"
                  required
                  className={field}
                  value={form.date}
                  onChange={(e) => update("date", e.target.value)}
                />
              </Field>
              <Field label="時間（可留空）">
                <input
                  type="time"
                  className={field}
                  value={form.time}
                  onChange={(e) => update("time", e.target.value)}
                />
              </Field>
              <Field label="影城（可留空）">
                <input
                  className={field}
                  value={form.cinema}
                  onChange={(e) => update("cinema", e.target.value)}
                  placeholder="大巨蛋秀泰"
                />
              </Field>
              <Field label="影廳 / 版本（可留空）">
                <input
                  className={field}
                  value={form.room}
                  onChange={(e) => update("room", e.target.value)}
                  placeholder="ULTRA 4DX"
                />
              </Field>
              <Field label="票種名稱關鍵字">
                <input className={field} value={form.ticketKeyword} onChange={(e) => update("ticketKeyword", e.target.value)} placeholder="例如：另一個媽咪》DVA特別場套票" />
              </Field>
              <Field label="希望張數">
                <select
                  className={field}
                  value={form.quantity}
                  onChange={(e) => update("quantity", e.target.value)}
                >
                  {[1, 2, 3, 4, 5, 6].map((number) => (
                    <option key={number} value={number}>
                      {number} 張
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="開始監看時間（可留空）">
                <input
                  type="datetime-local"
                  className={field}
                  value={form.startAt}
                  onChange={(e) => update("startAt", e.target.value)}
                />
              </Field>
              <Field label="掃描間隔">
                <select
                  className={field}
                  value={form.pollIntervalSeconds}
                  onChange={(e) =>
                    update("pollIntervalSeconds", e.target.value)
                  }
                >
                  {[5, 10, 15, 30, 60].map((n) => (
                    <option key={n} value={n}>
                      {n} 秒
                    </option>
                  ))}
                </select>
              </Field>
              <p className="text-sm text-white/60">自動選位已啟用：優先連座，也可分開坐，維持指定張數。排程會提前 8 秒預載票種，開始時間到才會自動訂票。</p>

            </div>
            <div className="mt-7 flex gap-3">
              <button className="flex-1 bg-acid px-5 py-4 font-black text-black">
                {status.running ? "更新條件" : "開始監看並自動選位"}
              </button>
              {status.running && (
                <button
                  type="button"
                  onClick={stop}
                  className="bg-[#302c38] px-5"
                >
                  停止
                </button>
              )}
            </div>
            <p className="mt-3 min-h-4 text-xs text-red-400">{error}</p>
          </form>
          <section className="flex min-h-[570px] flex-col border border-line bg-panel p-7">
            <div className="mb-6 flex justify-between">
              <h2 className="text-sm tracking-widest">02 / 即時雷達</h2>
              <span className="text-xs text-muted">
                {status.checks || 0} 次掃描
              </span>
            </div>
            <FlowProgress status={status} />
            {!status.config ? (
              <div className="grid flex-1 place-items-center border border-dashed border-line text-center text-muted">
                設定特別場後啟動監看
              </div>
            ) : (
              <>
                <div className="border-l-2 border-acid bg-[#211e28] p-5">
                  <b className="text-xl">{status.config.movie || `節目 ${status.config.programId}`}</b>
                  <p className="mt-2 text-xs text-muted">
                    {status.config.date} · {status.config.cinema || "全部影城"}{" "}
                    · {status.config.time || "全部時間"} · 票種：{status.config.ticketKeyword}
                  </p>
                </div>
                <div className="grid gap-3 overflow-auto">
                  {status.matches?.map((item) => (
                    <article
                      key={item.id}
                      className="flex items-center gap-4 border border-line bg-[#211e28] p-4 max-sm:flex-wrap"
                    >
                      <b className="text-2xl text-acid">{item.time}</b>
                      <div>
                        <h3 className="text-sm font-bold">{item.movie}</h3>
                        <p className="text-xs text-muted">
                          {item.date} · {item.cinema} ·{" "}
                          {item.room || item.format} · 空位 {item.availableSeats ?? "未知"}
                        </p>
                      </div>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto bg-acid px-4 py-3 text-xs font-black text-black"
                      >
                        手動開啟秀泰
                      </a>
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
        <p className="mt-6 text-center text-[11px] text-muted">
          不繞過 Turnstile、人機驗證或付款確認；請先在 Chrome 登入；自動選票與保留座位後，由你確認訂單與付款。請遵守影城規範。
        </p>
      </main>
    </div>
  );
}
