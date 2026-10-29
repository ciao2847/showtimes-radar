(() => {
  const STORAGE_KEY = "showtimesRadarConfig";
  const HANDLED_KEY = "showtimesRadarHandledEvent";
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function setStatus(message, type = "working") {
    let element = document.getElementById("showtimes-radar-status");
    if (!element) {
      element = document.createElement("div");
      element.id = "showtimes-radar-status";
      Object.assign(element.style, { position:"fixed", right:"20px", bottom:"20px", zIndex:"2147483647", maxWidth:"360px", padding:"12px 16px", borderRadius:"12px", color:"white", font:"600 13px/1.5 system-ui", boxShadow:"0 12px 35px #0005" });
      document.documentElement.appendChild(element);
    }
    element.style.background = type === "error" ? "#b42336" : type === "done" ? "#287a4b" : "#7346b8";
    element.textContent = `Showtimes Radar：${message}`;
  }

  function readConfig() {
    const url = new URL(location.href);
    const quantity = Number(url.searchParams.get("radarQuantity"));
    if (Number.isInteger(quantity) && quantity >= 1 && quantity <= 6) {
      const config = { quantity, eventId:location.pathname.split("/").at(-1) };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      sessionStorage.removeItem(HANDLED_KEY);
      return config;
    }
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
      return saved ? { quantity: saved.quantity, eventId: saved.eventId } : null;
    } catch { return null; }
  }

  async function waitFor(selector, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { const element = document.querySelector(selector); if (element) return element; await sleep(100); }
    throw new Error(`等待頁面元素逾時：${selector}`);
  }

  async function selectQuantity(config) {
    await waitFor("button svg.lucide-plus", 30000);
    const plusButtons = [...document.querySelectorAll("button")].filter((button) => button.querySelector("svg.lucide-plus"));
    if (!plusButtons.length) throw new Error("找不到票數增加按鈕");
    let control;
    if (plusButtons.length === 1) control = plusButtons[0].closest("div.border-t") || plusButtons[0].parentElement;
    else control = plusButtons[0].closest("div.border-t") || plusButtons[0].parentElement;
    const counter = [...control.querySelectorAll("span")].find((span) => /^\s*\d+\s*$/.test(span.textContent));
    if (!counter) throw new Error("找不到目前票數");
    const current = Number(counter.textContent.trim()), delta = config.quantity - current;
    const button = delta >= 0 ? control.querySelector("button:has(svg.lucide-plus)") : control.querySelector("button:has(svg.lucide-minus)");
    if (delta && !button) throw new Error("找不到票數調整按鈕");
    setStatus(`正在設定 ${config.quantity} 張票`);
    for (let index = 0; index < Math.abs(delta); index++) { button.click(); await sleep(150); }
    if (Number(counter.textContent.trim()) !== config.quantity) throw new Error("票數未成功更新");
    const next = [...document.querySelectorAll("button")].find((button) => /^下一步/.test(button.textContent.trim()) && !button.disabled);
    if (!next) throw new Error("找不到票種頁下一步按鈕");
    next.click();
    const confirm = await waitForButton(/確認[，,、\s]*前往選位/, 10000);
    confirm.click();
  }

  async function waitForButton(pattern, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { const button=[...document.querySelectorAll("button")].find((item)=>pattern.test(item.textContent.trim())&&!item.disabled); if(button)return button; await sleep(100); }
    throw new Error(`找不到按鈕：${pattern}`);
  }

  async function waitForPath(pattern, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (pattern.test(location.pathname)) return location.pathname; await sleep(100); }
    throw new Error(`等待頁面切換逾時：${pattern}`);
  }

  function parseSeat(button, index) {
    const match = button.getAttribute("aria-label")?.match(/^座位\s*([A-Za-z]+|\d+)排(\d+)號$/);
    if (!match) return null;
    return { button, index, row:match[1].toUpperCase(), number:Number(match[2]), x:Number.parseFloat(button.style.left), disabled:button.disabled || button.getAttribute("aria-disabled") === "true" || button.getAttribute("aria-pressed") === "true" || button.className.includes("cursor-not-allowed") };
  }

  const seatSelector = 'button[aria-label^="座位 "][aria-label*="排"][aria-label*="號"]';
  const readSeats = () => [...document.querySelectorAll(seatSelector)].map(parseSeat).filter(Boolean);
  const seatKey = (seat) => `${seat.row}:${seat.number}`;
  const groupKey = (group) => group.map(seatKey).sort().join("|");

  async function clearSelection() {
    for (const seat of readSeats()) {
      if (seat.button.getAttribute("aria-pressed") === "true") {
        seat.button.click();
        await sleep(150);
      }
    }
    if (readSeats().some((seat) => seat.button.getAttribute("aria-pressed") === "true")) {
      throw new Error("無法清除上一組選位，請手動確認座位");
    }
  }

  async function selectSeats(config) {
    await waitFor(seatSelector);
    const excluded = new Set();
    const deadline = Date.now() + 90000;
    await clearSelection();
    while (Date.now() < deadline) {
      // Always read fresh DOM nodes; React may replace them after any click.
      const seats = readSeats();
      const group = ShowtimesSeatPlanner.chooseSeats(seats, config.quantity, excluded);
      if (!group.length) {
        throw new Error(`目前沒有符合影城規則的 ${config.quantity} 個空位，請確認最新空位後重試`);
      }
      setStatus(`正在選擇 ${config.quantity} 張：${group.map((seat) => `${seat.row}排${seat.number}號`).join("、")}`);
      let selected = true;
      for (const seat of group) {
        const fresh = readSeats().find((item) => seatKey(item) === seatKey(seat));
        if (!fresh || fresh.disabled) { selected = false; break; }
        fresh.button.click();
        await sleep(300);
        if (readSeats().find((item) => seatKey(item) === seatKey(seat))?.button.getAttribute("aria-pressed") !== "true") { selected = false; break; }
      }
      if (selected && readSeats().filter((seat) => seat.button.getAttribute("aria-pressed") === "true").length === config.quantity) {
        const next = await waitForButton(/^下一步/, 5000);
        next.click();
        const result = await waitForSeatResult();
        if (result === "success") { setStatus(`已保留 ${config.quantity} 張座位，正在前往訂單確認`); return; }
        const dismiss = [...document.querySelectorAll("button")].find((button) => /^(確定|關閉|知道了|重試)$/.test(button.textContent.trim()));
        if (!dismiss) throw new Error("座位保留失敗，無法關閉提示，請手動確認");
        dismiss.click();
        await sleep(300);
      }
      excluded.add(groupKey(group));
      setStatus("這組座位無法取得，正在重新檢查全場空位");
      await clearSelection();
      await sleep(200);
    }
    throw new Error("自動選位已達時間上限，請確認最新空位後手動選位");
  }

  async function waitForSeatResult(timeout=10000){
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){
      if(/\/selectConcessions|\/confirmOrder/.test(location.pathname))return"success";
      if(/座位保留失敗|Vista\s*錯誤/i.test(document.body?.innerText||""))return"rejected";
      await sleep(100);
    }
    throw new Error("送出座位後沒有收到秀泰回應，請檢查頁面提示");
  }

  async function skipConcessions(config) {
    setStatus("不加購套餐，正在前往訂單確認");
    const confirmOrder = await waitForButton(/^確認訂單$/);
    confirmOrder.click();
    sessionStorage.setItem(HANDLED_KEY, config.eventId);
    setStatus(`已略過套餐，請確認 ${config.quantity} 張訂單與付款`, "done");
  }

  async function run() {
    const config=readConfig();if(!config||sessionStorage.getItem(HANDLED_KEY)===config.eventId)return;
    try {
      if(location.pathname.includes("/selectTicketTypes/"))await selectQuantity(config);
      if(location.pathname.includes("/selectConcessions")){await skipConcessions(config);return;}
      const deadline=Date.now()+60000;
      while(Date.now()<deadline){
        if(location.pathname.includes("/selectSeats")){
          await selectSeats(config);
          await waitForPath(/\/selectConcessions|\/confirmOrder/);
          if(location.pathname.includes("/selectConcessions"))await skipConcessions(config);
          else {sessionStorage.setItem(HANDLED_KEY,config.eventId);setStatus("請確認訂單與付款","done");}
          return;
        }
        if(location.pathname.includes("/selectConcessions")){await skipConcessions(config);return;}
        await sleep(200);
      }
      throw new Error("未進入選位或套餐頁");
    } catch(error){setStatus(error instanceof Error?error.message:String(error),"error");}
  }
  run();
})();
