# CLAUDE.md

這份文件給在這個 repo 裡工作的 Claude Code 看。

## 專案
上傳房屋平面圖（圖片或 CAD 輸出的 PDF），在瀏覽器裡辨識牆、門窗、房間，產生 3D 模型，再擺家具、換材質模擬裝修。純前端靜態網頁，沒有後端、沒有帳號，部署在 GitHub Pages。使用者是一般屋主，個人專案。

功能說明在 `README.md`；每個階段的決定與原因在 `docs/設計脈絡.md`（第 7 節是平面圖 JSON 格式，第 8 節是階段表，第 11 節之後每階段一節）。改某個功能之前先讀對應的那一節。注意：設計脈絡第 6 節的 React + FastAPI 架構是最初的規劃，沒有實作；實際架構以下面為準。

## 指令
```
npm test                                        # 全部測試（Node 內建 node:test，不需要 npm install）
node --test test/plan.test.js                   # 單一檔案
node --test --test-name-pattern="換算成公尺" test/plan.test.js   # 單一測試
node tools/build-models.js                      # 重新產生 js/models-data.js
```
沒有建置步驟、沒有 lint、沒有任何 npm 套件。要看畫面就直接用瀏覽器開 `index.html`。CI（`.github/workflows/test.yml`）用 Node 22 跑 `npm test`。

## 架構

### 沒有打包工具，全部是全域 `<script>`
- `index.html` 最下面依序用 `<script>` 載入 `js/*.js`，每個檔案掛一個全域物件（`FPPlan`、`FPRooms`、`FPScene`…）。**新增 js 檔要加進 `index.html`，而且要排在用到它的檔案前面。**
- 不能用 ES modules、不能在執行時 `fetch` 本機檔案：從電腦直接開 `index.html`（`file://`）也要能用。這也是家具模型預先轉成 `js/models-data.js` 的原因。唯一的例外是 AI 辨識（要下載 30 MB 模型，只有網站版能用）。
- Three.js 是 CDN 上的 r147 全域版（`THREE`、`examples/js/controls/OrbitControls.js`）。r148 之後拿掉了 `examples/js`，不要升級版本，也不要用 `import` 的寫法。
- pdf.js、ONNX Runtime Web 只在用到時才從 CDN 載入（`js/pdfpick.js`、`js/ml.js`）。
- 發布（`.github/workflows/pages.yml`）只複製 `index.html`、`css`、`js`、`model`。執行時需要的檔案放在別的資料夾就不會上線。

### 兩種檔案
- **純計算**（大部分檔案）：UMD 寫法，瀏覽器掛全域、Node 用 `module.exports`，相依的模組用 `root.FPxxx || require('./xxx.js')` 取得。每個檔案在 `test/` 有對應的 `*.test.js`。
- **只在瀏覽器跑**（`app.js`、`editor.js`、`scene.js`、`pdfpick.js`、`facadepick.js`、`sample.js`）：單純的 IIFE，沒有測試。

邏輯盡量寫在純計算的檔案裡並加測試，瀏覽器那幾個檔案只負責畫面和串接。例如編輯操作在 `edit.js`（有測試），`editor.js` 只處理 canvas 和滑鼠。

### 平面圖 JSON 是中心
所有東西都圍繞 `js/plan.js` 定義的平面圖 JSON：辨識產生它，2D 校正修改它，3D 場景、房間、用量、分享連結都只讀它。

```
圖片 → detect（牆像素）→ vectorize（直線段）→ openings（門窗）┐
        └ 勾選 AI 辨識時由 ml 取代 detect                        ├→ plan（JSON）→ rooms → editor / scene
PDF  → pdfpick（框選）→ pdflines（線段）→ linewalls（牆門窗） ┘
```

圖片那一條由 `js/pipeline.js` 的 `FPPipeline.raster` 串起來，`app.js` 只負責讀設定和顯示結果。`test/pipeline.test.js` 照 `js/sample.js` 的座標在 Node 畫出黑白範例圖，檢查牆、門窗、房間的數量。

- 單位公尺，原點在左上角，x 向右、**y 向下**。牆是「中心線 a→b + 厚度」，門窗用 `offset` 掛在牆上。辨識階段用像素座標，進 `plan.js` 才換成公尺。
- 只支援水平、垂直的牆。
- 房間不是存下來的，是 `rooms.js` 用 5 公分格子從牆算出來的；改了牆就重算，房名、地板、牆色跟著保留。
- 裝修方案（`schemes.js`）：平面圖上的 `furniture`、`materials`、房間的 `floor`／`paint` 永遠是目前方案的內容，`schemes` 存每個方案的副本。牆、門窗、外觀圖是所有方案共用的。
- 多樓層（`building.js`）：整棟是 `{type:'building', floors:[{plan, offset…}]}`，每層一份完整的平面圖 JSON。**只有一層時存檔還是單純的平面圖 JSON**，舊檔案要一直能開。
- 專案存在 IndexedDB（`projects.js`）：圖片（`source.image`、`facades[].image`）和平面圖分開存，圖片沒換就不重寫。平面圖裡新增其他放圖片的欄位時，要加進 `projects.js` 的 `mapImages`。分享連結把 JSON 壓縮放在網址 `#v=` 後面（`share.js`），不帶原圖和外觀圖。

### 改資料格式時
新欄位一律是選用的，省略時的行為要和以前一樣（例如 `wall.kind`、`room.paint`、`furniture.color`），這樣舊存檔、舊分享連結都不用轉換。同時要檢查：裝修方案要不要帶（`schemes.js`）、分享連結要不要帶（`share.js`）、復原重做（`edit.js`）、多樓層時其他樓層怎麼畫（`building.js`、`scene.js`）。

### 3D 場景只在有變化時重畫
`scene.js` 的迴圈在畫面沒變時不呼叫 `render`，陰影也不會自動重算。改 `scene.js` 時：改了場景內容或光線要呼叫 `changed()`（重畫並重算陰影），只動鏡頭或貼圖載入完呼叫 `invalidate()`。漏掉的話畫面會停在舊的樣子，直到使用者轉動鏡頭。

## 慣例
- 註解、測試名稱、介面文字、commit 訊息都用繁體中文，白話寫法。每個檔案開頭有幾行註解說明這個檔案負責什麼；常數後面註明單位和由來。
- 辨識規則裡的門檻值都是對著真實圖面調出來的（設計脈絡第 11、12、16–20 節記錄了調整前後的門窗、房間數量）。改辨識時，黑白範例、彩色範例的測試結果不應該變，除非那就是這次要改的。
- `js/models-data.js` 是產生出來的，不要手動改；改 `tools/build-models.js` 再重跑。
- `model/cubicasa-int8.onnx` 是 CC BY-NC 4.0，只能非商業使用。KayKit 家具模型是 CC0。新增素材要在 `docs/licenses/` 放授權說明。

## 工作流程
每個功能是一個「階段」：
1. 從 main 開分支 `stage<編號>-<英文名稱>`。
2. 寫程式和測試，`npm test` 要全過。
3. 更新 `README.md` 的使用方式，並在 `docs/設計脈絡.md` 的階段表加一列、最後面加一節（為什麼做、做法、結果、還沒做的）。
4. 開 PR 合併到 main，合併後自動發布到 GitHub Pages。
