以下檔案曾出現 `ENV_API_BASE`，已改為 `import.meta.env.VITE_API_BASE`：

- src/pages/CalendarPage.tsx

`src/web/lib/api.ts` 已統一同時支援 `VITE_API_BASE` 與 `VITE_API_BASE_URL`。
