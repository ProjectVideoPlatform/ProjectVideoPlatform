import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Search, 
  Filter, 
  Upload, 
  ShoppingCart, 
  User, 
  Video,
  Clock,
  Tag,
  Eye,
  DollarSign,
  CheckCircle,
  AlertCircle,
  Loader,
  X
} from 'lucide-react';
import Hls from 'hls.js';
// API service matching the backend
const API_BASE = 'http://localhost:3000/api';

const api = {
  getVideos: async (params = {}) => {
    const query = new URLSearchParams(params).toString();
    const response = await fetch(`${API_BASE}/videos?${query}`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
    });
    if (!response.ok) throw new Error('Failed to fetch videos');
    return response.json();
  },
  
  getVideo: async (id) => {
    const response = await fetch(`${API_BASE}/videos/${id}`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
    });
    if (!response.ok) throw new Error('Failed to fetch video');
    return response.json();
  },
  
  purchaseVideo: async (id) => {
    const response = await fetch(`${API_BASE}/videos/${id}/purchase`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) throw new Error('Failed to purchase video');
    return response.json();
  },
  
 
playVideo: async (id) => {
  const response = await fetch(`${API_BASE}/videos/${id}/play`, {
    method: 'POST',
    headers: { 
      'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) throw new Error('Failed to get playback URL');
  const data = await response.json();
  
  // Set CloudFront signed cookies with domain
  if (data.cookies) {
    // document.cookie = `CloudFront-Policy=${data.cookies['CloudFront-Policy']}; path=/;  secure; samesite=none`;
    // document.cookie = `CloudFront-Signature=${data.cookies['CloudFront-Signature']}; path=/;  secure; samesite=none`;
    // document.cookie = `CloudFront-Key-Pair-Id=${data.cookies['CloudFront-Key-Pair-Id']}; path=/;  secure; samesite=none`;
  }
  
  return data;
},
  getPurchasedVideos: async (params = {}) => {
    const query = new URLSearchParams(params).toString();
    const response = await fetch(`${API_BASE}/videos/purchased/list?${query}`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
    });
    if (!response.ok) throw new Error('Failed to fetch purchased videos');
    return response.json();
  },

  // Multi-step upload process matching backend
  initializeUpload: async (videoData) => {
    const response = await fetch(`${API_BASE}/videos/upload/initialize`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(videoData)
    });
    if (!response.ok) throw new Error('Failed to initialize upload');
    return response.json();
  },

  completeUpload: async (videoId) => {
    const response = await fetch(`${API_BASE}/videos/upload/${videoId}/complete`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) throw new Error('Failed to complete upload');
    return response.json();
  },

  failUpload: async (videoId, error) => {
    const response = await fetch(`${API_BASE}/videos/upload/${videoId}/failed`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error })
    });
    if (!response.ok) throw new Error('Failed to record upload failure');
    return response.json();
  }
};

