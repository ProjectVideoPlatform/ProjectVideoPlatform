import React, { useState, useEffect, useRef } from 'react';
import { Play, Clock, CheckCircle, ArrowLeft, Share2, Download, AlertCircle, ShoppingCart, X } from 'lucide-react';
import { useParams } from 'react-router-dom';
import Hls from 'hls.js';
import { useNavigate } from 'react-router-dom';
// API service (เหมือนกับ VideoStreamingApp)
const API_BASE = 'http://localhost:3000/api';
const api = {
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
    return response.json();
  }
};

// Video Player Component (เหมือนกับ VideoStreamingApp)
const VideoPlayer = ({ manifestUrl, onClose }) => {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);

  useEffect(() => {
    if (!manifestUrl || !videoRef.current) return;

    const loadHls = async () => {
      const video = videoRef.current;
      
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = manifestUrl;
        video.play().catch(() => {});
      } else {
        try {
          
          if (Hls.isSupported()) {
            const hls = new Hls({
              xhrSetup: (xhr) => {
                xhr.withCredentials = true;
              }
            });
            
            hlsRef.current = hls;
            hls.loadSource(manifestUrl);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              video.play().catch(() => {});
            });
          }
        } catch (error) {
          console.error('HLS not supported:', error);
        }
      }
    };

    loadHls();

    return () => {
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
        <div className="aspect-video bg-black rounded-lg overflow-hidden">
          <video 
            ref={videoRef}
            controls
            className="w-full h-full"
          >
            Your browser does not support HTML5 video.
          </video>
        </div>
      </div>
    </div>
  );
};

