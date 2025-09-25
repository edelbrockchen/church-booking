import React, { useEffect, useState } from 'react';
import CalendarPage from './pages/CalendarPage';
import RulesPage from './pages/RulesPage';
import BookingPage from './pages/BookingPage';
import AdminReviewPage from './pages/AdminReviewPage';

type Tab = 'calendar'|'rules'|'apply'|'admin';

export default function App(){
  const [tab, setTab] = useState<Tab>('calendar');
  const [agreed, setAgreed] = useState<boolean>(false);

  useEffect(()=>{
    const v = localStorage.getItem('rulesAgreed') === 'true';
    setAgreed(v);
  },[]);

  function gotoApply(){
    if(!agreed){
      alert('請先閱讀並同意「借用規範」。');
      setTab('rules');
      return;
    }
    setTab('apply');
  }

  return (
    <div style={{maxWidth: 980, margin: '32px auto', padding: 16}}>
      <h1 style={{marginBottom: 12}}>南投支會場地借用系統</h1>

      <div style={{display:'flex', gap:8, marginBottom: 16}}>
        <button onClick={()=>setTab('calendar')}>行事曆</button>
        <button onClick={()=>setTab('rules')}>借用規範</button>
        <button onClick={gotoApply}>申請借用</button>
        <button onClick={()=>setTab('admin')}>管理者審核</button>
      </div>

      {tab==='calendar' && <CalendarPage />}
      {tab==='rules' && <RulesPage onAgreed={()=>{
        localStorage.setItem('rulesAgreed', 'true');
        setAgreed(true);
        setTab('apply');
      }}/>}
      {tab==='apply' && <BookingPage />}
      {tab==='admin' && <AdminReviewPage />}
    </div>
  );
}
