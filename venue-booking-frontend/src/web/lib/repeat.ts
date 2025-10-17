import { useEffect, useMemo, useState } from 'react'
import { buildTwoWeekStarts } from '../lib/repeat'

const DOW_LABELS = ['日','一','二','三','四','五','六']

type Props = {
  /** 使用者選的第一筆開始時間（ISO 字串，例如 new Date(...).toISOString()） */
  firstStartISO: string
  /** 預設是否啟用兩週模式；預設 false */
  initialEnabled?: boolean
  /** 預覽回呼：會回傳計算出的開始時間陣列（至少 1 筆） */
  onStartsPreview?: (starts: string[]) => void
  /** 可選：外層容器 className */
  className?: string
}

/**
 * 「連續 2 週（自選星期）」挑選器
 * - 預設選中 firstStartISO 所在的星期
 * - 啟用後依勾選的星期產生兩週內的多個開始時間（保留原本的時分）
 * - 不啟用時回傳只有 firstStartISO 一筆
 */
export function RepeatTwoWeeksPicker({
  firstStartISO,
  initialEnabled = false,
  onStartsPreview,
  className,
}: Props) {
  // 若 firstStartISO 無效，就用現在時間避免 NaN
  const firstDate = useMemo(() => {
    const d = new Date(firstStartISO)
    return isNaN(d.getTime()) ? new Date() : d
  }, [firstStartISO])

  const firstDow = firstDate.getDay()
  const [enableRepeat, setEnableRepeat] = useState<boolean>(initialEnabled)
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set<number>([firstDow]) // 預設勾選「首次日期的星期」
  )

  // 產生開始時間陣列
  const starts = useMemo(() => {
    if (!enableRepeat) return [firstDate.toISOString()]
    return buildTwoWeekStarts(firstDate.toISOString(), Array.from(selected.values()))
  }, [enableRepeat, selected, firstDate])

  // 把預覽結果通知父層
  useEffect(() => {
    onStartsPreview?.(starts)
  }, [starts, onStartsPreview])

  // 切換某個星期
  const toggleDow = (d: number) => {
    const next = new Set(selected)
    next.has(d) ? next.delete(d) : next.add(d)
    setSelected(next)
  }

  // 快捷鍵
  const selectWeekdays = () => setSelected(new Set([1,2,3,4,5]))
  const selectAll = () => setSelected(new Set([0,1,2,3,4,5,6]))
  const clearAll = () => setSelected(new Set())

  return (
    <div className={className ?? ''}>
      <label className="flex items-center gap-2 mb-2">
        <input
          type="checkbox"
          checked={enableRepeat}
          onChange={(e) => setEnableRepeat(e.target.checked)}
        />
        <span>連續 2 週（自選星期）</span>
      </label>

      {enableRepeat && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {DOW_LABELS.map((lbl, i) => {
              const active = selected.has(i)
              return (
                <button
                  type="button"
                  key={i}
                  onClick={() => toggleDow(i)}
                  className={
                    'px-3 py-1 rounded-md border transition-colors ' +
                    (active ? 'bg-zinc-800 text-white border-zinc-800' : 'bg-white text-zinc-800')
                  }
                  aria-pressed={active}
                >
                  週{lbl}
                </button>
              )
            })}
          </div>

          <div className="flex gap-2 text-sm">
            <button type="button" onClick={selectWeekdays} className="underline">
              平日（週一～週五）
            </button>
            <button type="button" onClick={selectAll} className="underline">
              全選
            </button>
            <button type="button" onClick={clearAll} className="underline">
              全不選
            </button>
          </div>
        </div>
      )}

      <div className="mt-2 text-sm text-zinc-500">
        將建立：{starts.length} 筆（每筆固定 3 小時）
      </div>
    </div>
  )
}

export default RepeatTwoWeeksPicker
