// src/web/components/RepeatTwoWeeksFlexiblePicker.tsx
import { useEffect, useMemo, useState } from 'react'
import { buildTwoWeekStarts, buildMultiWeekStarts } from '../lib/repeat'

const DOW_LABELS = ['日','一','二','三','四','五','六']

type Props = {
  firstStartISO: string
  initialEnabled?: boolean
  /** 預設是否開啟「每週獨立選擇」 */
  initialPerWeek?: boolean
  onStartsPreview?: (starts: string[]) => void
  className?: string
}

export default function RepeatTwoWeeksFlexiblePicker({
  firstStartISO,
  initialEnabled = false,
  initialPerWeek = false,
  onStartsPreview,
  className,
}: Props) {
  // 合法化 firstStart
  const firstDate = useMemo(() => {
    const d = new Date(firstStartISO)
    return isNaN(d.getTime()) ? new Date() : d
  }, [firstStartISO])

  const firstDow = firstDate.getDay()
  const [enableRepeat, setEnableRepeat] = useState(initialEnabled)
  const [perWeek, setPerWeek] = useState(initialPerWeek)

  // 「兩週同組」模式的選擇
  const [selectedGlobal, setSelectedGlobal] = useState<Set<number>>(
    () => new Set([firstDow])
  )

  // 「每週獨立」模式的選擇：week0 與 week1
  const [selectedWeek0, setSelectedWeek0] = useState<Set<number>>(
    () => new Set([firstDow])
  )
  const [selectedWeek1, setSelectedWeek1] = useState<Set<number>>(
    () => new Set([firstDow])
  )

  // 產生開始時間陣列
  const starts = useMemo(() => {
    if (!enableRepeat) return [firstDate.toISOString()]
    if (!perWeek) {
      return buildTwoWeekStarts(firstDate.toISOString(), Array.from(selectedGlobal.values()))
    }
    return buildMultiWeekStarts(
      firstDate.toISOString(),
      [Array.from(selectedWeek0.values()), Array.from(selectedWeek1.values())]
    )
  }, [enableRepeat, perWeek, selectedGlobal, selectedWeek0, selectedWeek1, firstDate])

  // 回拋預覽
  useEffect(() => { onStartsPreview?.(starts) }, [starts, onStartsPreview])

  // 工具
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
        <input type="checkbox" checked={enableRepeat} onChange={(e) => setEnableRepeat(e.target.checked)} />
        <span>連續 2 週</span>
      </label>

      {enableRepeat && (
        <div className="space-y-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={perWeek} onChange={(e) => setPerWeek(e.target.checked)} />
            <span>每週獨立選擇</span>
          </label>

          {!perWeek ? (
            <WeekRow
              selected={selectedGlobal}
              onToggle={(d) => toggle(setSelectedGlobal, d)}
              onWeekdays={() => setWeekdays(setSelectedGlobal)}
              onAll={() => setAll(setSelectedGlobal)}
              onClear={() => clear(setSelectedGlobal)}
            />
          ) : (
            <>
              <WeekRow
                title="第 1 週"
                selected={selectedWeek0}
                onToggle={(d) => toggle(setSelectedWeek0, d)}
                onWeekdays={() => setWeekdays(setSelectedWeek0)}
                onAll={() => setAll(setSelectedWeek0)}
                onClear={() => clear(setSelectedWeek0)}
              />
              <WeekRow
                title="第 2 週"
                selected={selectedWeek1}
                onToggle={(d) => toggle(setSelectedWeek1, d)}
                onWeekdays={() => setWeekdays(setSelectedWeek1)}
                onAll={() => setAll(setSelectedWeek1)}
                onClear={() => clear(setSelectedWeek1)}
              />
            </>
          )}
        </div>
      )}

      <div className="mt-2 text-sm text-zinc-500">將建立：{starts.length} 筆（每筆固定 3.5 小時）</div>
    </div>
  )
}
