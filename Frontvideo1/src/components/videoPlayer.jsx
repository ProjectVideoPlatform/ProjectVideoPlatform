import React, { useRef, useEffect, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { X, Play } from 'lucide-react';
import videoAnalytics from './VideoTracker';

const WATCH_INTERVAL_SECONDS = 10;

// debounce helper — ใช้แทน lodash เพื่อไม่ต้อง import เพิ่ม
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

const VideoPlayer = ({ manifestUrl, onClose, videoId, userIdRef }) => {
  const videoRef = useRef(null);
  const hlsRef   = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const segmentStartTime     = useRef(null);
  const totalWatchTime       = useRef(0);
  const lastTrackedVideoTime = useRef(0);

    let isSeeking = false;
  // FIX: ไม่ต้องการ userIdRef แยกอีกแล้ว — ใช้ที่ส่งมาจาก parent โดยตรง
  // parent เป็นคนถือ ref → ค่าถูกต้องเสมอ แม้ตอน unmount

  const flushWatchTime = useCallback(() => {
    if (segmentStartTime.current === null) return 0;
    const elapsed = Math.round((Date.now() - segmentStartTime.current) / 1000);
    totalWatchTime.current += elapsed;
    segmentStartTime.current = null;
    return elapsed;
  }, []);

  // FIX: makePayload ไม่อยู่ใน dependency array ของ useEffect หลัก
  // แก้ด้วยการใช้ ref เก็บ makePayload แทน useCallback
  const makePayloadRef = useRef(null);
  makePayloadRef.current = (overrides = {}) => ({
    videoId,
    userId: userIdRef.current,    // อ่านจาก ref ของ parent
    manifestUrl,
    timestamp: new Date().toISOString(),
    totalWatchTime: totalWatchTime.current,
    ...overrides,
  });

  // shorthand สำหรับใช้ใน handlers
  const makePayload = (overrides) => makePayloadRef.current(overrides);

  useEffect(() => {
    if (!manifestUrl || !videoRef.current) return;
    const video = videoRef.current;
let isEnded = false;
    // HLS setup
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = manifestUrl;
    } else if (Hls.isSupported()) {
      const hls = new Hls({ xhrSetup: (xhr) => { xhr.withCredentials = true; } });
      hlsRef.current = hls;
      hls.loadSource(manifestUrl);
      hls.attachMedia(video);
    }


  const handlePlay = () => {
      isEnded = false; // รีเซ็ตสถานะเมื่อเริ่มเล่นใหม่
      segmentStartTime.current = Date.now();
      if (isSeeking) return;
      setIsPlaying(true);
      videoAnalytics.trackVideoEvent(makePayload({
        eventType: 'play',
        currentTime: video.currentTime,
        duration: 0,
      }));
    };
    // VideoPlayer.jsx — handlePause
const handlePause = () => {
      // ✅ ถ้าเป็นเพราะ Seek หรือวิดีโอเพิ่งจบไปหมาดๆ ให้ข้ามการยิง Event pause
      if (isSeeking || isEnded) return;
      
      setIsPlaying(false);
      const elapsed = flushWatchTime();

      videoAnalytics.trackVideoEvent(makePayload({
        eventType: 'pause',
        duration: elapsed,
        currentTime: video.currentTime,
      }));
    };
    const handleSeeking = () => {
      isSeeking = true;
      flushWatchTime();
    };

    const handleSeeked = debounce(() => {
      lastTrackedVideoTime.current = video.currentTime;
      videoAnalytics.trackVideoEvent(makePayload({
        eventType: 'seek',
        currentTime: video.currentTime,
        duration: 0, // <--- เติมบรรทัดนี้ลงไปเพื่อให้ Log สมบูรณ์
      }));
      isSeeking = false;
      if (!video.paused) {
        segmentStartTime.current = Date.now();
        setIsPlaying(true);
      }
    }, 200);

    const handleEnded = () => {
      isEnded = true; // ✅ เซ็ต flag ว่าจบแล้ว เพื่อให้ดัก pause ได้ทัน
      setIsPlaying(false);
      const elapsed = flushWatchTime();
      videoAnalytics.trackVideoEvent(makePayload({
        eventType: 'completed',
        duration: elapsed,
        videoDuration: video.duration,
        currentTime: video.currentTime,
      }));
    };

    const handleTimeUpdate = () => {
      if (video.paused || video.ended || isSeeking) return;
      if (segmentStartTime.current === null) {
        segmentStartTime.current = Date.now();
      }
      const elapsed = video.currentTime - lastTrackedVideoTime.current;
      if (elapsed >= WATCH_INTERVAL_SECONDS) {
        lastTrackedVideoTime.current = video.currentTime;
        videoAnalytics.trackVideoEvent(makePayload({
          eventType: 'watch',
          duration: WATCH_INTERVAL_SECONDS,
          currentTime: video.currentTime,
        }));
      }
    };

    const handleError = () => {
      const err = video.error;
      videoAnalytics.trackVideoEvent(makePayload({
        eventType: 'error',
        errorCode: err?.code,
        errorMessage: err?.message ?? 'Unknown error',
        currentTime: video.currentTime,
      }));
    };

    video.addEventListener('play',       handlePlay);
    video.addEventListener('pause',      handlePause);
    video.addEventListener('seeking',    handleSeeking);
    video.addEventListener('seeked',     handleSeeked);
    video.addEventListener('ended',      handleEnded);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('error',      handleError);

    video.play().catch(() => {});

    return () => {
      video.removeEventListener('play',       handlePlay);
      video.removeEventListener('pause',      handlePause);
      video.removeEventListener('seeking',    handleSeeking);
      video.removeEventListener('seeked',     handleSeeked);
      video.removeEventListener('ended',      handleEnded);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('error',      handleError);

      const elapsed = flushWatchTime();
      videoAnalytics.trackVideoEvent(makePayload({
        eventType: 'close',
        duration: elapsed,
        currentTime: video.currentTime,
      }));

      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  // FIX: dependency array มีแค่ค่าที่เปลี่ยนจริง
  // makePayload ออกจาก deps แล้ว เพราะใช้ ref แทน
  // → useEffect ไม่ re-run เมื่อ parent re-render
  }, [manifestUrl, videoId,flushWatchTime]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center">
      <div className="relative w-full max-w-6xl mx-4">
        <button onClick={onClose} className="absolute -top-12 right-0 text-white hover:text-gray-300">
          <X className="w-6 h-6" />
        </button>
        <div className="aspect-video bg-black rounded-lg overflow-hidden relative">
          <video ref={videoRef} controls className="w-full h-full">
            Your browser does not support HTML5 video.
          </video>
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