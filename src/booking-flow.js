import { getRecentSessionContext } from "./showtimes-api.js";
import { notifyTicketMatch } from "./browser-session.js";
import { publishExtensionCommand, waitForExtensionAck, getExtensionCommand } from "./extension-handoff.js";
let active;

export function parseShowtimesSeatLabel(text) {
  const match = String(text).match(/(?:座位\s*)?([A-Za-z]+|\d+)\s*排\s*(\d+)\s*號?/);
  return match ? { row: match[1].toUpperCase(), number: Number(match[2]), label: `${match[1].toUpperCase()}排${Number(match[2])}號` } : null;
}

export function rankSeatGroups(seats, quantity, preference = "middleBack", preferAisle = false) {
  const rows = [...new Set(seats.map((s) => s.row))].sort((a,b) => a.localeCompare(b, undefined, { numeric: true }));
  const ratio = { front: .15, center: .5, middleBack: .68, back: .9 }[preference] ?? .68, groups = [];
  for (const row of rows) {
    const list = seats.filter((s) => s.row === row).sort((a,b) => a.number-b.number);
    const xSteps = list.slice(1).map((seat,index) => Math.abs(seat.x-list[index].x)).filter((step) => Number.isFinite(step) && step > 0).sort((a,b)=>a-b);
    const pitch = xSteps[0];
    const adjacent = (left, right) => right.number === left.number + 1 && (!pitch || !Number.isFinite(left.x) || !Number.isFinite(right.x) || Math.abs(right.x-left.x) <= pitch * 1.35);
    for (let i=0;i<=list.length-quantity;i++) {
      const group=list.slice(i,i+quantity);
      if (group.some((seat,j)=>j && !adjacent(group[j-1],seat))) continue;
      const xs=group.map((seat)=>seat.x).filter(Number.isFinite), physicalMid=xs.length?(Math.min(...xs)+Math.max(...xs))/2:group.reduce((sum,seat)=>sum+seat.number,0)/group.length;
      const allXs=list.map((seat)=>seat.x).filter(Number.isFinite), roomMid=allXs.length?(Math.min(...allXs)+Math.max(...allXs))/2:(list[0].number+list.at(-1).number)/2;
      const previous=list[i-1], next=list[i+quantity];
      const besideAisle=!previous||!adjacent(previous,group[0])||!next||!adjacent(group.at(-1),next);
      const center=Math.abs(physicalMid-roomMid)/Math.max(1,allXs.length?Math.max(...allXs)-Math.min(...allXs):list.length);
      groups.push({ group, score: Math.abs(rows.indexOf(row)/Math.max(1,rows.length-1)-ratio)*3+center+(preferAisle&&!besideAisle?.7:0) });
    }
  }
  return groups.sort((a,b)=>a.score-b.score)[0]?.group || [];
}

export function ticketQuantityDelta(current, wanted) {
  const from = Number(current), to = Number(wanted);
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < 1 || to > 6) throw new Error("票數必須是 1–6 張的整數");
  return to - from;
}

