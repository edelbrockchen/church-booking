import React,{useMemo,useState} from 'react'
const API_BASE=import.meta.env.VITE_API_BASE_URL||''
type BookingRequest={start:string}

function addHours(d:Date,h:number){return new Date(d.getTime()+h*3600_000)}
function isSunday(d:Date){return d.getDay()===0}
function latestEnd(d:Date){const day=d.getDay(); return (day===1||day===3)?{h:18,m:0}:{h:21,m:30}}
function clampEnd(start:Date){const target=addHours(start,3); const {h,m}=latestEnd(start); const cap=new Date(start); cap.setHours(h,m,0,0); return target.getTime()>cap.getTime()?cap:target}
function fmt(d?:Date){return d?d.toISOString().slice(0,16):''}
function willTruncate(start: Date){
  const targetEnd = addHours(start, 3)
  const {h,m} = latestEnd(start)
  const cap = new Date(start); cap.setHours(h,m,0,0)
  return targetEnd.getTime() > cap.getTime()
}

export default function BookingPage(){
  const [start,setStart]=useState('')
  const [repeatDays,setRepeatDays]=useState(0)

  const startDate=useMemo(()=>start?new Date(start):undefined,[start])
  const endDate=useMemo(()=>startDate?clampEnd(startDate):undefined,[startDate])

  const preview=useMemo(()=>{
    if(!startDate||repeatDays<=0) return []
    return Array.from({length:repeatDays},(_,i)=>{const d=new Date(startDate); d.setDate(d.getDate()+i); return d}).filter(d=>!isSunday(d))
  },[startDate,repeatDays])

  async function submit(){
    if(!startDate){alert('請選擇開始時間');return}
    if(isSunday(startDate)){alert('週日禁用');return}
    const body:BookingRequest={start:new Date(startDate).toISOString()}
    const resp=await fetch(`${API_BASE}/api/bookings`,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(body)})
    const data=await resp.json()
    if(!resp.ok){alert('錯誤：'+(data?.error||'unknown'));return}
    alert('已送出（待審核）：\\n'+JSON.stringify(data,null,2))
  }

  return (
    <div>
      <p>結束時間原則為起始 + 3 小時；若超過當日上限，系統會自動截短（週一/三最晚 18:00；其餘 21:30；週日禁用）。</p>

      <label>開始時間（本地時區）：</label><br/>
      <input type="datetime-local" value={start} onChange={(e)=>setStart(e.target.value)} />
      {!!startDate && (
        <p style={{marginTop:6, fontSize:12, color:'#6b7280'}}>
          {isSunday(startDate) ? '（週日禁用）' : (willTruncate(startDate) ? '＊此申請將因日別上限被截短：3 小時原則 > 上限時段' : '')}
        </p>
      )}
      <br/><br/>

      <label>結束時間（自動計算；可能因規範截短）：</label><br/>
      <input type="datetime-local" value={fmt(endDate)} readOnly />
      <br/><br/>

      <div>
        <label>連續預約天數（含第一天；週日自動略過）：</label><br/>
        <input type="number" min={0} max={14} value={repeatDays} onChange={(e)=>setRepeatDays(parseInt(e.target.value||'0')||0)} />
      </div>

      <div style={{marginTop:16}}>
        <button onClick={submit}>送出</button>
      </div>

      {preview.length>0 && (
        <div style={{marginTop:24}}>
          <h3>預視清單（原則 3 小時；週一/週三可能截短至 18:00）：</h3>
          <ul>
            {preview.map((d,i)=>{
              const t = startDate!
              const sameTime = new Date(d); sameTime.setHours(t.getHours(), t.getMinutes(), 0, 0)
              const end = clampEnd(sameTime)
              const capped = end.getTime() < addHours(sameTime,3).getTime()
              return <li key={i}>{sameTime.toLocaleString()} → {end.toLocaleString()} {capped && '（受日別上限截短）'}</li>
            })}
          </ul>
        </div>
      )}
    </div>
  )
}