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
      if (!r.ok) throw new Error((await r.json().catch(()=>({})))?.error || 'login_failed')
      window.location.href = '/admin/review'
    } catch (e:any) {
      setMsg(e.message === 'invalid_credentials' ? '帳號或密碼錯誤' :
             e.message === 'server_not_configured' ? '伺服器未設定管理密碼' :
             '登入失敗')
    } finally { setLoading(false) }
  }

  return (
    <div className="max-w-sm mx-auto p-6 space-y-4">
      <h2 className="text-2xl font-bold">管理者登入</h2>
      <form onSubmit={submit} className="space-y-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-slate-600">帳號</span>
          <input className="border rounded-lg px-3 py-2"
                 value={username} onChange={e=>setUsername(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-slate-600">密碼</span>
          <input className="border rounded-lg px-3 py-2" type="password"
                 value={password} onChange={e=>setPassword(e.target.value)} />
        </label>
        <button type="submit" disabled={loading}
                className="w-full rounded-lg bg-blue-600 text-white py-2 disabled:opacity-60">
          {loading ? '登入中…' : '登入'}
        </button>
        {msg && <div className="text-sm text-rose-600">{msg}</div>}
      </form>
    </div>
  )
}