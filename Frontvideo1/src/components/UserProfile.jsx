import React, { useState, useEffect } from 'react';
import { User, Mail, Shield, Calendar, History, LogOut, Edit2, Save, X, Eye, EyeOff, ChevronRight, Loader, CreditCard, MapPin, Video, Clock, TrendingUp, Award, Lock } from 'lucide-react';

const UserProfile = () => {
  const apiBaseUrl = 'http://localhost:3000';
  const [activeTab, setActiveTab] = useState('overview');
  const [isEditing, setIsEditing] = useState(false);
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

  const [sessions] = useState([
    {
      id: '1',
      device: 'Chrome on Windows',
      location: 'Bangkok, Thailand',
      lastActive: new Date().toISOString(),
      current: true
    }
  ]);

  const fetchProfile = async () => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${apiBaseUrl}/api/user/profile`, {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include'
      });
      
      if (!response.ok) throw new Error('Failed to fetch profile');
      const data = await response.json();
      setUserData(data);
    } catch (error) {
      console.error('Error fetching profile:', error);
    }
  };

  const fetchPurchaseHistory = async () => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${apiBaseUrl}/api/purchase/purchased/list?limit=100`, {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include'
      });
      
      if (!response.ok) throw new Error('Failed to fetch purchases');
      const data = await response.json();
      setPurchaseHistory(data.videos || []);
    } catch (error) {
      console.error('Error fetching purchases:', error);
    }
  };

  const fetchStats = async () => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${apiBaseUrl}/api/purchase/stats`, {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include'
      });
      
      if (!response.ok) throw new Error('Failed to fetch stats');
      const data = await response.json();
      setStats(data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setPageLoading(true);
      await Promise.all([fetchProfile(), fetchPurchaseHistory(), fetchStats()]);
      setPageLoading(false);
    };
    loadData();
  }, []);

  const handlePasswordChange = async () => {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      alert('รหัสผ่านไม่ตรงกัน!');
      return;
    }
    if (!passwordForm.currentPassword || !passwordForm.newPassword) {
      alert('กรุณากรอกข้อมูลให้ครบถ้วน!');
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      alert('รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร!');
      return;
    }

    setLoading(true);
   try {
  setLoading(true); // เปิด Loading ก่อนเริ่ม

  // 1. เช็คเบื้องต้นที่ฝั่ง Client
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    throw new Error('รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน');
  }

  const token = localStorage.getItem('authToken');
  const response = await fetch(`${apiBaseUrl}/api/user/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    // credentials: 'include', // ใช้ถ้าคุณใช้ Cookie/Session ถ้าใช้ JWT อย่างเดียวเอาออกได้
    body: JSON.stringify({
      oldPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword
    })
  });

  const data = await response.json(); // อ่าน JSON ก่อนเพื่อเช็ค Error

  if (!response.ok) {
    throw new Error(data.error || 'การเปลี่ยนรหัสผ่านล้มเหลว');
  }

  alert('เปลี่ยนรหัสผ่านสำเร็จ!');
  setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });

} catch (error) {
  alert(error.message); // แสดง Error ที่มาจากทั้ง Client และ Server
} finally {
  setLoading(false);
}
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (pageLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950 flex items-center justify-center">
        <div className="text-center">
          <Loader className="w-12 h-12 animate-spin text-blue-500 mx-auto mb-4" />
          <p className="text-gray-400">กำลังโหลดข้อมูล...</p>
        </div>
      </div>
    );
  }

  if (!userData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950 flex items-center justify-center">
        <p className="text-white">ไม่สามารถโหลดข้อมูลได้</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950">
      {/* Header */}
      <header className="bg-slate-900/80 backdrop-blur-xl border-b border-slate-800/50 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              VideoStream
            </h1>
            <button 
              onClick={() => window.history.back()}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800/50 hover:bg-slate-700/50 text-white rounded-xl transition-all border border-slate-700/50"
            >
              <ChevronRight className="w-4 h-4 rotate-180" />
              <span>ย้อนกลับ</span>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Profile Header Card */}
        <div className="bg-gradient-to-br from-blue-600/20 via-purple-600/20 to-pink-600/20 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-8 mb-6 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5" />
          <div className="relative flex flex-col md:flex-row items-center md:items-start gap-6">
            <div className="relative">
              <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center ring-4 ring-slate-900/50">
                <User className="w-12 h-12 text-white" />
              </div>
              <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-green-500 rounded-full border-4 border-slate-900" />
            </div>
            
            <div className="flex-1 text-center md:text-left">
              <h2 className="text-3xl font-bold text-white mb-2">{userData.email?.split('@')[0]}</h2>
              <p className="text-gray-400 mb-3">{userData.email}</p>
              <div className="flex flex-wrap gap-2 justify-center md:justify-start">
                <span className="px-4 py-1.5 bg-blue-500/20 text-blue-400 rounded-full text-sm font-medium border border-blue-500/30">
                  {userData.role === 'admin' ? '👑 Administrator' : '🎬 Member'}
                </span>
                <span className="px-4 py-1.5 bg-purple-500/20 text-purple-400 rounded-full text-sm font-medium border border-purple-500/30 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  สมาชิกตั้งแต่ {new Date(userData.createdAt).getFullYear()}
                </span>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="bg-slate-900/50 backdrop-blur-sm rounded-xl p-4 border border-slate-700/50">
                <Video className="w-6 h-6 text-blue-400 mx-auto mb-2" />
                <div className="text-2xl font-bold text-white">{stats?.totalPurchases || 0}</div>
                <div className="text-xs text-gray-400">วิดีโอ</div>
              </div>
              <div className="bg-slate-900/50 backdrop-blur-sm rounded-xl p-4 border border-slate-700/50">
                <TrendingUp className="w-6 h-6 text-green-400 mx-auto mb-2" />
                <div className="text-2xl font-bold text-white">฿{stats?.totalSpent || 0}</div>
                <div className="text-xs text-gray-400">ใช้จ่าย</div>
              </div>
              <div className="bg-slate-900/50 backdrop-blur-sm rounded-xl p-4 border border-slate-700/50">
                <Award className="w-6 h-6 text-purple-400 mx-auto mb-2" />
                <div className="text-2xl font-bold text-white">{stats?.activeAccess || 0}</div>
                <div className="text-xs text-gray-400">กำลังใช้งาน</div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs Navigation */}
        <div className="bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-2 mb-6">
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'overview', label: 'ภาพรวม', icon: User },
              { id: 'purchases', label: 'ประวัติการซื้อ', icon: CreditCard },
              { id: 'security', label: 'ความปลอดภัย', icon: Shield }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 min-w-[120px] flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg shadow-blue-500/20'
                    : 'text-gray-400 hover:text-white hover:bg-slate-800/50'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-6">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <h3 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                <div className="w-1 h-8 bg-gradient-to-b from-blue-500 to-purple-500 rounded-full" />
                ข้อมูลส่วนตัว
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="group">
                  <label className="block text-sm font-medium text-gray-400 mb-3">อีเมล</label>
                  <div className="flex items-center gap-3 p-4 bg-slate-800/50 rounded-xl border border-slate-700/50 group-hover:border-blue-500/30 transition-all">
                    <Mail className="w-5 h-5 text-blue-400" />
                    <span className="text-white text-lg">{userData.email}</span>
                  </div>
                </div>

                <div className="group">
                  <label className="block text-sm font-medium text-gray-400 mb-3">ประเภทบัญชี</label>
                  <div className="flex items-center gap-3 p-4 bg-slate-800/50 rounded-xl border border-slate-700/50 group-hover:border-purple-500/30 transition-all">
                    <Shield className="w-5 h-5 text-purple-400" />
                    <span className="text-white text-lg">
                      {userData.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้งานทั่วไป'}
                    </span>
                  </div>
                </div>

                <div className="group">
                  <label className="block text-sm font-medium text-gray-400 mb-3">สมาชิกตั้งแต่</label>
                  <div className="flex items-center gap-3 p-4 bg-slate-800/50 rounded-xl border border-slate-700/50 group-hover:border-green-500/30 transition-all">
                    <Calendar className="w-5 h-5 text-green-400" />
                    <span className="text-white text-lg">{formatDate(userData.createdAt)}</span>
                  </div>
                </div>

                <div className="group">
                  <label className="block text-sm font-medium text-gray-400 mb-3">อัพเดทล่าสุด</label>
                  <div className="flex items-center gap-3 p-4 bg-slate-800/50 rounded-xl border border-slate-700/50 group-hover:border-orange-500/30 transition-all">
                    <History className="w-5 h-5 text-orange-400" />
                    <span className="text-white text-lg">{formatDateTime(userData.updatedAt)}</span>
                  </div>
                </div>
              </div>

              {/* Activity Stats */}
              <div className="mt-8">
                <h4 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-blue-400" />
                  สถิติการใช้งาน
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-gradient-to-br from-blue-600/10 to-blue-600/5 p-6 rounded-xl border border-blue-500/20">
                    <div className="flex items-center justify-between mb-2">
                      <Video className="w-8 h-8 text-blue-400" />
                      <span className="text-3xl font-bold text-white">{stats?.totalPurchases || 0}</span>
                    </div>
                    <p className="text-gray-400 text-sm">วิดีโอที่ซื้อทั้งหมด</p>
                  </div>

                  <div className="bg-gradient-to-br from-green-600/10 to-green-600/5 p-6 rounded-xl border border-green-500/20">
                    <div className="flex items-center justify-between mb-2">
                      <CreditCard className="w-8 h-8 text-green-400" />
                      <span className="text-3xl font-bold text-white">฿{stats?.totalSpent || 0}</span>
                    </div>
                    <p className="text-gray-400 text-sm">ยอดใช้จ่ายทั้งหมด</p>
                  </div>

                  <div className="bg-gradient-to-br from-purple-600/10 to-purple-600/5 p-6 rounded-xl border border-purple-500/20">
                    <div className="flex items-center justify-between mb-2">
                      <Eye className="w-8 h-8 text-purple-400" />
                      <span className="text-3xl font-bold text-white">{stats?.totalAccessCount || 0}</span>
                    </div>
                    <p className="text-gray-400 text-sm">จำนวนครั้งที่ดู</p>
                  </div>

                  <div className="bg-gradient-to-br from-pink-600/10 to-pink-600/5 p-6 rounded-xl border border-pink-500/20">
                    <div className="flex items-center justify-between mb-2">
                      <Award className="w-8 h-8 text-pink-400" />
                      <span className="text-3xl font-bold text-white">{Math.round(stats?.avgAccessPerVideo || 0)}</span>
                    </div>
                    <p className="text-gray-400 text-sm">เฉลี่ยต่อวิดีโอ</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Purchases Tab */}
          {activeTab === 'purchases' && (
            <div>
              <h3 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                <div className="w-1 h-8 bg-gradient-to-b from-blue-500 to-purple-500 rounded-full" />
                ประวัติการซื้อ
              </h3>

              <div className="space-y-4">
                {purchaseHistory.map((item) => (
                  <div key={item._id} className="group bg-slate-800/30 hover:bg-slate-800/50 rounded-xl p-5 border border-slate-700/50 hover:border-blue-500/30 transition-all">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <h4 className="text-white font-semibold mb-2 text-lg group-hover:text-blue-400 transition-colors">
                          {item.title || 'Unknown Video'}
                        </h4>
                        
                        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400 mb-3">
                          <span className="flex items-center gap-1.5">
                            <Calendar className="w-4 h-4" />
                            {formatDate(item.purchaseInfo?.purchaseDate)}
                          </span>
                          {item.duration && (
                            <span className="flex items-center gap-1.5">
                              <Clock className="w-4 h-4" />
                              {Math.floor(item.duration / 60)} นาที
                            </span>
                          )}
                          {item.purchaseInfo?.accessCount > 0 && (
                            <span className="flex items-center gap-1.5">
                              <Eye className="w-4 h-4" />
                              ดูแล้ว {item.purchaseInfo.accessCount} ครั้ง
                            </span>
                          )}
                        </div>

                        {item.purchaseInfo?.lastTime > 0 && (
                          <div className="flex items-center gap-2 mb-2">
                            <div className="flex-1 bg-slate-700/50 rounded-full h-2 overflow-hidden">
                              <div 
                                className="bg-gradient-to-r from-blue-500 to-purple-500 h-full rounded-full transition-all"
                                style={{ width: `${(item.purchaseInfo.lastTime / item.duration) * 100}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-400">
                              {Math.floor((item.purchaseInfo.lastTime / item.duration) * 100)}%
                            </span>
                          </div>
                        )}

                        {item.description && (
                          <p className="text-gray-500 text-sm line-clamp-2">{item.description}</p>
                        )}
                      </div>

                      <div className="text-right">
                        <div className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent mb-2">
                          ฿{item.purchaseInfo?.amount || item.price}
                        </div>
                        {item.purchaseInfo?.isExpired !== undefined && (
                          <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium border ${
                            !item.purchaseInfo.isExpired
                              ? 'bg-green-500/20 text-green-400 border-green-500/30'
                              : 'bg-red-500/20 text-red-400 border-red-500/30'
                          }`}>
                            {item.purchaseInfo.isExpired ? 'หมดอายุ' : 'ใช้งานได้'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {purchaseHistory.length === 0 && (
                <div className="text-center py-16">
                  <div className="w-20 h-20 bg-slate-800/50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CreditCard className="w-10 h-10 text-gray-600" />
                  </div>
                  <p className="text-gray-400 text-lg font-medium mb-2">ยังไม่มีประวัติการซื้อ</p>
                  <p className="text-gray-500 text-sm">เริ่มซื้อวิดีโอเพื่อดูประวัติการซื้อของคุณ</p>
                </div>
              )}
            </div>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <div className="space-y-8">
              <div>
                <h3 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                  <div className="w-1 h-8 bg-gradient-to-b from-blue-500 to-purple-500 rounded-full" />
                  เปลี่ยนรหัสผ่าน
                </h3>

                <div className="space-y-4 max-w-2xl">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">รหัสผ่านปัจจุบัน</label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={passwordForm.currentPassword}
                        onChange={(e) => setPasswordForm({...passwordForm, currentPassword: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-xl text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all pr-12"
                        placeholder="กรอกรหัสผ่านปัจจุบัน"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                      >
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">รหัสผ่านใหม่</label>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={passwordForm.newPassword}
                      onChange={(e) => setPasswordForm({...passwordForm, newPassword: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-xl text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      placeholder="กรอกรหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">ยืนยันรหัสผ่านใหม่</label>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={passwordForm.confirmPassword}
                      onChange={(e) => setPasswordForm({...passwordForm, confirmPassword: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-xl text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      placeholder="กรอกรหัสผ่านใหม่อีกครั้ง"
                    />
                  </div>

                  <button
                    onClick={handlePasswordChange}
                    disabled={loading}
                    className="px-8 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-xl font-medium transition-all disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-blue-500/20"
                  >
                    {loading ? <Loader className="w-5 h-5 animate-spin" /> : <Lock className="w-5 h-5" />}
                    {loading ? 'กำลังอัพเดท...' : 'อัพเดทรหัสผ่าน'}
                  </button>
                </div>
              </div>

              <div className="pt-8 border-t border-slate-700/50">
                <h4 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-blue-400" />
                  เซสชันที่ใช้งานอยู่
                </h4>
                <div className="space-y-4">
                  {sessions.map((session) => (
                    <div key={session.id} className="bg-slate-800/30 rounded-xl p-5 border border-slate-700/50">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-3">
                            <h5 className="text-white font-medium text-lg">{session.device}</h5>
                            {session.current && (
                              <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-xs font-medium border border-green-500/30">
                                ⚡ กำลังใช้งาน
                              </span>
                            )}
                          </div>
                          <div className="space-y-2 text-sm text-gray-400">
                            <p className="flex items-center gap-2">
                              <MapPin className="w-4 h-4 text-blue-400" />
                              {session.location}
                            </p>
                            <p className="flex items-center gap-2">
                              <Clock className="w-4 h-4 text-purple-400" />
                              ใช้งานล่าสุด: {formatDateTime(session.lastActive)}
                            </p>
                          </div>
                        </div>
                        {!session.current && (
                          <button
                            onClick={() => handleLogoutDevice(session.id)}
                            className="flex items-center gap-2 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-xl transition-all text-sm border border-red-500/30"
                          >
                            <LogOut className="w-4 h-4" />
                            ออกจากระบบ
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Security Tips */}
              <div className="pt-8 border-t border-slate-700/50">
                <h4 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                  <Shield className="w-5 h-5 text-blue-400" />
                  คำแนะนำด้านความปลอดภัย
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-gradient-to-br from-blue-600/10 to-blue-600/5 p-4 rounded-xl border border-blue-500/20">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Lock className="w-5 h-5 text-blue-400" />
                      </div>
                      <div>
                        <h5 className="text-white font-medium mb-1">ใช้รหัสผ่านที่แข็งแรง</h5>
                        <p className="text-gray-400 text-sm">ควรมีอย่างน้อย 8 ตัวอักษร ประกอบด้วยตัวพิมพ์ใหญ่-เล็ก ตัวเลข และสัญลักษณ์</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-purple-600/10 to-purple-600/5 p-4 rounded-xl border border-purple-500/20">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Eye className="w-5 h-5 text-purple-400" />
                      </div>
                      <div>
                        <h5 className="text-white font-medium mb-1">ตรวจสอบกิจกรรม</h5>
                        <p className="text-gray-400 text-sm">ตรวจสอบเซสชันที่ใช้งานอยู่เป็นประจำ และออกจากอุปกรณ์ที่ไม่รู้จัก</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-green-600/10 to-green-600/5 p-4 rounded-xl border border-green-500/20">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Shield className="w-5 h-5 text-green-400" />
                      </div>
                      <div>
                        <h5 className="text-white font-medium mb-1">อย่าแชร์รหัสผ่าน</h5>
                        <p className="text-gray-400 text-sm">ไม่ควรแชร์รหัสผ่านกับผู้อื่น หรือใช้รหัสผ่านเดียวกันหลายเว็บไซต์</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-orange-600/10 to-orange-600/5 p-4 rounded-xl border border-orange-500/20">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-orange-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                        <History className="w-5 h-5 text-orange-400" />
                      </div>
                      <div>
                        <h5 className="text-white font-medium mb-1">เปลี่ยนรหัสผ่านเป็นประจำ</h5>
                        <p className="text-gray-400 text-sm">แนะนำให้เปลี่ยนรหัสผ่านทุก 3-6 เดือน เพื่อความปลอดภัยสูงสุด</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const handleLogoutDevice = (sessionId) => {
  alert(`ออกจากระบบอุปกรณ์: ${sessionId}`);
};

export default UserProfile;