// Video Card Component
const VideoCard = ({ video, onPlay, onPurchase, isLoading }) => {
  const formatDuration = (seconds) => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatPrice = (price) => {
    return price === 0 ? 'Free' : `$${price.toFixed(2)}`;
  };

  const getStatusBadge = (video) => {
    if (video.uploadStatus === 'processing') {
      return (
        <div className="absolute top-2 left-2 bg-yellow-500 text-white text-xs px-2 py-1 rounded flex items-center">
          <Loader className="w-3 h-3 mr-1 animate-spin" />
          Processing
        </div>
      );
    }
    if (video.uploadStatus === 'failed') {
      return (
        <div className="absolute top-2 left-2 bg-red-500 text-white text-xs px-2 py-1 rounded flex items-center">
          <AlertCircle className="w-3 h-3 mr-1" />
          Failed
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">
      {/* Thumbnail */}
      <div className="relative aspect-video bg-gray-900">
          {video.thumbnailPath ? (
    <img
      src={"https://cdn.toteja.co/"+video.thumbnailPath+"original_thumb.0000000.jpg"}
      alt={video.title || "Video thumbnail"}
      className="absolute inset-0 w-full h-full object-cover"
    />
  ) : (
    <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
      <Video className="w-16 h-16 text-gray-600" />
    </div>
  )}
        {video.duration && (
          <div className="absolute bottom-2 right-2 bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded">
            {formatDuration(video.duration)}
          </div>
        )}
        {getStatusBadge(video)}
      </div>
      
      {/* Content */}
      <div className="p-4">
        <h3 className="font-semibold text-lg mb-2 line-clamp-2">{video.title}</h3>
        {video.description && (
          <p className="text-gray-600 text-sm mb-3 line-clamp-3">{video.description}</p>
        )}
        
        {/* Tags */}
        {video.tags && video.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {video.tags.slice(0, 3).map((tag, index) => (
              <span key={index} className="inline-flex items-center px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                <Tag className="w-3 h-3 mr-1" />
                {tag}
              </span>
            ))}
          </div>
        )}
        
        {/* Price and Actions */}
        <div className="flex items-center justify-between">
          <span className="font-bold text-lg text-green-600">
            {formatPrice(video.price)}
          </span>
          
          <div className="flex gap-2">
            {video.uploadStatus === 'completed' && video.canPlay ? (
              <button 
                onClick={() => onPlay(video)}
                disabled={isLoading}
                className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {isLoading ? <Loader className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                Play
              </button>
            ) : video.uploadStatus === 'completed' && !video.canPlay ? (
              <button 
                onClick={() => onPurchase(video)}
                disabled={isLoading}
                className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                {isLoading ? <Loader className="w-4 h-4 animate-spin mr-2" /> : <ShoppingCart className="w-4 h-4 mr-2" />}
                Buy
              </button>
            ) : (
              <span className="text-sm text-gray-500 px-4 py-2">
                {video.uploadStatus === 'processing' ? 'Processing...' : 'Not Available'}
              </span>
            )}
          </div>
        </div>
        
        {/* Purchase Status */}
        {video.purchased && (
          <div className="mt-2 flex items-center text-green-600 text-sm">
            <CheckCircle className="w-4 h-4 mr-1" />
            Owned
            {video.purchaseInfo && (
              <span className="ml-2 text-gray-500">
                • Purchased {new Date(video.purchaseInfo.purchaseDate).toLocaleDateString()}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// Video Player Component
const VideoPlayer = ({ manifestUrl, onClose }) => {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);

  useEffect(() => {
    if (!manifestUrl || !videoRef.current) return;

    const video = videoRef.current;

    // ถ้า browser รองรับ HLS natively (Safari) ใช้งานตรง ๆ
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = manifestUrl;
      video.play().catch(() => {});
    } else if (Hls.isSupported()) {
  const hls = new Hls({
    xhrSetup: (xhr, url) => {
      xhr.withCredentials = true; // ส่ง cookie กับ request
    },
  });

  hlsRef.current = hls;
  hls.loadSource(manifestUrl);
  hls.attachMedia(video);
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    video.play().catch(() => {});
  });
}
else {
      console.error('HLS not supported in this browser');
    }

    return () => {
      // Cleanup HLS instance
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [manifestUrl]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center">
      <div className="relative w-full max-w-6xl mx-4">
        <button 
          onClick={onClose}
          className="absolute -top-12 right-0 text-white hover:text-gray-300"
        >
          <X className="w-6 h-6" />
        </button>
        <div className="aspect-video bg-black rounded-lg overflow-hidden relative">
          <video 
            ref={videoRef}
            controls
            className="w-full h-full"
          >
            Your browser does not support HTML5 video.
          </video>

          {/* Optional overlay */}
          <div className="absolute inset-0 flex items-center justify-center text-white pointer-events-none">
            <div className="text-center">
              <Play className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="opacity-50 text-sm mt-2">HLS Player</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Upload Modal Component
const UploadModal = ({ isOpen, onClose, onUpload }) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    price: 0,
    tags: ''
  });
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState('form'); // 'form', 'uploading', 'processing'

  const handleSubmit = async () => {
    if (!file || !formData.title) return;

    setUploading(true);
    setCurrentStep('uploading');

    try {
      // Step 1: Initialize upload
      const initData = {
        title: formData.title,
        description: formData.description,
        price: formData.price,
        tags: formData.tags,
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type
      };

      const initResult = await api.initializeUpload(initData);
      console.log('Upload initialized:', initResult);

      // Step 2: Upload to S3 using presigned URL
      const uploadFormData = new FormData();
      
      // Add S3 form fields
      if (initResult.fields) {
        Object.entries(initResult.fields).forEach(([key, value]) => {
          uploadFormData.append(key, value);
        });
      }
      
      // Add file last
      uploadFormData.append('file', file);

      // Upload to S3
        const uploadResponse = await fetch(initResult.uploadUrl, {
      method: 'PUT',
      body: file,               // ส่งเฉพาะไฟล์
      headers: {
        'Content-Type': file.type // ต้องตรงกับตอนสร้าง Presigned URL
      }
    });

      if (!uploadResponse.ok) {
        throw new Error('S3 upload failed');
      }

      setUploadProgress(100);

      // Step 3: Complete upload and start processing
      setCurrentStep('processing');
      const completeResult = await api.completeUpload(initResult.videoId);
      console.log('Upload completed:', completeResult);

      // Success
      onUpload();
      onClose();
      resetForm();

    } catch (error) {
      console.error('Upload failed:', error);
      alert('Upload failed: ' + error.message);
      
      // Try to record the failure if we have a video ID
      try {
        if (error.videoId) {
          await api.failUpload(error.videoId, error.message);
        }
      } catch (failError) {
        console.error('Failed to record upload failure:', failError);
      }
    } finally {
      setUploading(false);
      setCurrentStep('form');
      setUploadProgress(0);
    }
  };

  const resetForm = () => {
    setFormData({ title: '', description: '', price: 0, tags: '' });
    setFile(null);
    setUploadProgress(0);
    setCurrentStep('form');
  };

  const handleClose = () => {
    if (!uploading) {
      onClose();
      resetForm();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Upload Video</h2>
          <button 
            onClick={handleClose} 
            disabled={uploading}
            className="text-gray-500 hover:text-gray-700 disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Progress Steps */}
        {uploading && (
          <div className="mb-6">
            <div className="flex justify-between text-sm text-gray-600 mb-2">
              <span className={currentStep === 'uploading' ? 'text-blue-600 font-medium' : ''}>
                Uploading
              </span>
              <span className={currentStep === 'processing' ? 'text-blue-600 font-medium' : ''}>
                Processing
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ 
                  width: currentStep === 'uploading' ? `${uploadProgress}%` : 
                         currentStep === 'processing' ? '100%' : '0%' 
                }}
              />
            </div>
            <p className="text-sm text-gray-600 mt-2">
              {currentStep === 'uploading' && 'Uploading file to server...'}
              {currentStep === 'processing' && 'Starting video processing...'}
            </p>
          </div>
        )}
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Video File *</label>
            <input 
              type="file" 
              accept="video/*"
              onChange={(e) => setFile(e.target.files[0])}
              disabled={uploading}
              className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100"
              required
            />
            {file && (
              <p className="text-xs text-gray-600 mt-1">
                {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
              </p>
            )}
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Title *</label>
            <input 
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({...formData, title: e.target.value})}
              disabled={uploading}
              className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea 
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              disabled={uploading}
              className="w-full px-3 py-2 border rounded-lg h-24 resize-none disabled:bg-gray-100"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Price ($)</label>
            <input 
              type="number"
              min="0"
              step="0.01"
              value={formData.price}
              onChange={(e) => setFormData({...formData, price: parseFloat(e.target.value) || 0})}
              disabled={uploading}
              className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Tags (comma separated)</label>
            <input 
              type="text"
              value={formData.tags}
              onChange={(e) => setFormData({...formData, tags: e.target.value})}
              disabled={uploading}
              placeholder="action, comedy, thriller"
              className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100"
            />
          </div>
          
          <div className="flex gap-2 pt-4">
            <button 
              type="button" 
              onClick={handleClose}
              disabled={uploading}
              className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              {uploading ? 'Uploading...' : 'Cancel'}
            </button>
            <button 
              type="submit" 
              onClick={handleSubmit}
              disabled={uploading || !file || !formData.title}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {uploading ? (
                <Loader className="w-4 h-4 animate-spin mx-auto" />
              ) : (
                'Upload'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Main App Component
const VideoStreamingApp = () => {
  const [videos, setVideos] = useState([]);
  const [purchasedVideos, setPurchasedVideos] = useState([]);
  const [currentView, setCurrentView] = useState('all'); // 'all', 'purchased'
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState({});
  const [currentPlayer, setCurrentPlayer] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isAdmin] = useState(true); // Mock admin status

  // Load videos
  const loadVideos = async (params = {}) => {
    setLoading(true);
    try {
      const result = await api.getVideos({
        page: currentPage,
        limit: 12,
        search: searchQuery,
        category: selectedCategory,
        ...params
      });
      setVideos(result.videos);
      setPagination(result.pagination);
    } catch (error) {
      console.error('Failed to load videos:', error);
    } finally {
      setLoading(false);
    }
  };

  // Load purchased videos
  const loadPurchasedVideos = async () => {
    setLoading(true);
    try {
      const result = await api.getPurchasedVideos({
        page: currentPage,
        limit: 12
      });
      setPurchasedVideos(result.videos);
      setPagination(result.pagination);
    } catch (error) {
      console.error('Failed to load purchased videos:', error);
    } finally {
      setLoading(false);
    }
  };

  // Handle video purchase
  const handlePurchase = async (video) => {
    setActionLoading(video.id);
    try {
      const result = await api.purchaseVideo(video.id);
      alert(`Purchase successful! Amount: $${result.purchase.amount}`);
      // Reload videos to update purchase status
      if (currentView === 'all') {
        loadVideos();
      }
    } catch (error) {
      console.error('Purchase failed:', error);
      alert('Purchase failed: ' + error.message);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle video play
  const handlePlay = async (video) => {
    setActionLoading(video.id);
    try {
      const result = await api.playVideo(video.id);
      setCurrentPlayer({
        video,
        manifestUrl: result.manifestUrl
      });
    } catch (error) {
      console.error('Play failed:', error);
      alert('Playback failed: ' + error.message);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle search
  const handleSearch = () => {
    setCurrentPage(1);
    if (currentView === 'all') {
      loadVideos();
    }
  };

  // Handle view change
  const handleViewChange = (view) => {
    setCurrentView(view);
    setCurrentPage(1);
    setSearchQuery('');
    setSelectedCategory('');
  };

  // Effect for loading data
  useEffect(() => {
    if (currentView === 'all') {
      loadVideos();
    } else {
      loadPurchasedVideos();
    }
  }, [currentView, currentPage]);

  const displayVideos = currentView === 'all' ? videos : purchasedVideos;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <h1 className="text-2xl font-bold text-gray-900">VideoStream</h1>
            
            <div className="flex items-center space-x-4">
              {isAdmin && (
                <button 
                  onClick={() => setShowUploadModal(true)}
                  className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Upload
                </button>
              )}
              <button className="flex items-center px-4 py-2 border rounded-lg hover:bg-gray-50">
                <User className="w-4 h-4 mr-2" />
                Profile
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            <button 
              onClick={() => handleViewChange('all')}
              className={`py-4 px-2 border-b-2 font-medium text-sm ${
                currentView === 'all' 
                  ? 'border-blue-500 text-blue-600' 
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              All Videos
            </button>
            <button 
              onClick={() => handleViewChange('purchased')}
              className={`py-4 px-2 border-b-2 font-medium text-sm ${
                currentView === 'purchased' 
                  ? 'border-blue-500 text-blue-600' 
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              My Videos
            </button>
          </div>
        </div>
      </nav>

      {/* Search and Filters */}
      {currentView === 'all' && (
        <div className="bg-white border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input 
                  type="text"
                  placeholder="Search videos..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <select 
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Categories</option>
                <option value="action">Action</option>
                <option value="comedy">Comedy</option>
                <option value="drama">Drama</option>
                <option value="thriller">Thriller</option>
                <option value="educational">Educational</option>
                <option value="documentary">Documentary</option>
              </select>
              <button 
                type="button"
                onClick={handleSearch}
                disabled={loading}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {loading ? <Loader className="w-4 h-4 animate-spin" /> : 'Search'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : (
          <>
            {/* Video Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-8">
              {displayVideos.map((video) => (
                <VideoCard 
                  key={video.id || video._id}
                  video={video}
                  onPlay={handlePlay}
                  onPurchase={handlePurchase}
                  isLoading={actionLoading === (video.id || video._id)}
                />
              ))}
            </div>

            {/* Pagination */}
            {pagination.pages > 1 && (
              <div className="flex justify-center space-x-2">
                <button 
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1 || loading}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="px-4 py-2">
                  Page {currentPage} of {pagination.pages}
                </span>
                <button 
                  onClick={() => setCurrentPage(Math.min(pagination.pages, currentPage + 1))}
                  disabled={currentPage === pagination.pages || loading}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            )}

            {/* Empty State */}
            {!loading && displayVideos.length === 0 && (
              <div className="text-center py-12">
                <Video className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 text-lg">
                  {currentView === 'purchased' ? 'No purchased videos yet' : 'No videos found'}
                </p>
                <p className="text-gray-500 text-sm mt-2">
                  {currentView === 'purchased' 
                    ? 'Start browsing and purchasing videos to build your library' 
                    : 'Try adjusting your search criteria'
                  }
                </p>
              </div>
            )}
          </>
        )}
      </main>

      {/* Video Player Modal */}
      {currentPlayer && (
        <VideoPlayer 
          manifestUrl={currentPlayer.manifestUrl}
          onClose={() => setCurrentPlayer(null)}
        />
      )}

      {/* Upload Modal */}
      <UploadModal 
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onUpload={() => loadVideos()}
      />
    </div>
  );
};

export default VideoStreamingApp;