async function selectTickets(page, keyword, quantity) {
  // 秀泰的 +/- 圖示是 SVG，按鈕本身沒有可供 hasText 使用的文字。
  const controls = page.locator("div.border-t.bg-gray-50.p-2").filter({ has: page.locator("svg.lucide-plus") });
  await controls.first().waitFor({ state: "visible", timeout: 30_000 });

  let control;
  if (await controls.count() === 1) {
    // 特別場通常只有一個票種，直接使用唯一的數量控制。
    control = controls.first();
  } else {
    const ticketContainer = page.locator("article, li, tr, [class*='rounded']").filter({ hasText: keyword }).filter({ has: page.locator("svg.lucide-plus") }).last();
    if (!await ticketContainer.count()) throw new Error(`頁面有多個票種，但找不到「${keyword}」的數量控制`);
    control = ticketContainer.locator("div.border-t.bg-gray-50.p-2").filter({ has: page.locator("svg.lucide-plus") }).first();
  }

  const counter = control.locator("span").filter({ hasText: /^\s*\d+\s*$/ }).first();
  const current = Number((await counter.innerText()).trim());
  const delta = ticketQuantityDelta(current, quantity);
  const button = delta > 0
    ? control.locator("button").filter({ has: page.locator("svg.lucide-plus") }).first()
    : control.locator("button").filter({ has: page.locator("svg.lucide-minus") }).first();
  if (delta && !await button.count()) throw new Error(`找不到票數${delta > 0 ? "增加" : "減少"}按鈕`);
  for (let step = 0; step < Math.abs(delta); step++) {
    await button.click();
    const expected = current + Math.sign(delta) * (step + 1);
    await page.waitForFunction(({ element, expected }) => Number(element?.textContent?.trim()) === expected, { element: await counter.elementHandle(), expected });
  }
  const actual = Number((await counter.innerText()).trim());
  if (actual !== quantity) throw new Error(`票數調整失敗：預期 ${quantity} 張，實際 ${actual} 張`);

  const next = page.getByRole("button", { name: /^下一步/ }).last();
  await next.waitFor({ state: "visible", timeout: 15_000 });
  if (await next.isDisabled()) throw new Error("票數已設定，但「下一步」仍不可點擊");
  await next.click();

  // 秀泰會再開一層確認視窗；確認後才真正導向選位頁。
  const confirmSeats = page.getByRole("button", { name: /確認[，,、\s]*前往選位/ }).first();
  const confirmationShown = await confirmSeats.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
  if (confirmationShown) {
    if (await confirmSeats.isDisabled()) throw new Error("「確認，前往選位」按鈕目前不可點擊");
    await confirmSeats.click();
  }
}
async function selectSeats(page, quantity, preference, preferAisle) {
  await page.waitForURL(/selectSeats/i, { timeout: 30_000 });
  await page.waitForLoadState("domcontentloaded");
  const nodes=page.locator('button[aria-label^="座位 "][aria-label*="排"][aria-label*="號"]');
  await nodes.first().waitFor({ state:"attached", timeout:30_000 });
  const seats=await nodes.evaluateAll((els)=>els.map((el,index)=>({
    index,
    text:el.getAttribute("aria-label")||"",
    x:Number.parseFloat(el.style.left),
    y:Number.parseFloat(el.style.top),
    disabled:el.matches(":disabled,[aria-disabled=true]")||el.getAttribute("aria-pressed")==="true"||/cursor-not-allowed|bg-gray-200/i.test(el.className)
  })));
  const parsed=seats.map((s)=>({ ...s, ...parseShowtimesSeatLabel(s.text) })).filter((s)=>s.row&&!s.disabled);
  const group=rankSeatGroups(parsed,quantity,preference,preferAisle); if (!group.length) throw new Error(`找不到 ${quantity} 個可辨識的連號座位，請手動選位`);
  for (const seat of group) {
    const node=nodes.nth(seat.index);
    await node.click();
    await node.waitFor({ state:"visible" });
    if (await node.getAttribute("aria-pressed") !== "true") throw new Error(`${seat.label} 點選後未進入已選狀態`);
  }
  const selectedCount = await nodes.evaluateAll((elements) => elements.filter((element) => element.getAttribute("aria-pressed") === "true").length);
  if (selectedCount < quantity) throw new Error(`預期選擇 ${quantity} 張座位，但頁面只確認 ${selectedCount} 張`);

  const next=page.getByRole("button", { name:/^下一步/ }).last();
  await next.waitFor({ state:"visible", timeout:15_000 }).catch(() => {});
  if (!await next.count()) throw new Error("座位已選取，但找不到選位頁的「下一步」按鈕");
  await page.waitForFunction((element) => element && !element.disabled, await next.elementHandle(), { timeout:15_000 }).catch(() => {});
  if (await next.isDisabled()) throw new Error("座位已選取，但選位頁的「下一步」仍不可點擊");
  await next.click();
  return group.map((s)=>s.label);
}
export async function prepareBooking({ url, quantity, ticketKeyword = "全票", watchKey }) {
  const target = new URL(url);
  target.searchParams.set("radarQuantity", String(quantity));
  target.searchParams.set("radarTicketKeyword", ticketKeyword);
  const command = publishExtensionCommand(target.href, undefined, "prepare", watchKey);
  if (!await waitForExtensionAck(command.id, 10_000)) return { status: "error", message: "票種預載未完成，命中後會即時查詢" };
  return getExtensionCommand()?.result;
}
export async function startBooking({ url, movie="秀泰特別場", quantity=1, ticketKeyword="全票", watchKey, onStatus=()=>{}, onProgress=()=>{}, onResult=()=>{} }) {
  if(active) return { status:"busy", message:"已有訂票流程進行中" };
  const task={cancelled:false}; active=task;
  try {
    onStatus("已命中場次，正在透過秀泰 API 選票並保留座位");
    const target = new URL(url);
    target.searchParams.set("radarQuantity", String(quantity));
    target.searchParams.set("radarTicketKeyword", ticketKeyword);
    target.searchParams.delete("radarSeatPreference");
    target.searchParams.delete("radarPreferAisle");
    const command = publishExtensionCommand(target.href, getRecentSessionContext(target.pathname.split("/").at(-1)), "book", watchKey);
    if (!await waitForExtensionAck(command.id, 120_000, onProgress)) throw new Error("API 訂票未於時限內確認；請先檢查秀泰目前訂票及擴充功能狀態");
    const reply = getExtensionCommand();
    if (reply?.id !== command.id || reply.result?.status !== "reserved") throw new Error(reply?.result?.message || "API 訂票未確認，請檢查秀泰分頁");
    notifyTicketMatch(movie);
    const result={status:"reserved",message:reply.result.message,url};
    onStatus(result.message); onResult(result); active=undefined; return result;
  } catch(error) { const result={status:"error",message:error instanceof Error?error.message:String(error)}; onResult(result); active=undefined; return result; }
}
export async function cancelActiveBooking(){ if(!active)return{status:"idle"}; active.cancelled=true; await active.page?.close().catch(()=>{}); active=undefined; return{status:"cancelled"}; }
