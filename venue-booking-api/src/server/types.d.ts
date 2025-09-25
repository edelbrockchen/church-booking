import 'express-session'

declare global {
  namespace Express {
    interface Request {
      csrfToken?: () => string
    }
  }
}

declare module 'express-session' {
  interface SessionData {
    isAdmin?: boolean
    adminUser?: string   // ← 新增，記錄登入的管理者帳號
  }
}