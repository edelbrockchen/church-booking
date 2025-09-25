import { useEffect, useState } from 'react'
import { isAgreedLocal, fetchAgreementFromServer } from '../agree'
import TermsGateModal from '../components/TermsGateModal'


export default function ApplyPage() {
const [agreed, setAgreed] = useState<boolean>(isAgreedLocal())
const [checking, setChecking] = useState(true)
const [openGate, setOpenGate] = useState(false)


useEffect(() => {
let alive = true
;(async () => {
if (agreed) {
const ok = await fetchAgreementFromServer()
if (alive) setAgreed(ok || true) // 體驗放行；API 層仍會最終把關
}
if (alive) setChecking(false)
})()
return () => { alive = false }
}, [])


function startApplyFlow() {
// TODO: 這裡展開你的申請流程（導頁/開表單/開日曆…）
console.log('開始申請流程')
}


async function onClickApply() {
if (agreed) startApplyFlow()
else setOpenGate(true)
}


return (
<div className="p-6">
<h1 className="text-xl font-semibold">申請借用</h1>


{/* 你的申請 UI … */}
<div className="mt-4">
<button
className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
onClick={onClickApply}
disabled={checking}
title={agreed ? '開始申請' : '未同意時會先顯示借用規範'}
>
{checking ? '檢查中…' : '申請借用'}
</button>
</div>


<TermsGateModal
open={openGate}
onClose={() => setOpenGate(false)}
onAgreed={() => {
setOpenGate(false)
setAgreed(true)
startApplyFlow()
}}
/>
</div>
)
}