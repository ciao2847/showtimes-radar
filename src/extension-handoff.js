import { FLOW_STEPS } from "./progress.js";
// Keep command IDs increasing when the local API restarts while Chrome stays open.
let sequence = Date.now();
let current = null;

export function publishExtensionCommand(url, sessionContext, kind = "book", watchKey) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "www.showtimes.com.tw") throw new Error("拒絕發布非秀泰網址");
  current = { id: ++sequence, url: parsed.href, kind, watchKey, createdAt: new Date().toISOString(), acknowledged: false, progress: [], ...(sessionContext ? { sessionContext } : {}) };
  return current;
}

export function getExtensionCommand() { return current; }

export function acknowledgeExtensionCommand(id, result) {
  if (current?.id === Number(id)) {
    current.acknowledged = true;
    current.result = ["reserved", "prepared"].includes(result?.status)
      ? { status: result.status, message: String(result.message || "API 已保留座位，請確認訂單與付款") }
      : { status: "error", message: String(result?.message || "API 訂票失敗") };
  }
  return current;
}

export function updateExtensionProgress(id, entries) {
  if (current?.id !== Number(id) || current.acknowledged || !Array.isArray(entries)) return current;
  current.progress = entries.slice(0, 30).filter(entry => FLOW_STEPS.some(step => step.id === entry?.step) && typeof entry.message === "string").map(entry => ({ step: entry.step, message: entry.message.slice(0, 500) }));
  return current;
}

export async function waitForExtensionAck(id, timeout = 120_000, onProgress = () => {}) {
  const deadline = Date.now() + timeout;
  let delivered = 0;
  while (Date.now() < deadline) {
    if (current?.id !== id) return false;
    if (current?.id === id) {
      for (const progress of current.progress.slice(delivered)) { onProgress(progress); delivered++; }
    }
    if (current?.id === id && current.acknowledged) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}
