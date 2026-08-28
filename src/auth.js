import { openShowtimesLogin } from "./browser-session.js";
let state = { status: "unknown", message: "尚未檢查登入狀態", checkedAt: null, error: null };
const set = (status, message, error = null) => state = { status, message, checkedAt: new Date().toISOString(), error };
export async function getAuthStatus() {
  return state;
}
export async function beginLogin() {
  try {
    openShowtimesLogin();
    set("external", "已開啟一般 Chrome；請在該瀏覽器確認秀泰登入狀態");
    return state;
  } catch (error) { set("loggedOut", "尚未登入秀泰影城", error instanceof Error ? error.message : String(error)); return state; }
}
