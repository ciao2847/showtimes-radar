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
      const config = { quantity, preference:url.searchParams.get("radarSeatPreference") || "middleBack", preferAisle:url.searchParams.get("radarPreferAisle") === "true", eventId:location.pathname.split("/").at(-1) };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      sessionStorage.removeItem(HANDLED_KEY);
      return config;
    }
    try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY)); } catch { return null; }
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
    return { button, index, row:match[1].toUpperCase(), number:Number(match[2]), x:Number.parseFloat(button.style.left), disabled:button.disabled || button.getAttribute("aria-pressed") === "true" || button.className.includes("cursor-not-allowed") };
  }

  function createsNewSingleSeat(allSeats, selectedGroup) {
    const selected = new Set(selectedGroup.map((seat) => `${seat.row}:${seat.number}`));
    const emptyRuns = (includeSelection) => {
      const runs = [];
      for (const row of [...new Set(allSeats.filter(Boolean).map((seat) => seat.row))]) {
        const seats = allSeats.filter((seat) => seat?.row === row).sort((a,b) => a.number-b.number);
        const steps = seats.slice(1).map((seat,index) => Math.abs(seat.x-seats[index].x)).filter((step) => Number.isFinite(step) && step > 0).sort((a,b)=>a-b);
        const pitch = steps[0];
        let run = [], previous;
        const finish = () => { if (run.length) runs.push(run); run=[]; };
        for (const seat of seats) {
          const physicallyAdjacent = previous && seat.number === previous.number + 1 && (!pitch || Math.abs(seat.x-previous.x) <= pitch*1.35);
          if (previous && !physicallyAdjacent) finish();
          const blocked = seat.disabled || (includeSelection && selected.has(`${seat.row}:${seat.number}`));
          if (blocked) finish(); else run.push(seat);
          previous = seat;
        }
        finish();
      }
      return runs;
    };
    const existingSingles = new Set(emptyRuns(false).filter((run)=>run.length===1).map((run)=>`${run[0].row}:${run[0].number}`));
    return emptyRuns(true).some((run)=>run.length===1&&!existingSingles.has(`${run[0].row}:${run[0].number}`));
  }

  function chooseGroups(allSeats, quantity, preference, preferAisle) {
    const available=allSeats.filter((seat)=>seat&&!seat.disabled), rows=[...new Set(available.map((seat)=>seat.row))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    const target={front:.15,center:.5,middleBack:.68,back:.9}[preference]??.68, groups=[];
    for(const row of rows){const seats=available.filter((seat)=>seat.row===row).sort((a,b)=>a.number-b.number);const rowGeometry=allSeats.filter((seat)=>seat?.row===row).sort((a,b)=>a.number-b.number),steps=rowGeometry.slice(1).map((seat,index)=>Math.abs(seat.x-rowGeometry[index].x)).filter((step)=>Number.isFinite(step)&&step>0).sort((a,b)=>a-b),pitch=steps[0];const adjacent=(a,b)=>b.number===a.number+1&&(!pitch||Math.abs(b.x-a.x)<=pitch*1.35);for(let index=0;index<=seats.length-quantity;index++){const group=seats.slice(index,index+quantity);if(group.some((seat,offset)=>offset&&!adjacent(group[offset-1],seat))||createsNewSingleSeat(allSeats,group))continue;const xs=group.map((seat)=>seat.x),allXs=seats.map((seat)=>seat.x),middle=(Math.min(...xs)+Math.max(...xs))/2,roomMiddle=(Math.min(...allXs)+Math.max(...allXs))/2,previous=seats[index-1],next=seats[index+quantity],aisle=!previous||!adjacent(previous,group[0])||!next||!adjacent(group.at(-1),next);groups.push({group,score:Math.abs(rows.indexOf(row)/Math.max(1,rows.length-1)-target)*3+Math.abs(middle-roomMiddle)/Math.max(1,Math.max(...allXs)-Math.min(...allXs))+(preferAisle&&!aisle?.7:0)});}}
    return groups.sort((a,b)=>a.score-b.score).map((entry)=>entry.group);
  }

  async function selectSeats(config) {
    await waitFor('button[aria-label^="座位 "][aria-label*="排"][aria-label*="號"]');
    const buttons=[...document.querySelectorAll('button[aria-label^="座位 "][aria-label*="排"][aria-label*="號"]')], seats=buttons.map(parseSeat), groups=chooseGroups(seats,config.quantity,config.preference,config.preferAisle);
    if(!groups.length)throw new Error(`找不到 ${config.quantity} 個符合偏好的連號座位`);
    const attempts=Math.min(groups.length,5);
    for(let attempt=0;attempt<attempts;attempt++){
      const group=groups[attempt];
      setStatus(`正在選擇 ${group.map((seat)=>`${seat.row}排${seat.number}號`).join("、")}${attempt?`（第 ${attempt+1} 組）`:""}`);
      for(const seat of group){seat.button.click();await sleep(300);if(seat.button.getAttribute("aria-pressed")!=="true")throw new Error(`${seat.row}排${seat.number}號未成功選取`);}
      await sleep(500);
      const next=await waitForButton(/^下一步/);
      next.click();
      const result=await waitForSeatResult();
      if(result==="success"){setStatus("座位已送出，正在略過套餐");return;}
      setStatus("Vista 拒絕這組座位，正在改選下一組");
      const dismiss=[...document.querySelectorAll("button")].find((button)=>/^(確定|關閉|知道了|重試)$/.test(button.textContent.trim()));
      dismiss?.click();
      await sleep(300);
      for(const seat of group){if(seat.button.getAttribute("aria-pressed")==="true"){seat.button.click();await sleep(150);}}
    }
    throw new Error(`Vista 已拒絕 ${attempts} 組座位，請重新整理後手動選位`);
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
    setStatus("已略過套餐，請確認訂單與付款", "done");
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
