import React, { useRef, useEffect, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { X, Play } from 'lucide-react';
import videoAnalytics from './VideoTracker';

const getAdaptiveInterval = (currentTime) => {
  if (currentTime < 60)  return 5;
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

  const seekDestinationTime  = useRef(null);
  const segmentStartTime     = useRef(null);
  const totalWatchTime       = useRef(0);
  const lastTrackedVideoTime = useRef(0);
  const hasSeeked            = useRef(false);
  const isSeekingRef         = useRef(false);
  const isBufferingRef       = useRef(false);
  const isHiddenRef          = useRef(false);
  const isEndedRef           = useRef(false);

  const seekCountRef       = useRef(0);
  const seekTimerRef       = useRef(null);
  const prevTimeRef        = useRef(0);
  const lastWatchTrackedAt = useRef(0);

  // ─── flushWatchTime ────────────────────────────────────────────────────────
  // cap elapsed ด้วย video duration เพื่อกัน wall-clock drift ตอน tab hidden
  const flushWatchTime = useCallback(() => {
    if (segmentStartTime.current === null) return 0;
    const video   = videoRef.current;
    const maxSecs = video?.duration > 0 ? video.duration : Infinity;
    const elapsed = Math.min(
      Math.round((Date.now() - segmentStartTime.current) / 1000),
      maxSecs
    );
    totalWatchTime.current  += elapsed;
    segmentStartTime.current = null;
    return elapsed;
  }, []);

  // ─── makePayload ───────────────────────────────────────────────────────────
  const makePayloadRef = useRef(null);
  makePayloadRef.current = (overrides = {}) => ({
    videoId,
    userId:         userIdRef.current,
    manifestUrl,
    timestamp:      new Date().toISOString(),
    totalWatchTime: totalWatchTime.current,
    ...overrides,
  });
  const makePayload = useCallback(
    (overrides) => makePayloadRef.current(overrides),
    []
  );

  useEffect(() => {
    if (!manifestUrl || !videoRef.current) return;
    const video = videoRef.current;

    // ─── play window helpers ──────────────────────────────────────────────────
    const startPlayWindow = () => {
      segmentStartTime.current   = Date.now();
      lastWatchTrackedAt.current = Date.now();
    };

    const pausePlayWindow = () => {
      flushWatchTime();
      lastWatchTrackedAt.current = 0;
    };

    // ─── buffering helpers ────────────────────────────────────────────────────
    const enterBuffering = () => {
      if (isBufferingRef.current) return;
      isBufferingRef.current = true;
      if (segmentStartTime.current !== null) {
        const video   = videoRef.current;
        const maxSecs = video?.duration > 0 ? video.duration : Infinity;
        const elapsed = Math.min(
          Math.round((Date.now() - segmentStartTime.current) / 1000),
          maxSecs
        );
        totalWatchTime.current  += elapsed;
        segmentStartTime.current = null;
      }
      videoAnalytics.forceFlushChunk();
      lastWatchTrackedAt.current = 0;
    };

    const exitBuffering = () => {
      if (!isBufferingRef.current) return;
      isBufferingRef.current = false;
      if (!video.paused) startPlayWindow();
    };

    // ─── HLS setup ────────────────────────────────────────────────────────────
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = manifestUrl;
    } else if (Hls.isSupported()) {
      const hls = new Hls({ xhrSetup: (xhr) => { xhr.withCredentials = true; } });
      hlsRef.current = hls;
      hls.loadSource(manifestUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.BUFFER_STALLED, enterBuffering);
      hls.on(Hls.Events.FRAG_BUFFERED, () => { exitBuffering(); });
    }

    // ─── visibilitychange ─────────────────────────────────────────────────────
    // ใช้ sendBeacon ตอน tab hidden เพื่อกันข้อมูลหาย
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        isHiddenRef.current = true;
        if (!video.paused) {
          const finalDelta = video.currentTime - lastTrackedVideoTime.current;
          if (finalDelta > 0.5) {
            videoAnalytics.trackVideoEvent(makePayload({
              eventType:   'watch',
              duration:    Math.round(finalDelta),
              currentTime: video.currentTime,
            }));
          }
          lastTrackedVideoTime.current = video.currentTime;
          pausePlayWindow();
          videoAnalytics.trackVideoEvent(makePayload({
            eventType:   'pause',
            currentTime: video.currentTime,
            reason:      'tab_hidden',
          }));
          // flushAndBeacon = push watchChunk เข้า buffer + sendBeacon ทันที
          // กัน race กับ Tracker's own visibilitychange listener
          videoAnalytics.flushAndBeacon();
        } else {
          videoAnalytics.flushAndBeacon();
        }
      } else {
        isHiddenRef.current = false;
        if (!video.paused && !isBufferingRef.current) {
          // ✅ ไม่แตะ lastTrackedVideoTime ตรงนี้
          // lastTracked จัดการโดย timeupdate และ seeked เท่านั้น
          startPlayWindow();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // ─── play ─────────────────────────────────────────────────────────────────
    const handlePlay = () => {
      if (isSeekingRef.current || document.hidden) return;
      isEndedRef.current  = false;
      isHiddenRef.current = false;
      startPlayWindow();
      setIsPlaying(true);
      videoAnalytics.trackVideoEvent(makePayload({
        eventType:   'play',
        currentTime: video.currentTime,
        duration:    0,
      }));
    };

    // ─── pause ────────────────────────────────────────────────────────────────
const handlePause = () => {
  // ✅ block ถ้ายังอยู่ใน seek session (debounce ยังไม่ settle)
  if (isSeekingRef.current || hasSeeked.current) return;
  
  setIsPlaying(false);
  if (isEndedRef.current) {
    isEndedRef.current = false;
    return;
  }
  const finalDelta = video.currentTime - lastTrackedVideoTime.current;
  if (finalDelta > 0.5 && finalDelta < (video.duration ?? Infinity)) {
    videoAnalytics.trackVideoEvent(makePayload({
      eventType:   'watch',
      duration:    Math.round(finalDelta),
      currentTime: video.currentTime,
    }));
  }
  lastTrackedVideoTime.current = video.currentTime;
  pausePlayWindow();
  videoAnalytics.forceFlushChunk();
  videoAnalytics.trackVideoEvent(makePayload({
    eventType:   'pause',
    currentTime: video.currentTime,
  }));
};
    // ─── seeking ──────────────────────────────────────────────────────────────
   const handleSeeking = () => {
  isSeekingRef.current = true;

  if (!hasSeeked.current) {
    // ✅ ครั้งแรกของ seek session — flush และ lock lastTracked
    hasSeeked.current = true;
    pausePlayWindow();
    videoAnalytics.forceFlushChunk();

    const safePreSeek = prevTimeRef.current > 0
      ? prevTimeRef.current
      : lastTrackedVideoTime.current;

    console.log('[SEEKING] safePreSeek =', safePreSeek);
    lastTrackedVideoTime.current = safePreSeek;
  }

  // ✅ prevTime อัปเดตทุกครั้งที่ seeking fire ไม่ขึ้นกับ hasSeeked
  // เพราะต้องการรู้ตำแหน่ง "ล่าสุดก่อน seek settle"
  prevTimeRef.current = video.currentTime;

  seekCountRef.current += 1;
  clearTimeout(seekTimerRef.current);
  seekTimerRef.current = setTimeout(() => {
    seekCountRef.current = 0;
  }, 1_000);
};

    // ─── seeked ───────────────────────────────────────────────────────────────
    const handleSeeked = debounce(() => {
      hasSeeked.current = false;

      // เก็บ destination ก่อนทำอะไร
      seekDestinationTime.current = video.currentTime;

      console.log('[SEEKED] destination saved:', {
        destination:  seekDestinationTime.current,
        lastTracked:  lastTrackedVideoTime.current,
        prevTime:     prevTimeRef.current,
      });

      // flush chunk ที่อาจค้างอยู่
      videoAnalytics.forceFlushChunk();

      // เก็บ fromTime ก่อน overwrite
      const seekFromTime = lastTrackedVideoTime.current;

      // หลัง flush ค่อยอัปเดตด้วย destination
      lastTrackedVideoTime.current = seekDestinationTime.current;
      prevTimeRef.current          = seekDestinationTime.current;
      isSeekingRef.current         = false;

      // reset interval ให้นับใหม่จาก destination
      lastWatchTrackedAt.current   = Date.now();

      const isScrubNoise = seekCountRef.current > 3;
      if (!isScrubNoise) {
        videoAnalytics.trackVideoEvent(makePayload({
          eventType:   'seek',
          fromTime:    seekFromTime,
          currentTime: seekDestinationTime.current,
          duration:    0,
        }));
      }

      if (!video.paused) {
        startPlayWindow();
        setIsPlaying(true);
      }
    }, 300);

    // ─── ended ────────────────────────────────────────────────────────────────
    const handleEnded = () => {
      isEndedRef.current = true;
      setIsPlaying(false);
      pausePlayWindow();
      videoAnalytics.forceFlushChunk();
      videoAnalytics.trackVideoEvent(makePayload({
        eventType:     'completed',
        videoDuration: video.duration,
        currentTime:   video.currentTime,
      }));
    };

    // ─── timeupdate ───────────────────────────────────────────────────────────
    const handleTimeUpdate = () => {
      if (video.paused || video.ended)            return;
      if (isSeekingRef.current)                   return;
      if (isHiddenRef.current || document.hidden) return;

      const currentTime = video.currentTime;
      const timeDiff    = Math.abs(currentTime - prevTimeRef.current);

      // กระโดดเกิน 2s = seeking ที่ยังไม่ถูก flag → set flag แล้ว return
      // ไม่แตะ lastTrackedVideoTime เลย
      if (timeDiff > 2 && prevTimeRef.current > 0) {
        isSeekingRef.current = true;
        prevTimeRef.current  = currentTime;
        return;
      }

      // prevTime อัปเดตได้ปกติ (ใช้โดย handleSeeking เพื่อหา safePreSeek)
      prevTimeRef.current = currentTime;

      if (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        enterBuffering();
        return;
      }
      exitBuffering();

      if (segmentStartTime.current === null) {
        segmentStartTime.current = Date.now();
      }
      if (lastWatchTrackedAt.current === 0) return;

      const wallElapsed     = Date.now() - lastWatchTrackedAt.current;
      const currentInterval = getAdaptiveInterval(currentTime);

      if (wallElapsed >= currentInterval * 1_000) {
        const videoDelta = currentTime - lastTrackedVideoTime.current;

        // delta ต้องเป็นบวก และไม่เกิน duration (กัน drift)
        if (videoDelta <= 0 || videoDelta > (video.duration ?? Infinity)) return;

        console.log('[TIMEUPDATE watch]', {
          currentTime,
          lastTracked: lastTrackedVideoTime.current,
          videoDelta,
        });

        lastWatchTrackedAt.current = Date.now();

        // อัปเดต lastTracked เฉพาะตอน track จริงๆ เท่านั้น
        lastTrackedVideoTime.current = currentTime;

        videoAnalytics.trackVideoEvent(makePayload({
          eventType:   'watch',
          duration:    Math.round(videoDelta),
          currentTime,
        }));
      }
    };

    // ─── error ────────────────────────────────────────────────────────────────
    const handleError = () => {
      const err = video.error;
      videoAnalytics.trackVideoEvent(makePayload({
        eventType:    'error',
        errorCode:    err?.code,
        errorMessage: err?.message ?? 'Unknown error',
        currentTime:  video.currentTime,
      }));
    };

    // ─── attach listeners ─────────────────────────────────────────────────────
    video.addEventListener('play',       handlePlay);
    video.addEventListener('pause',      handlePause);
    video.addEventListener('seeking',    handleSeeking);
    video.addEventListener('seeked',     handleSeeked);
    video.addEventListener('ended',      handleEnded);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('error',      handleError);

    video.play().catch(() => {});

    // ─── cleanup ──────────────────────────────────────────────────────────────
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

      pausePlayWindow();
      // forceFlushChunk → push watchChunk เข้า buffer
      // Tracker จะ sendBeacon buffer ทั้งหมดเองใน beforeunload
      videoAnalytics.forceFlushChunk();
      videoAnalytics.trackVideoEvent(makePayload({
        eventType:   'close',
        currentTime: video.currentTime,
      }));

      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifestUrl, videoId, flushWatchTime, makePayload]);

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