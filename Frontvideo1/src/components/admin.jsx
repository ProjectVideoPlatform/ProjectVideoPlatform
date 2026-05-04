// admin.jsx — Dark Cinema Theme · Cookie Auth (no Bearer)
import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import {
  Search, Users, Video, DollarSign, Activity, Edit, Trash2,
  PlayCircle, CheckCircle, AlertCircle, XCircle, RefreshCw, Loader,
  LayoutDashboard, ShoppingBag, X, Film, TrendingUp, RotateCcw,
  ThumbsUp, ThumbsDown, Clock, MessageSquare
} from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

const API_BASE = '/admin';

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  :root {
    --bg:#0a0a0f; --surface:#111118; --card:#16161f;
    --border:rgba(255,255,255,0.07); --accent:#e8445a; --accent2:#ff8c42;
    --gold:#f5c842; --text:#f0eff5; --muted:#6b6a7a;
    --success:#2ecc71; --warn:#f5c842; --nav-h:60px;
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
  .adm-sel { padding:9px 13px; background:var(--surface); border:1px solid var(--border); border-radius:10px; color:var(--text); font-family:'DM Sans',sans-serif; font-size:13px; outline:none; cursor:pointer; min-width:120px; }
  .adm-sel option { background:var(--surface); }
  .adm-ref { display:flex; align-items:center; gap:6px; padding:9px 14px; border-radius:10px; background:var(--surface); border:1px solid var(--border); color:var(--text); font-size:13px; font-weight:500; cursor:pointer; transition:border-color .2s; font-family:'DM Sans',sans-serif; white-space:nowrap; }
  .adm-ref:hover { border-color:var(--accent); color:var(--accent); }
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

  .recharts-cartesian-grid-horizontal line,.recharts-cartesian-grid-vertical line{stroke:rgba(255,255,255,.06);}
  .recharts-text{fill:var(--muted)!important;font-size:11px!important;}
  .recharts-tooltip-wrapper .recharts-default-tooltip{background:var(--card)!important;border:1px solid var(--border)!important;border-radius:10px!important;font-family:'DM Sans',sans-serif!important;font-size:12px!important;}
  .recharts-default-tooltip .recharts-tooltip-label{color:var(--text)!important;}
  .recharts-default-tooltip .recharts-tooltip-item{color:var(--accent)!important;}
  @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  .spin{animation:spin 1s linear infinite;}
`;

/* ── API ── */
const api = {
  get:    (ep)       => apiFetch(`${API_BASE}${ep}`),
  put:    (ep, data) => apiFetch(`${API_BASE}${ep}`, { method: 'PUT',    body: JSON.stringify(data) }),
  post:   (ep, data) => apiFetch(`${API_BASE}${ep}`, { method: 'POST',   body: JSON.stringify(data) }),
  delete: (ep)       => apiFetch(`${API_BASE}${ep}`, { method: 'DELETE' }),
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
  const [reason,   setReason]  = useState('');
  const [saving,   setSaving]  = useState(false);

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
            <textarea
              className="adm-ta"
              placeholder="เช่น ไม่อยู่ในเงื่อนไข, ใช้งานเกิน 80%, พ้นกรอบเวลา..."
              value={reason}
              onChange={e => setReason(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="adm-mact">
            <button className="adm-bcnl" onClick={onClose} disabled={saving}>ยกเลิก</button>
            <button className="adm-bsav" onClick={confirm} disabled={saving || !reason.trim()}
              style={{ background: '#475569' }}>
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
  const [form, setForm]     = useState({ title: '', description: '', price: 0, tags: '' });
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
      await api.put(`/videos/${video.id}`, p);
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
          <div className="adm-fld"><label className="adm-lbl">Title</label><input className="adm-in" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} /></div>
          <div className="adm-fld"><label className="adm-lbl">Description</label><textarea className="adm-ta" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
          <div className="adm-fld"><label className="adm-lbl">Price (฿)</label><input type="number" step="1" className="adm-in" value={form.price} onChange={e => setForm(p => ({ ...p, price: parseFloat(e.target.value) || 0 }))} /></div>
          <div className="adm-fld"><label className="adm-lbl">Tags</label><input className="adm-in" value={form.tags} onChange={e => setForm(p => ({ ...p, tags: e.target.value }))} /></div>
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

/* ── Admin Dashboard ── */
const AdminDashboard = () => {
  const [tab, setTab]           = useState('dashboard');
  const [dashStats, setDash]    = useState(null);
  const [videos, setVideos]     = useState([]);
  const [users, setUsers]       = useState([]);
  const [purchases, setPurch]   = useState([]);
  const [refunds, setRefunds]   = useState([]);
  const [pendingCount, setPendingCount] = useState(0);

  const [loading, setLoading]   = useState(false);
  const [vLoad, setVLoad]       = useState(false);
  const [uLoad, setULoad]       = useState(false);
  const [pLoad, setPLoad]       = useState(false);
  const [rLoad, setRLoad]       = useState(false);
  const [actionId, setActionId] = useState(null); // id ที่กำลัง approve/reject

  const [error, setError]       = useState('');
  const [search, setSearch]     = useState('');
  const [filters, setFilters]   = useState({ status: '', role: '', refundStatus: 'pending_refund', page: 1, limit: 20 });
  const [editVid, setEditVid]   = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);

  const fetchDash  = async () => {
    try {
      setLoading(true);
      const d = await api.get('/dashboard/stats');
      setDash(d);
      setError('');
    } catch { setError('Failed to load stats'); }
    finally { setLoading(false); }
  };

  const fetchVids  = async () => {
    try {
      setVLoad(true);
      const q = new URLSearchParams({ page: filters.page, limit: filters.limit, ...(filters.status && { status: filters.status }), ...(search && { search }) });
      const d = await api.get(`/videos?${q}`);
      setVideos(d.videos || []);
      setError('');
    } catch { setError('Failed to load videos'); }
    finally { setVLoad(false); }
  };

  const fetchUsers = async () => {
    try {
      setULoad(true);
      const q = new URLSearchParams({ page: filters.page, limit: filters.limit, ...(filters.role && { role: filters.role }), ...(search && { search }) });
      const d = await api.get(`/users?${q}`);
      setUsers(d.users || []);
      setError('');
    } catch { setError('Failed to load users'); }
    finally { setULoad(false); }
  };

  const fetchPurch = async () => {
    try {
      setPLoad(true);
      const d = await api.get('/purchases');
      setPurch(d.purchases || []);
      setError('');
    } catch { setError('Failed to load purchases'); }
    finally { setPLoad(false); }
  };

  const fetchRefunds = async () => {
    try {
      setRLoad(true);
      const q = new URLSearchParams({ ...(filters.refundStatus && { status: filters.refundStatus }) });
      const d = await api.get(`/refunds?${q}`);
      setRefunds(d.refunds || []);
      // นับ pending สำหรับ badge
      const pendingRes = await api.get('/refunds?status=pending_refund');
      setPendingCount((pendingRes.refunds || []).length);
      setError('');
    } catch { setError('Failed to load refunds'); }
    finally { setRLoad(false); }
  };

  useEffect(() => {
    setSearch('');
    if (tab === 'dashboard') fetchDash();
    else if (tab === 'videos')    fetchVids();
    else if (tab === 'users')     fetchUsers();
    else if (tab === 'purchases') fetchPurch();
    else if (tab === 'refunds')   fetchRefunds();
  }, [tab, filters]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (tab === 'videos') fetchVids();
      else if (tab === 'users') fetchUsers();
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  // นับ pending refund ตอน mount
  useEffect(() => {
    api.get('/refunds?status=pending_refund')
      .then(d => setPendingCount((d.refunds || []).length))
      .catch(() => {});
  }, []);

  const handleApprove = async (refundId) => {
    setActionId(refundId);
    try {
      // POST /admin/refunds/:id/approve → backend เรียก Stripe refund จริง
      await api.post(`/refunds/${refundId}/approve`);
      setRefunds(prev => prev.map(r =>
        r._id === refundId ? { ...r, status: 'refunded' } : r
      ));
      setPendingCount(c => Math.max(0, c - 1));
    } catch (e) {
      setError(`Approve failed: ${e.message}`);
    } finally {
      setActionId(null);
    }
  };

  const handleReject = async (refundId, reason) => {
    setActionId(refundId);
    try {
      // POST /admin/refunds/:id/reject
      await api.post(`/refunds/${refundId}/reject`, { reason });
      setRefunds(prev => prev.map(r =>
        r._id === refundId ? { ...r, status: 'rejected', rejectReason: reason } : r
      ));
      setPendingCount(c => Math.max(0, c - 1));
    } catch (e) {
      setError(`Reject failed: ${e.message}`);
    } finally {
      setActionId(null);
    }
  };

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'videos',    label: 'Videos',    icon: Film             },
    { id: 'users',     label: 'Users',     icon: Users            },
    { id: 'purchases', label: 'Purchases', icon: ShoppingBag      },
    { id: 'refunds',   label: 'Refunds',   icon: RotateCcw, badge: pendingCount },
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
              <button key={t.id} className={`adm-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                <t.icon size={13} />{t.label}
                {t.badge > 0 && <span className="adm-tab-badge">{t.badge}</span>}
              </button>
            ))}
          </div>
        </nav>

        <main className="adm-page">
          {error && <div className="adm-err"><AlertCircle size={14} />{error}<button style={{ marginLeft:'auto', background:'none', border:'none', color:'inherit', cursor:'pointer' }} onClick={() => setError('')}><X size={12} /></button></div>}

          <div className="adm-head">
            <span className="adm-title">{{ dashboard:'Dashboard', videos:'Videos', users:'Users', purchases:'Purchases', refunds:'Refund Requests' }[tab]}</span>
          </div>

          {/* ── Dashboard ─────────────────────────────────────────────── */}
          {tab === 'dashboard' && (
            <>
              {loading && <div className="adm-loading"><Loader size={26} className="spin" /><span>Loading...</span></div>}
              {dashStats && (
                <>
                  <div className="adm-stats">
                    {[
                      { lbl:'Total Videos',  val: dashStats.stats.totalVideos,                   icon:<Film size={17} />,        bg:'rgba(232,68,90,.15)',  c:'var(--accent)' },
                      { lbl:'Total Users',   val: dashStats.stats.totalUsers,                    icon:<Users size={17} />,       bg:'rgba(99,102,241,.15)', c:'#a5b4fc' },
                      { lbl:'Revenue',       val:`฿${dashStats.stats.totalRevenue.toFixed(2)}`,  icon:<TrendingUp size={17} />,  bg:'rgba(245,200,66,.15)', c:'var(--gold)' },
                      { lbl:'Purchases',     val: dashStats.stats.totalPurchases,                icon:<ShoppingBag size={17} />, bg:'rgba(46,204,113,.15)', c:'var(--success)' },
                    ].map((s, i) => (
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

          {/* ── Videos ────────────────────────────────────────────────── */}
          {tab === 'videos' && (
            <>
              <div className="adm-bar">
                <div className="adm-sw"><Search /><input className="adm-si" placeholder="ค้นหาวิดีโอ..." value={search} onChange={e => setSearch(e.target.value)} autoFocus /></div>
                <select className="adm-sel" value={filters.status} onChange={e => setFilters(p => ({ ...p, status: e.target.value }))}>
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
                            if (window.confirm('ลบวิดีโอนี้?')) { await api.delete(`/videos/${v.id}`); setVideos(p => p.filter(x => x.id !== v.id)); }
                          }}><Trash2 size={13} /></button>
                        </div>
                      </div>
                    ))}
              </div>
            </>
          )}

          {/* ── Users ─────────────────────────────────────────────────── */}
          {tab === 'users' && (
            <>
              <div className="adm-bar">
                <div className="adm-sw"><Search /><input className="adm-si" placeholder="ค้นหาผู้ใช้..." value={search} onChange={e => setSearch(e.target.value)} /></div>
                <select className="adm-sel" value={filters.role} onChange={e => setFilters(p => ({ ...p, role: e.target.value }))}>
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

          {/* ── Purchases ─────────────────────────────────────────────── */}
          {tab === 'purchases' && (
            <>
              <div className="adm-bar"><button className="adm-ref" onClick={fetchPurch}><RefreshCw size={12} />รีเฟรช</button></div>
              <div className="adm-tbl">
                {pLoad
                  ? <div className="adm-loading"><Loader size={22} className="spin" /><span>Loading...</span></div>
                  : purchases.length === 0
                    ? <div className="adm-empty"><ShoppingBag size={30} color="var(--muted)" /><span>ไม่พบรายการ</span></div>
                    : purchases.map(p => (
                      <div key={p._id} className="adm-row">
                        <div className="adm-ico" style={{ background:'rgba(46,204,113,.1)', color:'var(--success)' }}><DollarSign size={16} /></div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div className="adm-rtitle">{p.videoId?.title || 'Unknown Video'}</div>
                          <div className="adm-rsub">{p.userId?.email || 'Unknown'} · ฿{p.amount}</div>
                        </div>
                        <div style={{ textAlign:'right', flexShrink:0 }}>
                          <Bdg status={p.status} />
                          <div style={{ fontSize:11, color:'var(--muted)', marginTop:4 }}>{new Date(p.purchaseDate).toLocaleDateString('th-TH')}</div>
                        </div>
                      </div>
                    ))}
              </div>
            </>
          )}

          {/* ── Refunds ───────────────────────────────────────────────── */}
          {tab === 'refunds' && (
            <>
              <div className="adm-bar">
                <select
                  className="adm-sel"
                  value={filters.refundStatus}
                  onChange={e => setFilters(p => ({ ...p, refundStatus: e.target.value }))}
                >
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
                              {/* Icon */}
                              <div className="adm-ico" style={{ background:'rgba(251,191,36,.1)', color:'#fbbf24', flexShrink:0 }}>
                                <RotateCcw size={15} />
                              </div>

                              {/* Info */}
                              <div style={{ flex:1, minWidth:0 }}>
                                <div className="adm-rtitle">
                                  {r.videoId?.title || `Purchase #${String(r._id).slice(-6)}`}
                                </div>
                                <div className="adm-rsub">
                                  {r.userId?.email || '—'} · ฿{r.amount}
                                  {' · '}
                                  {new Date(r.refundRequestedAt || r.purchaseDate).toLocaleDateString('th-TH', { day:'numeric', month:'short', year:'numeric' })}
                                </div>
                              </div>

                              {/* Badge + actions */}
                              <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
                                <Bdg status={r.status} />
                                {isPending && (
                                  <>
                                    <button
                                      className="adm-approve-btn"
                                      onClick={() => handleApprove(r._id)}
                                      disabled={isActing}
                                      title="Approve & refund via Stripe"
                                    >
                                      {isActing
                                        ? <Loader size={12} className="spin" />
                                        : <ThumbsUp size={12} />}
                                      Approve
                                    </button>
                                    <button
                                      className="adm-reject-btn"
                                      onClick={() => setRejectTarget(r)}
                                      disabled={isActing}
                                      title="Reject with reason"
                                    >
                                      <ThumbsDown size={12} />Reject
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Reason row */}
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
        </main>

        {/* Bottom nav (mobile) */}
        <nav className="adm-bot">
          {tabs.map(t => (
            <button key={t.id} className={`adm-bitem ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              <t.icon />
              {t.label}
              {t.badge > 0 && <span style={{ position:'absolute', top:4, right:'calc(50% - 14px)', width:14, height:14, borderRadius:'50%', background:'var(--accent)', fontSize:8, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, color:'#fff' }}>{t.badge}</span>}
            </button>
          ))}
        </nav>
      </div>

      <EditModal isOpen={showEdit} onClose={() => setShowEdit(false)} onSave={fetchVids} video={editVid} />

      <RejectModal
        isOpen={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        onConfirm={(reason) => handleReject(rejectTarget._id, reason)}
        refund={rejectTarget}
      />
    </>
  );
};

export default AdminDashboard;