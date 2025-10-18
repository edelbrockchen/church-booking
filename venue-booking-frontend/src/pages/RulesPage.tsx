import React, { useState } from 'react'
import { recordAgreementOnServer, setAgreedLocal } from '../web/agree'

export default function RulesPage() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string>('')

  async function onAgree() {
    setBusy(true)
    setMsg('')
    try {
      // 先寫本機，再通知後端（需要 CORS + credentials）
      setAgreedLocal()
      await recordAgreementOnServer()
      setMsg('已記錄同意，您可以前往「申請借用」。')
      // 若想自動跳到申請頁，可在這裡發出自訂事件讓 App 切 Tab：
      // window.dispatchEvent(new CustomEvent('terms:agreed'))
    } catch (e: any) {
      setMsg(`送出失敗：${e?.message || '無法連線伺服器'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <h2 className="text-2xl font-bold">南投支會教堂借用規範</h2>
      {/* 你的規範條文區塊 … */}

      <div className="pt-2">
        <button
          onClick={onAgree}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-zinc-800 text-white px-4 py-2 disabled:opacity-60"
        >
          {busy ? '送出中…' : '我已閱讀並同意'}
        </button>
        {msg && <div className="mt-2 text-sm text-emerald-700">{msg}</div>}
      </div>
    </div>
  )
}
