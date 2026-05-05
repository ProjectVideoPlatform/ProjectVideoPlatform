// Video.jsx — Dark Cinema Theme · Cookie Auth (no Bearer)
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play, Search, Upload, ShoppingCart, User, Video,
  Clock, Tag, CheckCircle, AlertCircle,
  QrCode, Loader, X, Home, BookOpen, Flame, ChevronLeft, ChevronRight, Sparkles
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import VideoPlayer from './VideoPlayer';
import { useNotif } from '../NotifContext';
import { apiFetch } from '../utils/apiClient';
import VideoCard from './VideoCard';
const API_BASE = '/api';
import { useAuth } from '../AuthContext';
const CATEGORIES = [
  { value: 'action',  label: 'Action' },
  { value: 'comedy',  label: 'Comedy' },
  { value: 'thriller',label: 'Thriller' },
  { value: 'romance', label: 'Romance' },
  { value: 'sci-fi',  label: 'Sci-Fi' },
  { value: 'horror',  label: 'Horror' },
];

/* ─── Styles ──────────────────────────────────────────────── */
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&display=swap');

  :root {
    --bg:       #0a0a0f;
    --surface:  #111118;
    --card:     #16161f;
    --border:   rgba(255,255,255,0.07);
    --accent:   #e8445a;
    --accent2:  #ff8c42;
    --gold:     #f5c842;
    --text:     #f0eff5;
    --muted:    #6b6a7a;
    --success:  #2ecc71;
    --nav-h:    64px;
    --bot-nav:  68px;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'DM Sans', sans-serif; -webkit-font-smoothing: antialiased; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  .vs-header { position: fixed; top: 0; left: 0; right: 0; height: var(--nav-h); background: rgba(10,10,15,0.85); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border-bottom: 1px solid var(--border); z-index: 100; display: flex; align-items: center; padding: 0 20px; gap: 16px; }
  .vs-logo { font-family: 'Bebas Neue', sans-serif; font-size: 26px; letter-spacing: 2px; background: linear-gradient(135deg, var(--accent) 0%, var(--accent2) 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; flex-shrink: 0; user-select: none; }
  .vs-header-tabs { display: flex; gap: 4px; margin-left: 8px; }
  @media (max-width: 640px) { .vs-header-tabs { display: none; } }
  .vs-htab { padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: 500; color: var(--muted); background: transparent; border: none; cursor: pointer; transition: all .2s; white-space: nowrap; }
  .vs-htab:hover { color: var(--text); background: var(--surface); }
  .vs-htab.active { color: var(--accent); background: rgba(232,68,90,0.12); }
  .vs-header-spacer { flex: 1; }
  .vs-header-actions { display: flex; gap: 10px; align-items: center; }
  .vs-btn-icon { width: 38px; height: 38px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--surface); border: 1px solid var(--border); color: var(--text); cursor: pointer; transition: all .2s; }
  .vs-btn-icon:hover { background: var(--card); border-color: var(--accent); color: var(--accent); }
  .vs-btn-upload { display: flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 20px; background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #fff; font-size: 13px; font-weight: 600; border: none; cursor: pointer; transition: opacity .2s, transform .15s; white-space: nowrap; }
  .vs-btn-upload:hover { opacity: .9; transform: translateY(-1px); }
  @media (max-width: 480px) { .vs-btn-upload span { display: none; } }

  .vs-bottom-nav { display: none; position: fixed; bottom: 0; left: 0; right: 0; height: var(--bot-nav); background: rgba(10,10,15,0.95); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border-top: 1px solid var(--border); z-index: 100; align-items: center; justify-content: space-around; padding: 0 8px; }
  @media (max-width: 640px) { .vs-bottom-nav { display: flex; } }
  .vs-bnav-item { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 6px 16px; border: none; background: transparent; color: var(--muted); cursor: pointer; transition: color .2s; font-size: 10px; font-weight: 500; letter-spacing: .3px; flex: 1; }
  .vs-bnav-item.active { color: var(--accent); }
  .vs-bnav-item svg { width: 22px; height: 22px; }
  .vs-bnav-center { position: relative; top: -10px; width: 52px; height: 52px; border-radius: 50%; background: linear-gradient(135deg, var(--accent), var(--accent2)); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 20px rgba(232,68,90,0.5); border: none; cursor: pointer; transition: transform .2s; flex-shrink: 0; }
  .vs-bnav-center:hover { transform: scale(1.08); }

  .vs-page { padding-top: var(--nav-h); min-height: 100vh; }
  @media (max-width: 640px) { .vs-page { padding-bottom: var(--bot-nav); } }

  .vs-search-bar { padding: 16px 20px; display: flex; gap: 10px; align-items: center; border-bottom: 1px solid var(--border); background: var(--bg); flex-wrap: wrap; }
  .vs-search-wrap { flex: 1; min-width: 160px; position: relative; }
  .vs-search-wrap svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); width: 16px; height: 16px; pointer-events: none; }
  .vs-search-input { width: 100%; padding: 10px 12px 10px 38px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; color: var(--text); font-family: 'DM Sans', sans-serif; font-size: 14px; outline: none; transition: border-color .2s; }
  .vs-search-input::placeholder { color: var(--muted); }
  .vs-search-input:focus { border-color: var(--accent); }
  .vs-select { padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; color: var(--text); font-family: 'DM Sans', sans-serif; font-size: 13px; outline: none; cursor: pointer; transition: border-color .2s; min-width: 130px; }
  @media (max-width: 480px) { .vs-select { display: none; } }
  .vs-select:focus { border-color: var(--accent); }
  .vs-select option { background: var(--surface); }
  .vs-search-btn { padding: 10px 20px; background: var(--accent); color: #fff; border: none; border-radius: 12px; font-size: 14px; font-weight: 600; cursor: pointer; transition: opacity .2s; white-space: nowrap; flex-shrink: 0; }
  .vs-search-btn:hover { opacity: .85; }
  .vs-search-btn:disabled { opacity: .4; cursor: not-allowed; }

  .vs-main { max-width: 1320px; margin: 0 auto; padding: 28px 20px; }
  .vs-section-header { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
  .vs-section-title { font-family: 'Bebas Neue', sans-serif; font-size: 22px; letter-spacing: 1.5px; color: var(--text); }
  .vs-section-pill { font-size: 11px; font-weight: 600; padding: 2px 10px; background: rgba(232,68,90,0.15); color: var(--accent); border-radius: 20px; letter-spacing: .5px; }
  .vs-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }
  @media (max-width: 1200px) { .vs-grid { grid-template-columns: repeat(3, 1fr); } }
  @media (max-width: 860px)  { .vs-grid { grid-template-columns: repeat(2, 1fr); gap: 14px; } }
  @media (max-width: 480px)  { .vs-grid { grid-template-columns: 1fr; gap: 12px; } }

  .vs-card { background: var(--card); border-radius: 16px; overflow: hidden; border: 1px solid var(--border); transition: transform .25s, box-shadow .25s, border-color .25s; cursor: default; }
  .vs-card:hover { transform: translateY(-4px); box-shadow: 0 16px 40px rgba(0,0,0,0.5); border-color: rgba(255,255,255,0.14); }
  .vs-thumb { position: relative; aspect-ratio: 16/9; background: #0d0d14; overflow: hidden; }
  .vs-thumb img { width: 100%; height: 100%; object-fit: cover; transition: transform .4s; }
  .vs-card:hover .vs-thumb img { transform: scale(1.05); }
  .vs-thumb-overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,.7) 0%, transparent 50%); opacity: 0; transition: opacity .25s; }
  .vs-card:hover .vs-thumb-overlay { opacity: 1; }
  .vs-play-btn { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity .25s; }
  .vs-card:hover .vs-play-btn { opacity: 1; }
  .vs-play-circle { width: 52px; height: 52px; border-radius: 50%; background: rgba(232,68,90,0.9); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 24px rgba(232,68,90,0.6); transition: transform .2s; }
  .vs-play-circle:hover { transform: scale(1.1); }
  .vs-duration { position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,.8); color: #fff; font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 6px; letter-spacing: .3px; }
  .vs-status-badge { position: absolute; top: 8px; left: 8px; display: flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 700; letter-spacing: .5px; padding: 3px 9px; border-radius: 6px; text-transform: uppercase; }
  .vs-status-processing { background: rgba(245,200,66,.15); color: var(--gold); border: 1px solid rgba(245,200,66,.3); }
  .vs-status-failed { background: rgba(232,68,90,.15); color: var(--accent); border: 1px solid rgba(232,68,90,.3); }

  /* ✅ accessType badge */
  .vs-access-badge { position: absolute; top: 8px; right: 8px; font-size: 10px; font-weight: 700; letter-spacing: .5px; padding: 3px 9px; border-radius: 6px; text-transform: uppercase; }
  .vs-access-free { background: rgba(46,204,113,.2); color: #2ecc71; border: 1px solid rgba(46,204,113,.35); }
  .vs-access-paid { background: rgba(245,200,66,.15); color: var(--gold); border: 1px solid rgba(245,200,66,.3); }

  .vs-card-body { padding: 14px 16px 16px; }
  .vs-card-title { font-size: 14px; font-weight: 600; line-height: 1.4; color: var(--text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-bottom: 6px; }
  .vs-card-desc { font-size: 12px; color: var(--muted); line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-bottom: 10px; }
  .vs-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 12px; }
  .vs-tag { display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px; border-radius: 6px; background: rgba(255,255,255,0.05); border: 1px solid var(--border); font-size: 10px; color: var(--muted); font-weight: 500; }
  .vs-card-footer { display: flex; align-items: center; justify-content: space-between; }
  .vs-price { font-size: 18px; font-weight: 700; background: linear-gradient(135deg, var(--gold), #e8a82a); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
  .vs-price-free { font-size: 15px; font-weight: 700; color: var(--success); }
  .vs-action-btn { display: flex; align-items: center; gap: 6px; padding: 8px 18px; border-radius: 10px; font-size: 13px; font-weight: 600; border: none; cursor: pointer; transition: all .2s; white-space: nowrap; }
  .vs-btn-play { background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff; box-shadow: 0 4px 16px rgba(37,99,235,.35); }
  .vs-btn-play:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(37,99,235,.5); }
  .vs-btn-buy { background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #fff; box-shadow: 0 4px 16px rgba(232,68,90,.35); }
  .vs-btn-buy:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(232,68,90,.5); }
  .vs-action-btn:disabled { opacity: .45; cursor: not-allowed; transform: none !important; }
  .vs-owned-badge { display: flex; align-items: center; gap: 5px; margin-top: 10px; font-size: 11px; color: var(--success); font-weight: 500; }
  .vs-admin-badge { display: flex; align-items: center; gap: 4px; margin-top: 8px; font-size: 10px; color: #60a5fa; font-weight: 600; letter-spacing: .4px; text-transform: uppercase; }
  .vs-pagination { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 36px; padding-bottom: 16px; }
  .vs-page-btn { display: flex; align-items: center; gap: 5px; padding: 8px 18px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); color: var(--text); font-size: 13px; font-weight: 500; cursor: pointer; transition: all .2s; }
  .vs-page-btn:hover { border-color: var(--accent); color: var(--accent); }
  .vs-page-btn:disabled { opacity: .35; cursor: not-allowed; }
  .vs-page-info { font-size: 13px; color: var(--muted); }
  .vs-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 80px 20px; text-align: center; }
  .vs-empty-icon { width: 72px; height: 72px; background: var(--surface); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 20px; border: 1px solid var(--border); }
  .vs-empty h3 { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
  .vs-empty p  { font-size: 13px; color: var(--muted); max-width: 300px; line-height: 1.6; }
  .vs-spinner { display: flex; align-items: center; justify-content: center; padding: 80px; color: var(--accent); }
  .vs-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.75); backdrop-filter: blur(6px); z-index: 200; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .vs-modal { background: var(--card); border: 1px solid var(--border); border-radius: 24px; width: 100%; max-width: 420px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,.7); }
  .vs-modal-header { padding: 24px; background: linear-gradient(135deg, rgba(232,68,90,.15), rgba(255,140,66,.1)); border-bottom: 1px solid var(--border); position: relative; display: flex; align-items: center; gap: 14px; }
  .vs-modal-icon { width: 48px; height: 48px; border-radius: 14px; background: linear-gradient(135deg, var(--accent), var(--accent2)); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .vs-modal-close { position: absolute; top: 16px; right: 16px; width: 32px; height: 32px; border-radius: 50%; background: rgba(255,255,255,.08); border: none; color: var(--text); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background .2s; }
  .vs-modal-close:hover { background: rgba(255,255,255,.15); }
  .vs-modal-body { padding: 24px; }
  .vs-payment-summary { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 16px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
  .vs-qr-wrap { background: #fff; border-radius: 16px; padding: 16px; margin-bottom: 16px; }
  .vs-qr-wrap img { width: 100%; height: auto; display: block; }
  .vs-payment-status { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px; border-radius: 12px; background: rgba(37,99,235,.08); border: 1px solid rgba(37,99,235,.2); margin-bottom: 16px; text-align: center; }
  .vs-payment-steps { margin-top: 16px; padding: 14px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); }
  .vs-payment-steps p { font-size: 12px; font-weight: 600; color: var(--text); margin-bottom: 8px; }
  .vs-payment-steps ol { font-size: 12px; color: var(--muted); padding-left: 16px; line-height: 2; }
  .vs-upload-modal { background: var(--card); border: 1px solid var(--border); border-radius: 24px; width: 100%; max-width: 480px; overflow: hidden; max-height: 90vh; overflow-y: auto; box-shadow: 0 24px 60px rgba(0,0,0,.7); }
  .vs-upload-header { padding: 20px 24px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
  .vs-upload-body { padding: 24px; }
  .vs-progress-steps { margin-bottom: 20px; padding: 16px; background: var(--surface); border-radius: 14px; border: 1px solid var(--border); }
  .vs-progress-labels { display: flex; justify-content: space-between; font-size: 11px; font-weight: 600; margin-bottom: 10px; text-transform: uppercase; letter-spacing: .5px; }
  .vs-progress-track { height: 4px; background: rgba(255,255,255,.08); border-radius: 2px; overflow: hidden; }
  .vs-progress-fill { height: 100%; border-radius: 2px; transition: width .5s ease, background .3s; }
  .vs-field { margin-bottom: 16px; }
  .vs-label { display: block; font-size: 12px; font-weight: 600; color: var(--muted); letter-spacing: .5px; text-transform: uppercase; margin-bottom: 6px; }
  .vs-input, .vs-textarea { width: 100%; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; color: var(--text); font-family: 'DM Sans', sans-serif; font-size: 14px; outline: none; transition: border-color .2s; }
  .vs-input:focus, .vs-textarea:focus { border-color: var(--accent); }
  .vs-input:disabled, .vs-textarea:disabled { opacity: .5; cursor: not-allowed; }
  .vs-input::placeholder, .vs-textarea::placeholder { color: var(--muted); }
  .vs-textarea { height: 88px; resize: none; }

  /* ✅ radio toggle สำหรับ accessType */
  .vs-toggle-group { display: flex; gap: 8px; }
  .vs-toggle-btn { flex: 1; padding: 9px 12px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); color: var(--muted); font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; transition: all .2s; text-align: center; }
  .vs-toggle-btn:hover { border-color: rgba(255,255,255,.2); color: var(--text); }
  .vs-toggle-btn.active-free  { background: rgba(46,204,113,.15); border-color: rgba(46,204,113,.5); color: #2ecc71; }
  .vs-toggle-btn.active-paid  { background: rgba(245,200,66,.12); border-color: rgba(245,200,66,.4); color: var(--gold); }
  .vs-toggle-btn:disabled { opacity: .4; cursor: not-allowed; }

  .vs-file-hint { font-size: 11px; color: var(--muted); margin-top: 5px; }
  .vs-modal-actions { display: flex; gap: 10px; margin-top: 20px; }
  .vs-btn-cancel { flex: 1; padding: 11px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); color: var(--text); font-size: 14px; font-weight: 500; cursor: pointer; transition: border-color .2s; }
  .vs-btn-cancel:hover { border-color: var(--accent); }
  .vs-btn-cancel:disabled { opacity: .4; cursor: not-allowed; }
  .vs-btn-confirm { flex: 1; padding: 11px; border-radius: 10px; background: linear-gradient(135deg, var(--accent), var(--accent2)); border: none; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; transition: opacity .2s; display: flex; align-items: center; justify-content: center; }
  .vs-btn-confirm:hover { opacity: .9; }
  .vs-btn-confirm:disabled { opacity: .35; cursor: not-allowed; }
  .vs-result-wrap { display: flex; flex-direction: column; align-items: center; padding: 32px 24px; gap: 12px; text-align: center; }
  .vs-result-icon { width: 72px; height: 72px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 4px; }
  .vs-result-success { background: rgba(46,204,113,.15); }
  .vs-result-fail { background: rgba(232,68,90,.15); }
  .vs-thumb-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #0d0d18, #1a1a28); }
`;

/* ─── API ─────────────────────────────────────────────────── */
const api = {
  getVideos: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/videos?${query}`);
  },
  purchaseVideo: (id) =>
    apiFetch(`/videos/${id}/purchase`, { method: 'POST' }),
  playVideo: (id) =>
    apiFetch(`/videos/${id}/play`, { method: 'POST' }),
  getPurchasedVideos: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/videos/purchased/list?${query}`);
  },
  initializeUpload: (data) =>
    apiFetch(`/videos/upload/initialize`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  completeUpload: (id) =>
    apiFetch(`/videos/upload/${id}/complete`, { method: 'POST' }),
  failUpload: (id, error) =>
    apiFetch(`/videos/upload/${id}/failed`, {
      method: 'POST',
      body: JSON.stringify({ error }),
    }),
};

/* ─── Video Card ──────────────────────────────────────────── */

/* ─── Upload Modal ────────────────────────────────────────── */
const UploadModal = ({ isOpen, onClose, onUpload }) => {
  const [form, setForm] = useState({
    title: '',
    description: '',
    price: 0,
    tags: [],        // ✅ เปลี่ยนเป็น array
    accessType: 'free', // ✅ เพิ่ม
  });
  const [file, setFile]           = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress]   = useState(0);
  const [step, setStep]           = useState('form');

  const reset = () => {
    setForm({ title: '', description: '', price: 0, tags: [], accessType: 'free' });
    setFile(null); setProgress(0); setStep('form'); setUploading(false);
  };
  const handleClose = () => { if (!uploading) { onClose(); reset(); } };

  // ✅ toggle category
  const toggleTag = (val) => {
    setForm(prev => ({
      ...prev,
      tags: prev.tags.includes(val)
        ? prev.tags.filter(t => t !== val)
        : [...prev.tags, val]
    }));
  };

  const handleSubmit = async () => {
    if (!file || !form.title) return;
    setUploading(true); setStep('uploading'); setProgress(0);
    try {
      const payload = {
        ...form,
        tags: form.tags.join(','), // ✅ ส่งเป็น string ตาม route เดิม
        price: form.accessType === 'paid' ? form.price : 0,
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type,
      };
      const init = await api.initializeUpload(payload);
      const up = await fetch(init.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!up.ok) throw new Error('S3 upload failed');
      setProgress(100); setStep('processing');
      await api.completeUpload(init.videoId);
      onUpload(
        {
          id: init.videoId,
          title: form.title,
          description: form.description,
          price: payload.price,
          tags: form.tags,
          accessType: form.accessType,
          uploadStatus: 'processing',
          thumbnailPath: null,
          canPlay: false,
          purchased: false,
        },
        init.videoId,
        form.title
      );
      onClose(); reset();
    } catch (err) {
      console.error(err); setStep('failed'); setUploading(false);
    }
  };

  if (!isOpen) return null;

  const progressVal   = step === 'uploading' ? progress : step === 'processing' ? 100 : step === 'failed' ? 100 : 0;
  const progressColor = step === 'failed' ? 'var(--accent)' : 'linear-gradient(90deg, var(--accent), var(--accent2))';

  return (
    <div className="vs-modal-backdrop">
      <div className="vs-upload-modal">
        <div className="vs-upload-header">
          <div>
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 22, letterSpacing: 1.5 }}>Upload Video</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>อัปโหลดวิดีโอใหม่</div>
          </div>
          <button className="vs-btn-icon" onClick={handleClose} disabled={uploading}><X size={18} /></button>
        </div>
        <div className="vs-upload-body">
          {step !== 'form' && (
            <div className="vs-progress-steps">
              <div className="vs-progress-labels">
                <span style={{ color: step === 'uploading' ? 'var(--accent)' : step === 'failed' ? 'var(--muted)' : 'var(--success)' }}>Uploading</span>
                <span style={{ color: step === 'processing' ? 'var(--accent)' : step === 'failed' ? 'var(--muted)' : step === 'form' ? 'var(--muted)' : 'var(--success)' }}>Processing</span>
                <span style={{ color: step === 'failed' ? 'var(--accent)' : 'var(--muted)' }}>{step === 'failed' ? 'Failed' : 'Done'}</span>
              </div>
              <div className="vs-progress-track">
                <div className="vs-progress-fill" style={{ width: `${progressVal}%`, background: progressColor }} />
              </div>
              <div style={{ fontSize: 12, color: step === 'failed' ? 'var(--accent)' : 'var(--muted)', marginTop: 8 }}>
                {step === 'uploading' && 'Uploading to S3...'}
                {step === 'processing' && 'Processing video...'}
                {step === 'failed' && '❌ Upload failed. Please try again.'}
              </div>
            </div>
          )}

          <div className="vs-field">
            <label className="vs-label">Video File *</label>
            <input type="file" accept="video/*" onChange={e => setFile(e.target.files[0])} disabled={uploading} className="vs-input" style={{ cursor: 'pointer' }} />
            {file && <div className="vs-file-hint">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</div>}
          </div>

          <div className="vs-field">
            <label className="vs-label">Title *</label>
            <input className="vs-input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} disabled={uploading} placeholder="ชื่อวิดีโอ" />
          </div>

          <div className="vs-field">
            <label className="vs-label">Description</label>
            <textarea className="vs-textarea" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} disabled={uploading} placeholder="รายละเอียดวิดีโอ..." />
          </div>

          {/* ✅ ประเภทวิดีโอ (free / paid) */}
          <div className="vs-field">
            <label className="vs-label">ประเภท</label>
            <div className="vs-toggle-group">
              <button
                type="button"
                className={`vs-toggle-btn ${form.accessType === 'free' ? 'active-free' : ''}`}
                onClick={() => setForm({ ...form, accessType: 'free', price: 0 })}
                disabled={uploading}
              >
                🆓 ฟรี
              </button>
              <button
                type="button"
                className={`vs-toggle-btn ${form.accessType === 'paid' ? 'active-paid' : ''}`}
                onClick={() => setForm({ ...form, accessType: 'paid' })}
                disabled={uploading}
              >
                💰 มีค่าใช้จ่าย
              </button>
            </div>
          </div>

          {/* ✅ แสดง price field เฉพาะตอน paid */}
          {form.accessType === 'paid' && (
            <div className="vs-field">
              <label className="vs-label">ราคา (฿) *</label>
              <input
                type="number"
                min="1"
                step="0.01"
                className="vs-input"
                value={form.price}
                onChange={e => setForm({ ...form, price: parseFloat(e.target.value) || 0 })}
                disabled={uploading}
                placeholder="เช่น 99.00"
              />
            </div>
          )}

          {/* ✅ หมวดหมู่ — เลือกได้หลายอัน */}
          <div className="vs-field">
            <label className="vs-label">หมวดหมู่</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {CATEGORIES.map(cat => {
                const active = form.tags.includes(cat.value);
                return (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => !uploading && toggleTag(cat.value)}
                    disabled={uploading}
                    style={{
                      padding: '6px 14px',
                      borderRadius: 8,
                      border: active ? '1px solid rgba(232,68,90,.6)' : '1px solid var(--border)',
                      background: active ? 'rgba(232,68,90,.15)' : 'var(--surface)',
                      color: active ? 'var(--accent)' : 'var(--muted)',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: uploading ? 'not-allowed' : 'pointer',
                      transition: 'all .2s',
                      opacity: uploading ? .5 : 1,
                    }}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>
            {form.tags.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                เลือก: {form.tags.join(', ')}
              </div>
            )}
          </div>

          <div className="vs-modal-actions">
            <button className="vs-btn-cancel" onClick={handleClose} disabled={uploading}>{uploading ? 'Please wait...' : 'Cancel'}</button>
            <button
              className="vs-btn-confirm"
              onClick={handleSubmit}
              disabled={uploading || !file || !form.title || (form.accessType === 'paid' && !form.price)}
            >
              {uploading ? <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> : 'Upload'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ─── Main App ────────────────────────────────────────────── */
const VideoStreamingApp = () => {
  const { user } = useAuth();
  const { startWatching } = useNotif();
  const navigate = useNavigate();
  const location = useLocation();
  const [videos, setVideos]               = useState([]);
  const [purchasedVideos, setPurchased]   = useState([]);
  const [currentView, setView] = useState(
    location.pathname === '/purchased' ? 'purchased' : 'all'
  );
  const [loading, setLoading]             = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [searchQuery, setSearch]          = useState('');
  const [selectedCat, setCat]             = useState('');
  const [selectedAccessType, setAccessType] = useState(''); // ✅ filter by accessType
  const [currentPage, setPage]            = useState(1);
  const [pagination, setPagination]       = useState({});
  const [currentPlayer, setPlayer]        = useState(null);
  const [showUpload, setShowUpload]       = useState(false);
 const isAdmin = user?.role === 'admin';
  const currentUserIdRef = useRef(null);
  const loadVideos = async (params = {}) => {
    setLoading(true);
    try {
      const r = await api.getVideos({
        page: currentPage,
        limit: 12,
        search: searchQuery,
        category: selectedCat,
        accessType: selectedAccessType, // ✅ ส่ง filter
        ...params
      });
      setVideos(r.videos); setPagination(r.pagination);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const loadPurchased = async () => {
    setLoading(true);
    try {
      const r = await api.getPurchasedVideos({ page: currentPage, limit: 12 });
      setPurchased(r.videos); setPagination(r.pagination);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handlePlay = async (video) => {
    setActionLoading(video.id);
    try {
      const r = await api.playVideo(video.id);
      currentUserIdRef.current = r.userId || null;
      setPlayer({ manifestUrl: r.manifestUrl, videoId: video.id, videoCategory: video.tags });
    } catch (e) { alert('Playback failed: ' + e.message); }
    finally { setActionLoading(null); }
  };

  const handleViewChange = (v) => { setView(v); setPage(1); setSearch(''); setCat(''); setAccessType(''); };

  const handleUploadComplete = useCallback((newVideo, videoId, title) => {
    setVideos(prev => [newVideo, ...prev]);
    startWatching(videoId, title);
  }, [startWatching]);

  useEffect(() => {
    if (currentView === 'all') loadVideos();
    else loadPurchased();
  }, [currentView, currentPage]);

  const displayVideos = currentView === 'all' ? videos : purchasedVideos;

  return (
    <>
      <style>{styles}</style>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.4; } }
        .animate-spin { animation: spin 1s linear infinite; }
      `}</style>

      <div className="vs-page">
        <header className="vs-header">
          <span className="vs-logo">🎬 CineStream</span>
          <div className="vs-header-tabs">
            <button className={`vs-htab ${currentView === 'all' ? 'active' : ''}`} onClick={() => handleViewChange('all')}>
              <Flame size={13} style={{ display: 'inline', marginRight: 5, verticalAlign: 'middle' }} />ทั้งหมด
            </button>
            <button className={`vs-htab ${currentView === 'purchased' ? 'active' : ''}`} onClick={() => handleViewChange('purchased')}>
              <BookOpen size={13} style={{ display: 'inline', marginRight: 5, verticalAlign: 'middle' }} />วิดีโอของฉัน
            </button>
            <button className="vs-htab" onClick={() => navigate('/foryou')}>
              <Sparkles size={13} style={{ display: 'inline', marginRight: 5, verticalAlign: 'middle' }} />สำหรับคุณ
            </button>
          </div>
          <div className="vs-header-spacer" />
          <div className="vs-header-actions">
            {isAdmin && (
              <button className="vs-btn-upload" onClick={() => setShowUpload(true)}>
                <Upload size={15} /><span>Upload</span>
              </button>
            )}
            <button className="vs-btn-icon" onClick={() => navigate('/UserProfile')} title="Profile">
              <User size={17} />
            </button>
          </div>
        </header>

        {currentView === 'all' && (
          <div className="vs-search-bar">
            <div className="vs-search-wrap">
              <Search />
              <input
                className="vs-search-input"
                placeholder="ค้นหาวิดีโอ..."
                value={searchQuery}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (setPage(1), loadVideos())}
              />
            </div>

            {/* ✅ Dropdown หมวดหมู่ */}
            <select
              className="vs-select"
              value={selectedCat}
              onChange={e => setCat(e.target.value)}
            >
              <option value="">ทุกหมวด</option>
              {CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>

            {/* ✅ Dropdown ประเภท free/paid */}
            <select
              className="vs-select"
              value={selectedAccessType}
              onChange={e => setAccessType(e.target.value)}
              style={{ minWidth: 110 }}
            >
              <option value="">ทุกประเภท</option>
              <option value="free">ฟรี</option>
              <option value="paid">มีค่าใช้จ่าย</option>
            </select>

            <button className="vs-search-btn" onClick={() => { setPage(1); loadVideos(); }} disabled={loading}>
              {loading ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : 'ค้นหา'}
            </button>
          </div>
        )}

        <main className="vs-main">
          <div className="vs-section-header">
            <span className="vs-section-title">
              {currentView === 'all' ? 'วิดีโอทั้งหมด' : 'วิดีโอของฉัน'}
            </span>
            {displayVideos.length > 0 && (
              <span className="vs-section-pill">{displayVideos.length} รายการ</span>
            )}
          </div>

          {loading ? (
            <div className="vs-spinner"><Loader size={32} className="animate-spin" /></div>
          ) : displayVideos.length === 0 ? (
            <div className="vs-empty">
              <div className="vs-empty-icon"><Video size={28} color="var(--muted)" /></div>
              <h3>{currentView === 'purchased' ? 'ยังไม่มีวิดีโอที่ซื้อ' : 'ไม่พบวิดีโอ'}</h3>
              <p>{currentView === 'purchased' ? 'เริ่มเรียกดูและซื้อวิดีโอเพื่อสร้างคลังของคุณ' : 'ลองปรับเกณฑ์การค้นหาดูนะ'}</p>
            </div>
          ) : (
            <>
              <div className="vs-grid">
                {displayVideos.map(video => (
                  <VideoCard
                    key={video.id || video._id}
                    video={video}
                    onPlay={handlePlay}
                    isLoading={actionLoading === (video.id || video._id)}
                    isAdmin={isAdmin}
                     showRefundButton={currentView === 'purchased'}  // ✅ แค่นี้พอ
                  />
                ))}
              </div>
              {pagination.pages > 1 && (
                <div className="vs-pagination">
                  <button className="vs-page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={currentPage === 1 || loading}>
                    <ChevronLeft size={15} />ก่อนหน้า
                  </button>
                  <span className="vs-page-info">หน้า {currentPage} / {pagination.pages}</span>
                  <button className="vs-page-btn" onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={currentPage === pagination.pages || loading}>
                    ถัดไป<ChevronRight size={15} />
                  </button>
                </div>
              )}
            </>
          )}
        </main>

        <nav className="vs-bottom-nav">
          <button className={`vs-bnav-item ${currentView === 'all' ? 'active' : ''}`} onClick={() => handleViewChange('all')}>
            <Home />หน้าหลัก
          </button>
          <button className="vs-bnav-item" onClick={() => navigate('/foryou')}>
            <Sparkles />สำหรับคุณ
          </button>
          {isAdmin && (
            <button className="vs-bnav-center" onClick={() => setShowUpload(true)}>
              <Upload size={22} color="#fff" />
            </button>
          )}
          <button className={`vs-bnav-item ${currentView === 'purchased' ? 'active' : ''}`} onClick={() => handleViewChange('purchased')}>
            <BookOpen />คลังของฉัน
          </button>
        </nav>
      </div>

      {currentPlayer && (
        <VideoPlayer
          manifestUrl={currentPlayer.manifestUrl}
          onClose={() => setPlayer(null)}
          videoId={currentPlayer.videoId}
          videoCategory={currentPlayer.videoCategory}
        />
      )}

      <UploadModal isOpen={showUpload} onClose={() => setShowUpload(false)} onUpload={handleUploadComplete} />
    </>
  );
};

export default VideoStreamingApp;