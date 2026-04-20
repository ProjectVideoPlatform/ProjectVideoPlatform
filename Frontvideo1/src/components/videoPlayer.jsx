import React, { useRef, useEffect, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { X, Play } from 'lucide-react';
import videoAnalytics from './VideoTracker';

const getAdaptiveInterval = (currentTime) => {
  if (currentTime < 60) return 5;
  if (currentTime < 300) return 10;
  return 30;
};

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

  const isSeekingRef   = useRef(false);
  const isBufferingRef = useRef(false);
  const isHiddenRef    = useRef(false);
  const seekCountRef   = useRef(0);
  const seekTimerRef   = useRef(null);
  const prevTimeRef    = useRef(0);

  const lastWatchTrackedAt = useRef(0);

  const flushWatchTime = useCallback(() => {
    if (segmentStartTime.current === null) return 0;
    const elapsed = Math.round((Date.now() - segmentStartTime.current) / 1000);
    totalWatchTime.current += elapsed;
    segmentStartTime.current = null;
    return elapsed;
  }, []);

  const makePayloadRef = useRef(null);
  makePayloadRef.current = (overrides = {}) => ({
    videoId,
    userId:         userIdRef.current,
    manifestUrl,
    timestamp:      new Date().toISOString(),
    totalWatchTime: totalWatchTime.current,
    ...overrides,
  });

  const makePayload = (overrides) => makePayloadRef.current(overrides);

  useEffect(() => {
    if (!manifestUrl || !videoRef.current) return;
    const video = videoRef.current;

    // ── HLS setup ────────────────────────────────────
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = manifestUrl;
    } else if (Hls.isSupported()) {
      const hls = new Hls({ xhrSetup: (xhr) => { xhr.withCredentials = true; } });
      hlsRef.current = hls;
      hls.loadSource(manifestUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.BUFFER_STALLED, () => {
        isBufferingRef.current = true;
        if (segmentStartTime.current !== null) {
          const elapsed = Math.round((Date.now() - segmentStartTime.current) / 1000);
          totalWatchTime.current  += elapsed;
          segmentStartTime.current = null;
        }
        videoAnalytics.forceFlushChunk();
        lastWatchTrackedAt.current = 0;
      });

      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        if (!isBufferingRef.current) return;
        isBufferingRef.current = false;
        if (!video.paused) {
          segmentStartTime.current   = Date.now();
          lastWatchTrackedAt.current = Date.now();
        }
      });
    }

    // ── Visibility tracking ───────────────────────────
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        isHiddenRef.current = true;
        videoAnalytics.forceFlushChunk();
        lastWatchTrackedAt.current = 0;

        if (!video.paused) {
          flushWatchTime();
          videoAnalytics.trackVideoEvent(makePayload({
            eventType:   'pause',
            currentTime: video.currentTime,
            reason:      'tab_hidden',
          }));
        }
      } else {
        isHiddenRef.current = false;
        if (!document.hidden && !video.paused && !isBufferingRef.current) {
          segmentStartTime.current   = Date.now();
          lastWatchTrackedAt.current = Date.now();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // ── Event handlers ───────────────────────────────

    const handlePlay = () => {
      if (isSeekingRef.current || document.hidden) return;
      isHiddenRef.current        = false;
      segmentStartTime.current   = Date.now();
      lastWatchTrackedAt.current = Date.now();
      setIsPlaying(true);
      videoAnalytics.trackVideoEvent(makePayload({
        eventType:   'play',
        currentTime: video.currentTime,
        duration:    0,
      }));
    };

    const handlePause = () => {
      if (isSeekingRef.current) return;
      setIsPlaying(false);

      // แก้ไข #1: ลบ finalDelta watch event ออก
      // เดิมทำให้นับเวลาซ้ำซ้อนกับ flushWatchTime() ด้านล่าง
      // forceFlushChunk() จัดการ flush chunk ที่ค้างอยู่อยู่แล้ว

      lastWatchTrackedAt.current   = 0;
      lastTrackedVideoTime.current = video.currentTime;

      flushWatchTime();
      videoAnalytics.forceFlushChunk();

      videoAnalytics.trackVideoEvent(makePayload({
        eventType:   'pause',
        currentTime: video.currentTime,
      }));
    };

    const handleSeeking = () => {
      isSeekingRef.current = true;
      lastWatchTrackedAt.current = 0;

      // แก้ไข #2: บันทึก position ก่อน seek ทันที เพื่อป้องกัน chunk window พองเกิน
      lastTrackedVideoTime.current = video.currentTime;

      flushWatchTime();

      if (videoAnalytics && typeof videoAnalytics.forceFlushChunk === 'function') {
        videoAnalytics.forceFlushChunk();
      }

      seekCountRef.current += 1;
      clearTimeout(seekTimerRef.current);
      seekTimerRef.current = setTimeout(() => {
        seekCountRef.current = 0;
      }, 1_000);
    };

    const handleSeeked = debounce(() => {
      const isScrubNoise = seekCountRef.current > 3;

      // รีเซ็ต position หลัง seek เสร็จ (เปิด window ใหม่จากตำแหน่งหลัง seek)
      lastTrackedVideoTime.current = video.currentTime;

      if (!isScrubNoise) {
        videoAnalytics.trackVideoEvent(makePayload({
          eventType:   'seek',
          currentTime: video.currentTime,
          duration:    0,
        }));
      }

      isSeekingRef.current = false;
      if (!video.paused) {
        segmentStartTime.current   = Date.now();
        lastWatchTrackedAt.current = Date.now();
        setIsPlaying(true);
      }
    }, 300);

    const handleEnded = () => {
      setIsPlaying(false);
      lastWatchTrackedAt.current = 0;

      flushWatchTime();

      if (videoAnalytics && typeof videoAnalytics.forceFlushChunk === 'function') {
        videoAnalytics.forceFlushChunk();
      }

      videoAnalytics.trackVideoEvent(makePayload({
        eventType:     'completed',
        videoDuration: video.duration,
        currentTime:   video.currentTime,
      }));
    };

    const handleTimeUpdate = () => {
      if (video.paused || video.ended) return;
      if (isSeekingRef.current) return;
      if (isHiddenRef.current || document.hidden) return;

      const currentTime = video.currentTime;

      // ── Spike filtering ──────────────────────────────
      const timeDiff = Math.abs(currentTime - prevTimeRef.current);
      if (timeDiff > 10 && prevTimeRef.current > 0) {
        segmentStartTime.current     = Date.now();
        lastTrackedVideoTime.current = currentTime;
        prevTimeRef.current          = currentTime;
        return;
      }
      prevTimeRef.current = currentTime;

      // ── Buffering fallback (readyState) ─────────────
      if (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        if (!isBufferingRef.current) {
          isBufferingRef.current = true;
          if (segmentStartTime.current !== null) {
            const elapsed = Math.round((Date.now() - segmentStartTime.current) / 1000);
            totalWatchTime.current  += elapsed;
            segmentStartTime.current = null;
          }
          videoAnalytics.forceFlushChunk();
          lastWatchTrackedAt.current = 0;
        }
        return;
      } else if (isBufferingRef.current) {
        isBufferingRef.current     = false;
        segmentStartTime.current   = Date.now();
        lastWatchTrackedAt.current = Date.now();
      }

      if (segmentStartTime.current === null) {
        segmentStartTime.current = Date.now();
      }

      if (lastWatchTrackedAt.current === 0) return;

      const wallElapsed     = Date.now() - lastWatchTrackedAt.current;
      const currentInterval = getAdaptiveInterval(currentTime);

      if (wallElapsed >= currentInterval * 1000) {
        // แก้ไข #3: ส่ง videoDelta จริงๆ แทน currentInterval
        // เพื่อสะท้อนระยะวิดีโอที่ขยับจริง (ถูกต้องกว่าเมื่อ playback rate เปลี่ยน)
        const videoDelta = currentTime - lastTrackedVideoTime.current;

        lastWatchTrackedAt.current   = Date.now();
        lastTrackedVideoTime.current = currentTime;

        videoAnalytics.trackVideoEvent(makePayload({
          eventType:   'watch',
          duration:    Math.round(videoDelta), // ใช้ค่าจริงจาก video position
          currentTime: currentTime,
        }));
      }
    };

    const handleError = () => {
      const err = video.error;
      videoAnalytics.trackVideoEvent(makePayload({
        eventType:    'error',
        errorCode:    err?.code,
        errorMessage: err?.message ?? 'Unknown error',
        currentTime:  video.currentTime,
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
      document.removeEventListener('visibilitychange', handleVisibility);
      clearTimeout(seekTimerRef.current);

      flushWatchTime();

      if (videoAnalytics && typeof videoAnalytics.forceFlushChunk === 'function') {
        videoAnalytics.forceFlushChunk();
      }

      videoAnalytics.trackVideoEvent(makePayload({
        eventType:   'close',
        currentTime: video.currentTime,
      }));

      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [manifestUrl, videoId, flushWatchTime]);

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