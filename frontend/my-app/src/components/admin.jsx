import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Search, Users, Video, DollarSign, Activity, Edit, Trash2, Eye, PlayCircle, CheckCircle, AlertCircle, XCircle, Filter, RefreshCw, Loader } from 'lucide-react';

// API Base URL - adjust as needed
const API_BASE = 'http://localhost:3000/api/admin';

const UploadModal = ({ isOpen, onClose, onUpload, Videoja }) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    price: 0,
    tags: ''
  });
  const [uploading, setUploading] = useState(false);

  const handleSubmit = async () => {
    if (!(formData.title || formData.tags || formData.description || formData.price)) return;
    setUploading(true);
    try {
      const uploadData = new FormData();
      uploadData.append('title', formData.title);
      if(formData.description != ''){
        uploadData.append('description', formData.description);
      }
      if (formData.price != 0){
        uploadData.append('price', formData.price);
      }
      if (formData.tags != ''){
        uploadData.append('tags', formData.tags);
      }
      const jsonData = Object.fromEntries(uploadData.entries());
      await api.put(`/videos/${Videoja.id}`, jsonData);
      onUpload();
      onClose();
      setFormData({ title: '', description: '', price: 0, tags: '' });
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Upload Video</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Title</label>
            <input 
              type="text"
              value={formData.title}
              placeholder={Videoja.title}
              onChange={(e) => setFormData({...formData, title: e.target.value})}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea 
              value={formData.description}
              placeholder={Videoja.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              className="w-full px-3 py-2 border rounded-lg h-24 resize-none"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Price ($)</label>
            <input 
              type="number"
              step="1"
              value={formData.price}
              onChange={(e) => setFormData({...formData, price: parseFloat(e.target.value) || 0})}
              placeholder={Videoja.price}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Tags (comma separated)</label>
            <input 
              type="text"
              value={formData.tags}
              onChange={(e) => setFormData({...formData, tags: e.target.value})}
              placeholder={Videoja.tags}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          
          <div className="flex gap-2 pt-4">
            <button 
              type="button" 
              onClick={onClose}
              className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              onClick={handleSubmit}
              disabled={uploading || !(formData.title||formData.price||formData.tags||formData.description)}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {uploading ? <Loader className="w-4 h-4 animate-spin mx-auto" /> : 'Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const api = {
  get: async (endpoint) => {
    const AUTH_TOKEN = localStorage.getItem("authToken");
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` },     credentials: 'include'
    });
    if (!response.ok) throw new Error('API call failed');
    return response.json();
  },
  put: async (endpoint, data = {}) => {
    const AUTH_TOKEN = localStorage.getItem("authToken");
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json'
      },
           credentials: 'include',
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('API call failed');
    return response.json();
  },
  delete: async (endpoint) => {
    const AUTH_TOKEN = localStorage.getItem("authToken");
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${AUTH_TOKEN}`
       },
            credentials: 'include'
    });
    if (!response.ok) throw new Error('API call failed');
    return response.json();
  },
  post: async (endpoint, data = {}) => {
    const AUTH_TOKEN = localStorage.getItem("authToken");
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json',
        
      },
           credentials: 'include',
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('API call failed');
    return response.json();
  }
};

