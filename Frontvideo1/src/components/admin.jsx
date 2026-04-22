// admin.jsx — Dark Cinema Theme · Cookie Auth (no Bearer)
import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import {
  Search, Users, Video, DollarSign, Activity, Edit, Trash2,
  PlayCircle, CheckCircle, AlertCircle, XCircle, RefreshCw, Loader,
  LayoutDashboard, ShoppingBag, X, Film, TrendingUp, Clapperboard
} from 'lucide-react';

const API_BASE = 'http://localhost:3000/api/admin';

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
  .adm-bdg { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:6px; font-size:10px; font-weight:700; letter-spacing:.4px; text-transform:uppercase; }
  .adm-bdg-completed { background:rgba(46,204,113,.12); color:var(--success); border:1px solid rgba(46,204,113,.25); }
  .adm-bdg-processing { background:rgba(245,200,66,.12); color:var(--warn); border:1px solid rgba(245,200,66,.25); }
  .adm-bdg-failed { background:rgba(232,68,90,.12); color:var(--accent); border:1px solid rgba(232,68,90,.25); }
  .adm-bdg-pending { background:rgba(99,102,241,.12); color:#a5b4fc; border:1px solid rgba(99,102,241,.25); }
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
  .recharts-cartesian-grid-horizontal line,.recharts-cartesian-grid-vertical line{stroke:rgba(255,255,255,.06);}
  .recharts-text{fill:var(--muted)!important;font-size:11px!important;}
  .recharts-tooltip-wrapper .recharts-default-tooltip{background:var(--card)!important;border:1px solid var(--border)!important;border-radius:10px!important;font-family:'DM Sans',sans-serif!important;font-size:12px!important;}
  .recharts-default-tooltip .recharts-tooltip-label{color:var(--text)!important;}
  .recharts-default-tooltip .recharts-tooltip-item{color:var(--accent)!important;}
  @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  .spin{animation:spin 1s linear infinite;}
`;

/* ── API ── */
// ✅ ลบ Authorization header ทั้งหมด — ใช้แค่ credentials:'include'
const api = {
  get: (ep) =>
    fetch(`${API_BASE}${ep}`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error('failed'); return r.json(); }),

  put: (ep, data) =>
    fetch(`${API_BASE}${ep}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    }).then(r => { if (!r.ok) throw new Error('failed'); return r.json(); }),

  delete: (ep) =>
    fetch(`${API_BASE}${ep}`, {
      method: 'DELETE',
      credentials: 'include',
    }).then(r => { if (!r.ok) throw new Error('failed'); return r.json(); }),
};

