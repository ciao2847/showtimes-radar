import { useEffect, useState } from "react";
const initial = {
  movie: "",
  date: new Date().toISOString().slice(0, 10),
  time: "",
  cinema: "",
  room: "",
  ticketKeyword: "全票",
  quantity: "2",
  seatPreference: "middleBack",
  preferAisle: false,
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
export default function App() {
  const [form, setForm] = useState(initial),
    [status, setStatus] = useState({ matches: [] }),
    [auth, setAuth] = useState({ status: "unknown" }),
    [error, setError] = useState("");
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const refresh = async () => {
    const [s, a] = await Promise.all([api("/api/status"), api("/api/auth")]);
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
    try {
      setStatus(
        await api("/api/watch", { method: "POST", body: JSON.stringify(form) }),
      );
    } catch (e) {
      setError(e.message);
    }
  };
  const stop = async () =>
    setStatus(await api("/api/watch", { method: "DELETE" }));
  const login = async () => {
    await api("/api/auth/login", { method: "POST", body: "{}" });
    refresh();
  };
  const book = async (item) => {
    setStatus((s) => ({ ...s, bookingStatus: "正在啟動訂票流程" }));
    await api("/api/book", {
      method: "POST",
      body: JSON.stringify({ url: item.url }),
    });
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
          監看秀泰官方特別場，一釋出就通知你並在正常 Chrome 開啟訂票頁。
        </p>
        <div className="grid grid-cols-[.9fr_1.1fr] gap-5 max-lg:grid-cols-1">
          <form onSubmit={start} className="border border-line bg-panel p-7">
            <h2 className="mb-7 text-sm tracking-widest">01 / 目標設定</h2>
            <Field label="特別場名稱關鍵字">
              <input
                required
                className={`${field} text-lg`}
                value={form.movie}
                onChange={(e) => update("movie", e.target.value)}
                placeholder="例如：攻殼機動隊"
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
              <Field label="張數">
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
              <Field label="座位偏好">
                <select
                  className={field}
                  value={form.seatPreference}
                  onChange={(e) => update("seatPreference", e.target.value)}
                >
                  <option value="middleBack">中後排</option>
                  <option value="center">正中間</option>
                  <option value="front">前排</option>
                  <option value="back">後排</option>
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
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={form.preferAisle}
                  onChange={(e) => update("preferAisle", e.target.checked)}
                />
                優先靠走道
              </label>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={form.autoOpen}
                  onChange={(e) => update("autoOpen", e.target.checked)}
                />
                命中自動開啟 Chrome
              </label>
            </div>
            <div className="mt-7 flex gap-3">
              <button className="flex-1 bg-acid px-5 py-4 font-black text-black">
                {status.running ? "更新條件" : "開始監看"}
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
            {!status.config ? (
              <div className="grid flex-1 place-items-center border border-dashed border-line text-center text-muted">
                設定特別場後啟動監看
              </div>
            ) : (
              <>
                <div className="border-l-2 border-acid bg-[#211e28] p-5">
                  <b className="text-xl">{status.config.movie}</b>
                  <p className="mt-2 text-xs text-muted">
                    {status.config.date} · {status.config.cinema || "全部影城"}{" "}
                    · {status.config.time || "全部時間"}
                  </p>
                </div>
                <p className="py-5 text-sm text-acid">
                  {status.bookingStatus ||
                    status.error ||
                    `${status.running ? "持續掃描中" : "已停止"} · 共 ${status.sessionCount || 0} 個公開特別場`}
                </p>
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
                          {item.room || item.format}
                        </p>
                      </div>
                      <button
                        onClick={() => book(item)}
                        className="ml-auto bg-acid px-4 py-3 text-xs font-black text-black"
                      >
                        在 Chrome 開啟
                      </button>
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
        <p className="mt-6 text-center text-[11px] text-muted">
          不繞過 Turnstile、人機驗證或付款確認；登入、選票、選位與付款皆由你在正常
          Chrome 完成。請遵守影城規範。
        </p>
      </main>
    </div>
  );
}
