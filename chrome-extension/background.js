let lastCommandId = 0;

let inFlight = false;
async function pollRadar() {
  if (inFlight) return;
  inFlight = true;
  try {
    const response = await fetch("http://127.0.0.1:4173/api/extension-command", { cache: "no-store" });
    if (!response.ok) return;
    const command = await response.json();
    if (!command?.id || command.id <= lastCommandId) return;
    lastCommandId = command.id;
    let result;
    try {
      const tabs = await chrome.tabs.query({ url: "https://www.showtimes.com.tw/*" });
      const probes = await Promise.allSettled(tabs.filter(tab => tab.id).map(async tab => {
        const info = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: () => {
          try {
            const { protocol, hostname, port = 80 } = location;
            const user = JSON.parse(sessionStorage.getItem(`${protocol}//${hostname}:${port}/cinehub-frontend/globalStoreUser`) || "null");
            return { loggedIn: typeof user?.accessToken === "string" && user.accessToken.length > 0 };
          } catch { return { loggedIn: false }; }
        } });
        return { tab, loggedIn: info[0]?.result?.loggedIn === true };
      }));
      const loggedInTabs = probes.filter(probe => probe.status === "fulfilled" && probe.value.loggedIn).map(probe => probe.value.tab);
      const target = loggedInTabs.find(tab => tab.active) || loggedInTabs.sort((left, right) => (right.lastAccessed || 0) - (left.lastAccessed || 0))[0];
      if (!target?.id) throw new Error(tabs.length ? "所有秀泰分頁皆未讀到登入資料，請在已登入分頁重新整理後再試" : "找不到秀泰分頁，請按登入秀泰並保留分頁");
      const url = new URL(command.url);
      const match = url.pathname.match(/^\/ticketing\/cart\/selectTicketTypes\/(\d+)$/);
      if (!match || url.origin !== "https://www.showtimes.com.tw") throw new Error("場次網址不正確");
      await chrome.scripting.executeScript({ target: { tabId: target.id }, world: "MAIN", files: ["seat-planner.js", "api-booking.js"] });
      let reading = false;
      let lastReport = Promise.resolve();
      const reportProgress = () => {
        if (reading) return lastReport;
        reading = true;
        lastReport = (async () => {
          const progress = await chrome.scripting.executeScript({ target: { tabId: target.id }, world: "MAIN", func: () => globalThis.ShowtimesApiProgress || [] });
          await fetch("http://127.0.0.1:4173/api/extension-command/progress", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: command.id, entries: progress[0]?.result || [] }) });
        })().catch(() => {}).finally(() => { reading = false; });
        return lastReport;
      };
      const progressTimer = command.kind === "prepare" ? null : setInterval(reportProgress, 400);
      let output;
      try {
        output = await chrome.scripting.executeScript({
        target: { tabId: target.id }, world: "MAIN",
        func: config => config.prepareOnly ? globalThis.ShowtimesApiBooking.prefetch(config) : globalThis.ShowtimesApiBooking.run(config),
        args: [{ prepareOnly: command.kind === "prepare", watchKey: command.watchKey, sessionContext: command.sessionContext, detectedAt: command.createdAt, eventId: match[1], quantity: url.searchParams.get("radarQuantity"), ticketKeyword: url.searchParams.get("radarTicketKeyword") || "全票" }]
      });
      } finally {
        clearInterval(progressTimer);
        await lastReport;
        if (command.kind !== "prepare") await reportProgress();
      }
      result = output[0]?.result;
      if (!result) throw new Error("秀泰 API 選位未回傳結果，請確認分頁");
      if (result.status === "reserved") {
        await chrome.tabs.update(target.id, { url: result.url, active: true });
        if (target.windowId) await chrome.windows.update(target.windowId, { focused: true });
      }
    } catch (error) { result = { status: "error", message: error.message }; }
    await fetch("http://127.0.0.1:4173/api/extension-command/ack", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: command.id, result })
    });
  } catch {} finally { inFlight = false; }
}

chrome.alarms.create("showtimes-radar-poll", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "showtimes-radar-poll") void pollRadar(); });
setInterval(() => { void pollRadar(); }, 200);
void pollRadar();