const VideoDetailPage = () => {
  const navigate = useNavigate();
  const [videoData, setVideoData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [purchasing, setPurchasing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [currentPlayer, setCurrentPlayer] = useState(null);
  
  // Mock video ID - ในการใช้งานจริงจะได้มาจาก useParams
  const videoId = useParams().id;

  // ฟังก์ชันโหลดข้อมูลวิดีโอ
  useEffect(() => {
    const fetchVideoData = async () => {
      try {
        setLoading(true);
        const data = await api.getVideo(videoId);
        setVideoData(data);
      } catch (err) {
        console.error('Error fetching video:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (videoId) {
      fetchVideoData();
    }
  }, [videoId]);

  // Handle Purchase (เหมือนกับ VideoStreamingApp)
  const handlePurchase = async () => {
    if (!videoData?.video?.id && !videoData?.video?._id) return;
    
    setPurchasing(true);
    setActionLoading(true);
    
    try {
      const id = videoData.video.id || videoData.video._id;
      const result = await api.purchaseVideo(id);
      
      alert(`Purchase successful! Amount: $${result.purchase.amount}`);
      
      // รีโหลดข้อมูลวิดีโอเพื่ออัปเดตสถานะ
      const updatedData = await api.getVideo(videoId);
      setVideoData(updatedData);
      
    } catch (error) {
      console.error('Purchase failed:', error);
      alert('Purchase failed: ' + error.message);
    } finally {
      setPurchasing(false);
      setActionLoading(false);
    }
  };

  // Handle Play (เหมือนกับ VideoStreamingApp)
  const handlePlay = async () => {
    if (!videoData?.canPlay) return;
    if (!videoData?.video?.id && !videoData?.video?._id) return;
    
    setActionLoading(true);
    
    try {
      const id = videoData.video.id || videoData.video._id;
      const result = await api.playVideo(id);
      
      setCurrentPlayer({
        video: videoData.video,
        manifestUrl: result.manifestUrl
      });
    } catch (error) {
      console.error('Play failed:', error);
      alert('Playback failed: ' + error.message);
    } finally {
      setActionLoading(false);
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const handleGoBack = () => {
    navigate('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-400">กำลังโหลดวิดีโอ...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-6">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-4">เกิดข้อผิดพลาด</h2>
          <p className="text-gray-400 mb-6">{error}</p>
          <button
            onClick={handleGoBack}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            กลับไปยังรายการวิดีโอ
          </button>
        </div>
      </div>
    );
  }

  if (!videoData || !videoData.video) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-white mb-2">ไม่พบวิดีโอ</h2>
          <p className="text-gray-400">วิดีโอที่คุณต้องการดูไม่มีอยู่ในระบบ</p>
        </div>
      </div>
    );
  }

  const { video, purchased, canPlay, purchaseInfo } = videoData;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-black/20 backdrop-blur-lg border-b border-gray-700">
        <div className="container mx-auto px-4 py-4">
          <button 
            onClick={handleGoBack}
            className="flex items-center text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            กลับไปยังรายการวิดีโอ
          </button>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Video Player Section */}
          <div className="lg:col-span-2">
            <div className="relative rounded-2xl overflow-hidden bg-black shadow-2xl">
              <div className="relative group">
                <img 
                  src={video.thumbnailPath ? `https://cdn.toteja.co/${video.thumbnailPath}original_thumb.0000000.jpg` : 'https://via.placeholder.com/1280x720/1e293b/ffffff?text=Video+Preview'} 
                  alt={video.title}
                  className="w-full aspect-video object-cover"
                  onError={(e) => {
                    e.target.src = 'https://via.placeholder.com/1280x720/1e293b/ffffff?text=No+Preview';
                  }}
                />
                <div className="absolute inset-0 bg-black/40 group-hover:bg-black/30 transition-colors"></div>
                
                {/* Play Button */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <button
                    onClick={handlePlay}
                    disabled={!canPlay || actionLoading}
                    className={`
                      flex items-center justify-center w-20 h-20 rounded-full transition-all duration-300 transform hover:scale-110
                      ${canPlay && !actionLoading
                        ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg hover:shadow-blue-500/25' 
                        : 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      }
                    `}
                  >
                    {actionLoading ? (
                      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-white"></div>
                    ) : (
                      <Play className="w-8 h-8 ml-1" fill="currentColor" />
                    )}
                  </button>
                </div>

                {/* Video Info Overlay */}
                <div className="absolute bottom-4 left-4 right-4">
                  <div className="bg-black/60 backdrop-blur-sm rounded-lg p-3">
                    <div className="flex items-center text-white text-sm space-x-4">
                      <span className="flex items-center">
                        <Clock className="w-4 h-4 mr-1" />
                        {formatDuration(video.duration)}
                      </span>
                      {video.uploadStatus && (
                        <span className={`flex items-center px-2 py-1 rounded text-xs font-medium ${
                          video.uploadStatus === 'completed' ? 'bg-green-600/80 text-green-100' :
                          video.uploadStatus === 'processing' ? 'bg-yellow-600/80 text-yellow-100' :
                          video.uploadStatus === 'failed' ? 'bg-red-600/80 text-red-100' :
                          'bg-blue-600/80 text-blue-100'
                        }`}>
                          {video.uploadStatus === 'completed' ? 'พร้อมดู' :
                           video.uploadStatus === 'processing' ? 'กำลังประมวลผล' :
                           video.uploadStatus === 'failed' ? 'ประมวลผลไม่สำเร็จ' :
                           'กำลังอัปโหลด'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Video Title and Actions */}
            <div className="mt-6">
              <h1 className="text-3xl font-bold text-white mb-4">{video.title}</h1>
              
              <div className="flex flex-wrap items-center gap-4 mb-6">
                <div className="flex items-center text-gray-400">
                  <span>วันที่อัปโหลด:</span>
                  <span className="ml-2 text-blue-400 font-medium">{formatDate(video.createdAt)}</span>
                </div>
                <div className="flex items-center space-x-4">
                  <button className="flex items-center text-gray-400 hover:text-white transition-colors">
                    <Share2 className="w-5 h-5 mr-1" />
                    แชร์
                  </button>
                  {canPlay && (
                    <button className="flex items-center text-gray-400 hover:text-white transition-colors">
                      <Download className="w-5 h-5 mr-1" />
                      ดาวน์โหลด
                    </button>
                  )}
                </div>
              </div>

              {/* Tags */}
              {video.tags && video.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-6">
                  {video.tags.map((tag, index) => (
                    <span 
                      key={index}
                      className="px-3 py-1 bg-blue-600/20 text-blue-400 rounded-full text-sm font-medium border border-blue-600/30"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Description */}
              {video.description && (
                <div className="bg-gray-800/50 rounded-xl p-6">
                  <h3 className="text-lg font-semibold text-white mb-3">รายละเอียด</h3>
                  <p className="text-gray-300 leading-relaxed">{video.description}</p>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1">
            <div className="sticky top-24">
              {/* Purchase Card */}
              <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-6 shadow-2xl border border-gray-700">
                <div className="text-center mb-6">
                  <div className="text-4xl font-bold text-white mb-2">
                    ฿{video.price?.toLocaleString() || 'ฟรี'}
                  </div>
                  <p className="text-gray-400">
                    {video.price > 0 ? 'ซื้อครั้งเดียว ดูได้ตลอดชีวิต' : 'วิดีโอฟรี'}
                  </p>
                </div>

                {purchased ? (
                  <div className="text-center">
                    <div className="flex items-center justify-center text-green-400 mb-4">
                      <CheckCircle className="w-6 h-6 mr-2" />
                      <span className="font-medium">คุณเป็นเจ้าของวิดีโอนี้แล้ว</span>
                    </div>
                    {purchaseInfo && (
                      <div className="text-sm text-gray-400 mb-4">
                        <p>ซื้อเมื่อ: {formatDate(purchaseInfo.purchaseDate)}</p>
                        {purchaseInfo.expiresAt && (
                          <p>หมดอายุ: {formatDate(purchaseInfo.expiresAt)}</p>
                        )}
                      </div>
                    )}
                    <button
                      onClick={handlePlay}
                      disabled={video.uploadStatus !== 'completed' || actionLoading}
                      className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-gray-600 disabled:to-gray-700 text-white py-4 rounded-xl font-bold text-lg transition-all duration-200 transform hover:scale-[1.02] disabled:scale-100 shadow-lg disabled:cursor-not-allowed"
                    >
                      {actionLoading ? (
                        <div className="flex items-center justify-center">
                          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-white mr-2"></div>
                          กำลังโหลด...
                        </div>
                      ) : (
                        <>
                          <Play className="inline w-5 h-5 mr-2" fill="currentColor" />
                          {video.uploadStatus === 'completed' ? 'เริ่มดูวิดีโอ' : 
                           video.uploadStatus === 'processing' ? 'กำลังประมวลผล...' : 'ไม่พร้อมใช้งาน'}
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <div>
                    {video.price > 0 ? (
                      <button
                        onClick={handlePurchase}
                        disabled={purchasing || video.uploadStatus !== 'completed'}
                        className="w-full bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 disabled:from-gray-600 disabled:to-gray-700 text-white py-4 rounded-xl font-bold text-lg transition-all duration-200 transform hover:scale-[1.02] disabled:scale-100 shadow-lg disabled:cursor-not-allowed"
                      >
                        {purchasing ? (
                          <div className="flex items-center justify-center">
                            <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-white mr-2"></div>
                            กำลังดำเนินการ...
                          </div>
                        ) : (
                          <div className="flex items-center justify-center">
                            <ShoppingCart className="w-5 h-5 mr-2" />
                            ซื้อวิดีโอ
                          </div>
                        )}
                      </button>
                    ) : (
                      <button
                        onClick={handlePlay}
                        disabled={video.uploadStatus !== 'completed' || actionLoading}
                        className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-gray-600 disabled:to-gray-700 text-white py-4 rounded-xl font-bold text-lg transition-all duration-200 transform hover:scale-[1.02] disabled:scale-100 shadow-lg disabled:cursor-not-allowed"
                      >
                        {actionLoading ? (
                          <div className="flex items-center justify-center">
                            <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-white mr-2"></div>
                            กำลังโหลด...
                          </div>
                        ) : (
                          <>
                            <Play className="inline w-5 h-5 mr-2" fill="currentColor" />
                            {video.uploadStatus === 'completed' ? 'ดูวิดีโอฟรี' : 
                             video.uploadStatus === 'processing' ? 'กำลังประมวลผล...' : 'ไม่พร้อมใช้งาน'}
                          </>
                        )}
                      </button>
                    )}
                  </div>
                )}

                {/* Features */}
                <div className="mt-6 space-y-3">
                  <div className="flex items-center text-gray-300">
                    <CheckCircle className="w-5 h-5 mr-3 text-green-400" />
                    <span>ดูได้ไม่จำกัดครั้ง</span>
                  </div>
                  <div className="flex items-center text-gray-300">
                    <CheckCircle className="w-5 h-5 mr-3 text-green-400" />
                    <span>คุณภาพ HD</span>
                  </div>
                  <div className="flex items-center text-gray-300">
                    <CheckCircle className="w-5 h-5 mr-3 text-green-400" />
                    <span>สตรีมมิ่งแบบ HLS</span>
                  </div>
                  <div className="flex items-center text-gray-300">
                    <CheckCircle className="w-5 h-5 mr-3 text-green-400" />
                    <span>ดูบนอุปกรณ์ทุกประเภท</span>
                  </div>
                </div>
              </div>

              {/* Stats Card */}
              <div className="bg-gray-800/50 rounded-xl p-4 mt-6">
                <h4 className="font-semibold text-white mb-4">ข้อมูลวิดีโอ</h4>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-gray-400">สถานะ</span>
                    <span className={`font-medium ${
                      video.uploadStatus === 'completed' ? 'text-green-400' :
                      video.uploadStatus === 'processing' ? 'text-yellow-400' :
                      video.uploadStatus === 'failed' ? 'text-red-400' :
                      'text-blue-400'
                    }`}>
                      {video.uploadStatus === 'completed' ? 'พร้อมดู' :
                       video.uploadStatus === 'processing' ? 'กำลังประมวลผล' :
                       video.uploadStatus === 'failed' ? 'ประมวลผลไม่สำเร็จ' :
                       'กำลังอัปโหลด'}
                    </span>
                  </div>
                  {video.duration && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">ความยาว</span>
                      <span className="text-white font-medium">{formatDuration(video.duration)}</span>
                    </div>
                  )}
                  {video.fileSize && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">ขนาดไฟล์</span>
                      <span className="text-white font-medium">
                        {(video.fileSize / (1024 * 1024 * 1024)).toFixed(2)} GB
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-400">วันที่อัปโหลด</span>
                    <span className="text-white font-medium">{formatDate(video.createdAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">อัปเดตล่าสุด</span>
                    <span className="text-white font-medium">{formatDate(video.updatedAt)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Video Player Modal */}
      {currentPlayer && (
        <VideoPlayer 
          manifestUrl={currentPlayer.manifestUrl}
          onClose={() => setCurrentPlayer(null)}
        />
      )}
    </div>
  );
};

export default VideoDetailPage;