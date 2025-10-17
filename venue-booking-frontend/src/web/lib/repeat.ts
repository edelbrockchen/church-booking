// src/web/lib/repeat.ts

/**
 * 依「第一個開始時間」與勾選的星期，產生兩週內所有開始時間（保留原本的時分）
 * - 星期以瀏覽器本地時間計算（和 <input type="datetime-local"> 一致）
 * - 回傳為 ISO 字串陣列（交給後端用伺服器時區處理）
 *
 * @param firstStartISO  例如 new Date(value).toISOString()
 * @param selectedDOW    勾選的星期，0(日) ~ 6(六)
 * @returns              ISO 字串陣列（已去重、排序）
 */
export function buildTwoWeekStarts(firstStartISO: string, selectedDOW: number[]): string[] {
  // 兩週同一組星期 → 直接委派給多週版本
  return buildMultiWeekStarts(firstStartISO, [selectedDOW, selectedDOW])
}

/**
 * 「每週可選不同星期」的多週版本。
 * - weeksDays[0] 是第 1 週要的星期陣列、weeksDays[1] 是第 2 週…以此類推
 * - 不限制週數；最少會跑 2 週（若陣列長度 < 2 也會補到 2 週）
 * - 若某週的陣列為空，代表那週不建立任何日期
 *
 * @param firstStartISO  第一筆開始時間（ISO）
 * @param weeksDays      例如：[[1,3,5], [2,4]] 代表第 1 週選一三五，第 2 週選二四
 * @returns              ISO 字串陣列（已去重、排序）
 */
export function buildMultiWeekStarts(firstStartISO: string, weeksDays: number[][]): string[] {
  const first = new Date(firstStartISO)
  const base = isNaN(first.getTime()) ? new Date() : first

  // 保留使用者選的 時:分:秒:毫秒（避免邊界誤差）
  const h = base.getHours()
  const m = base.getMinutes()
  const s = base.getSeconds()
  const ms = base.getMilliseconds()

  // 找到「第一筆所在週的 星期日 00:00」作為基準（本地時間）
  const week0 = new Date(base)
  week0.setHours(0, 0, 0, 0)
  week0.setDate(week0.getDate() - week0.getDay()) // Sunday = 0

  const totalWeeks = Math.max(2, weeksDays.length || 0) // 最少兩週
  const out: string[] = []

  for (let w = 0; w < totalWeeks; w++) {
    const rawDays = weeksDays[w] ?? []
    // 過濾非法數字並去重
    const days = Array.from(new Set(rawDays.filter((d) => d >= 0 && d <= 6)))

    for (const d of days) {
      const dt = new Date(week0)          // 以週起點為基準
      dt.setDate(dt.getDate() + w * 7 + d) // 加上週位移＋星期位移
      dt.setHours(h, m, s, ms)            // 套用原本的時分秒
      out.push(dt.toISOString())
    }
  }

  // 去重 + 按時間排序（ISO 字串可直接字典排序）
  return Array.from(new Set(out)).sort()
}
