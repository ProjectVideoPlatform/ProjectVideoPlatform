import React, { useRef, useEffect, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { X, Play } from 'lucide-react';
import videoAnalytics from './VideoTracker';

const WATCH_INTERVAL_SECONDS = 10;

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

  // ✅ wall clock ref — track ว่ายิง watch event ครั้งล่าสุดเมื่อไหร่
  // ใช้ Date.now() แทน video position เพื่อให้ยิงทุก 10s จริงๆ
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
        // ✅ reset wall clock — ไม่นับช่วง buffer เป็นเวลาดู
        lastWatchTrackedAt.current = 0;
      });

      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        if (!isBufferingRef.current) return;
        isBufferingRef.current = false;
        if (!video.paused) {
          segmentStartTime.current   = Date.now();
          // ✅ reset wall clock เมื่อ buffer หาย — เริ่มนับใหม่
          lastWatchTrackedAt.current = Date.now();
        }
      });
    }

    // ── Visibility tracking ───────────────────────────
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        isHiddenRef.current = true;
        videoAnalytics.forceFlushChunk();
        // ✅ reset wall clock เมื่อ tab hidden
        lastWatchTrackedAt.current = 0;
        const elapsed = flushWatchTime();
        if (elapsed > 0) {
          videoAnalytics.trackVideoEvent(makePayload({
            eventType:   'pause',
            duration:    elapsed,
            currentTime: video.currentTime,
            reason:      'tab_hidden',
          }));
        }
      } else {
        isHiddenRef.current = false;
        if (!document.hidden && !video.paused && !isBufferingRef.current) {
          segmentStartTime.current   = Date.now();
          // ✅ set wall clock เมื่อ user กลับมา
          lastWatchTrackedAt.current = Date.now();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // ── Event handlers ───────────────────────────────

    const handlePlay = () => {
      if (isSeekingRef.current || document.hidden) return;
      isHiddenRef.current      = false;
      segmentStartTime.current = Date.now();
      // ✅ เริ่มนับ wall clock ตอน play
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
      // ✅ reset wall clock ตอน pause
      lastWatchTrackedAt.current = 0;
      const elapsed = flushWatchTime();
      videoAnalytics.trackVideoEvent(makePayload({
        eventType:   'pause',
        duration:    elapsed,
        currentTime: video.currentTime,
      }));
    };

    const handleSeeking = () => {
      isSeekingRef.current = true;
      // ✅ reset wall clock ตอน seek — ไม่งั้น watch event จะยิงทันทีหลัง seek
      lastWatchTrackedAt.current = 0;
      flushWatchTime();

      seekCountRef.current += 1;
      clearTimeout(seekTimerRef.current);
      seekTimerRef.current = setTimeout(() => {
        seekCountRef.current = 0;
      }, 1_000);
    };

    const handleSeeked = debounce(() => {
      const isScrubNoise = seekCountRef.current > 3;
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
        segmentStartTime.current = Date.now();
        // ✅ set wall clock หลัง seek เสร็จ — เริ่มนับใหม่จาก 0
        lastWatchTrackedAt.current = Date.now();
        setIsPlaying(true);
      }
    }, 300);

    const handleEnded = () => {
      setIsPlaying(false);
      lastWatchTrackedAt.current = 0;
      const elapsed = flushWatchTime();
      videoAnalytics.trackVideoEvent(makePayload({
        eventType:     'completed',
        duration:      elapsed,
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

      // ✅ ใช้ wall clock แทน video position delta
      // เดิม: elapsed = currentTime - lastTrackedVideoTime (video position)
      //   → ต้องรอ video เดิน 10s → watch event แรกมาตอน t=10 เสมอ
      //   → chunk มีแค่ event เดียว → start=end → MV filter ออก
      // ใหม่: wallElapsed = Date.now() - lastWatchTrackedAt (wall clock)
      //   → ยิงทุก 10s จริงๆ โดยไม่สนว่า video position อยู่ที่ไหน
      if (lastWatchTrackedAt.current === 0) return; // ยังไม่ได้ play

      // ในฟังก์ชัน handleTimeUpdate
const wallElapsed = Date.now() - lastWatchTrackedAt.current;
if (wallElapsed >= WATCH_INTERVAL_SECONDS * 1000) {
  
  // ✅ เพิ่มบรรทัดนี้: หาว่าวิดีโอขยับไปกี่วินาทีแล้วจริงๆ
  const videoDelta = currentTime - lastTrackedVideoTime.current;

  lastWatchTrackedAt.current   = Date.now();
  lastTrackedVideoTime.current = currentTime;
  
  videoAnalytics.trackVideoEvent(makePayload({
    eventType:   'watch',
    duration:    Math.max(0, videoDelta), // ✅ ส่งค่าที่วิดีโอขยับจริง ไม่ใช่ 10 ตายตัว
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

      const elapsed = flushWatchTime();
      videoAnalytics.trackVideoEvent(makePayload({
        eventType:   'close',
        duration:    elapsed,
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