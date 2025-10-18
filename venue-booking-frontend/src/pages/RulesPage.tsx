// src/pages/RulesPage.tsx
import React from 'react'
import { CheckCircle2 } from 'lucide-react'

export default function RulesPage({ onAgreed }: { onAgreed: () => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="md:col-span-2 card">
        <h2 className="mb-3 text-lg font-semibold">南投支會教堂借用規範</h2>
        <p className="text-sm text-slate-600 mb-3">教堂借用前請務必詳細閱讀以下規定：</p>

        <ol className="list-decimal pl-6 space-y-2 text-sm text-slate-700">
          <li>
            除支聯會及支會年初排定之聚會及活動外，每月1號後核准當月及下個月內的申請，每次只核准2個月內的申請。（經過實務設施代表及主教團核准，才算正式核准。）
          </li>
          <li>
            教堂可借用時間如下：
            <ul className="list-disc pl-6 mt-1 space-y-1">
              <li>2-1 每日最早 07:00；週一/週三最晚 18:00；其他至 21:30；週日禁用。</li>
              <li>2-2 當日相同活動僅能申請 3.5 小時為限。</li>
              <li>2-3 借用時間 3.5 小時包含環境復歸及清潔。</li>
            </ul>
          </li>
          <li>申請優先順序：當地的支聯會、支會 ＞ 其餘支聯會、傳道部及支會。</li>
          <li>核准優先順序：教會正式聚會 ＞ 支聯會、傳道部、支會、各組織的活動 ＞ 一般婚喪喜慶 ＞ 其餘各類型活動。</li>
          <li>該項用途不可與排定的教會活動時間相衝突。</li>
          <li>所有申請的活動，申請人必須在場，場地才開放使用。</li>
          <li>使用者需對設施的一切損壞，或因使用該設施而導致的任何人員傷害或法律責任，承擔全部的責任。</li>
          <li>大會堂只為正式聚會而使用，其餘活動一律不開放，所有例外皆需經主教核准。</li>
          <li>
            申請者必須清理並將設施完全恢復至使用前的狀態。清掃拖地、桌椅歸位、廚房與洗手間垃圾清理與補充耗材、
            鏡面清潔…等；詳情依實務設施代表指示。
          </li>
          <li>若不遵守相關指示，教會領袖可以要求任何個人或團體停止使用教會產業。</li>
          <li>請確認上列之條文可以接受再借用，以免發生爭議。教會有權取消任何違反規定之活動。感謝!!</li>
        </ol>

        {/* 按鈕置中 */}
        <div className="mt-6 flex justify-center">
          <button className="btn" onClick={onAgreed}>
            <CheckCircle2 className="size-4" /> 我已閱讀並同意
          </button>
        </div>
      </div>

      <aside className="card">
        <h3 className="mb-2 font-medium">備註</h3>
        <p className="text-sm text-slate-600">同意後才可進入「申請借用」頁面。</p>
      </aside>
    </div>
  )
}
