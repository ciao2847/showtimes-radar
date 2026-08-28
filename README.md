# 秀泰特別場搶票雷達

參考 `miramar-radar` 製作的本機 React 監看工具。它會監看秀泰官方公開資料中的「特別場」，符合名稱、日期、時間、影城與影廳條件時，發出系統通知與提示音，並在一般 Chrome 開啟該場票種頁。

程式不會繞過 Cloudflare Turnstile、人機驗證、登入或付款。首次使用請安裝隨附的 Chrome 擴充功能，再按右上角「登入秀泰」，於一般 Chrome 手動登入並保留該分頁。命中後擴充功能會沿用同一分頁，自動選票數、座位並略過套餐；最後的訂單確認與付款仍由使用者完成。

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
4. 修改擴充功能程式後，回到這一頁按重新載入。

擴充功能只連線到本機 `http://127.0.0.1:4173`，用來接收雷達命中指令並接管已登入的秀泰分頁。Chrome 不允許一般應用程式靜默安裝本機擴充功能，因此第一次仍需手動載入。

## 建立 macOS 安裝檔

```bash
npm run dist:mac
```

產物會放在 `release/`。目前未設定 Apple Developer 簽章；在其他 Mac 首次開啟時，可能需要於 Finder 對 App 按右鍵後選擇「打開」。安裝檔內會附帶 `chrome-extension` 資料夾，但仍須依上方步驟手動載入。

## 建立 Windows 安裝檔

```bash
npm run dist:win
```

會建立 Windows x64 的 NSIS 安裝程式與 ZIP 免安裝封裝，產物同樣位於 `release/`。首次使用仍需在 Chrome 手動載入隨附的擴充功能，並保留已登入秀泰的分頁。

建議輪詢間隔至少 10–15 秒。網站 UI 或 API 結構更新後，票種／座位選擇器可能需要調整；正式搶票前請先用一般可售場次測試瀏覽器流程。
