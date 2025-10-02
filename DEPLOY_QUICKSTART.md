# Venue Booking — 快速部署指引（Render）

## 必備環境變數（API）
- DATABASE_URL
- SESSION_SECRET
- CORS_ORIGIN = https://<你的前端域名>,http://localhost:5173
- （選）ALLOW_GUEST_TERMS=true

## 後端 Start Command
```
npm run start:with-migrate
```

## 健康檢查
- `GET /api/bookings/approved` -> JSON
- `GET /api/debug/cookies` -> 檢查 cookie / sessionUser
- `GET /api/terms/status` -> { accepted: true/false }
- `GET /api/debug/terms` -> { user, terms }

## 常見錯誤
- 403 must_accept_terms: 先按規範同意；或確定 `terms_acceptances` 有被寫入。
- 重疊舊資料導致 migrate 卡住：本版會 NOTICE 並跳過建立 `no_overlap`，不會失敗。
