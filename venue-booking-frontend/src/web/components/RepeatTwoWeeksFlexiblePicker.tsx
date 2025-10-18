// src/web/components/RepeatTwoWeeksPicker.tsx
import { useEffect, useMemo, useState } from 'react'
import { buildTwoWeekStarts } from '../lib/repeat'

const DOW_LABELS = ['日','一','二','三','四','五','六']

type Props = {
  firstStartISO: string
  initialEnabled?: boolean
  onStartsPreview?: (starts: string[]) => void
  className?: string
}

export default function RepeatTwoWeeksPicker({
  firstStartISO,
  initialEnabled = false,
  onStartsPreview,
  className,
}: Props) {
  const firstDate = useMemo(() => {
    const d = new Date(firstStartISO)
    return isNaN(d.getTime()) ? new Date() : d
  }, [firstStartISO])

  const firstDow = firstDate.getDay()
  const [enableRepeat, setEnableRepeat] = useState<boolean>(initialEnabled)
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set<number>([firstDow])
  )

  const starts = useMemo(() => {
    if (!enableRepeat) return [firstDate.toISOString()]
    return buildTwoWeekStarts(firstDate.toISOString(), Array.from(selected.values()))
  }, [enableRepeat, selected, firstDate])

  useEffect(() => {
    onStartsPreview?.(starts)
  }, [starts, onStartsPreview])

  const toggleDow = (d: number) => {
    const next = new Set(selected)
    next.has(d) ? next.delete(d) : next.add(d)
    setSelected(next)
  }

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
        將建立：{starts.length} 筆（每筆固定 3.5 小時）
      </div>
    </div>
  )
}
