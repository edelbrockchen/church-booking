import React, { useState } from 'react'
import { apiFetch } from '../web/lib/api'

export default function AdminLoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setMsg('')
    setLoading(true)
    try {
      const r = await apiFetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!r.ok) {
        let j: any = null
        try { j = await r.json() } catch {}
        throw new Error(j?.message || j?.error || `HTTP ${r.status}`)
      }
      // 登入成功 → 轉審核頁
      window.location.href = '/admin/review'
    } catch (e: any) {
      setMsg(e?.message || '登入失敗')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4 max-w-md mx-auto">
      <h1 className="text-xl mb-4">管理者登入</h1>
      <form onSubmit={submit} className="grid gap-3">
        <input value={username} onChange={e=>setUsername(e.target.value)} placeholder="帳號" className="border p-2"/>
        <input value={password} onChange={e=>setPassword(e.target.value)} placeholder="密碼" type="password" className="border p-2"/>
        <button disabled={loading} className="border p-2">{loading ? '登入中…' : '登入'}</button>
        {msg ? <div className="text-red-600">{msg}</div> : null}
      </form>
    </div>
  )
}