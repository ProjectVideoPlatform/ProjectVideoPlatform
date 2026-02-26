// VideoPlayer.jsx
import React, { useRef, useEffect, useState } from 'react';
import Hls from 'hls.js';
import { X, Play } from 'lucide-react';
import videoAnalytics from './VideoTracker'; // import analytics

const VideoPlayer = ({ manifestUrl, onClose, videoId, userId }) => {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const watchStartTime = useRef(null);
  const lastTrackedTime = useRef(0);
  const totalWatchTime = useRef(0);
  const analyticsInterval = useRef(null);

  // ติดตาม events ต่างๆ
  useEffect(() => {
    if (!manifestUrl || !videoRef.current) return;

    const video = videoRef.current;

    // Setup HLS
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = manifestUrl;
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        xhrSetup: (xhr, url) => {
          xhr.withCredentials = true;
        },
      });

      hlsRef.current = hls;
      hls.loadSource(manifestUrl);
      hls.attachMedia(video);
    }

    // Event Listeners
    const handlePlay = () => {
      setIsPlaying(true);
      watchStartTime.current = Date.now();
      
      // Track play event
      videoAnalytics.trackVideoEvent({
        videoId,
        eventType: 'play',
        currentTime: video.currentTime,
        manifestUrl
      });

      // เริ่ม interval เพื่อ track การดูทุก 10 วินาที
      if (analyticsInterval.current) {
        clearInterval(analyticsInterval.current);
      }
      
      analyticsInterval.current = setInterval(() => {
        if (video.paused) return;
        
        const currentSeconds = Math.floor(video.currentTime);
        // Track ทุก 10 วินาที
        if (currentSeconds % 10 === 0 && currentSeconds > lastTrackedTime.current) {
          lastTrackedTime.current = currentSeconds;
          
          videoAnalytics.trackVideoEvent({
            videoId,
            eventType: 'watch',
            duration: 10,
            currentTime: video.currentTime,
            manifestUrl
          });
        }
      }, 1000);
    };

    const handlePause = () => {
      setIsPlaying(false);
      const watchDuration = watchStartTime.current ? 
        Math.round((Date.now() - watchStartTime.current) / 1000) : 0;
      
      totalWatchTime.current += watchDuration;
      
      // Track pause event
      videoAnalytics.trackVideoEvent({
        videoId,
        eventType: 'pause',
        duration: watchDuration,
        totalDuration: totalWatchTime.current,
        currentTime: video.currentTime,
        manifestUrl
      });

      if (analyticsInterval.current) {
        clearInterval(analyticsInterval.current);
        analyticsInterval.current = null;
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      
      videoAnalytics.trackVideoEvent({
        videoId,
        eventType: 'completed',
        totalDuration: totalWatchTime.current,
        duration: video.duration,
        currentTime: video.currentTime,
        manifestUrl
      });

      if (analyticsInterval.current) {
        clearInterval(analyticsInterval.current);
        analyticsInterval.current = null;
      }
    };

    const handleSeeked = () => {
      videoAnalytics.trackVideoEvent({
        videoId,
        eventType: 'seek',
        currentTime: video.currentTime,
        manifestUrl
      });
    };

    const handleError = (error) => {
      console.error('Video error:', error);
      videoAnalytics.trackVideoEvent({
        videoId,
        userId,
        eventType: 'error',
        error: error.message || 'Unknown error',
        currentTime: video.currentTime,
        manifestUrl
      });
    };

    // Add event listeners
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('error', handleError);

    // Auto play
    video.play().catch(() => {});

    return () => {
      // Cleanup
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleError);
      
      if (analyticsInterval.current) {
        clearInterval(analyticsInterval.current);
      }

      // Track close event
      if (!video.paused) {
        const watchDuration = watchStartTime.current ? 
          Math.round((Date.now() - watchStartTime.current) / 1000) : 0;
        
        videoAnalytics.trackVideoEvent({
          videoId,
          userId,
          eventType: 'close',
          duration: watchDuration,
          totalDuration: totalWatchTime.current + watchDuration,
          currentTime: video.currentTime,
          manifestUrl
        });
      }

      // Destroy HLS
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [manifestUrl, videoId, userId]);

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

          {/* Overlay - ซ่อนเมื่อเล่นแล้ว */}
          {!isPlaying && (
            <div className="absolute inset-0 flex items-center justify-center text-white pointer-events-none">
              <div className="text-center">
                <Play className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p className="opacity-50 text-sm mt-2">HLS Player</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer;