import React from 'react'

export default function CalendarPage() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="md:col-span-2 card">
        <h2 className="mb-3 text-lg font-semibold">行事曆</h2>
        {/* 若你有 Google Calendar 內嵌，放 iframe；否則放你的審核過清單 */}
        <div className="aspect-video w-full rounded-xl2 border border-slate-200 bg-slate-50 grid place-items-center text-slate-400">
          這裡可嵌入 Google Calendar 或自製月曆
        </div>
      </div>

      <aside className="card">
        <h3 className="mb-2 font-medium">提示</h3>
        <ul className="space-y-2 text-sm text-slate-600">
          <li>僅顯示「已核准」的排程。</li>
          <li>點上方「申請借用」可提出新的申請。</li>
        </ul>
      </aside>
    </div>
  )
}