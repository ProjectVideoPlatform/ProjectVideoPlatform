// admin.jsx — Dark Cinema Theme · Cookie Auth (no Bearer)
import React, { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import {
  Search, Users, Video, DollarSign, Activity, Edit, Trash2,
  PlayCircle, CheckCircle, AlertCircle, XCircle, RefreshCw, Loader,
  LayoutDashboard, ShoppingBag, X, Film, TrendingUp, RotateCcw,
  ThumbsUp, ThumbsDown, Clock, MessageSquare, Database, Zap,
  HardDrive, FileText, Trash, Download, UploadCloud, Filter,
  ChevronDown, ChevronUp, Calendar, CreditCard, Hash
} from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

const API_BASE = '/admin';
const ES_BASE  = '/elasticsearch'; // → /api/elasticsearch

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  :root {
    --bg:#0a0a0f; --surface:#111118; --card:#16161f;
    --border:rgba(255,255,255,0.07); --accent:#e8445a; --accent2:#ff8c42;
    --gold:#f5c842; --text:#f0eff5; --muted:#6b6a7a;
    --success:#2ecc71; --warn:#f5c842; --nav-h:60px;
    --es:#6366f1;
  }
  .adm-root { min-height:100vh; background:var(--bg); color:var(--text); font-family:'DM Sans',sans-serif; -webkit-font-smoothing:antialiased; }
  .adm-nav { position:sticky; top:0; height:var(--nav-h); background:rgba(10,10,15,0.9); backdrop-filter:blur(18px); border-bottom:1px solid var(--border); z-index:50; display:flex; align-items:center; padding:0 20px; gap:10px; }
  .adm-logo { font-family:'Bebas Neue',sans-serif; font-size:20px; letter-spacing:2px; background:linear-gradient(135deg,var(--accent),var(--accent2)); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; flex-shrink:0; }
  .adm-sep { width:1px; height:20px; background:var(--border); flex-shrink:0; }
  .adm-admin-pill { font-size:10px; font-weight:700; letter-spacing:.7px; text-transform:uppercase; padding:3px 9px; border-radius:6px; background:rgba(232,68,90,.12); color:var(--accent); border:1px solid rgba(232,68,90,.25); flex-shrink:0; }
  .adm-tabs { display:flex; gap:2px; flex:1; }
  @media(max-width:640px){.adm-tabs{display:none;}}
  .adm-tab { display:flex; align-items:center; gap:6px; padding:7px 13px; border-radius:8px; font-size:13px; font-weight:500; color:var(--muted); background:transparent; border:none; cursor:pointer; transition:all .2s; white-space:nowrap; font-family:'DM Sans',sans-serif; }
  .adm-tab:hover { color:var(--text); background:rgba(255,255,255,.04); }
  .adm-tab.active { color:var(--accent); background:rgba(232,68,90,.1); }
  .adm-tab.active.es-tab { color:var(--es); background:rgba(99,102,241,.1); }
  .adm-tab-badge { display:inline-flex; align-items:center; justify-content:center; min-width:17px; height:17px; padding:0 4px; border-radius:9px; background:var(--accent); color:#fff; font-size:9px; font-weight:700; }
  .adm-bot { display:none; position:fixed; bottom:0; left:0; right:0; height:62px; background:rgba(10,10,15,.96); backdrop-filter:blur(16px); border-top:1px solid var(--border); z-index:100; align-items:center; justify-content:space-around; }
  @media(max-width:640px){.adm-bot{display:flex;}}
  .adm-bitem { display:flex; flex-direction:column; align-items:center; gap:2px; padding:5px 8px; border:none; background:transparent; color:var(--muted); cursor:pointer; font-size:9px; font-weight:600; letter-spacing:.3px; text-transform:uppercase; font-family:'DM Sans',sans-serif; transition:color .2s; flex:1; }
  .adm-bitem.active { color:var(--accent); }
  .adm-bitem svg { width:20px; height:20px; }
  .adm-page { max-width:1280px; margin:0 auto; padding:26px 20px; }
  @media(max-width:640px){.adm-page{padding:18px 14px 80px;}}
  .adm-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:10px; }
  .adm-title { font-family:'Bebas Neue',sans-serif; font-size:26px; letter-spacing:1.5px; }
  .adm-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:22px; }
  @media(max-width:900px){.adm-stats{grid-template-columns:repeat(2,1fr);}}
  @media(max-width:480px){.adm-stats{grid-template-columns:1fr 1fr; gap:10px;}}
  .adm-stat { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:16px 18px; display:flex; align-items:center; gap:12px; transition:border-color .2s; }
  .adm-stat:hover { border-color:rgba(255,255,255,.12); }
  .adm-stat-icon { width:42px; height:42px; border-radius:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  .adm-stat-lbl { font-size:11px; color:var(--muted); font-weight:500; letter-spacing:.3px; margin-bottom:3px; }
  .adm-stat-val { font-size:22px; font-weight:700; line-height:1; }
  .adm-chart { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:18px 20px; margin-bottom:22px; }
  .adm-chart-lbl { font-size:11px; font-weight:600; color:var(--muted); letter-spacing:.5px; text-transform:uppercase; margin-bottom:14px; }
  .adm-bar { display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap; }
  .adm-sw { flex:1; min-width:140px; position:relative; }
  .adm-sw svg { position:absolute; left:10px; top:50%; transform:translateY(-50%); color:var(--muted); width:14px; height:14px; pointer-events:none; }
  .adm-si { width:100%; padding:9px 12px 9px 32px; background:var(--surface); border:1px solid var(--border); border-radius:10px; color:var(--text); font-family:'DM Sans',sans-serif; font-size:13px; outline:none; transition:border-color .2s; }
  .adm-si::placeholder { color:var(--muted); }
  .adm-si:focus { border-color:var(--accent); }
  .adm-in-plain { width:100%; padding:9px 12px; background:var(--surface); border:1px solid var(--border); border-radius:10px; color:var(--text); font-family:'DM Sans',sans-serif; font-size:13px; outline:none; transition:border-color .2s; box-sizing:border-box; }
  .adm-in-plain:focus { border-color:var(--accent); }
  .adm-in-plain::placeholder { color:var(--muted); }
  .adm-sel { padding:9px 13px; background:var(--surface); border:1px solid var(--border); border-radius:10px; color:var(--text); font-family:'DM Sans',sans-serif; font-size:13px; outline:none; cursor:pointer; min-width:120px; }
  .adm-sel option { background:var(--surface); }
  .adm-ref { display:flex; align-items:center; gap:6px; padding:9px 14px; border-radius:10px; background:var(--surface); border:1px solid var(--border); color:var(--text); font-size:13px; font-weight:500; cursor:pointer; transition:border-color .2s; font-family:'DM Sans',sans-serif; white-space:nowrap; }
  .adm-ref:hover { border-color:var(--accent); color:var(--accent); }
  .adm-ref:disabled { opacity:.4; cursor:not-allowed; }
  .adm-tbl { background:var(--card); border:1px solid var(--border); border-radius:14px; overflow:hidden; }
  .adm-row { display:flex; align-items:center; justify-content:space-between; padding:13px 16px; gap:12px; border-bottom:1px solid var(--border); transition:background .15s; }
  .adm-row:last-child { border-bottom:none; }
  .adm-row:hover { background:rgba(255,255,255,.025); }
  .adm-ico { width:38px; height:38px; border-radius:10px; background:var(--surface); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; flex-shrink:0; color:var(--muted); }
  .adm-rtitle { font-size:13px; font-weight:600; color:var(--text); margin-bottom:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .adm-rsub { font-size:11px; color:var(--muted); line-height:1.5; }
  .adm-actions { display:flex; gap:5px; flex-shrink:0; }
  .adm-ibtn { width:30px; height:30px; border-radius:8px; background:var(--surface); border:1px solid var(--border); color:var(--muted); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all .2s; }
  .adm-ibtn:hover { border-color:var(--accent); color:var(--accent); }
  .adm-ibtn.del:hover { background:rgba(232,68,90,.1); }
  .adm-ibtn:disabled { opacity:.35; cursor:not-allowed; }
  .adm-bdg { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:6px; font-size:10px; font-weight:700; letter-spacing:.4px; text-transform:uppercase; }
  .adm-bdg-completed       { background:rgba(46,204,113,.12);  color:var(--success); border:1px solid rgba(46,204,113,.25); }
  .adm-bdg-processing      { background:rgba(245,200,66,.12);  color:var(--warn);    border:1px solid rgba(245,200,66,.25); }
  .adm-bdg-failed          { background:rgba(232,68,90,.12);   color:var(--accent);  border:1px solid rgba(232,68,90,.25); }
  .adm-bdg-pending         { background:rgba(99,102,241,.12);  color:#a5b4fc;        border:1px solid rgba(99,102,241,.25); }
  .adm-bdg-pending_refund  { background:rgba(251,191,36,.12);  color:#fbbf24;        border:1px solid rgba(251,191,36,.25); }
  .adm-bdg-refunded        { background:rgba(74,222,128,.12);  color:#4ade80;        border:1px solid rgba(74,222,128,.25); }
  .adm-bdg-rejected        { background:rgba(100,116,139,.12); color:#94a3b8;        border:1px solid rgba(100,116,139,.25); }
  .adm-bdg-admin { background:rgba(232,68,90,.12); color:var(--accent); border:1px solid rgba(232,68,90,.25); }
  .adm-bdg-user  { background:rgba(99,102,241,.12); color:#a5b4fc; border:1px solid rgba(99,102,241,.25); }
  .adm-loading { display:flex; flex-direction:column; align-items:center; padding:52px; gap:10px; color:var(--muted); font-size:13px; }
  .adm-empty   { display:flex; flex-direction:column; align-items:center; padding:52px; gap:8px; color:var(--muted); font-size:13px; }
  .adm-err { background:rgba(232,68,90,.1); border:1px solid rgba(232,68,90,.25); border-radius:10px; padding:12px 14px; margin-bottom:16px; font-size:13px; color:#fca5a5; display:flex; align-items:center; gap:8px; }
  .adm-ok  { background:rgba(46,204,113,.1); border:1px solid rgba(46,204,113,.25); border-radius:10px; padding:12px 14px; margin-bottom:16px; font-size:13px; color:#86efac; display:flex; align-items:center; gap:8px; }
  .adm-mbk { position:fixed; inset:0; background:rgba(0,0,0,.7); backdrop-filter:blur(6px); z-index:200; display:flex; align-items:center; justify-content:center; padding:20px; }
  .adm-mdl { background:var(--card); border:1px solid var(--border); border-radius:22px; width:100%; max-width:450px; box-shadow:0 24px 60px rgba(0,0,0,.7); overflow:hidden; }
  .adm-mhd { padding:17px 20px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; }
  .adm-mbd { padding:20px; }
  .adm-fld { margin-bottom:14px; }
  .adm-lbl { display:block; font-size:11px; font-weight:600; letter-spacing:.6px; text-transform:uppercase; color:var(--muted); margin-bottom:5px; }
  .adm-in,.adm-ta { width:100%; padding:9px 12px; background:var(--surface); border:1px solid var(--border); border-radius:10px; color:var(--text); font-family:'DM Sans',sans-serif; font-size:13px; outline:none; transition:border-color .2s; }
  .adm-in:focus,.adm-ta:focus { border-color:var(--accent); }
  .adm-in::placeholder,.adm-ta::placeholder { color:var(--muted); }
  .adm-ta { height:76px; resize:none; }
  .adm-mact { display:flex; gap:10px; margin-top:16px; }
  .adm-bcnl { flex:1; padding:10px; border-radius:10px; background:var(--surface); border:1px solid var(--border); color:var(--text); font-family:'DM Sans',sans-serif; font-size:13px; font-weight:500; cursor:pointer; transition:border-color .2s; }
  .adm-bcnl:hover { border-color:var(--accent); }
  .adm-bsav { flex:1; padding:10px; border-radius:10px; background:linear-gradient(135deg,var(--accent),var(--accent2)); border:none; color:#fff; font-family:'DM Sans',sans-serif; font-size:13px; font-weight:600; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; transition:opacity .2s; }
  .adm-bsav:hover { opacity:.9; }
  .adm-bsav:disabled { opacity:.4; cursor:not-allowed; }

  /* Purchase filter panel */
  .adm-filter-panel { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:16px; margin-bottom:14px; }
  .adm-filter-toggle { display:flex; align-items:center; gap:7px; background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:9px 14px; font-size:13px; font-weight:500; color:var(--text); cursor:pointer; font-family:'DM Sans',sans-serif; transition:border-color .2s; }
  .adm-filter-toggle:hover { border-color:var(--accent); color:var(--accent); }
  .adm-filter-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:14px; }
  @media(max-width:700px){.adm-filter-grid{grid-template-columns:1fr 1fr;}}
  @media(max-width:440px){.adm-filter-grid{grid-template-columns:1fr;}}
  .adm-filter-group { display:flex; flex-direction:column; gap:5px; }
  .adm-filter-lbl { font-size:10px; font-weight:600; letter-spacing:.5px; text-transform:uppercase; color:var(--muted); }
  .adm-filter-actions { display:flex; gap:8px; margin-top:12px; }
  .adm-filter-apply { display:flex; align-items:center; gap:6px; padding:8px 16px; border-radius:10px; background:linear-gradient(135deg,var(--accent),var(--accent2)); border:none; color:#fff; font-size:13px; font-weight:600; cursor:pointer; font-family:'DM Sans',sans-serif; }
  .adm-filter-reset { display:flex; align-items:center; gap:6px; padding:8px 14px; border-radius:10px; background:var(--surface); border:1px solid var(--border); color:var(--muted); font-size:13px; cursor:pointer; font-family:'DM Sans',sans-serif; transition:all .2s; }
  .adm-filter-reset:hover { color:var(--text); border-color:rgba(255,255,255,.15); }

  /* Refund row expand */
  .adm-refund-row { background:var(--card); border-bottom:1px solid var(--border); }
  .adm-refund-row:last-child { border-bottom:none; }
  .adm-refund-main { display:flex; align-items:center; gap:12px; padding:14px 16px; transition:background .15s; }
  .adm-refund-main:hover { background:rgba(255,255,255,.025); }
  .adm-refund-reason { padding:0 16px 14px 66px; font-size:12px; color:#94a3b8; line-height:1.6; display:flex; align-items:flex-start; gap:6px; }
  .adm-refund-reason-icon { color:#64748b; flex-shrink:0; margin-top:2px; }
  .adm-approve-btn { display:flex; align-items:center; gap:5px; padding:6px 12px; border-radius:8px; background:rgba(46,204,113,.12); border:1px solid rgba(46,204,113,.3); color:#4ade80; font-size:12px; font-weight:600; cursor:pointer; transition:all .2s; white-space:nowrap; font-family:'DM Sans',sans-serif; }
  .adm-approve-btn:hover:not(:disabled) { background:rgba(46,204,113,.22); }
  .adm-approve-btn:disabled { opacity:.4; cursor:not-allowed; }
  .adm-reject-btn { display:flex; align-items:center; gap:5px; padding:6px 12px; border-radius:8px; background:rgba(100,116,139,.1); border:1px solid rgba(100,116,139,.25); color:#94a3b8; font-size:12px; font-weight:600; cursor:pointer; transition:all .2s; white-space:nowrap; font-family:'DM Sans',sans-serif; }
  .adm-reject-btn:hover:not(:disabled) { background:rgba(100,116,139,.2); color:#cbd5e1; }
  .adm-reject-btn:disabled { opacity:.4; cursor:not-allowed; }

  /* ES Tab */
  .es-section { margin-bottom:22px; }
  .es-section-title { font-size:11px; font-weight:700; letter-spacing:.8px; text-transform:uppercase; color:var(--es); margin-bottom:12px; display:flex; align-items:center; gap:6px; }
  .es-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:14px; }
  @media(max-width:600px){.es-grid{grid-template-columns:1fr;}}
  .es-index-card { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:18px; transition:border-color .2s; }
  .es-index-card:hover { border-color:rgba(99,102,241,.3); }
  .es-index-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
  .es-index-name { font-family:'Bebas Neue',sans-serif; font-size:18px; letter-spacing:1px; color:var(--es); }
  .es-index-status { width:8px; height:8px; border-radius:50%; background:var(--success); box-shadow:0 0 6px var(--success); flex-shrink:0; }
  .es-index-status.offline { background:var(--accent); box-shadow:0 0 6px var(--accent); }
  .es-meta-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px; }
  .es-meta-item { background:var(--surface); border-radius:8px; padding:10px 12px; }
  .es-meta-lbl { font-size:10px; color:var(--muted); font-weight:500; margin-bottom:4px; }
  .es-meta-val { font-size:16px; font-weight:700; color:var(--text); }
  .es-actions { display:flex; gap:8px; flex-wrap:wrap; }
  .es-btn { display:flex; align-items:center; gap:5px; padding:7px 13px; border-radius:9px; font-size:12px; font-weight:600; cursor:pointer; transition:all .2s; font-family:'DM Sans',sans-serif; border:1px solid transparent; white-space:nowrap; }
  .es-btn:disabled { opacity:.4; cursor:not-allowed; }
  .es-btn-sync { background:rgba(99,102,241,.12); border-color:rgba(99,102,241,.3); color:#a5b4fc; }
  .es-btn-sync:hover:not(:disabled) { background:rgba(99,102,241,.2); }
  .es-btn-recreate { background:rgba(245,200,66,.08); border-color:rgba(245,200,66,.25); color:var(--gold); }
  .es-btn-recreate:hover:not(:disabled) { background:rgba(245,200,66,.15); }
  .es-btn-delete { background:rgba(232,68,90,.08); border-color:rgba(232,68,90,.25); color:var(--accent); }
  .es-btn-delete:hover:not(:disabled) { background:rgba(232,68,90,.15); }
  .es-log { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:12px 14px; font-size:11px; font-family:'DM Mono','Courier New',monospace; color:var(--muted); line-height:1.7; max-height:160px; overflow-y:auto; }
  .es-log-entry { display:flex; gap:8px; }
  .es-log-ts { color:rgba(99,102,241,.6); flex-shrink:0; }
  .es-log-ok  { color:#4ade80; }
  .es-log-err { color:#f87171; }
  .es-log-warn{ color:#fbbf24; }
  .es-confirm-box { background:rgba(232,68,90,.08); border:1px solid rgba(232,68,90,.2); border-radius:10px; padding:12px 14px; margin-top:10px; font-size:12px; color:#fca5a5; display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
  .es-confirm-btns { display:flex; gap:7px; }

  .recharts-cartesian-grid-horizontal line,.recharts-cartesian-grid-vertical line{stroke:rgba(255,255,255,.06);}
  .recharts-text{fill:var(--muted)!important;font-size:11px!important;}
  .recharts-tooltip-wrapper .recharts-default-tooltip{background:var(--card)!important;border:1px solid var(--border)!important;border-radius:10px!important;font-family:'DM Sans',sans-serif!important;font-size:12px!important;}
  .recharts-default-tooltip .recharts-tooltip-label{color:var(--text)!important;}
  .recharts-default-tooltip .recharts-tooltip-item{color:var(--accent)!important;}
  @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  .spin{animation:spin 1s linear infinite;}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
  .pulse{animation:pulse 1.5s ease-in-out infinite;}
`;

/* ── API helpers ── */
const adminApi = {
  get:    (ep)       => apiFetch(`${API_BASE}${ep}`),
  put:    (ep, data) => apiFetch(`${API_BASE}${ep}`, { method: 'PUT',    body: JSON.stringify(data) }),
  post:   (ep, data) => apiFetch(`${API_BASE}${ep}`, { method: 'POST',   body: JSON.stringify(data) }),
  delete: (ep)       => apiFetch(`${API_BASE}${ep}`, { method: 'DELETE' }),
};

const esApi = {
  get:    (ep)       => apiFetch(`${ES_BASE}${ep}`),
  post:   (ep, data) => apiFetch(`${ES_BASE}${ep}`, { method: 'POST',   body: JSON.stringify(data) }),
  delete: (ep)       => apiFetch(`${ES_BASE}${ep}`, { method: 'DELETE' }),
};

/* ── Status badge ── */
const Bdg = ({ status }) => {
  const map = {
    completed:      [<CheckCircle size={9} />,  'completed'],
    processing:     [<Activity size={9} />,     'processing'],
    failed:         [<XCircle size={9} />,      'failed'],
    pending:        [<AlertCircle size={9} />,  'pending'],
    pending_refund: [<Clock size={9} />,         'pending_refund'],
    refunded:       [<RotateCcw size={9} />,    'refunded'],
    rejected:       [<XCircle size={9} />,      'rejected'],
  };
  const [icon, cls] = map[status] || map.pending;
  return <span className={`adm-bdg adm-bdg-${cls}`}>{icon}{status?.replace('_', ' ')}</span>;
};

/* ── Reject Modal ── */
const RejectModal = ({ isOpen, onClose, onConfirm, refund }) => {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const confirm = async () => {
    if (!reason.trim()) return;
    setSaving(true);
    try { await onConfirm(reason.trim()); onClose(); }
    finally { setSaving(false); }
  };
  if (!isOpen) return null;
  return (
    <div className="adm-mbk">
      <div className="adm-mdl">
        <div className="adm-mhd">
          <div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, letterSpacing:1.5 }}>ปฏิเสธคำร้อง</div>
            <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>
              {refund?.videoId?.title ?? `Purchase #${String(refund?._id ?? '').slice(-6)}`}
            </div>
          </div>
          <button className="adm-ibtn" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="adm-mbd">
          <div className="adm-fld">
            <label className="adm-lbl">เหตุผลที่ปฏิเสธ *</label>
            <textarea className="adm-ta" placeholder="เช่น ไม่อยู่ในเงื่อนไข, ใช้งานเกิน 80%, พ้นกรอบเวลา..."
              value={reason} onChange={e => setReason(e.target.value)} disabled={saving} />
          </div>
          <div className="adm-mact">
            <button className="adm-bcnl" onClick={onClose} disabled={saving}>ยกเลิก</button>
            <button className="adm-bsav" onClick={confirm} disabled={saving || !reason.trim()} style={{ background:'#475569' }}>
              {saving ? <Loader size={13} className="spin" /> : <><XCircle size={13} />ยืนยันปฏิเสธ</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ── Edit Modal ── */
const EditModal = ({ isOpen, onClose, onSave, video }) => {
  const [form, setForm]     = useState({ title:'', description:'', price:0, tags:'' });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (video) setForm({
      title:       video.title       || '',
      description: video.description || '',
      price:       video.price       || 0,
      tags:        Array.isArray(video.tags) ? video.tags.join(', ') : (video.tags || ''),
    });
  }, [video]);
  const save = async () => {
    setSaving(true);
    try {
      const p = {};
      if (form.title)       p.title       = form.title;
      if (form.description) p.description = form.description;
      if (form.price)       p.price       = form.price;
      if (form.tags)        p.tags        = form.tags;
      await adminApi.put(`/videos/${video.id}`, p);
      onSave(); onClose();
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };
  if (!isOpen) return null;
  return (
    <div className="adm-mbk">
      <div className="adm-mdl">
        <div className="adm-mhd">
          <div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, letterSpacing:1.5 }}>แก้ไขวิดีโอ</div>
            <div style={{ fontSize:11, color:'var(--muted)', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:280 }}>{video?.title}</div>
          </div>
          <button className="adm-ibtn" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="adm-mbd">
          <div className="adm-fld"><label className="adm-lbl">Title</label><input className="adm-in" value={form.title} onChange={e => setForm(p => ({ ...p, title:e.target.value }))} /></div>
          <div className="adm-fld"><label className="adm-lbl">Description</label><textarea className="adm-ta" value={form.description} onChange={e => setForm(p => ({ ...p, description:e.target.value }))} /></div>
          <div className="adm-fld"><label className="adm-lbl">Price (฿)</label><input type="number" step="1" className="adm-in" value={form.price} onChange={e => setForm(p => ({ ...p, price:parseFloat(e.target.value)||0 }))} /></div>
          <div className="adm-fld"><label className="adm-lbl">Tags</label><input className="adm-in" value={form.tags} onChange={e => setForm(p => ({ ...p, tags:e.target.value }))} /></div>
          <div className="adm-mact">
            <button className="adm-bcnl" onClick={onClose}>ยกเลิก</button>
            <button className="adm-bsav" onClick={save} disabled={saving}>
              {saving ? <Loader size={13} className="spin" /> : <><CheckCircle size={13} />บันทึก</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════
   ES TAB
════════════════════════════════════════════════ */
const ESTab = () => {
  const [stats,      setStats]      = useState({ videos: null, purchases: null });
  const [loading,    setLoading]    = useState({ videos: false, purchases: false });
  const [opLoading,  setOpLoading]  = useState({});       // { 'videos-sync': true, ... }
  const [logs,       setLogs]       = useState([]);
  const [confirm,    setConfirm]    = useState(null);     // { index, op } — pending confirmation
  const [globalMsg,  setGlobalMsg]  = useState(null);     // { type:'ok'|'err', text }

  const addLog = (level, text) =>
    setLogs(prev => [...prev.slice(-49), { ts: new Date().toLocaleTimeString('th-TH'), level, text }]);

  const fetchStats = async (idx) => {
    setLoading(p => ({ ...p, [idx]: true }));
    try {
      const d = await esApi.get(`/stats/${idx}`);
      setStats(p => ({ ...p, [idx]: d.data }));
      addLog('ok', `${idx}: ${d.data.documents} docs · ${d.data.sizeInMB} MB`);
    } catch (e) {
      setStats(p => ({ ...p, [idx]: null }));
      addLog('err', `stats/${idx} failed: ${e.message}`);
    } finally {
      setLoading(p => ({ ...p, [idx]: false }));
    }
  };

  useEffect(() => {
    fetchStats('videos');
    fetchStats('purchases');
  }, []);

  const setOp = (key, v) => setOpLoading(p => ({ ...p, [key]: v }));

  const doSync = async (idx) => {
    const key = `${idx}-sync`;
    setOp(key, true);
    addLog('warn', `Syncing ${idx}…`);
    try {
      const d = await esApi.post('/admin/sync', { models: [idx] });
      const r = d.data[idx];
      if (r.status === 'success') {
        addLog('ok', `${idx} synced · ${r.synced} docs`);
        setGlobalMsg({ type:'ok', text:`✓ ${idx} synced (${r.synced} documents)` });
      } else {
        addLog('err', `sync ${idx}: ${r.error}`);
        setGlobalMsg({ type:'err', text:`Sync ${idx} failed: ${r.error}` });
      }
      await fetchStats(idx);
    } catch (e) {
      addLog('err', `sync error: ${e.message}`);
      setGlobalMsg({ type:'err', text: e.message });
    } finally {
      setOp(key, false);
      setTimeout(() => setGlobalMsg(null), 4000);
    }
  };

  const doRecreate = async (idx) => {
    const key = `${idx}-recreate`;
    setOp(key, true);
    setConfirm(null);
    addLog('warn', `Recreating ${idx} index…`);
    try {
      const d = await esApi.post('/admin/recreate', { models: [idx] });
      const r = d.data[idx];
      if (r.status === 'success') {
        addLog('ok', `${idx} recreated`);
        setGlobalMsg({ type:'ok', text:`✓ ${idx} index recreated & re-synced` });
      } else {
        addLog('err', `recreate ${idx}: ${r.error}`);
        setGlobalMsg({ type:'err', text: r.error });
      }
      await fetchStats(idx);
    } catch (e) {
      addLog('err', `recreate error: ${e.message}`);
      setGlobalMsg({ type:'err', text: e.message });
    } finally {
      setOp(key, false);
      setTimeout(() => setGlobalMsg(null), 4000);
    }
  };

  const doDelete = async (idx) => {
    const key = `${idx}-delete`;
    setOp(key, true);
    setConfirm(null);
    addLog('warn', `Deleting ${idx} index…`);
    try {
      await esApi.delete(`/admin/index/${idx}`);
      setStats(p => ({ ...p, [idx]: null }));
      addLog('ok', `${idx} index deleted`);
      setGlobalMsg({ type:'ok', text:`✓ ${idx} index deleted` });
    } catch (e) {
      addLog('err', `delete error: ${e.message}`);
      setGlobalMsg({ type:'err', text: e.message });
    } finally {
      setOp(key, false);
      setTimeout(() => setGlobalMsg(null), 4000);
    }
  };

  const IndexCard = ({ idx, icon, color }) => {
    const s      = stats[idx];
    const isLoad = loading[idx];
    const busy   = (op) => !!opLoading[`${idx}-${op}`];
    return (
      <div className="es-index-card">
        <div className="es-index-header">
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:36, height:36, borderRadius:10, background:`rgba(${color},.12)`, display:'flex', alignItems:'center', justifyContent:'center', color:`rgb(${color})` }}>
              {icon}
            </div>
            <span className="es-index-name">{idx}</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div className={`es-index-status ${!s ? 'offline' : ''}`} />
            <button className="adm-ibtn" onClick={() => fetchStats(idx)} disabled={isLoad} title="Refresh stats">
              <RefreshCw size={12} className={isLoad ? 'spin' : ''} />
            </button>
          </div>
        </div>

        {isLoad ? (
          <div style={{ padding:'20px 0', display:'flex', justifyContent:'center' }}>
            <Loader size={18} className="spin" style={{ color:'var(--muted)' }} />
          </div>
        ) : s ? (
          <div className="es-meta-grid">
            <div className="es-meta-item">
              <div className="es-meta-lbl">Documents</div>
              <div className="es-meta-val">{s.documents?.toLocaleString()}</div>
            </div>
            <div className="es-meta-item">
              <div className="es-meta-lbl">Index Size</div>
              <div className="es-meta-val">{s.sizeInMB} MB</div>
            </div>
            <div className="es-meta-item">
              <div className="es-meta-lbl">Deleted Docs</div>
              <div className="es-meta-val" style={{ color:'var(--muted)' }}>{s.deleted}</div>
            </div>
            <div className="es-meta-item">
              <div className="es-meta-lbl">Size (bytes)</div>
              <div className="es-meta-val" style={{ fontSize:12 }}>{s.sizeInBytes?.toLocaleString()}</div>
            </div>
          </div>
        ) : (
          <div style={{ padding:'14px 0', textAlign:'center', fontSize:12, color:'var(--muted)' }}>Index not found / offline</div>
        )}

        <div className="es-actions">
          <button className="es-btn es-btn-sync" onClick={() => doSync(idx)} disabled={busy('sync') || busy('recreate') || busy('delete')}>
            {busy('sync') ? <Loader size={11} className="spin" /> : <UploadCloud size={11} />}
            Sync
          </button>
          <button className="es-btn es-btn-recreate" onClick={() => setConfirm({ idx, op:'recreate' })} disabled={busy('sync') || busy('recreate') || busy('delete')}>
            {busy('recreate') ? <Loader size={11} className="spin" /> : <RefreshCw size={11} />}
            Recreate
          </button>
          <button className="es-btn es-btn-delete" onClick={() => setConfirm({ idx, op:'delete' })} disabled={busy('sync') || busy('recreate') || busy('delete')}>
            {busy('delete') ? <Loader size={11} className="spin" /> : <Trash size={11} />}
            Delete
          </button>
        </div>

        {/* Inline confirm */}
        {confirm?.idx === idx && (
          <div className="es-confirm-box">
            <span>
              {confirm.op === 'recreate'
                ? `⚠️ Recreate "${idx}" — ลบแล้ว sync ใหม่ทั้งหมด?`
                : `⚠️ ลบ index "${idx}" ถาวร?`}
            </span>
            <div className="es-confirm-btns">
              <button className="adm-reject-btn" onClick={() => setConfirm(null)}>Cancel</button>
              <button
                className="adm-approve-btn"
                style={{ background:'rgba(232,68,90,.15)', borderColor:'rgba(232,68,90,.4)', color:'#fca5a5' }}
                onClick={() => confirm.op === 'recreate' ? doRecreate(idx) : doDelete(idx)}
              >
                ยืนยัน
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {globalMsg && (
        <div className={globalMsg.type === 'ok' ? 'adm-ok' : 'adm-err'}>
          {globalMsg.type === 'ok' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          {globalMsg.text}
        </div>
      )}

      <div className="es-section">
        <div className="es-section-title"><Database size={13} />Index Status</div>
        <div className="es-grid">
          <IndexCard idx="videos"    icon={<Film size={16} />}     color="99,102,241" />
          <IndexCard idx="purchases" icon={<ShoppingBag size={16} />} color="251,191,36" />
        </div>
      </div>

      <div className="es-section">
        <div className="es-section-title"><FileText size={13} />Operation Log</div>
        <div className="es-log">
          {logs.length === 0
            ? <span style={{ color:'var(--muted)' }}>No operations yet…</span>
            : [...logs].reverse().map((l, i) => (
                <div key={i} className="es-log-entry">
                  <span className="es-log-ts">[{l.ts}]</span>
                  <span className={`es-log-${l.level}`}>{l.text}</span>
                </div>
              ))
          }
        </div>
      </div>

      <div className="es-section">
        <div className="es-section-title"><Zap size={13} />Quick Sync All</div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <button
            className="es-btn es-btn-sync"
            style={{ padding:'10px 18px', fontSize:13 }}
            disabled={!!opLoading['all-sync']}
            onClick={async () => {
              setOpLoading(p => ({ ...p, 'all-sync':true }));
              addLog('warn', 'Syncing all indexes…');
              try {
                const d = await esApi.post('/admin/sync', { models:['videos','purchases'] });
                const ok = Object.entries(d.data).map(([k,v]) => v.status==='success' ? `${k}:${v.synced}` : `${k}:ERR`).join(', ');
                addLog('ok', `All sync done — ${ok}`);
                setGlobalMsg({ type:'ok', text:`✓ All indexes synced (${ok})` });
                await fetchStats('videos');
                await fetchStats('purchases');
              } catch (e) {
                addLog('err', e.message);
                setGlobalMsg({ type:'err', text: e.message });
              } finally {
                setOpLoading(p => ({ ...p, 'all-sync':false }));
                setTimeout(() => setGlobalMsg(null), 4000);
              }
            }}
          >
            {opLoading['all-sync'] ? <Loader size={13} className="spin" /> : <UploadCloud size={13} />}
            Sync Videos + Purchases
          </button>
        </div>
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════
   PURCHASES TAB  (with ES-powered search & filter)
════════════════════════════════════════════════ */
const PurchasesTab = () => {
  const defaultFilters = {
    userId: '', videoId: '', status: '', paymentMethod: '',
    currency: '', dateFrom: '', dateTo: '', amountMin: '', amountMax: '',
    sort: 'purchaseDate', order: 'desc', page: 1, limit: 20,
  };

  const [purchases,     setPurchases]     = useState([]);
  const [pagination,    setPagination]    = useState(null);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState('');
  const [filters,       setFilters]       = useState(defaultFilters);
  const [draft,         setDraft]         = useState(defaultFilters);   // form before apply
  const [showFilters,   setShowFilters]   = useState(false);
  const [useES,         setUseES]         = useState(true);             // toggle ES vs plain

  const fetchPurchases = useCallback(async (f = filters) => {
    setLoading(true);
    setError('');
    try {
      let data;
      if (useES) {
        // Build ES query params
        const q = new URLSearchParams();
        if (f.userId)       q.set('userId',        f.userId);
        if (f.videoId)      q.set('videoId',       f.videoId);
        if (f.status)       q.set('status',        f.status);
        if (f.paymentMethod)q.set('paymentMethod', f.paymentMethod);
        if (f.currency)     q.set('currency',      f.currency);
        if (f.dateFrom)     q.set('dateFrom',      f.dateFrom);
        if (f.dateTo)       q.set('dateTo',        f.dateTo);
        if (f.amountMin)    q.set('amountMin',     f.amountMin);
        if (f.amountMax)    q.set('amountMax',     f.amountMax);
        q.set('page',  f.page);
        q.set('limit', f.limit);
        q.set('sort',  f.sort);
        q.set('order', f.order);
        data = await esApi.get(`/purchases/search?${q}`);
        setPurchases(data.data || []);
        setPagination(data.pagination || null);
      } else {
        data = await adminApi.get('/purchases');
        setPurchases(data.purchases || []);
        setPagination(null);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filters, useES]);

  useEffect(() => { fetchPurchases(); }, []);

  const applyFilters = () => {
    const next = { ...draft, page: 1 };
    setFilters(next);
    setShowFilters(false);
    fetchPurchases(next);
  };

  const resetFilters = () => {
    setDraft(defaultFilters);
    setFilters(defaultFilters);
    fetchPurchases(defaultFilters);
  };

  const activeFilterCount = Object.entries(draft).filter(([k, v]) =>
    !['sort','order','page','limit'].includes(k) && v !== ''
  ).length;

  return (
    <div>
      {error && (
        <div className="adm-err">
          <AlertCircle size={14} />{error}
          <button style={{ marginLeft:'auto', background:'none', border:'none', color:'inherit', cursor:'pointer' }} onClick={() => setError('')}><X size={12} /></button>
        </div>
      )}

      {/* Toolbar */}
      <div className="adm-bar">
        <button className="adm-filter-toggle" onClick={() => setShowFilters(p => !p)}>
          <Filter size={13} />
          Filters
          {activeFilterCount > 0 && (
            <span style={{ background:'var(--accent)', color:'#fff', borderRadius:'50%', width:16, height:16, fontSize:9, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center' }}>
              {activeFilterCount}
            </span>
          )}
          {showFilters ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>

        {/* ES / Plain toggle */}
        <button
          className="adm-ref"
          onClick={() => setUseES(p => !p)}
          style={{ borderColor: useES ? 'rgba(99,102,241,.4)' : undefined, color: useES ? '#a5b4fc' : undefined }}
          title={useES ? 'Using Elasticsearch — click to switch to plain' : 'Using plain API — click to switch to ES'}
        >
          <Database size={12} />
          {useES ? 'ES Search' : 'Plain'}
        </button>

        <button className="adm-ref" onClick={() => fetchPurchases()}>
          <RefreshCw size={12} className={loading ? 'spin' : ''} />
          รีเฟรช
        </button>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="adm-filter-panel">
          <div className="adm-filter-grid">
            <div className="adm-filter-group">
              <label className="adm-filter-lbl"><Hash size={9} style={{ display:'inline', marginRight:3 }} />User ID</label>
              <input className="adm-in-plain" placeholder="MongoDB ObjectId…" value={draft.userId}
                onChange={e => setDraft(p => ({ ...p, userId: e.target.value }))} />
            </div>
            <div className="adm-filter-group">
              <label className="adm-filter-lbl"><Film size={9} style={{ display:'inline', marginRight:3 }} />Video ID</label>
              <input className="adm-in-plain" placeholder="MongoDB ObjectId…" value={draft.videoId}
                onChange={e => setDraft(p => ({ ...p, videoId: e.target.value }))} />
            </div>
            <div className="adm-filter-group">
              <label className="adm-filter-lbl">Status</label>
              <select className="adm-sel" style={{ width:'100%' }} value={draft.status}
                onChange={e => setDraft(p => ({ ...p, status: e.target.value }))}>
                <option value="">ทั้งหมด</option>
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
                <option value="failed">Failed</option>
                <option value="pending_refund">Pending Refund</option>
                <option value="refunded">Refunded</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
            <div className="adm-filter-group">
              <label className="adm-filter-lbl"><CreditCard size={9} style={{ display:'inline', marginRight:3 }} />Payment Method</label>
              <select className="adm-sel" style={{ width:'100%' }} value={draft.paymentMethod}
                onChange={e => setDraft(p => ({ ...p, paymentMethod: e.target.value }))}>
                <option value="">ทั้งหมด</option>
                <option value="card">Card</option>
                <option value="promptpay">PromptPay</option>
                <option value="cash">Cash</option>
              </select>
            </div>
            <div className="adm-filter-group">
              <label className="adm-filter-lbl">Currency</label>
              <select className="adm-sel" style={{ width:'100%' }} value={draft.currency}
                onChange={e => setDraft(p => ({ ...p, currency: e.target.value }))}>
                <option value="">ทั้งหมด</option>
                <option value="THB">THB</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div className="adm-filter-group">
              <label className="adm-filter-lbl">Sort By</label>
              <select className="adm-sel" style={{ width:'100%' }} value={draft.sort}
                onChange={e => setDraft(p => ({ ...p, sort: e.target.value }))}>
                <option value="purchaseDate">Purchase Date</option>
                <option value="amount">Amount</option>
              </select>
            </div>
            <div className="adm-filter-group">
              <label className="adm-filter-lbl"><Calendar size={9} style={{ display:'inline', marginRight:3 }} />Date From</label>
              <input type="date" className="adm-in-plain" value={draft.dateFrom}
                onChange={e => setDraft(p => ({ ...p, dateFrom: e.target.value }))} />
            </div>
            <div className="adm-filter-group">
              <label className="adm-filter-lbl">Date To</label>
              <input type="date" className="adm-in-plain" value={draft.dateTo}
                onChange={e => setDraft(p => ({ ...p, dateTo: e.target.value }))} />
            </div>
            <div className="adm-filter-group">
              <label className="adm-filter-lbl"><DollarSign size={9} style={{ display:'inline', marginRight:3 }} />Amount Range (฿)</label>
              <div style={{ display:'flex', gap:6 }}>
                <input type="number" className="adm-in-plain" placeholder="Min" value={draft.amountMin}
                  onChange={e => setDraft(p => ({ ...p, amountMin: e.target.value }))} style={{ width:'50%' }} />
                <input type="number" className="adm-in-plain" placeholder="Max" value={draft.amountMax}
                  onChange={e => setDraft(p => ({ ...p, amountMax: e.target.value }))} style={{ width:'50%' }} />
              </div>
            </div>
          </div>
          <div className="adm-filter-actions">
            <button className="adm-filter-apply" onClick={applyFilters}>
              <Search size={12} />Apply Filters
            </button>
            <button className="adm-filter-reset" onClick={resetFilters}>
              <RotateCcw size={12} />Reset
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      <div className="adm-tbl">
        {loading ? (
          <div className="adm-loading"><Loader size={22} className="spin" /><span>Loading…</span></div>
        ) : purchases.length === 0 ? (
          <div className="adm-empty"><ShoppingBag size={30} color="var(--muted)" /><span>ไม่พบรายการ</span></div>
        ) : (
          purchases.map(p => (
            <div key={p._id} className="adm-row">
              <div className="adm-ico" style={{ background:'rgba(46,204,113,.1)', color:'var(--success)' }}><DollarSign size={16} /></div>
              <div style={{ flex:1, minWidth:0 }}>
                <div className="adm-rtitle">{p.videoId?.title || p.videoTitle || 'Unknown Video'}</div>
                <div className="adm-rsub">
                  {p.userId?.email || p.userEmail || '—'}
                  {p.paymentMethod && <> · <span style={{ color:'#a5b4fc' }}>{p.paymentMethod}</span></>}
                  {p.currency && <> · {p.currency}</>}
                </div>
              </div>
              <div style={{ textAlign:'right', flexShrink:0 }}>
                <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>฿{p.amount}</div>
                <Bdg status={p.status} />
                <div style={{ fontSize:11, color:'var(--muted)', marginTop:4 }}>
                  {new Date(p.purchaseDate).toLocaleDateString('th-TH')}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination (ES mode) */}
      {pagination && pagination.pages > 1 && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:10, marginTop:14 }}>
          <button
            className="adm-ref" style={{ padding:'6px 12px', fontSize:12 }}
            disabled={filters.page <= 1 || loading}
            onClick={() => { const next = { ...filters, page: filters.page - 1 }; setFilters(next); fetchPurchases(next); }}
          >‹ Prev</button>
          <span style={{ fontSize:12, color:'var(--muted)' }}>
            Page {pagination.page} / {pagination.pages}
            <span style={{ color:'rgba(255,255,255,.25)', margin:'0 6px' }}>·</span>
            {pagination.total.toLocaleString()} results
          </span>
          <button
            className="adm-ref" style={{ padding:'6px 12px', fontSize:12 }}
            disabled={filters.page >= pagination.pages || loading}
            onClick={() => { const next = { ...filters, page: filters.page + 1 }; setFilters(next); fetchPurchases(next); }}
          >Next ›</button>
        </div>
      )}
    </div>
  );
};

/* ════════════════════════════════════════════════
   MAIN DASHBOARD
════════════════════════════════════════════════ */
const AdminDashboard = () => {
  const [tab, setTab]           = useState('dashboard');
  const [dashStats, setDash]    = useState(null);
  const [videos, setVideos]     = useState([]);
  const [users, setUsers]       = useState([]);
  const [refunds, setRefunds]   = useState([]);
  const [pendingCount, setPendingCount] = useState(0);

  const [loading, setLoading]   = useState(false);
  const [vLoad, setVLoad]       = useState(false);
  const [uLoad, setULoad]       = useState(false);
  const [rLoad, setRLoad]       = useState(false);
  const [actionId, setActionId] = useState(null);

  const [error, setError]       = useState('');
  const [search, setSearch]     = useState('');
  const [filters, setFilters]   = useState({ status:'', role:'', refundStatus:'pending_refund', page:1, limit:20 });
  const [editVid, setEditVid]   = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);

  const fetchDash = async () => {
    try {
      setLoading(true);
      const d = await adminApi.get('/dashboard/stats');
      setDash(d); setError('');
    } catch { setError('Failed to load stats'); }
    finally { setLoading(false); }
  };

  const fetchVids = async () => {
    try {
      setVLoad(true);
      const q = new URLSearchParams({ page:filters.page, limit:filters.limit, ...(filters.status && { status:filters.status }), ...(search && { search }) });
      const d = await adminApi.get(`/videos?${q}`);
      setVideos(d.videos || []); setError('');
    } catch { setError('Failed to load videos'); }
    finally { setVLoad(false); }
  };

  const fetchUsers = async () => {
    try {
      setULoad(true);
      const q = new URLSearchParams({ page:filters.page, limit:filters.limit, ...(filters.role && { role:filters.role }), ...(search && { search }) });
      const d = await adminApi.get(`/users?${q}`);
      setUsers(d.users || []); setError('');
    } catch { setError('Failed to load users'); }
    finally { setULoad(false); }
  };

  const fetchRefunds = async () => {
    try {
      setRLoad(true);
      const q = new URLSearchParams({ ...(filters.refundStatus && { status:filters.refundStatus }) });
      const d = await adminApi.get(`/refunds?${q}`);
      setRefunds(d.refunds || []);
      const pendingRes = await adminApi.get('/refunds?status=pending_refund');
      setPendingCount((pendingRes.refunds || []).length);
      setError('');
    } catch { setError('Failed to load refunds'); }
    finally { setRLoad(false); }
  };

  useEffect(() => {
    setSearch('');
    if (tab === 'dashboard') fetchDash();
    else if (tab === 'videos')  fetchVids();
    else if (tab === 'users')   fetchUsers();
    else if (tab === 'refunds') fetchRefunds();
    // 'purchases' and 'elasticsearch' manage their own data
  }, [tab, filters]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (tab === 'videos') fetchVids();
      else if (tab === 'users') fetchUsers();
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    adminApi.get('/refunds?status=pending_refund')
      .then(d => setPendingCount((d.refunds || []).length))
      .catch(() => {});
  }, []);

  const handleApprove = async (refundId) => {
    setActionId(refundId);
    try {
      await adminApi.post(`/refunds/${refundId}/approve`);
      setRefunds(prev => prev.map(r => r._id === refundId ? { ...r, status:'refunded' } : r));
      setPendingCount(c => Math.max(0, c - 1));
    } catch (e) { setError(`Approve failed: ${e.message}`); }
    finally { setActionId(null); }
  };

  const handleReject = async (refundId, reason) => {
    setActionId(refundId);
    try {
      await adminApi.post(`/refunds/${refundId}/reject`, { reason });
      setRefunds(prev => prev.map(r => r._id === refundId ? { ...r, status:'rejected', rejectReason:reason } : r));
      setPendingCount(c => Math.max(0, c - 1));
    } catch (e) { setError(`Reject failed: ${e.message}`); }
    finally { setActionId(null); }
  };

  const tabs = [
    { id:'dashboard',    label:'Dashboard',   icon:LayoutDashboard },
    { id:'videos',       label:'Videos',      icon:Film            },
    { id:'users',        label:'Users',       icon:Users           },
    { id:'purchases',    label:'Purchases',   icon:ShoppingBag     },
    { id:'refunds',      label:'Refunds',     icon:RotateCcw,  badge:pendingCount },
    { id:'elasticsearch',label:'Elasticsearch',icon:Database,   esTab:true },
  ];

  return (
    <>
      <style>{styles}</style>
      <div className="adm-root">
        <nav className="adm-nav">
          <span className="adm-logo">🎬 CineStream</span>
          <div className="adm-sep" />
          <span className="adm-admin-pill">Admin</span>
          <div className="adm-tabs">
            {tabs.map(t => (
              <button key={t.id} className={`adm-tab ${tab === t.id ? 'active' : ''} ${t.esTab ? 'es-tab' : ''}`} onClick={() => setTab(t.id)}>
                <t.icon size={13} />{t.label}
                {t.badge > 0 && <span className="adm-tab-badge">{t.badge}</span>}
              </button>
            ))}
          </div>
        </nav>

        <main className="adm-page">
          {error && (
            <div className="adm-err">
              <AlertCircle size={14} />{error}
              <button style={{ marginLeft:'auto', background:'none', border:'none', color:'inherit', cursor:'pointer' }} onClick={() => setError('')}><X size={12} /></button>
            </div>
          )}

          <div className="adm-head">
            <span className="adm-title" style={tab === 'elasticsearch' ? { color:'var(--es)' } : {}}>
              {{ dashboard:'Dashboard', videos:'Videos', users:'Users', purchases:'Purchases', refunds:'Refund Requests', elasticsearch:'Elasticsearch' }[tab]}
            </span>
          </div>

          {/* ── Dashboard ─────────────────────────────────── */}
          {tab === 'dashboard' && (
            <>
              {loading && <div className="adm-loading"><Loader size={26} className="spin" /><span>Loading...</span></div>}
              {dashStats && (
                <>
                  <div className="adm-stats">
                    {[
                      { lbl:'Total Videos', val:dashStats.stats.totalVideos,                  icon:<Film size={17} />,        bg:'rgba(232,68,90,.15)',  c:'var(--accent)' },
                      { lbl:'Total Users',  val:dashStats.stats.totalUsers,                   icon:<Users size={17} />,       bg:'rgba(99,102,241,.15)', c:'#a5b4fc' },
                      { lbl:'Revenue',      val:`฿${dashStats.stats.totalRevenue.toFixed(2)}`,icon:<TrendingUp size={17} />,  bg:'rgba(245,200,66,.15)', c:'var(--gold)' },
                      { lbl:'Purchases',    val:dashStats.stats.totalPurchases,               icon:<ShoppingBag size={17} />, bg:'rgba(46,204,113,.15)', c:'var(--success)' },
                    ].map((s,i) => (
                      <div key={i} className="adm-stat">
                        <div className="adm-stat-icon" style={{ background:s.bg, color:s.c }}>{s.icon}</div>
                        <div><div className="adm-stat-lbl">{s.lbl}</div><div className="adm-stat-val">{s.val}</div></div>
                      </div>
                    ))}
                  </div>
                  {dashStats.trends?.revenue && (
                    <div className="adm-chart">
                      <div className="adm-chart-lbl">Revenue — Last 30 Days</div>
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={dashStats.trends.revenue}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="_id.day" /><YAxis />
                          <Tooltip />
                          <Line type="monotone" dataKey="revenue" stroke="var(--accent)" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ── Videos ───────────────────────────────────── */}
          {tab === 'videos' && (
            <>
              <div className="adm-bar">
                <div className="adm-sw"><Search /><input className="adm-si" placeholder="ค้นหาวิดีโอ..." value={search} onChange={e => setSearch(e.target.value)} autoFocus /></div>
                <select className="adm-sel" value={filters.status} onChange={e => setFilters(p => ({ ...p, status:e.target.value }))}>
                  <option value="">All Status</option>
                  <option value="completed">Completed</option>
                  <option value="processing">Processing</option>
                  <option value="failed">Failed</option>
                </select>
                <button className="adm-ref" onClick={fetchVids}><RefreshCw size={12} />รีเฟรช</button>
              </div>
              <div className="adm-tbl">
                {vLoad
                  ? <div className="adm-loading"><Loader size={22} className="spin" /><span>Loading...</span></div>
                  : videos.length === 0
                    ? <div className="adm-empty"><Film size={30} color="var(--muted)" /><span>ไม่พบวิดีโอ</span></div>
                    : videos.map(v => (
                        <div key={v._id} className="adm-row">
                          <div className="adm-ico"><PlayCircle size={16} /></div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div className="adm-rtitle">{v.title}</div>
                            <div className="adm-rsub"><Bdg status={v.uploadStatus} /> ฿{v.price} · {v.purchaseCount} purchases</div>
                          </div>
                          <div className="adm-actions">
                            <button className="adm-ibtn" title="Edit" onClick={() => { setEditVid(v); setShowEdit(true); }}><Edit size={13} /></button>
                            <button className="adm-ibtn del" title="Delete" onClick={async () => {
                              if (window.confirm('ลบวิดีโอนี้?')) { await adminApi.delete(`/videos/${v.id}`); setVideos(p => p.filter(x => x.id !== v.id)); }
                            }}><Trash2 size={13} /></button>
                          </div>
                        </div>
                      ))}
              </div>
            </>
          )}

          {/* ── Users ────────────────────────────────────── */}
          {tab === 'users' && (
            <>
              <div className="adm-bar">
                <div className="adm-sw"><Search /><input className="adm-si" placeholder="ค้นหาผู้ใช้..." value={search} onChange={e => setSearch(e.target.value)} /></div>
                <select className="adm-sel" value={filters.role} onChange={e => setFilters(p => ({ ...p, role:e.target.value }))}>
                  <option value="">All Roles</option>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
                <button className="adm-ref" onClick={fetchUsers}><RefreshCw size={12} />รีเฟรช</button>
              </div>
              <div className="adm-tbl">
                {uLoad
                  ? <div className="adm-loading"><Loader size={22} className="spin" /><span>Loading...</span></div>
                  : users.length === 0
                    ? <div className="adm-empty"><Users size={30} color="var(--muted)" /><span>ไม่พบผู้ใช้</span></div>
                    : users.map(u => (
                        <div key={u._id} className="adm-row">
                          <div className="adm-ico" style={{ background:'rgba(99,102,241,.1)', color:'#a5b4fc', fontWeight:700, fontSize:15 }}>{u.email?.[0]?.toUpperCase()}</div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div className="adm-rtitle">{u.email}</div>
                            <div className="adm-rsub"><span className={`adm-bdg adm-bdg-${u.role === 'admin' ? 'admin' : 'user'}`}>{u.role}</span> ฿{u.stats?.totalSpent?.toFixed(2)} · {u.stats?.totalPurchases} purchases</div>
                          </div>
                          <div style={{ fontSize:11, color:'var(--muted)', whiteSpace:'nowrap', flexShrink:0 }}>{new Date(u.createdAt).toLocaleDateString('th-TH')}</div>
                        </div>
                      ))}
              </div>
            </>
          )}

          {/* ── Purchases (new) ──────────────────────────── */}
          {tab === 'purchases' && <PurchasesTab />}

          {/* ── Refunds ──────────────────────────────────── */}
          {tab === 'refunds' && (
            <>
              <div className="adm-bar">
                <select className="adm-sel" value={filters.refundStatus} onChange={e => setFilters(p => ({ ...p, refundStatus:e.target.value }))}>
                  <option value="pending_refund">Pending</option>
                  <option value="refunded">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="">ทั้งหมด</option>
                </select>
                <button className="adm-ref" onClick={fetchRefunds}><RefreshCw size={12} />รีเฟรช</button>
              </div>
              <div className="adm-tbl">
                {rLoad
                  ? <div className="adm-loading"><Loader size={22} className="spin" /><span>Loading...</span></div>
                  : refunds.length === 0
                    ? <div className="adm-empty"><RotateCcw size={30} color="var(--muted)" /><span>ไม่พบคำร้อง</span></div>
                    : refunds.map(r => {
                        const isActing = actionId === r._id;
                        const isPending = r.status === 'pending_refund';
                        return (
                          <div key={r._id} className="adm-refund-row">
                            <div className="adm-refund-main">
                              <div className="adm-ico" style={{ background:'rgba(251,191,36,.1)', color:'#fbbf24', flexShrink:0 }}><RotateCcw size={15} /></div>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div className="adm-rtitle">{r.videoId?.title || `Purchase #${String(r._id).slice(-6)}`}</div>
                                <div className="adm-rsub">
                                  {r.userId?.email || '—'} · ฿{r.amount}
                                  {' · '}
                                  {new Date(r.refundRequestedAt || r.purchaseDate).toLocaleDateString('th-TH', { day:'numeric', month:'short', year:'numeric' })}
                                </div>
                              </div>
                              <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
                                <Bdg status={r.status} />
                                {isPending && (
                                  <>
                                    <button className="adm-approve-btn" onClick={() => handleApprove(r._id)} disabled={isActing}>
                                      {isActing ? <Loader size={12} className="spin" /> : <ThumbsUp size={12} />}Approve
                                    </button>
                                    <button className="adm-reject-btn" onClick={() => setRejectTarget(r)} disabled={isActing}>
                                      <ThumbsDown size={12} />Reject
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                            {r.refundReason && (
                              <div className="adm-refund-reason">
                                <MessageSquare size={12} className="adm-refund-reason-icon" />
                                <span>"{r.refundReason}"</span>
                              </div>
                            )}
                            {r.rejectReason && r.status === 'rejected' && (
                              <div className="adm-refund-reason" style={{ color:'#64748b' }}>
                                <XCircle size={12} className="adm-refund-reason-icon" />
                                <span>ปฏิเสธ: "{r.rejectReason}"</span>
                              </div>
                            )}
                          </div>
                        );
                      })
                }
              </div>
            </>
          )}

          {/* ── Elasticsearch ────────────────────────────── */}
          {tab === 'elasticsearch' && <ESTab />}
        </main>

        {/* Bottom nav (mobile) */}
        <nav className="adm-bot">
          {tabs.map(t => (
            <button key={t.id} className={`adm-bitem ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)} style={{ position:'relative' }}>
              <t.icon />
              {t.label.slice(0, t.id === 'elasticsearch' ? 2 : undefined)}
              {t.badge > 0 && <span style={{ position:'absolute', top:4, right:'calc(50% - 14px)', width:14, height:14, borderRadius:'50%', background:'var(--accent)', fontSize:8, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, color:'#fff' }}>{t.badge}</span>}
            </button>
          ))}
        </nav>
      </div>

      <EditModal isOpen={showEdit} onClose={() => setShowEdit(false)} onSave={fetchVids} video={editVid} />
      <RejectModal isOpen={!!rejectTarget} onClose={() => setRejectTarget(null)} onConfirm={(reason) => handleReject(rejectTarget._id, reason)} refund={rejectTarget} />
    </>
  );
};

export default AdminDashboard;