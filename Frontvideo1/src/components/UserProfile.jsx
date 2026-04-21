import React, { useState, useEffect, useCallback } from 'react';
import { 
  User, Mail, Shield, Calendar, History, LogOut, Lock, 
  Eye, EyeOff, ChevronRight, Loader, CreditCard, 
  MapPin, Video, Clock, TrendingUp, Award 
} from 'lucide-react';
import { useNotif } from '../NotifContext';

const UserProfile = () => {
  const { notifications, videoNotifications, addNotification } = useNotif();
  
  const apiBaseUrl = 'http://localhost:3000';
  const [activeTab, setActiveTab] = useState('overview');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  
  const [userData, setUserData] = useState(null);
  const [purchaseHistory, setPurchaseHistory] = useState([]);
  const [stats, setStats] = useState(null);
  
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  // Mock sessions - ในอนาคตควรดึงจาก API
  const [sessions] = useState([
    {
      id: '1',
      device: 'Chrome on Windows',
      location: 'Bangkok, Thailand',
      lastActive: new Date().toISOString(),
      current: true
    }
  ]);

  // --- เพิ่มฟังก์ชัน Logout ---
  const handleLogout = () => {
    localStorage.removeItem('authToken'); // ลบ token ออก
    addNotification({
      title: 'ออกจากระบบสำเร็จ',
      message: 'แล้วเจอกันใหม่นะ!',
      type: 'info'
    });
    // ดีเลย์เล็กน้อยเพื่อให้แจ้งเตือนแสดงก่อนเปลี่ยนหน้า
    setTimeout(() => {
      window.location.href = '/login'; 
    }, 1000);
  };

  const fetchData = useCallback(async () => {
    setPageLoading(true);
    const token = localStorage.getItem('authToken');
    const headers = { 'Authorization': `Bearer ${token}` };

    try {
      const [profileRes, historyRes, statsRes] = await Promise.all([
        fetch(`${apiBaseUrl}/api/user/profile`, { headers, credentials: 'include' }),
        fetch(`${apiBaseUrl}/api/purchase/purchased/list?limit=100`, { headers, credentials: 'include' }),
        fetch(`${apiBaseUrl}/api/purchase/stats`, { headers, credentials: 'include' })
      ]);

      if (profileRes.ok) {
        const profileData = await profileRes.json();
        setUserData(profileData);
      }

      if (historyRes.ok) {
        const historyData = await historyRes.json();
        setPurchaseHistory(historyData.videos || []);
      }

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }
    } catch (error) {
      console.error('Fetch error:', error);
      addNotification({
        title: 'เกิดข้อผิดพลาด',
        message: 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้',
        type: 'error'
      });
    } finally {
      setPageLoading(false);
    }
  }, [addNotification]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handlePasswordChange = async () => {
    const { currentPassword, newPassword, confirmPassword } = passwordForm;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return addNotification({ title: 'ข้อมูลไม่ครบ', message: 'กรุณากรอกข้อมูลให้ครบถ้วน', type: 'error' });
    }
    if (newPassword !== confirmPassword) {
      return addNotification({ title: 'รหัสผ่านไม่ตรงกัน', message: 'รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน', type: 'error' });
    }
    if (newPassword.length < 6) {
      return addNotification({ title: 'รหัสผ่านสั้นเกินไป', message: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร', type: 'error' });
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${apiBaseUrl}/api/user/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ oldPassword: currentPassword, newPassword })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'เปลี่ยนรหัสผ่านไม่สำเร็จ');

      addNotification({
        title: 'สำเร็จ',
        message: 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว',
        type: 'success'
      });
      
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setShowPassword(false);
    } catch (error) {
      addNotification({ title: 'เกิดข้อผิดพลาด', message: error.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('th-TH', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  if (pageLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <Loader className="w-12 h-12 animate-spin text-blue-500 mx-auto mb-4" />
          <p className="text-gray-400 animate-pulse">กำลังเตรียมข้อมูลส่วนตัวของคุณ...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950 text-slate-200 pb-12">
      {/* Header */}
      <header className="bg-slate-900/80 backdrop-blur-xl border-b border-slate-800/50 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            VideoStream
          </h1>
          <div className="flex items-center gap-2 sm:gap-4">
            {(notifications.length + Object.keys(videoNotifications).length) > 0 && (
              <div className="bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center animate-bounce">
                {notifications.length + Object.keys(videoNotifications).length}
              </div>
            )}
            <button 
              onClick={() => window.history.back()}
              className="flex items-center gap-2 px-3 py-2 bg-slate-800/50 hover:bg-slate-700 text-white rounded-xl transition-all border border-slate-700/50 group text-sm"
            >
              <ChevronRight className="w-4 h-4 rotate-180 group-hover:-translate-x-1 transition-transform" />
              <span className="hidden xs:inline">ย้อนกลับ</span>
            </button>
            
            {/* เพิ่มปุ่ม Logout ใน Header */}
            <button 
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl transition-all border border-red-500/20 font-bold text-sm"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">ออกจากระบบ</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Profile Card */}
        <section className="bg-gradient-to-br from-blue-600/10 via-purple-600/10 to-transparent backdrop-blur-xl rounded-3xl border border-white/10 p-8 mb-8 relative overflow-hidden">
          <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
            <div className="relative">
              <div className="w-28 h-28 rounded-2xl bg-gradient-to-tr from-blue-500 to-purple-600 flex items-center justify-center shadow-2xl shadow-blue-500/20">
                <User className="w-14 h-14 text-white" />
              </div>
              <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-green-500 rounded-full border-4 border-slate-950" />
            </div>
            
            <div className="flex-1 text-center md:text-left">
              <h2 className="text-3xl font-bold text-white mb-2">{userData?.email?.split('@')[0]}</h2>
              <p className="text-blue-300/80 mb-4 flex items-center justify-center md:justify-start gap-2">
                <Mail className="w-4 h-4" /> {userData?.email}
              </p>
              <div className="flex flex-wrap gap-3 justify-center md:justify-start">
                <span className="px-4 py-1.5 bg-blue-500/20 text-blue-400 rounded-full text-xs font-bold border border-blue-500/30">
                  {userData?.role === 'admin' ? '👑 ADMINISTRATOR' : '🎬 MEMBER'}
                </span>
                <span className="px-4 py-1.5 bg-slate-800/50 text-slate-300 rounded-full text-xs font-medium border border-white/10 flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5" /> เป็นสมาชิกเมื่อ {formatDate(userData?.createdAt)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 w-full md:w-auto">
              {[
                { icon: Video, label: 'วิดีโอ', val: stats?.totalPurchases || 0, color: 'text-blue-400' },
                { icon: TrendingUp, label: 'ยอดซื้อ', val: `฿${stats?.totalSpent || 0}`, color: 'text-green-400' },
                { icon: Award, label: 'เข้าดู', val: stats?.totalAccessCount || 0, color: 'text-purple-400' }
              ].map((s, i) => (
                <div key={i} className="bg-slate-900/60 backdrop-blur-md rounded-2xl p-4 border border-white/5 text-center min-w-[100px]">
                  <s.icon className={`w-5 h-5 ${s.color} mx-auto mb-1`} />
                  <div className="text-xl font-bold text-white">{s.val}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Tabs */}
        <nav className="flex p-1.5 bg-slate-900/50 backdrop-blur-md rounded-2xl border border-white/5 mb-8">
          {[
            { id: 'overview', label: 'ภาพรวม', icon: User },
            { id: 'purchases', label: 'ประวัติการซื้อ', icon: CreditCard },
            { id: 'security', label: 'ความปลอดภัย', icon: Shield }
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl transition-all font-semibold text-sm ${
                activeTab === t.id 
                ? 'bg-blue-600 text-white shadow-lg' 
                : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </nav>

        {/* Tab Content */}
        <div className="bg-slate-900/40 backdrop-blur-xl rounded-3xl border border-white/5 p-8">
          {activeTab === 'overview' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h3 className="text-xl font-bold mb-8 flex items-center gap-3">
                <span className="w-1.5 h-6 bg-blue-500 rounded-full" /> รายละเอียดบัญชี
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
                {[
                  { label: 'อีเมลที่ลงทะเบียน', val: userData?.email, icon: Mail, color: 'text-blue-400' },
                  { label: 'ประเภทผู้ใช้งาน', val: userData?.role === 'admin' ? 'ผู้ดูแลระบบ' : 'สมาชิกทั่วไป', icon: Shield, color: 'text-purple-400' },
                  { label: 'วันที่เริ่มใช้งาน', val: formatDate(userData?.createdAt), icon: Calendar, color: 'text-green-400' },
                  { label: 'การเคลื่อนไหวล่าสุด', val: formatDateTime(userData?.updatedAt), icon: History, color: 'text-orange-400' }
                ].map((item, i) => (
                  <div key={i} className="p-4 rounded-2xl bg-white/5 border border-white/5 flex items-center gap-4">
                    <div className={`p-3 rounded-xl bg-slate-950/50 ${item.color}`}>
                      <item.icon className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-500 uppercase">{item.label}</p>
                      <p className="text-lg text-white font-medium">{item.val}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* เพิ่มส่วน Logout ในหน้านี้ด้วย */}
              <div className="pt-8 border-t border-white/5">
                <button 
                  onClick={handleLogout}
                  className="w-full md:w-auto px-8 py-4 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white rounded-2xl transition-all border border-red-500/30 flex items-center justify-center gap-3 font-bold"
                >
                  <LogOut className="w-5 h-5" />
                  ออกจากระบบจากอุปกรณ์นี้
                </button>
              </div>
            </div>
          )}

          {activeTab === 'purchases' && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
               <h3 className="text-xl font-bold mb-6 flex items-center gap-3">
                <span className="w-1.5 h-6 bg-green-500 rounded-full" /> รายการสั่งซื้อของคุณ
              </h3>
              {purchaseHistory.length > 0 ? (
                purchaseHistory.map((item) => (
                  <div key={item._id} className="group p-5 rounded-2xl bg-white/5 border border-white/5 hover:border-blue-500/50 transition-all flex flex-col md:flex-row justify-between gap-4">
                    <div>
                      <h4 className="text-lg font-bold text-white group-hover:text-blue-400 transition-colors">{item.title}</h4>
                      <div className="flex gap-4 mt-2 text-sm text-slate-400">
                        <span className="flex items-center gap-1"><Calendar className="w-4 h-4"/> {formatDate(item.purchaseInfo?.purchaseDate)}</span>
                        <span className="flex items-center gap-1"><Eye className="w-4 h-4"/> ดูไปแล้ว {item.purchaseInfo?.accessCount || 0} ครั้ง</span>
                      </div>
                    </div>
                    <div className="text-right flex flex-col justify-center">
                      <div className="text-2xl font-black text-white">฿{item.purchaseInfo?.amount || item.price}</div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase mt-1 ${item.purchaseInfo?.isExpired ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                        {item.purchaseInfo?.isExpired ? 'Expired' : 'Active'}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-20 text-center text-slate-500">
                  <CreditCard className="w-16 h-16 mx-auto mb-4 opacity-20" />
                  <p>ยังไม่มีรายการสั่งซื้อในขณะนี้</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'security' && (
            <div className="max-w-2xl animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h3 className="text-xl font-bold mb-8 flex items-center gap-3">
                <span className="w-1.5 h-6 bg-red-500 rounded-full" /> การจัดการความปลอดภัย
              </h3>
              <div className="space-y-5">
                {[
                  { label: 'รหัสผ่านปัจจุบัน', key: 'currentPassword' },
                  { label: 'รหัสผ่านใหม่', key: 'newPassword' },
                  { label: 'ยืนยันรหัสผ่านใหม่', key: 'confirmPassword' }
                ].map((f) => (
                  <div key={f.key}>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2 ml-1">{f.label}</label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={passwordForm[f.key]}
                        onChange={(e) => setPasswordForm({...passwordForm, [f.key]: e.target.value})}
                        className="w-full bg-slate-950/50 border border-white/10 rounded-2xl px-5 py-3.5 text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                        placeholder={`••••••••`}
                      />
                      {f.key === 'currentPassword' && (
                        <button 
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                        >
                          {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <button
                  onClick={handlePasswordChange}
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-4 rounded-2xl mt-4 transition-all shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2"
                >
                  {loading ? <Loader className="w-5 h-5 animate-spin" /> : <Lock className="w-5 h-5" />}
                  บันทึกการเปลี่ยนแปลงรหัสผ่าน
                </button>
              </div>

              {/* Sessions */}
              <div className="mt-12 pt-12 border-t border-white/5">
                <h4 className="font-bold mb-6 flex items-center gap-2"><MapPin className="w-4 h-4 text-red-400"/> อุปกรณ์ที่กำลังใช้งาน</h4>
                {sessions.map(s => (
                  <div key={s.id} className="p-5 rounded-2xl bg-white/5 border border-white/5 flex justify-between items-center">
                    <div className="flex gap-4 items-center">
                      <div className="p-3 bg-green-500/10 rounded-xl"><Clock className="text-green-500 w-5 h-5"/></div>
                      <div>
                        <p className="font-bold text-white">{s.device} <span className="text-[10px] bg-green-500 text-white px-2 py-0.5 rounded ml-2">Current</span></p>
                        <p className="text-xs text-slate-500">{s.location} • ใช้งานเมื่อ {formatDateTime(s.lastActive)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default UserProfile;