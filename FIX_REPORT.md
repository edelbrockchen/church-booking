# Venue Booking 修復報告（2025-10-02）

## 主要問題
- 申請單送出後，管理介面看不到資料。

## 根因（Root Cause）
1) **後端未自動執行資料庫遷移（migrate）**，資料表（bookings / terms_acceptances）沒有建立。
   - Render 的 `render.yaml` 中 `startCommand` 使用了 `npm run start`，沒有跑 `migrate`。
2) **前端 API 使用方式不正確**：
   - 管理頁用 `apiFetch` 但沒有呼叫 `.json()`，導致永遠把 `items` 當成 `[]`。
   - 申請頁送出後也沒有檢查 `HTTP` 狀態碼，後端即使 500 也會顯示「已送出」。

## 修復內容
- **render.yaml**：把 API 服務的 `startCommand` 改為 `npm run start:with-migrate`，開機就會自動 `build → migrate → start`。
- **後端 /api/admin/review**：查詢欄位補上 `venue`，前端不需再從 `note` 解析。
- **前端 AdminReviewPage**：正確取用 JSON，並在 HTTP 非 200 時拋出錯誤。
- **前端 AdminLoginPage**：登入後檢查 `HTTP` 狀態碼，避免錯誤憑證也被當作成功。
- **前端 BookingPage**：單日與重複申請都會檢查 `r.ok`，後端錯誤會顯示具體訊息。

## 需要您在 Render 上做的事
1. 在 **API 服務**的 Start Command 設為：`npm run start:with-migrate`
2. 確認 API 的環境變數：
   - `DATABASE_URL`（Neon/Supabase 連線字串）
   - `SESSION_SECRET`（任意安全字串）
   - `CORS_ORIGIN`：包含前端網域（例如：`https://venue-booking-frontend-a3ib.onrender.com`）
   - （可選）`ALLOW_GUEST_TERMS=true` 允許訪客同意規範
3. 重新部署 API 與前端。

## 驗證清單
- 開啟 `https://<API 網域>/api/health` 應得到 `{{ ok: true }}`
- 開啟 `https://<API 網域>/api/bookings/approved` 應得到 JSON 陣列
- 送出一張申請 → 進入管理審核頁登入 → 應看得到該筆申請（狀態 `pending`）。

---

如需改回舊行為或有其他需求，我可以再幫你微調。