/* ── Status badge ── */
const Bdg = ({ status }) => {
  const m = {
    completed:  ['completed',  <CheckCircle size={9} />],
    processing: ['processing', <Activity size={9} />],
    failed:     ['failed',     <XCircle size={9} />],
    pending:    ['pending',    <AlertCircle size={9} />],
  };
  const [cls, icon] = m[status] || m.pending;
  return <span className={`adm-bdg adm-bdg-${cls}`}>{icon}{status}</span>;
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
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 20, letterSpacing: 1.5 }}>แก้ไขวิดีโอ</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>{video?.title}</div>
          </div>
          <button className="adm-ibtn" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="adm-mbd">
          <div className="adm-fld"><label className="adm-lbl">Title</label><input className="adm-in" value={form.title} placeholder={video?.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} /></div>
          <div className="adm-fld"><label className="adm-lbl">Description</label><textarea className="adm-ta" value={form.description} placeholder={video?.description || 'รายละเอียด...'} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
          <div className="adm-fld"><label className="adm-lbl">Price (฿)</label><input type="number" step="1" className="adm-in" value={form.price} onChange={e => setForm(p => ({ ...p, price: parseFloat(e.target.value) || 0 }))} /></div>
          <div className="adm-fld"><label className="adm-lbl">Tags</label><input className="adm-in" value={form.tags} placeholder="action, comedy..." onChange={e => setForm(p => ({ ...p, tags: e.target.value }))} /></div>
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
  const [loading, setLoading]   = useState(false);
  const [vLoad, setVLoad]       = useState(false);
  const [uLoad, setULoad]       = useState(false);
  const [pLoad, setPLoad]       = useState(false);
  const [error, setError]       = useState('');
  const [search, setSearch]     = useState('');
  const [filters, setFilters]   = useState({ status: '', role: '', page: 1, limit: 20 });
  const [editVid, setEditVid]   = useState(null);
  const [showEdit, setShowEdit] = useState(false);

  const fetchDash  = async () => { try { setLoading(true);  const d = await api.get('/dashboard/stats'); setDash(d); setError(''); } catch { setError('Failed to load stats'); }   finally { setLoading(false); } };
  const fetchVids  = async () => {
    try { setVLoad(true);  const q = new URLSearchParams({ page: filters.page, limit: filters.limit, ...(filters.status && { status: filters.status }), ...(search && { search }) }); const d = await api.get(`/videos?${q}`); setVideos(d.videos || []); setError(''); } catch { setError('Failed to load videos'); }   finally { setVLoad(false); }
  };
  const fetchUsers = async () => {
    try { setULoad(true);  const q = new URLSearchParams({ page: filters.page, limit: filters.limit, ...(filters.role && { role: filters.role }),     ...(search && { search }) }); const d = await api.get(`/users?${q}`);  setUsers(d.users || []);   setError(''); } catch { setError('Failed to load users'); }    finally { setULoad(false); }
  };
  const fetchPurch = async () => { try { setPLoad(true);  const d = await api.get('/purchases'); setPurch(d.purchases || []); setError(''); } catch { setError('Failed to load purchases'); } finally { setPLoad(false); } };

  useEffect(() => {
    if (tab === 'dashboard') fetchDash();
    else if (tab === 'videos') fetchVids();
    else if (tab === 'users') fetchUsers();
    else fetchPurch();
    setSearch('');
  }, [tab, filters]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (tab === 'videos') fetchVids();
      else if (tab === 'users') fetchUsers();
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'videos',    label: 'Videos',    icon: Film             },
    { id: 'users',     label: 'Users',     icon: Users            },
    { id: 'purchases', label: 'Purchases', icon: ShoppingBag      },
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
              </button>
            ))}
          </div>
        </nav>

        <main className="adm-page">
          {error && <div className="adm-err"><AlertCircle size={14} />{error}</div>}
          <div className="adm-head">
            <span className="adm-title">{{ dashboard: 'Dashboard', videos: 'Videos', users: 'Users', purchases: 'Purchases' }[tab]}</span>
          </div>

          {/* Dashboard */}
          {tab === 'dashboard' && (
            <>
              {loading && <div className="adm-loading"><Loader size={26} className="spin" /><span>Loading...</span></div>}
              {dashStats && (
                <>
                  <div className="adm-stats">
                    {[
                      { lbl: 'Total Videos',  val: dashStats.stats.totalVideos,                   icon: <Film size={17} />,        bg: 'rgba(232,68,90,.15)',  c: 'var(--accent)' },
                      { lbl: 'Total Users',   val: dashStats.stats.totalUsers,                    icon: <Users size={17} />,       bg: 'rgba(99,102,241,.15)', c: '#a5b4fc' },
                      { lbl: 'Revenue',       val: `฿${dashStats.stats.totalRevenue.toFixed(2)}`, icon: <TrendingUp size={17} />,  bg: 'rgba(245,200,66,.15)', c: 'var(--gold)' },
                      { lbl: 'Purchases',     val: dashStats.stats.totalPurchases,                icon: <ShoppingBag size={17} />, bg: 'rgba(46,204,113,.15)', c: 'var(--success)' },
                    ].map((s, i) => (
                      <div key={i} className="adm-stat">
                        <div className="adm-stat-icon" style={{ background: s.bg, color: s.c }}>{s.icon}</div>
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

          {/* Videos */}
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
                {vLoad ? <div className="adm-loading"><Loader size={22} className="spin" /><span>Loading...</span></div>
                  : videos.length === 0 ? <div className="adm-empty"><Film size={30} color="var(--muted)" /><span>ไม่พบวิดีโอ</span></div>
                  : videos.map(v => (
                    <div key={v._id} className="adm-row">
                      <div className="adm-ico"><PlayCircle size={16} /></div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="adm-rtitle">{v.title}</div>
                        <div className="adm-rsub"><Bdg status={v.uploadStatus} /> ฿{v.price} · {v.purchaseCount} purchases</div>
                      </div>
                      <div className="adm-actions">
                        <button className="adm-ibtn" title="Edit" onClick={() => { setEditVid(v); setShowEdit(true); }}><Edit size={13} /></button>
                        <button className="adm-ibtn del" title="Delete" onClick={async () => {
                          if (window.confirm('ลบวิดีโอนี้?')) {
                            await api.delete(`/videos/${v.id}`);
                            setVideos(p => p.filter(x => x.id !== v.id));
                          }
                        }}><Trash2 size={13} /></button>
                      </div>
                    </div>
                  ))}
              </div>
            </>
          )}

          {/* Users */}
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
                {uLoad ? <div className="adm-loading"><Loader size={22} className="spin" /><span>Loading...</span></div>
                  : users.length === 0 ? <div className="adm-empty"><Users size={30} color="var(--muted)" /><span>ไม่พบผู้ใช้</span></div>
                  : users.map(u => (
                    <div key={u._id} className="adm-row">
                      <div className="adm-ico" style={{ background: 'rgba(99,102,241,.1)', color: '#a5b4fc', fontWeight: 700, fontSize: 15 }}>{u.email?.[0]?.toUpperCase()}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="adm-rtitle">{u.email}</div>
                        <div className="adm-rsub"><span className={`adm-bdg adm-bdg-${u.role === 'admin' ? 'admin' : 'user'}`}>{u.role}</span> ฿{u.stats?.totalSpent?.toFixed(2)} · {u.stats?.totalPurchases} purchases</div>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>{new Date(u.createdAt).toLocaleDateString('th-TH')}</div>
                    </div>
                  ))}
              </div>
            </>
          )}

          {/* Purchases */}
          {tab === 'purchases' && (
            <>
              <div className="adm-bar"><button className="adm-ref" onClick={fetchPurch}><RefreshCw size={12} />รีเฟรช</button></div>
              <div className="adm-tbl">
                {pLoad ? <div className="adm-loading"><Loader size={22} className="spin" /><span>Loading...</span></div>
                  : purchases.length === 0 ? <div className="adm-empty"><ShoppingBag size={30} color="var(--muted)" /><span>ไม่พบรายการ</span></div>
                  : purchases.map(p => (
                    <div key={p._id} className="adm-row">
                      <div className="adm-ico" style={{ background: 'rgba(46,204,113,.1)', color: 'var(--success)' }}><DollarSign size={16} /></div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="adm-rtitle">{p.videoId?.title || 'Unknown Video'}</div>
                        <div className="adm-rsub">{p.userId?.email || 'Unknown'} · ฿{p.amount}</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <Bdg status={p.status} />
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{new Date(p.purchaseDate).toLocaleDateString('th-TH')}</div>
                      </div>
                    </div>
                  ))}
              </div>
            </>
          )}
        </main>

        <nav className="adm-bot">
          {tabs.map(t => (
            <button key={t.id} className={`adm-bitem ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              <t.icon />{t.label}
            </button>
          ))}
        </nav>
      </div>

      <EditModal isOpen={showEdit} onClose={() => setShowEdit(false)} onSave={fetchVids} video={editVid} />
    </>
  );
};

export default AdminDashboard;