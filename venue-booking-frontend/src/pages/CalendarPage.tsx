import React, { useEffect, useState } from 'react';
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const PUBLIC_GOOGLE_CALENDAR_ID = ''; // ← 若有公開行事曆，填上 ID（例如 'xxxx@group.calendar.google.com'）
const GOOGLE_CALENDAR_EMBED =
  PUBLIC_GOOGLE_CALENDAR_ID
    ? `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(PUBLIC_GOOGLE_CALENDAR_ID)}&ctz=Asia%2FTaipei&mode=MONTH`
    : '';

export default function CalendarPage(){
  const [items, setItems] = useState<Array<{id:string,start_ts:string,end_ts:string}>>([]);

  useEffect(()=>{
    if(!GOOGLE_CALENDAR_EMBED){
      // fallback：從 API 讀「已核准」清單
      (async ()=>{
        try{
          const r = await fetch(`${API_BASE}/api/bookings/approved`, { credentials: 'include' });
          const j = await r.json();
          setItems(j.items || []);
        }catch{}
      })();
    }
  },[]);

  if(GOOGLE_CALENDAR_EMBED){
    return (
      <div>
        <p style={{color:'#64748b', fontSize: 12}}>以下為 Google 日曆內嵌（只顯示已審核核准的排程）</p>
        <iframe
          title="calendar"
          src={GOOGLE_CALENDAR_EMBED}
          style={{border:0, width:'100%', height:'70vh'}}
        />
      </div>
    );
  }

  return (
    <div>
      <p style={{color:'#64748b', fontSize: 12}}>尚未設定 Google Calendar，以下顯示 API 的「已核准」清單。</p>
      {items.length===0 ? <p>目前沒有已核准項目</p> : (
        <table style={{width:'100%', borderCollapse:'collapse'}}>
          <thead><tr><th>ID</th><th>Start</th><th>End</th></tr></thead>
          <tbody>
            {items.map(x=>(
              <tr key={x.id}>
                <td style={{fontFamily:'monospace'}}>{x.id}</td>
                <td>{new Date(x.start_ts).toLocaleString()}</td>
                <td>{new Date(x.end_ts).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}