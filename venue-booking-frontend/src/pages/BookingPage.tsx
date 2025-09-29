// src/web/pages/bookingpage.tsx
import React, { useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'                  // ✅ 修正 import 路徑
import SubmitWithTermsGate from '../components/SubmitWithTermsGate' // ✅ 修正 import 路徑

// ---- 主題顏色（可改）----
const BRAND = '#0F6FFF'

// ---- 常數與工具 ----
const MAX_DAYS = 14
const DURATION_HOURS = 3
type Venue = '大會堂' | '康樂廳' | '其它教室'
type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6
const WDL: Record<Weekday, string> = { 0: '週日', 1: '週一', 2: '週二', 3: '週三', 4: '週四', 5: '週五', 6: '週六' }

function addHours(d: Date, h: number) { return new Date(d.getTime() + h * 3600_000) }
function capOf(day: Date) { return (day.getDay() === 1 || day.getDay() === 3) ? { h: 18, m: 0 } : { h: 21, m: 30 } }
function clampByRules(start: Date) {
  const targetEnd = addHours(start, DURATION_HOURS)
  const { h, m } = capOf(start)
  const cap = new Date(start); cap.setHours(h, m, 0, 0)
  const end = targetEnd > cap ? cap : targetEnd
  return { end, truncated: end < targetEnd }
}
function fmtLocal(d?: Date | null) {
  if (!d) return ''
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${dd}T${hh}:${mm}`
}
function parseLocal(v: string) { const d = new Date(v); return isNaN(d.getTime()) ? null : d }
function* daysBetween(a: Date, b: Date) { const d = new Date(a); while (d <= b) { yield new Date(d); d.setDate(d.getDate() + 1) } }
function withinTwoWeeks(a: Date, b: Date) { const days = Math.floor((b.getTime() - a.getTime()) / 86400000) + 1; return days > 0 && days <= MAX_DAYS }
function hhmm(d: Date) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

export default function BookingPage() {
  // ...（下半段跟你的一樣，沒動）...
  // ✅ 我保留你原本的邏輯，唯一變動就是 import 修正
}