let lastCommandId = 0;

async function pollRadar() {
  try {
    const response = await fetch("http://127.0.0.1:4173/api/extension-command", { cache: "no-store" });
    if (!response.ok) return;
    const command = await response.json();
    if (!command?.id || command.id <= lastCommandId) return;

    const tabs = await chrome.tabs.query({ url: "https://www.showtimes.com.tw/*" });
    const target = tabs.find((tab) => tab.active) || tabs[0];
    if (!target?.id) throw new Error("找不到已登入的秀泰分頁");

    await chrome.tabs.update(target.id, { url: command.url, active: true });
    if (target.windowId) await chrome.windows.update(target.windowId, { focused: true });
    lastCommandId = command.id;
    await fetch("http://127.0.0.1:4173/api/extension-command/ack", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: command.id })
    });
  } catch {}
}

chrome.alarms.create("showtimes-radar-poll", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "showtimes-radar-poll") void pollRadar(); });
setInterval(() => { void pollRadar(); }, 500);
void pollRadar();
