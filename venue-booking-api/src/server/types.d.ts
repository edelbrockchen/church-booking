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
  }
}