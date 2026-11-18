# 秀泰特別場搶票雷達

**第一次使用、沒有程式背景？請先看 [使用者手冊](docs/USER_GUIDE.md)。** 內含 Mac／Windows 下載安裝、Chrome 小幫手設定、場次填寫範例、付款流程與常見問題；使用桌面安裝版不需要輸入程式指令。

[下載桌面版與 Chrome 小幫手](https://github.com/ciao2847/showtimes-radar/releases/latest)

參考 `miramar-radar` 製作的本機 React 監看工具。它會監看秀泰官方公開資料中的「特別場」，符合名稱、日期、時間、影城與影廳條件時，發出系統通知與提示音，並沿用 Chrome 登入狀態，透過官方 API 選票、保留座位，成功後開啟訂單確認頁。

程式不會繞過 Cloudflare Turnstile、人機驗證、登入或付款。首次使用請安裝隨附的 Chrome 擴充功能，再按右上角「登入秀泰」，於一般 Chrome 手動登入並保留該分頁。命中後擴充功能會沿用同一分頁，自動選票數、座位並略過套餐；最後的訂單確認與付款仍由使用者完成。

## 直接用 API 監看空位

在「特別場名稱搜尋」輸入「泥面人」，設定日期、希望張數及選填的影城／時間後開始監看。畫面只需以名稱搜尋，無須填入網址或 ID。

每次掃描會直接呼叫官方 `app/bootstrap` 與 `events/seatsAvailability`，以場次 ID 對應剩餘座位，不需等待節目頁載入。列表顯示剩餘數量；只有空位大於或等於希望張數才會自動進入訂票。滿場、數量未知或不足時繼續監看；API 失敗時顯示錯誤並於下次掃描重試。

空位數是總數，不代表一定連號或保留成功。擴充功能優先選連號，也接受符合影城規則的分散座位；不會自行減少張數。選票與選位透過官方 `ticketTypes/list`、`seats/list`、`cart`、`cart/lockSeats` 與 `cart/checkPrice` API 完成，不需載入票種頁或點擊座位按鈕。保留成功後才開啟訂單確認頁，登入及最後付款由使用者完成。

需要 Chrome 保留已登入的秀泰頁面，以載入官方 API 模組並沿用登入狀態。票種有歧義、需券號／銀行資格，或套票缺少可用原價品項時停止並提示手動確認；已有未完成訂票時不會覆寫。保留請求失敗或逾時時不會盲目重送，請先到秀泰確認目前訂票。正式登入後的保留流程仍需實際驗證。

更新本次程式後請重新啟動 Radar，並在 `chrome://extensions` 重新載入擴充功能。

## 執行

需要 Node.js 22：

```bash
npm install
npm start
```

UI 位於 `http://127.0.0.1:5173`，API 位於 `http://127.0.0.1:4173`。

桌面模式：

```bash
npm run electron
```

## 安裝 Chrome 擴充功能

1. 在 Chrome 開啟 `chrome://extensions`。
2. 開啟右上角「開發人員模式」。
3. 按「載入未封裝項目」，選擇本專案的 `chrome-extension` 資料夾。
4. 確認 `Showtimes Radar Assistant` 已顯示為「已啟用」。
5. 更新擴充功能程式碼後，回到 `chrome://extensions` 按「重新載入」。監看條件由 Radar 管理，修改條件後按「更新條件」即可。

擴充功能只連線到本機 `http://127.0.0.1:4173`，用來接收雷達命中指令並接管已登入的秀泰分頁。Chrome 不允許一般應用程式靜默安裝本機擴充功能，因此第一次仍需手動載入。

## 登入與購買流程（Showtimes Radar Assistant）

1. 啟動桌面版：`npm run electron`
2. 在一般 Chrome 登入秀泰，並保留已登入分頁開著。
3. 進到 `chrome://extensions`，確認 `Showtimes Radar Assistant` 已啟用。
4. 在 Showtimes Radar 設定條件後開始監看，修改條件後按「更新條件」。
5. 命中場次時，Assistant 會接管秀泰頁面，幫你選票、選位、略過套餐、確認訂單入口。
6. 最終訂單確認與付款仍由你在秀泰頁面完成。

> 擴充功能需保持啟用，且 Chrome 必須保留已登入的秀泰分頁。

## 建立 macOS 安裝檔

```bash
npm run dist:mac
```

本機打包的產物會放在 `release/`，適合開發測試。提供給其他 Mac 使用時，請分享 GitHub Release 的 macOS DMG。Apple Silicon（M 系列）選 `arm64`，Intel 選檔名未標 `arm64` 的 DMG。開啟 DMG 後，把 Showtimes Radar 拖到「應用程式」，再依上方步驟載入 Chrome 擴充功能。

### 從 GitHub 發行 macOS 安裝檔

發行者需加入 Apple Developer Program，並準備含私密金鑰的 Developer ID Application 憑證。到 GitHub 專案的 Settings → Secrets and variables → Actions 新增以下 Repository secrets：

| Secret | 內容 |
| --- | --- |
| `MAC_CSC_LINK` | 含私密金鑰的 `.p12` 憑證檔，轉成單行 Base64 |
| `MAC_CSC_KEY_PASSWORD` | 匯出 `.p12` 時設定的密碼 |
| `APPLE_ID` | 用於公證的 Apple Account 電子郵件 |
| `APPLE_APP_SPECIFIC_PASSWORD` | 此帳號產生的 App 專用密碼 |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

準備好後，推送與 `package.json` 版本一致的 `v<版本>` 標籤，例如 `v1.0.6`。Release installers 工作流程會在兩種 macOS 架構的 App 與 DMG 通過公證驗證後，將安裝檔和 Chrome 擴充功能發佈到 GitHub Release。發行後請從另一台 Mac 下載對應 DMG，實際走一遍安裝和首次開啟流程。

## 建立 Windows 安裝檔

```bash
npm run dist:win
```

會建立 Windows x64 的 NSIS 安裝程式與 ZIP 免安裝封裝，產物同樣位於 `release/`。首次使用仍需在 Chrome 手動載入隨附的擴充功能，並保留已登入秀泰的分頁。

建議輪詢間隔至少 10–15 秒。網站 UI 或 API 結構更新後，API 接口與購物車資料格式可能需要調整；正式搶票前請先用一般可售場次測試瀏覽器流程。

## 執行進度

即時雷達會顯示搜尋場次與空位、等待符合張數、連線登入分頁、取得票種、挑選座位、建立訂票、保留座位、確認金額、等待確認付款等步驟。當前步驟會亮起，錯誤會標在實際停住的位置；展開「執行紀錄」可查看時間與狀態。擴充功能更新後須重新載入，才能回報選位進度。

## 特別場套票

可在「票種名稱關鍵字」輸入 `《另一個媽咪》DVA特別場套票`，也可輸入能唯一匹配的片段（例如 `DVA特別場套票`）。明確指定名稱時不會改買其他票種；預設「全票」且只有一種可購票種時，仍可自動使用唯一票種。

套票直接以票種 ID 與份數建立訂票，不再查詢或配對套餐清單；內含特典由秀泰依票種內容處理，不額外加購。希望張數代表電影座位數，雙人套票會換算份數。進度紀錄會顯示選到的票種與份數，套票內含品項標示售完或 API 拒絕時停止並提示原因。實際票種與金額仍需在秀泰訂單確認頁核對。

## 票種預載

設定未來的開始時間後，程式會提前 8 秒查詢場次，並在已登入的秀泰分頁預載第一個符合條件場次的票種；此階段不建立訂票或保留座位。監看期間若空位不足，也會嘗試預載。

票種快取最多有效 15 秒，依登入帳號、場次、票種關鍵字、張數與本次監看分開保存，只留在秀泰分頁。預載失敗、過期或切換條件時會即時查詢；座位圖一律讀取最新資料。紀錄出現「已沿用預載票種」表示這次已省略票種請求。若開始監看就立即命中，可能尚無時間完成預載，仍採即時查詢。
