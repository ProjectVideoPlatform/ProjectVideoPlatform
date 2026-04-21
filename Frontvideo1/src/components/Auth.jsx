// Auth.jsx — Dark Cinema Theme · Matches CineStream Design System
import React, { useState, useEffect, memo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthProvider';
import videoTracker from './videoTracker';
import { Loader, Eye, EyeOff, Film, Mail, Lock, User, Shield, ChevronRight, RefreshCw, LogOut, Clapperboard } from 'lucide-react';

const API_BASE_URL = 'http://localhost:3000/api';

/* ─── Styles ──────────────────────────────────────────────── */
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&display=swap');

  :root {
    --bg:      #0a0a0f;
    --surface: #111118;
    --card:    #16161f;
    --border:  rgba(255,255,255,0.08);
    --accent:  #e8445a;
    --accent2: #ff8c42;
    --gold:    #f5c842;
    --text:    #f0eff5;
    --muted:   #6b6a7a;
    --success: #2ecc71;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  .auth-root {
    min-height: 100vh;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'DM Sans', sans-serif;
    -webkit-font-smoothing: antialiased;
    padding: 20px;
    position: relative;
    overflow: hidden;
  }

  /* Ambient background orbs */
  .auth-orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(80px);
    pointer-events: none;
    opacity: .18;
  }
  .auth-orb-1 {
    width: 420px; height: 420px;
    background: var(--accent);
    top: -120px; left: -120px;
  }
  .auth-orb-2 {
    width: 320px; height: 320px;
    background: #6366f1;
    bottom: -80px; right: -80px;
  }
  .auth-orb-3 {
    width: 200px; height: 200px;
    background: var(--accent2);
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    opacity: .08;
  }

  /* Film strip decoration */
  .auth-filmstrip {
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 6px;
    background: repeating-linear-gradient(
      90deg,
      var(--accent) 0px,
      var(--accent) 18px,
      transparent 18px,
      transparent 26px
    );
    opacity: .5;
  }

  /* Card */
  .auth-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 28px;
    width: 100%;
    max-width: 440px;
    overflow: hidden;
    box-shadow: 0 32px 80px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.04);
    position: relative;
    z-index: 1;
    animation: cardIn .4s cubic-bezier(.16,1,.3,1) both;
  }
  @keyframes cardIn {
    from { opacity: 0; transform: translateY(24px) scale(.97); }
    to   { opacity: 1; transform: none; }
  }

  /* Card header */
  .auth-header {
    padding: 36px 36px 28px;
    border-bottom: 1px solid var(--border);
    position: relative;
    overflow: hidden;
    text-align: center;
  }
  .auth-header::before {
    content: '';
    position: absolute; inset: 0;
    background: radial-gradient(ellipse at 50% 0%, rgba(232,68,90,.12) 0%, transparent 70%);
  }

  .auth-logo {
    display: inline-flex; align-items: center; justify-content: center;
    gap: 10px;
    margin-bottom: 20px;
    position: relative;
  }
  .auth-logo-icon {
    width: 52px; height: 52px; border-radius: 16px;
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 8px 24px rgba(232,68,90,.4);
  }
  .auth-logo-text {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 28px;
    letter-spacing: 3px;
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .auth-title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 32px;
    letter-spacing: 2px;
    color: var(--text);
    margin-bottom: 6px;
    position: relative;
  }
  .auth-subtitle {
    font-size: 13px;
    color: var(--muted);
    position: relative;
  }

  /* Tabs */
  .auth-tabs {
    display: flex;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .auth-tab {
    flex: 1; padding: 14px;
    font-size: 13px; font-weight: 600; letter-spacing: .3px;
    color: var(--muted); background: transparent; border: none;
    cursor: pointer; transition: color .2s; position: relative;
    font-family: 'DM Sans', sans-serif;
  }
  .auth-tab::after {
    content: '';
    position: absolute; bottom: 0; left: 20%; right: 20%;
    height: 2px; border-radius: 2px;
    background: linear-gradient(90deg, var(--accent), var(--accent2));
    transform: scaleX(0); transition: transform .25s;
  }
  .auth-tab.active { color: var(--text); }
  .auth-tab.active::after { transform: scaleX(1); }

  /* Body */
  .auth-body { padding: 28px 32px 32px; }
  @media (max-width: 480px) {
    .auth-body { padding: 24px 20px 28px; }
    .auth-header { padding: 28px 20px 24px; }
  }

  /* Alert */
  .auth-alert {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 12px 14px;
    border-radius: 12px;
    font-size: 13px;
    margin-bottom: 20px;
    animation: alertIn .2s ease both;
  }
  @keyframes alertIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
  .auth-alert-error   { background: rgba(232,68,90,.1);  border: 1px solid rgba(232,68,90,.25); color: #fca5a5; }
  .auth-alert-success { background: rgba(46,204,113,.1); border: 1px solid rgba(46,204,113,.25); color: #86efac; }
  .auth-alert-dot {
    width: 6px; height: 6px; border-radius: 50%;
    flex-shrink: 0; margin-top: 5px;
  }
  .auth-alert-error   .auth-alert-dot { background: var(--accent); }
  .auth-alert-success .auth-alert-dot { background: var(--success); }

  /* Field */
  .auth-field { margin-bottom: 18px; }
  .auth-label {
    display: flex; align-items: center; gap: 6px;
    font-size: 11px; font-weight: 600; letter-spacing: .7px;
    text-transform: uppercase; color: var(--muted);
    margin-bottom: 8px;
  }

  .auth-input-wrap { position: relative; }
  .auth-input-icon {
    position: absolute; left: 13px; top: 50%;
    transform: translateY(-50%);
    color: var(--muted); pointer-events: none;
    width: 16px; height: 16px;
    transition: color .2s;
  }
  .auth-input-wrap:focus-within .auth-input-icon { color: var(--accent); }

  .auth-input {
    width: 100%;
    padding: 12px 14px 12px 40px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    color: var(--text);
    font-family: 'DM Sans', sans-serif;
    font-size: 14px;
    outline: none;
    transition: border-color .2s, box-shadow .2s;
  }
  .auth-input::placeholder { color: var(--muted); }
  .auth-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(232,68,90,.12);
  }
  .auth-input.focused {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(232,68,90,.12);
  }
  .auth-input:disabled { opacity: .5; cursor: not-allowed; }

  .auth-pw-toggle {
    position: absolute; right: 12px; top: 50%;
    transform: translateY(-50%);
    background: none; border: none;
    color: var(--muted); cursor: pointer;
    padding: 4px; border-radius: 6px;
    transition: color .2s;
    display: flex; align-items: center;
  }
  .auth-pw-toggle:hover { color: var(--text); }

  .auth-select {
    width: 100%;
    padding: 12px 14px 12px 40px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    color: var(--text);
    font-family: 'DM Sans', sans-serif;
    font-size: 14px;
    outline: none;
    cursor: pointer;
    transition: border-color .2s, box-shadow .2s;
    appearance: none;
    -webkit-appearance: none;
  }
  .auth-select:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(232,68,90,.12);
  }
  .auth-select option { background: var(--surface); color: var(--text); }

  /* Submit button */
  .auth-submit {
    width: 100%;
    padding: 14px;
    border-radius: 14px;
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    color: #fff;
    font-family: 'DM Sans', sans-serif;
    font-size: 15px;
    font-weight: 700;
    border: none;
    cursor: pointer;
    margin-top: 8px;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    transition: opacity .2s, transform .2s, box-shadow .2s;
    box-shadow: 0 6px 24px rgba(232,68,90,.35);
    letter-spacing: .3px;
  }
  .auth-submit:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 10px 32px rgba(232,68,90,.5);
  }
  .auth-submit:active:not(:disabled) { transform: translateY(0); }
  .auth-submit:disabled { opacity: .45; cursor: not-allowed; }

  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

  /* Divider */
  .auth-divider {
    display: flex; align-items: center; gap: 12px;
    margin: 22px 0 18px;
    color: var(--muted); font-size: 11px; letter-spacing: .5px; text-transform: uppercase;
  }
  .auth-divider::before, .auth-divider::after {
    content: ''; flex: 1; height: 1px; background: var(--border);
  }

  /* Switch link */
  .auth-switch { text-align: center; font-size: 13px; color: var(--muted); }
  .auth-link {
    color: var(--accent); font-weight: 600;
    background: none; border: none; cursor: pointer;
    font-family: 'DM Sans', sans-serif; font-size: 13px;
    padding: 2px 6px; border-radius: 4px;
    transition: opacity .2s;
    text-decoration: none;
  }
  .auth-link:hover { opacity: .8; }

  /* Profile card */
  .auth-profile-avatar {
    width: 72px; height: 72px; border-radius: 50%;
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 16px;
    font-size: 28px;
    box-shadow: 0 8px 24px rgba(232,68,90,.4);
  }
  .auth-profile-email {
    font-size: 17px; font-weight: 600; color: var(--text);
    margin-bottom: 12px; word-break: break-all;
  }
  .auth-role-badge {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 4px 14px; border-radius: 20px;
    font-size: 11px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase;
    margin-bottom: 8px;
  }
  .auth-role-admin { background: rgba(232,68,90,.15); color: var(--accent); border: 1px solid rgba(232,68,90,.3); }
  .auth-role-user  { background: rgba(99,102,241,.15); color: #a5b4fc; border: 1px solid rgba(99,102,241,.3); }
  .auth-uid {
    font-size: 11px; color: var(--muted);
    font-family: 'Courier New', monospace;
    background: var(--surface); padding: 4px 10px; border-radius: 6px;
    border: 1px solid var(--border);
  }
  .auth-profile-info {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 16px; padding: 20px;
    display: flex; flex-direction: column; align-items: center;
    gap: 8px; margin-bottom: 20px;
  }

  .auth-outline-btn {
    width: 100%; padding: 12px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; color: var(--text);
    font-family: 'DM Sans', sans-serif;
    font-size: 14px; font-weight: 500;
    cursor: pointer; transition: border-color .2s;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    margin-bottom: 10px;
  }
  .auth-outline-btn:hover { border-color: var(--accent); color: var(--accent); }

  .auth-nav-links {
    display: flex; gap: 8px; margin-top: 16px;
    padding-top: 16px; border-top: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .auth-nav-btn {
    flex: 1; min-width: 120px;
    display: flex; align-items: center; justify-content: center; gap: 6px;
    padding: 10px 14px; border-radius: 10px;
    background: rgba(255,255,255,.04); border: 1px solid var(--border);
    color: var(--muted); font-size: 13px; font-weight: 500;
    cursor: pointer; transition: all .2s;
    font-family: 'DM Sans', sans-serif;
    white-space: nowrap;
  }
  .auth-nav-btn:hover { border-color: var(--accent); color: var(--accent); background: rgba(232,68,90,.06); }
`;

/* ─── Main Component ──────────────────────────────────────── */
const VideoAuthSystem = () => {
  const navigate = useNavigate();
  const { setUser: setAuthUser } = useAuth();

  const [currentView, setCurrentView]             = useState('login');
  const [currentUser, setCurrentUser]             = useState(null);
  const [authToken, setAuthToken]                 = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
  );
  const [loading, setLoading]                     = useState({ login: false, register: false });
  const [alerts, setAlerts]                       = useState({ login: null, register: null });
  const [currentlyFocusedField, setFocused]       = useState('email');
  const [showPw, setShowPw]                       = useState({ login: false, register: false });
  const [loginForm, setLoginForm]                 = useState({ email: '', password: '' });
  const [registerForm, setRegisterForm]           = useState({ email: '', password: '', role: 'user' });

  const showAlert = useCallback((type, message, alertType = 'error') => {
    setAlerts(prev => ({ ...prev, [type]: { message, type: alertType } }));
  }, []);

  const clearAlerts = useCallback(() => {
    setAlerts({ login: null, register: null });
  }, []);

  const apiCall = useCallback(async (endpoint, options = {}) => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(authToken && { Authorization: `Bearer ${authToken}` }),
        ...options.headers,
      },
      credentials: 'include',
      ...options,
    });
    let data = {};
    try { data = await response.json(); } catch (e) {
      if (!response.ok) throw new Error(`Server error: ${response.status}`);
      return {};
    }
    if (!response.ok) throw new Error(data.message || data.error || `Error ${response.status}`);
    return data;
  }, [authToken]);

  const logout = useCallback(() => {
    setAuthToken(null); setCurrentUser(null); setAuthUser(null);
    localStorage.removeItem('authToken');
    setCurrentView('login');
    videoTracker.updateUserId(null);
    clearAlerts(); setFocused('email');
  }, [setAuthUser, clearAlerts]);

  const getCurrentUser = useCallback(async () => {
    try {
      const r = await apiCall('/auth/verify');
      setCurrentUser(r.user); setAuthUser(r.user); setCurrentView('profile');
    } catch { logout(); }
  }, [apiCall, setAuthUser, logout]);

  useEffect(() => { if (authToken) getCurrentUser(); }, [authToken, getCurrentUser]);

  const handleLogin = useCallback(async () => {
    setLoading(p => ({ ...p, login: true })); clearAlerts();
    try {
      const r = await apiCall('/auth/login', { method: 'POST', body: JSON.stringify(loginForm) });
      setAuthToken(r.token); localStorage.setItem('authToken', r.token);
      setCurrentUser(r.user); setAuthUser(r.user);
      showAlert('login', 'เข้าสู่ระบบสำเร็จ!', 'success');
      setTimeout(() => setCurrentView('profile'), 900);
    } catch (e) { showAlert('login', e.message); }
    finally { setLoading(p => ({ ...p, login: false })); }
  }, [loginForm, apiCall, clearAlerts, setAuthUser, showAlert]);

  const handleRegister = useCallback(async () => {
    setLoading(p => ({ ...p, register: true })); clearAlerts();
    try {
      const r = await apiCall('/auth/register', { method: 'POST', body: JSON.stringify(registerForm) });
      setAuthToken(r.token); localStorage.setItem('authToken', r.token);
      setCurrentUser(r.user); setAuthUser(r.user);
      showAlert('register', 'สมัครสมาชิกสำเร็จ!', 'success');
      setTimeout(() => setCurrentView('profile'), 900);
    } catch (e) { showAlert('register', e.message); }
    finally { setLoading(p => ({ ...p, register: false })); }
  }, [registerForm, apiCall, clearAlerts, setAuthUser, showAlert]);

  const refreshToken = useCallback(async () => {
    try {
      const r = await apiCall('/auth/refresh', { method: 'POST' });
      setAuthToken(r.token); localStorage.setItem('authToken', r.token);
    } catch (e) { logout(); }
  }, [apiCall, logout]);

  /* ── Alert ── */
  const AlertBox = memo(({ alert }) => {
    if (!alert) return null;
    return (
      <div className={`auth-alert auth-alert-${alert.type}`}>
        <div className="auth-alert-dot" />
        <span>{alert.message}</span>
      </div>
    );
  });

  /* ── Login Form ── */
  const LoginForm = memo(() => {
    const emailRef = useRef(null);
    const pwRef    = useRef(null);
    const hasFocused = useRef(false);

    useEffect(() => {
      if (hasFocused.current) return;
      const ref = currentlyFocusedField === 'email' ? emailRef : pwRef;
      if (ref.current) { ref.current.focus(); const l = ref.current.value.length; ref.current.setSelectionRange(l, l); }
      hasFocused.current = true;
    }, []);

    const handleKeyDown = useCallback((e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (currentlyFocusedField === 'email') setFocused('password');
        else handleLogin();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        setFocused(f => f === 'email' ? 'password' : 'email');
      }
    }, [currentlyFocusedField]);

    return (
      <>
        <AlertBox alert={alerts.login} />
        <div className="auth-field">
          <label className="auth-label"><Mail size={12} />Email</label>
          <div className="auth-input-wrap">
            <Mail className="auth-input-icon" />
            <input
              ref={emailRef}
              type="text"
              value={loginForm.email}
              onChange={e => setLoginForm(p => ({ ...p, email: e.target.value }))}
              onKeyDown={handleKeyDown}
              onFocus={() => setFocused('email')}
              className={`auth-input ${currentlyFocusedField === 'email' ? 'focused' : ''}`}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>
        </div>
        <div className="auth-field">
          <label className="auth-label"><Lock size={12} />Password</label>
          <div className="auth-input-wrap">
            <Lock className="auth-input-icon" />
            <input
              ref={pwRef}
              type={showPw.login ? 'text' : 'password'}
              value={loginForm.password}
              onChange={e => setLoginForm(p => ({ ...p, password: e.target.value }))}
              onKeyDown={handleKeyDown}
              onFocus={() => setFocused('password')}
              className={`auth-input ${currentlyFocusedField === 'password' ? 'focused' : ''}`}
              placeholder="••••••••"
              autoComplete="current-password"
              style={{ paddingRight: 42 }}
            />
            <button className="auth-pw-toggle" type="button" onClick={() => setShowPw(p => ({ ...p, login: !p.login }))}>
              {showPw.login ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <button className="auth-submit" onClick={handleLogin} disabled={loading.login}>
          {loading.login
            ? <Loader size={17} style={{ animation: 'spin 1s linear infinite' }} />
            : <><Film size={16} />เข้าสู่ระบบ</>}
        </button>
        <div className="auth-divider">หรือ</div>
        <div className="auth-switch">
          ยังไม่มีบัญชี?{' '}
          <button className="auth-link" onClick={() => { setCurrentView('register'); setFocused('email'); }}>
            สมัครสมาชิก →
          </button>
        </div>
      </>
    );
  });

  /* ── Register Form ── */
  const RegisterForm = memo(() => {
    const emailRef = useRef(null);
    const pwRef    = useRef(null);
    const roleRef  = useRef(null);

    useEffect(() => {
      const map = { email: emailRef, password: pwRef, role: roleRef };
      const ref = map[currentlyFocusedField];
      if (ref?.current) { ref.current.focus(); }
    }, [currentlyFocusedField]);

    const handleKeyDown = useCallback((e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (currentlyFocusedField === 'email') setFocused('password');
        else if (currentlyFocusedField === 'password') setFocused('role');
        else handleRegister();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const order = ['email', 'password', 'role'];
        const idx = order.indexOf(currentlyFocusedField);
        setFocused(order[(idx + 1) % order.length]);
      }
    }, [currentlyFocusedField]);

    return (
      <>
        <AlertBox alert={alerts.register} />
        <div className="auth-field">
          <label className="auth-label"><Mail size={12} />Email</label>
          <div className="auth-input-wrap">
            <Mail className="auth-input-icon" />
            <input
              ref={emailRef}
              type="text"
              value={registerForm.email}
              onChange={e => setRegisterForm(p => ({ ...p, email: e.target.value }))}
              onKeyDown={handleKeyDown}
              onFocus={() => setFocused('email')}
              className={`auth-input ${currentlyFocusedField === 'email' ? 'focused' : ''}`}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>
        </div>
        <div className="auth-field">
          <label className="auth-label"><Lock size={12} />Password</label>
          <div className="auth-input-wrap">
            <Lock className="auth-input-icon" />
            <input
              ref={pwRef}
              type={showPw.register ? 'text' : 'password'}
              value={registerForm.password}
              onChange={e => setRegisterForm(p => ({ ...p, password: e.target.value }))}
              onKeyDown={handleKeyDown}
              onFocus={() => setFocused('password')}
              className={`auth-input ${currentlyFocusedField === 'password' ? 'focused' : ''}`}
              placeholder="••••••••"
              autoComplete="new-password"
              style={{ paddingRight: 42 }}
            />
            <button className="auth-pw-toggle" type="button" onClick={() => setShowPw(p => ({ ...p, register: !p.register }))}>
              {showPw.register ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <div className="auth-field">
          <label className="auth-label"><Shield size={12} />Role</label>
          <div className="auth-input-wrap">
            <Shield className="auth-input-icon" />
            <select
              ref={roleRef}
              value={registerForm.role}
              onChange={e => setRegisterForm(p => ({ ...p, role: e.target.value }))}
              onFocus={() => setFocused('role')}
              onKeyDown={handleKeyDown}
              className={`auth-select ${currentlyFocusedField === 'role' ? 'focused' : ''}`}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <button className="auth-submit" onClick={handleRegister} disabled={loading.register}>
          {loading.register
            ? <Loader size={17} style={{ animation: 'spin 1s linear infinite' }} />
            : <><User size={16} />สมัครสมาชิก</>}
        </button>
        <div className="auth-divider">หรือ</div>
        <div className="auth-switch">
          มีบัญชีแล้ว?{' '}
          <button className="auth-link" onClick={() => { setCurrentView('login'); setFocused('email'); }}>
            เข้าสู่ระบบ →
          </button>
        </div>
      </>
    );
  });

  /* ── Profile ── */
  const UserProfile = memo(() => (
    <>
      <div className="auth-profile-info">
        <div className="auth-profile-avatar">
          {currentUser?.email?.[0]?.toUpperCase() ?? <User size={28} />}
        </div>
        <div className="auth-profile-email">{currentUser?.email}</div>
        <div className={`auth-role-badge ${currentUser?.role === 'admin' ? 'auth-role-admin' : 'auth-role-user'}`}>
          {currentUser?.role === 'admin' ? <Shield size={10} /> : <User size={10} />}
          {currentUser?.role}
        </div>
        {currentUser?.id && <div className="auth-uid">ID: {currentUser.id}</div>}
      </div>

      <button className="auth-outline-btn" onClick={refreshToken}>
        <RefreshCw size={15} />รีเฟรช Token
      </button>
      <button className="auth-submit" onClick={logout}>
        <LogOut size={16} />ออกจากระบบ
      </button>

      <div className="auth-nav-links">
        <button className="auth-nav-btn" onClick={() => currentUser && navigate('/')}>
          <Film size={14} />วิดีโอ<ChevronRight size={13} />
        </button>
        {currentUser?.role === 'admin' && (
          <button className="auth-nav-btn" onClick={() => navigate('/admin')}>
            <Shield size={14} />Admin<ChevronRight size={13} />
          </button>
        )}
      </div>
    </>
  ));

  /* ── Render ── */
  const isProfile = currentView === 'profile';

  return (
    <>
      <style>{styles}</style>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>

      <div className="auth-root">
        {/* Ambient orbs */}
        <div className="auth-orb auth-orb-1" />
        <div className="auth-orb auth-orb-2" />
        <div className="auth-orb auth-orb-3" />

        <div className="auth-card">
          <div className="auth-filmstrip" />

          {/* Header */}
          <div className="auth-header">
            <div className="auth-logo">
              <div className="auth-logo-icon"><Clapperboard size={26} color="#fff" /></div>
              <span className="auth-logo-text">CineStream</span>
            </div>
            <div className="auth-title">
              {isProfile ? `ยินดีต้อนรับ` : currentView === 'login' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}
            </div>
            <div className="auth-subtitle">
              {isProfile
                ? 'คุณเข้าสู่ระบบเรียบร้อยแล้ว'
                : currentView === 'login'
                  ? 'ดูหนัง ซีรีส์ วิดีโอพรีเมียมได้ทุกที่'
                  : 'สร้างบัญชีเพื่อเข้าถึงคอนเทนต์ทั้งหมด'}
            </div>
          </div>

          {/* Tabs (login/register only) */}
          {!isProfile && (
            <div className="auth-tabs">
              <button
                className={`auth-tab ${currentView === 'login' ? 'active' : ''}`}
                onClick={() => { setCurrentView('login'); setFocused('email'); clearAlerts(); }}
              >เข้าสู่ระบบ</button>
              <button
                className={`auth-tab ${currentView === 'register' ? 'active' : ''}`}
                onClick={() => { setCurrentView('register'); setFocused('email'); clearAlerts(); }}
              >สมัครสมาชิก</button>
            </div>
          )}

          {/* Body */}
          <div className="auth-body">
            {currentView === 'login'    && <LoginForm />}
            {currentView === 'register' && <RegisterForm />}
            {currentView === 'profile'  && <UserProfile />}
          </div>
        </div>
      </div>
    </>
  );
};

export default VideoAuthSystem;