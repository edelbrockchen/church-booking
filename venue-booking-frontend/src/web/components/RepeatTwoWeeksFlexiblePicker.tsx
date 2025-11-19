// src/web/components/RepeatTwoWeeksFlexiblePicker.tsx
import { useEffect, useMemo, useState } from 'react'
import { buildMultiWeekStarts } from '../lib/repeat'

const DOW_LABELS = ['日','一','二','三','四','五','六']

type Props = {
  /** 第一筆開始時間（做為所有週的基準日與時間） */
  firstStartISO: string
  /** 預設是否啟用重複 */
  initialEnabled?: boolean
  /** 預設是否每週獨立選擇 */
  initialPerWeek?: boolean
  /** 最多可選幾週（2 個月 ≒ 8~9 週；預設 9 週） */
  maxWeeks?: number
  /** 預設週數（介於 1..maxWeeks，預設 8 週） */
  defaultWeeks?: number
  /** 回拋預覽：所有要送出的開始時間 ISO 陣列 */
  onStartsPreview?: (starts: string[]) => void
  className?: string
}

export default function RepeatTwoWeeksFlexiblePicker({
  firstStartISO,
  initialEnabled = false,
  initialPerWeek = false,
  maxWeeks = 9,       // 最長約 2 個月
  defaultWeeks = 8,   // 預設 8 週
  onStartsPreview,
  className,
}: Props) {
  // --- 正規化基準時間 ---
  const firstDate = useMemo(() => {
    const d = new Date(firstStartISO)
    return isNaN(d.getTime()) ? new Date() : d
  }, [firstStartISO])
  const firstDow = firstDate.getDay()

  // --- 控制項 ---
  const [enableRepeat, setEnableRepeat] = useState(initialEnabled)
  const [perWeek, setPerWeek] = useState(initialPerWeek)
  const [weeksCount, setWeeksCount] = useState(
    Math.min(Math.max(1, defaultWeeks), Math.max(1, maxWeeks))
  )

  // 「每週同組」模式的選擇
  const [selectedGlobal, setSelectedGlobal] = useState<Set<number>>(
    () => new Set([firstDow])
  )

  // 「每週獨立」模式的選擇：依週數動態維護
  const [selectedPerWeek, setSelectedPerWeek] = useState<Set<number>[]>(() =>
    Array.from({ length: weeksCount }, () => new Set([firstDow]))
  )

  // 週數異動時，補齊/裁切各週的選擇集合
  useEffect(() => {
    setSelectedPerWeek(prev => {
      const next = [...prev]
      if (weeksCount > next.length) {
        for (let i = next.length; i < weeksCount; i++) next.push(new Set<number>([firstDow]))
      } else if (weeksCount < next.length) {
        next.length = weeksCount
      }
      return next
    })
  }, [weeksCount, firstDow])

  // 產生開始時間陣列
  const starts = useMemo(() => {
    if (!enableRepeat) return [firstDate.toISOString()]

    // perWeek = false → 所有週套用同一組 weekday
    const perWeekDows: number[][] = perWeek
      ? selectedPerWeek.map(s => Array.from(s.values()))
      : Array.from({ length: weeksCount }, () => Array.from(selectedGlobal.values()))

    return buildMultiWeekStarts(firstDate.toISOString(), perWeekDows)
  }, [enableRepeat, perWeek, weeksCount, selectedGlobal, selectedPerWeek, firstDate])

  // 回拋預覽
  useEffect(() => { onStartsPreview?.(starts) }, [starts, onStartsPreview])

  // 小工具
  const toggle = (set: React.Dispatch<React.SetStateAction<Set<number>>>, d: number) => {
    set(prev => {
      const next = new Set(prev)
      next.has(d) ? next.delete(d) : next.add(d)
      return next
    })
  }
  const setWeekdays = (setter: React.Dispatch<React.SetStateAction<Set<number>>>) => setter(new Set([1,2,3,4,5]))
  const setAll = (setter: React.Dispatch<React.SetStateAction<Set<number>>>) => setter(new Set([0,1,2,3,4,5,6]))
  const clear = (setter: React.Dispatch<React.SetStateAction<Set<number>>>) => setter(new Set())

  // UI：一組星期按鈕
  const WeekRow = ({
    title,
    selected,
    onToggle,
    onWeekdays,
    onAll,
    onClear,
  }: {
    title?: string
    selected: Set<number>
    onToggle: (d: number) => void
    onWeekdays: () => void
    onAll: () => void
    onClear: () => void
  }) => (
    <div className="space-y-2">
      {title && <div className="text-sm text-zinc-600">{title}</div>}
      <div className="flex flex-wrap gap-2">
        {DOW_LABELS.map((lbl, i) => {
          const active = selected.has(i)
          return (
            <button
              type="button"
              key={i}
              onClick={() => onToggle(i)}
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
        <button type="button" onClick={onWeekdays} className="underline">平日（週一～週五）</button>
        <button type="button" onClick={onAll} className="underline">全選</button>
        <button type="button" onClick={onClear} className="underline">全不選</button>
      </div>
    </div>
  )

  return (
    <div className={className ?? ''}>
      <label className="flex items-center gap-2 mb-2">
        <input
          type="checkbox"
          checked={enableRepeat}
          onChange={(e) => setEnableRepeat(e.target.checked)}
        />
        <span>連續多週（最長 2 個月）</span>
      </label>

      {enableRepeat && (
        <div className="space-y-3">
          {/* 週數選擇 */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-zinc-700">週數</label>
            <input
              type="number"
              min={1}
              max={maxWeeks}
              value={weeksCount}
              onChange={(e) => {
                const v = Number(e.target.value) || 1
                setWeeksCount(Math.min(Math.max(1, v), maxWeeks))
              }}
              className="w-20 rounded-md border px-2 py-1"
            />
            <div className="text-xs text-zinc-500">(上限 {maxWeeks} 週 ≒ 2 個月)</div>
            <div className="ml-3 flex gap-2 text-xs">
              <button
                type="button"
                className="underline"
                onClick={() => setWeeksCount(Math.min(4, maxWeeks))}
              >1 個月（4 週）</button>
              <button
                type="button"
                className="underline"
                onClick={() => setWeeksCount(Math.min(8, maxWeeks))}
              >2 個月（8 週）</button>
            </div>
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={perWeek}
              onChange={(e) => setPerWeek(e.target.checked)}
            />
            <span>每週獨立選擇</span>
          </label>

          {!perWeek ? (
            <WeekRow
              title="每週同組（套用到所有週）"
              selected={selectedGlobal}
              onToggle={(d) => toggle(setSelectedGlobal, d)}
              onWeekdays={() => setWeekdays(setSelectedGlobal)}
              onAll={() => setAll(setSelectedGlobal)}
              onClear={() => clear(setSelectedGlobal)}
            />
          ) : (
            <div className="space-y-4">
              {selectedPerWeek.map((set, idx) => (
                <WeekRow
                  key={idx}
                  title={`第 ${idx + 1} 週`}
                  selected={set}
                  onToggle={(d) =>
                    setSelectedPerWeek(prev => {
                      const next = [...prev]
                      const one = new Set(next[idx])
                      one.has(d) ? one.delete(d) : one.add(d)
                      next[idx] = one
                      return next
                    })
                  }
                  onWeekdays={() =>
                    setSelectedPerWeek(prev => {
                      const next = [...prev]; next[idx] = new Set([1,2,3,4,5]); return next
                    })
                  }
                  onAll={() =>
                    setSelectedPerWeek(prev => {
                      const next = [...prev]; next[idx] = new Set([0,1,2,3,4,5,6]); return next
                    })
                  }
                  onClear={() =>
                    setSelectedPerWeek(prev => {
                      const next = [...prev]; next[idx] = new Set(); return next
                    })
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-2 text-sm text-zinc-500">
        將建立：{starts.length} 筆（每筆固定 3.5 小時；重複日期最長 2 個月）
      </div>
    </div>
  )
}
