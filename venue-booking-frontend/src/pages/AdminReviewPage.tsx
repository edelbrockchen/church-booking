import React,{useState} from 'react'
const API_BASE=import.meta.env.VITE_API_BASE_URL||''

type Item={
  id:string; start_ts:string; end_ts:string; created_at:string; created_by?:string|null;
  status:'pending'|'approved'|'rejected'; reviewed_at?:string|null; reviewed_by?:string|null; rejection_reason?:string|null;
}

export default function AdminReviewPage(){
  const [authed,setAuthed]=useState(false)
  const [user,setUser]=useState('')
  const [pwd,setPwd]=useState('')
  const [items,setItems]=useState<Item[]>([])
  const [loading,setLoading]=useState(false)
  const [reason,setReason]=useState('')

  async function login(){
    const r=await fetch(`${API_BASE}/api/admin/login`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials:'include',
      body:JSON.stringify({username:user,password:pwd})
    })
    if(r.ok){ setAuthed(true); load() } else alert('帳號或密碼錯誤，或尚未設定')
  }
  async function load(){
    setLoading(true)
    const r=await fetch(`${API_BASE}/api/admin/review`,{credentials:'include'})
    if(r.ok){ const j=await r.json(); setItems(j.items||[]) } else { alert('未授權或伺服器錯誤') }
    setLoading(false)
  }
  async function approve(id:string){
    const r=await fetch(`${API_BASE}/api/admin/bookings/${id}/approve`,{method:'POST',credentials:'include'})
    if(r.ok) load(); else alert('核准失敗')
  }
  async function reject(id:string){
    const r=await fetch(`${API_BASE}/api/admin/bookings/${id}/reject`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials:'include',
      body:JSON.stringify({reason})
    })
    if(r.ok){ setReason(''); load(); } else alert('退件失敗')
  }

  if(!authed){
    return (
      <div>
        <h3>管理者登入</h3>
        <input placeholder='帳號（ADMIN_USER）' value={user} onChange={e=>setUser(e.target.value)} />
        <br/>
        <input type='password' placeholder='密碼（ADMIN_PASSWORD）' value={pwd} onChange={e=>setPwd(e.target.value)} />
        <div style={{marginTop:12}}>
          <button onClick={login}>登入</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <h3>近 60 天申請</h3>
        <button onClick={load} disabled={loading}>{loading?'載入中…':'重新載入'}</button>
      </div>
      {items.length===0 ? <p>暫無資料</p> : (
        <table style={{width:'100%',borderCollapse:'collapse', marginTop:8}}>
          <thead>
            <tr>
              <th>狀態</th>
              <th>開始 → 結束</th>
              <th>建立時間</th>
              <th>審核資訊</th>
              <th style={{textAlign:'right'}}>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map(x=>(
              <tr key={x.id} style={{borderTop:'1px solid #eee'}}>
                <td>{x.status}</td>
                <td>{new Date(x.start_ts).toLocaleString()} → {new Date(x.end_ts).toLocaleString()}</td>
                <td>{new Date(x.created_at).toLocaleString()}</td>
                <td>
                  {x.status!=='pending'
                    ? <div>
                        <div>{x.status==='approved'?'已核准':'已退件'}</div>
                        {x.reviewed_at && <div>於 {new Date(x.reviewed_at).toLocaleString()}</div>}
                        {x.rejection_reason && <div>理由：{x.rejection_reason}</div>}
                      </div>
                    : <em>待審核</em>}
                </td>
                <td style={{textAlign:'right'}}>
                  {x.status==='pending' && (
                    <>
                      <button onClick={()=>approve(x.id)}>核准</button>
                      <span style={{margin:'0 6px'}} />
                      <input style={{width:160}} placeholder='退件理由（可空）' value={reason} onChange={e=>setReason(e.target.value)} />
                      <button onClick={()=>reject(x.id)}>退件</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}