const AdminDashboard = () => {
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dashboardStats, setDashboardStats] = useState(null);
  const [videos, setVideos] = useState([]);
  const [users, setUsers] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(false);
  const [videosLoading, setVideosLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [purchasesLoading, setPurchasesLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({
    status: '',
    role: '',
    page: 1,
    limit: 20
  });
  const [Videoja, setVideo] = useState({});

  // Fetch dashboard stats
  const fetchDashboardStats = async () => {
    try {
      setLoading(true);
      const data = await api.get('/dashboard/stats');
      setDashboardStats(data);
    } catch (err) {
      setError('Failed to fetch dashboard stats');
    } finally {
      setLoading(false);
    }
  };

  // Fetch videos
  const fetchVideos = async () => {
    try {
      setVideosLoading(true);
      const queryParams = new URLSearchParams({
        page: filters.page,
        limit: filters.limit,
        ...(filters.status && { status: filters.status }),
        ...(searchTerm && { search: searchTerm })
      });
      const data = await api.get(`/videos?${queryParams}`);
      setVideos(data.videos || []);
    } catch (err) {
      setError('Failed to fetch videos');
    } finally {
      setVideosLoading(false);
    }
  };

  // Fetch users
  const fetchUsers = async () => {
    try {
      setUsersLoading(true);
      const queryParams = new URLSearchParams({
        page: filters.page,
        limit: filters.limit,
        ...(filters.role && { role: filters.role }),
        ...(searchTerm && { search: searchTerm })
      });
      const data = await api.get(`/users?${queryParams}`);
      setUsers(data.users || []);
    } catch (err) {
      setError('Failed to fetch users');
    } finally {
      setUsersLoading(false);
    }
  };

  // Fetch purchases
  const fetchPurchases = async () => {
    try {
      setPurchasesLoading(true);
      const data = await api.get('/purchases');
      setPurchases(data.purchases || []);
    } catch (err) {
      setError('Failed to fetch purchases');
    } finally {
      setPurchasesLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'dashboard') fetchDashboardStats();
    else if (activeTab === 'videos') fetchVideos();
    else if (activeTab === 'users') fetchUsers();
    else if (activeTab === 'purchases') fetchPurchases();
  }, [activeTab, filters]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeTab === 'videos') fetchVideos();
      else if (activeTab === 'users') fetchUsers();
    }, 500);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Status badge component
  const StatusBadge = ({ status }) => {
    const statusConfig = {
      completed: { color: 'bg-green-100 text-green-800', icon: CheckCircle },
      processing: { color: 'bg-yellow-100 text-yellow-800', icon: Activity },
      failed: { color: 'bg-red-100 text-red-800', icon: XCircle },
      pending: { color: 'bg-blue-100 text-blue-800', icon: AlertCircle }
    };

    const config = statusConfig[status] || statusConfig.pending;
    const Icon = config.icon;

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.color}`}>
        <Icon className="w-3 h-3 mr-1" />
        {status}
      </span>
    );
  };

  // Dashboard component
  const Dashboard = () => (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
      
      {dashboardStats && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <Video className="h-6 w-6 text-gray-400" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Total Videos</dt>
                      <dd className="text-lg font-medium text-gray-900">{dashboardStats.stats.totalVideos}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <Users className="h-6 w-6 text-gray-400" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Total Users</dt>
                      <dd className="text-lg font-medium text-gray-900">{dashboardStats.stats.totalUsers}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <DollarSign className="h-6 w-6 text-gray-400" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Total Revenue</dt>
                      <dd className="text-lg font-medium text-gray-900">${dashboardStats.stats.totalRevenue.toFixed(2)}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <Activity className="h-6 w-6 text-gray-400" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Total Purchases</dt>
                      <dd className="text-lg font-medium text-gray-900">{dashboardStats.stats.totalPurchases}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {dashboardStats.trends.revenue && (
            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Revenue Trend (Last 30 Days)</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={dashboardStats.trends.revenue}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="_id.day" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="revenue" stroke="#3B82F6" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );

  // Videos component
  const Videos = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Videos</h1>
        <button
          onClick={fetchVideos}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search videos..."
            value={searchTerm}
            autoFocus
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
        <select
          value={filters.status}
          onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
          className="px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
        >
          <option value="">All Status</option>
          <option value="completed">Completed</option>
          <option value="processing">Processing</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        {videosLoading ? (
          <div className="px-4 py-12 text-center">
            <Loader className="w-8 h-8 animate-spin mx-auto text-indigo-600" />
            <p className="mt-2 text-sm text-gray-500">Loading videos...</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {videos.map((video) => (
              <li key={video._id}>
                <div className="px-4 py-4 flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 h-10 w-10">
                      <PlayCircle className="h-10 w-10 text-gray-400" />
                    </div>
                    <div className="ml-4">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-900">{video.title}</p>
                        <StatusBadge status={video.uploadStatus} />
                      </div>
                      <p className="text-sm text-gray-500">ID: {video.id}</p>
                      <p className="text-sm text-gray-500">${video.price} • {video.purchaseCount} purchases</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button className="text-indigo-600 hover:text-indigo-900">
                      <Eye className="h-4 w-4" />
                    </button>
                    <button 
                      className="text-indigo-600 hover:text-indigo-900"
                      onClick={() => {
                        setVideo(video);
                        setShowUploadModal(true);
                      }}
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button 
                      className="text-red-600 hover:text-red-900"
                      onClick={async () => {
                        if (confirm("คุณแน่ใจว่าจะลบวิดีโอนี้?")) {
                          await api.delete(`/videos/${video.id}`);
                          setVideos(videos.filter(v => v.id !== video.id));
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  // Users component
  const Usersja = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Users</h1>
        <button
          onClick={fetchUsers}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search users by email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
        <select
          value={filters.role}
          onChange={(e) => setFilters(prev => ({ ...prev, role: e.target.value }))}
          className="px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
        >
          <option value="">All Roles</option>
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        {usersLoading ? (
          <div className="px-4 py-12 text-center">
            <Loader className="w-8 h-8 animate-spin mx-auto text-indigo-600" />
            <p className="mt-2 text-sm text-gray-500">Loading users...</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {users.map((user) => (
              <li key={user._id}>
                <div className="px-4 py-4 flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 h-10 w-10">
                      <div className="h-10 w-10 rounded-full bg-gray-300 flex items-center justify-center">
                        <Users className="h-6 w-6 text-gray-600" />
                      </div>
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-900">{user.email}</p>
                      <p className="text-sm text-gray-500">Role: {user.role}</p>
                      <p className="text-sm text-gray-500">
                        ${user.stats.totalSpent.toFixed(2)} spent • {user.stats.totalPurchases} purchases
                      </p>
                    </div>
                  </div>
                  <div className="text-sm text-gray-500">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  // Purchases component
  const Purchases = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Purchases</h1>
        <button
          onClick={fetchPurchases}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </button>
      </div>

      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        {purchasesLoading ? (
          <div className="px-4 py-12 text-center">
            <Loader className="w-8 h-8 animate-spin mx-auto text-indigo-600" />
            <p className="mt-2 text-sm text-gray-500">Loading purchases...</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {purchases.map((purchase) => (
              <li key={purchase._id}>
                <div className="px-4 py-4 flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 h-10 w-10">
                      <DollarSign className="h-10 w-10 text-green-600" />
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-900">
                        {purchase.videoId?.title || 'Unknown Video'}
                      </p>
                      <p className="text-sm text-gray-500">
                        {purchase.userId?.email || 'Unknown User'}
                      </p>
                      <p className="text-sm text-gray-500">${purchase.amount}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <StatusBadge status={purchase.status} />
                    <p className="text-sm text-gray-500 mt-1">
                      {new Date(purchase.purchaseDate).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart },
    { id: 'videos', label: 'Videos', icon: Video },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'purchases', label: 'Purchases', icon: DollarSign }
  ];

  return (
    <div className="min-h-screen bg-gray-100 pt-18">
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <h1 className="text-xl font-bold text-gray-900">Admin Panel</h1>
              </div>
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`${
                        activeTab === tab.id
                          ? 'border-indigo-500 text-gray-900'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      } whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm inline-flex items-center`}
                    >
                      <Icon className="w-4 h-4 mr-2" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {error && (
            <div className="mb-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {activeTab === 'dashboard' && <Dashboard />}
          {activeTab === 'videos' && <Videos />}
          {activeTab === 'users' && <Usersja />}
          {activeTab === 'purchases' && <Purchases />}
          
          <UploadModal 
            isOpen={showUploadModal}
            onClose={() => setShowUploadModal(false)}
            onUpload={fetchVideos}
            Videoja={Videoja}
          />
        </div>
      </main>
    </div>
  );
};

export default AdminDashboard;