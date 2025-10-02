# v3.1 (no-card edition)
Use external Postgres (Neon/Supabase). Render deploy via Blueprint without databases block.


---

## 健康檢查 / Debug 小抄
- **API 健康檢查**：打開 `https://<你的 API 網域>/api/bookings/approved` 應回傳 JSON。
- **Cookie 有無帶到**：`https://<你的 API 網域>/api/debug/cookies` 會回傳瀏覽器送過來的 Cookie 標頭。
- **Admin 是否登入**：`https://<你的 API 網域>/api/admin/me` 應回 `{ user: { role: 'admin', ... } }`。
- **CORS / Cookie 重點**：後端 `CORS_ORIGIN` 要含前端網域；前端呼叫需 `credentials: 'include'`（已內建在 `web/lib/api.ts`）。
