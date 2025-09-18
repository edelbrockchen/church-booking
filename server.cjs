// server.js (CommonJS 版本)
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me"; // 正式請改成很長的亂碼
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173"; // 之後前端本機開發用

// Middleware
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// ====== 假資料庫（正式請改用真正資料庫）======
// 帳號：admin / 密碼：admin123
const users = [
  {
    id: "u_1",
    username: "admin",
    // 為了示範，這邊即時做雜湊（正式環境請把 hash 存在資料庫）
    passwordHash: bcrypt.hashSync("admin123", 10),
    role: "admin",
  },
];

// ====== 小工具 ======
function signAuthToken(payload) {
  // 有效期 2 小時，可再搭配 refresh token 機制
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "2h" });
}
function setAuthCookie(res, token) {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie("auth", token, {
    httpOnly: true,         // JS 讀不到，較安全
    secure: isProd,         // 正式（HTTPS）請設 true
    sameSite: "lax",        // 基本的 CSRF 保護
    maxAge: 2 * 60 * 60 * 1000, // 2 小時
    path: "/",
  });
}
function authMiddleware(req, res, next) {
  const token = req.cookies?.auth;
  if (!token) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ ok: false, error: "INVALID_TOKEN" });
  }
}

// ====== 路由 ======

// 健康檢查
app.get("/", (_req, res) => {
  res.send("OK");
});

// 登入：POST /api/login
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: "MISSING_CREDENTIALS" });
  }
  const user = users.find((u) => u.username === username);
  if (!user) {
    return res.status(401).json({ ok: false, error: "BAD_CREDENTIALS" });
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ ok: false, error: "BAD_CREDENTIALS" });
  }
  const token = signAuthToken({ sub: user.id, username: user.username, role: user.role });
  setAuthCookie(res, token);
  return res.json({ ok: true, user: { username: user.username, role: user.role } });
});

// 驗證登入：GET /api/auth/check
app.get("/api/auth/check", authMiddleware, (req, res) => {
  const { username, role } = req.user || {};
  return res.json({ ok: true, user: { username, role } });
});

// 登出：POST /api/logout
app.post("/api/logout", (req, res) => {
  res.clearCookie("auth", { path: "/" });
  return res.json({ ok: true });
});

// 啟動伺服器
app.listen(PORT, () => {
  console.log(`Auth server listening on http://localhost:${PORT}`);
});
