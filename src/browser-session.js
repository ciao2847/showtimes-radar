import { chromium } from "playwright-core";
import { join, resolve } from "node:path";
import { existsSync, readFileSync, readlinkSync } from "node:fs";
import { spawn } from "node:child_process";

let context;
let connectedBrowser;
let manualCdpUrl;
const profile = resolve(process.env.SHOWTIMES_PROFILE_DIR || ".browser-profile");
export function browserExecutable() {
  const windowsRoots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
  const windowsPaths = windowsRoots.flatMap((root) => [
    join(root, "Google", "Chrome", "Application", "chrome.exe"),
    join(root, "Microsoft", "Edge", "Application", "msedge.exe")
  ]);
  const paths = process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"] : process.platform === "win32" ? windowsPaths : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/microsoft-edge"];
  return paths.find(existsSync);
}

function profileOwnerPid() {
  try {
    const lock = readlinkSync(resolve(profile, "SingletonLock"));
    const pid = Number(lock.match(/-(\d+)$/)?.[1]);
    if (!pid) return null;
    process.kill(pid, 0);
    return pid;
  } catch { return null; }
}

async function waitForProfile(maxWaitMs = 10_000) {
  const deadline = Date.now() + maxWaitMs;
  while (profileOwnerPid() && Date.now() < deadline) await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  const pid = profileOwnerPid();
  if (pid) throw new Error(`登入用 Chrome 尚未關閉（PID ${pid}）。請先關閉該 Chrome 視窗，程式才能接手自動搶票`);
}

export async function getBrowserContext() {
  if (context) return context;
  if (manualCdpUrl) return connectManualBrowser();
  const executablePath = browserExecutable();
  if (!executablePath) throw new Error("找不到 Google Chrome 或 Microsoft Edge");
  await waitForProfile();
  try {
    context = await chromium.launchPersistentContext(profile, { executablePath, headless: false, viewport: null, args: ["--start-maximized"] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/launchPersistentContext|browser has been closed|Target page, context or browser has been closed/i.test(message)) {
      throw new Error("無法啟動搶票瀏覽器。請關閉登入用 Chrome 與其他 Showtimes Radar 視窗後再試");
    }
    throw error;
  }
  context.once("close", () => { context = undefined; });
  return context;
}
export function isBrowserOpen() { return Boolean(context); }
export async function closeBrowser() { await connectedBrowser?.close().catch(() => {}); await context?.close().catch(() => {}); connectedBrowser = undefined; context = undefined; manualCdpUrl = undefined; }

export async function connectManualBrowser() {
  if (context) return context;
  if (!manualCdpUrl) throw new Error("尚未開啟登入用 Chrome");
  try {
    connectedBrowser = await chromium.connectOverCDP(manualCdpUrl);
    context = connectedBrowser.contexts()[0];
    if (!context) throw new Error("找不到登入瀏覽器內容");
    connectedBrowser.once("disconnected", () => { connectedBrowser = undefined; context = undefined; manualCdpUrl = undefined; });
    return context;
  } catch {
    manualCdpUrl = undefined;
    throw new Error("無法接管登入用 Chrome；請確認視窗仍開著，再重新登入");
  }
}

export async function openManualBrowser(url) {
  // Turnstile production challenges do not support Playwright-controlled
  // browsers. Launch Chrome directly for the human login, while retaining the
  // same isolated profile that the booking flow will use afterwards.
  await closeBrowser();
  await waitForProfile();
  const executablePath = browserExecutable();
  if (!executablePath) throw new Error("找不到 Google Chrome 或 Microsoft Edge");
  const child = spawn(executablePath, [`--user-data-dir=${profile}`, "--remote-debugging-port=0", "--disable-background-mode", "--new-window", url], { stdio: "ignore" });
  await new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    const portFile = resolve(profile, "DevToolsActivePort");
    const deadline = Date.now() + 10_000;
    const check = () => {
      try {
        const port = Number(readFileSync(portFile, "utf8").split(/\r?\n/)[0]);
        if (port) { manualCdpUrl = `http://127.0.0.1:${port}`; resolvePromise(); return; }
      } catch {}
      if (Date.now() >= deadline) { reject(new Error("登入 Chrome 啟動逾時")); return; }
      setTimeout(check, 100);
    };
    check();
  });
}

function waitForChild(child) {
  return new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`開啟瀏覽器失敗（exit ${code}）`)));
  });
}

export async function openExternalBrowser(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "www.showtimes.com.tw") throw new Error("拒絕開啟非秀泰網址");
  if (process.platform === "darwin") {
    const safeUrl = parsed.href.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    const script = `
      tell application "Google Chrome"
        activate
        set targetURL to "${safeUrl}"
        set foundShowtimesTab to false
        repeat with browserWindow in windows
          set tabNumber to 0
          repeat with browserTab in tabs of browserWindow
            set tabNumber to tabNumber + 1
            if (URL of browserTab starts with "https://www.showtimes.com.tw") then
              set active tab index of browserWindow to tabNumber
              set index of browserWindow to 1
              set URL of browserTab to targetURL
              set foundShowtimesTab to true
              exit repeat
            end if
          end repeat
          if foundShowtimesTab then exit repeat
        end repeat
        if not foundShowtimesTab then
          if (count of windows) is 0 then make new window
          make new tab at end of tabs of front window with properties {URL:targetURL}
          set active tab index of front window to (count of tabs of front window)
        end if
      end tell
    `;
    const automation = spawn("osascript", ["-e", script], { stdio: "ignore" });
    try {
      await waitForChild(automation);
      return;
    } catch {
      // Automation permission may be denied. Opening a new Chrome tab is less
      // ideal because sessionStorage is tab-scoped, but it guarantees the user
      // still receives the matched booking page instead of a false notification.
      await waitForChild(spawn("open", ["-a", "Google Chrome", parsed.href], { stdio: "ignore" }));
      return;
    }
  }
  if (process.platform === "win32") await waitForChild(spawn("cmd", ["/c", "start", "", "chrome", parsed.href], { stdio: "ignore", windowsHide: true }));
  else await waitForChild(spawn("xdg-open", [parsed.href], { stdio: "ignore" }));
}

export function openShowtimesLogin() {
  const url = "https://www.showtimes.com.tw/";
  let child;
  if (process.platform === "darwin") child = spawn("open", ["-a", "Google Chrome", url], { detached: true, stdio: "ignore" });
  else if (process.platform === "win32") {
    const executablePath = browserExecutable();
    child = executablePath
      ? spawn(executablePath, [url], { detached: true, stdio: "ignore", windowsHide: true })
      : spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true });
  }
  else child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
  child.unref();
}

export function notifyTicketMatch(movie = "秀泰特別場") {
  if (process.platform === "darwin") {
    const script = `display notification ${JSON.stringify("已開啟訂票頁，請立即選票與選位")} with title ${JSON.stringify(`Showtimes Radar：${movie}`)}`;
    const notice = spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" }); notice.unref();
    const sound = spawn("afplay", ["/System/Library/Sounds/Glass.aiff"], { detached: true, stdio: "ignore" }); sound.unref();
  }
}
