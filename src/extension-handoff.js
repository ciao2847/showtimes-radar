let sequence = 0;
let current = null;

export function publishExtensionCommand(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "www.showtimes.com.tw") throw new Error("拒絕發布非秀泰網址");
  current = { id: ++sequence, url: parsed.href, createdAt: new Date().toISOString(), acknowledged: false };
  return current;
}

export function getExtensionCommand() { return current; }

export function acknowledgeExtensionCommand(id) {
  if (current?.id === Number(id)) current.acknowledged = true;
  return current;
}

export async function waitForExtensionAck(id, timeout = 8_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (current?.id === id && current.acknowledged) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}
