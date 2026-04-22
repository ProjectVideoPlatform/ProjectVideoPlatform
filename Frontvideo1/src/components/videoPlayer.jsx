// VideoPlayer.jsx — Analytics fixed + Progress restore/save (purchased videos only)
import React, { useRef, useEffect, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { X, Play } from 'lucide-react';
import videoAnalytics from './VideoTracker';
import { fetchVideoProgress, saveVideoProgress } from './services/videoProgress';

const getAdaptiveInterval = (t) => t < 60 ? 5 : t < 300 ? 10 : 30;
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

function getOrCreateSessionId() {
  let s = sessionStorage.getItem('video_session_id');
  if (!s) { s = crypto.randomUUID(); sessionStorage.setItem('video_session_id', s); }
  return s;
}
function newEventId() { return crypto.randomUUID(); }

const playerStyles = `
  .vp-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,.93);
    z-index: 300;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    font-family: 'DM Sans', sans-serif;
  }
  .vp-topbar {
    width: 100%; max-width: 1100px;
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 16px 8px; flex-shrink: 0;
  }
  .vp-label { font-size: 12px; font-weight: 500; letter-spacing: .5px; text-transform: uppercase; color: rgba(255,255,255,.4); }
  .vp-close {
    width: 40px; height: 40px; border-radius: 50%;
    background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.15);
    color: #fff; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background .2s, transform .15s;
  }
  .vp-close:hover { background: rgba(232,68,90,.75); transform: scale(1.08); }
  .vp-body {
    width: 100%; max-width: 1100px;
    padding: 0 12px; flex: 1;
    display: flex; align-items: center;
    max-height: calc(100vh - 140px);
  }
  @media (max-width: 640px) { .vp-body { max-height: calc(100vh - 180px); } }
  .vp-box {
    width: 100%; aspect-ratio: 16/9;
    background: #000; border-radius: 14px; overflow: hidden;
    position: relative;
    box-shadow: 0 28px 70px rgba(0,0,0,.85);
    border: 1px solid rgba(255,255,255,.06);
  }
  .vp-box video { width: 100%; height: 100%; display: block; }
  .vp-idle {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    pointer-events: none; transition: opacity .25s;
  }
  .vp-idle.gone { opacity: 0; }
  .vp-play-circle {
    width: 68px; height: 68px; border-radius: 50%;
    background: rgba(232,68,90,.85);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 6px 28px rgba(232,68,90,.55);
  }
  .vp-spacer { height: 10px; flex-shrink: 0; }
  @media (max-width: 640px) { .vp-spacer { height: 76px; } }
`;

function getBufferedRanges(video) {
  if (!video?.buffered) return [];
  const ranges = [];
  for (let i = 0; i < video.buffered.length; i++) {
    ranges.push({ start: video.buffered.start(i), end: video.buffered.end(i) });
  }
  return ranges;
}

const PROGRESS_SAVE_INTERVAL_SEC = 10;

const VideoPlayer = ({ manifestUrl, onClose, videoId, userIdRef, videoCategory }) => {
  const videoRef        = useRef(null);
  const hlsRef          = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const segmentStartTime      = useRef(null);
  const totalWatchTime        = useRef(0);
  const lastTrackedVideoTime  = useRef(0);
  const lastWatchTrackedAt    = useRef(0);

  const hasSeeked       = useRef(false);
  const isSeekingRef    = useRef(false);
  const seekCountRef    = useRef(0);
  const seekTimerRef    = useRef(null);
  const prevTimeRef     = useRef(0);

  const isBufferingRef  = useRef(false);
  const bufferStartTime = useRef(null);
  const isHiddenRef     = useRef(false);
  const isEndedRef      = useRef(false);

  const sessionId       = useRef(getOrCreateSessionId());

  // Progress (purchased only)
  const isOwnedRef            = useRef(false);
  const lastSavedProgressTime = useRef(-1);
  const progressSaveTimer     = useRef(null);

  const flushWatchTime = useCallback(() => {
    if (segmentStartTime.current === null) return 0;
    const v = videoRef.current;
    const maxSecs = v?.duration > 0 ? v.duration : Infinity;
    const elapsed = Math.min(Math.round((Date.now() - segmentStartTime.current) / 1000), maxSecs);
    totalWatchTime.current += elapsed;
    segmentStartTime.current = null;
    return elapsed;
  }, []);

  const makePayloadRef = useRef(null);
  makePayloadRef.current = (o = {}) => ({
    event_id:            newEventId(),
    session_id:          sessionId.current,
    videoId,
    userId:              userIdRef.current,
      video_category:      videoCategory || undefined,   // ← เพิ่ม
    timestamp:           new Date().toISOString(),
    total_watch_seconds: totalWatchTime.current,
    ...o,
  });
  const makePayload = useCallback((o) => makePayloadRef.current(o), []);

  // ─── Progress save (purchased only) ──────────────────────────────────────
  const scheduleSaveProgress = useCallback((currentTime, immediate = false) => {
    if (!isOwnedRef.current) return;

    const doSave = () => {
      const t = Math.floor(currentTime);
      if (Math.abs(t - lastSavedProgressTime.current) >= PROGRESS_SAVE_INTERVAL_SEC) {
        lastSavedProgressTime.current = t;
        saveVideoProgress(videoId, t); // fire-and-forget
      }
    };

    clearTimeout(progressSaveTimer.current);
    if (immediate) {
      doSave();
    } else {
      progressSaveTimer.current = setTimeout(doSave, 3000);
    }
  }, [videoId]);

  // ─── Progress restore on mount ───────────────────────────────────────────
  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;

    fetchVideoProgress(videoId).then((result) => {
      if (cancelled || !result) return;

      // owned: false → free / admin → ไม่ restore ไม่ save
      if (!result.owned) { isOwnedRef.current = false; return; }

      isOwnedRef.current = true;
      const savedTime = result.lastTime || 0;
      if (savedTime <= 5 || !videoRef.current) return;

      const applyTime = () => {
        if (cancelled || !videoRef.current) return;
        videoRef.current.currentTime = savedTime;
        lastSavedProgressTime.current = savedTime;
        lastTrackedVideoTime.current  = savedTime;
        prevTimeRef.current           = savedTime;
        console.log(`[Progress] Restored: ${savedTime}s`);
        videoAnalytics.trackVideoEvent(makePayload({
          eventType:            'resume',
          current_time_seconds: savedTime,
        }));
      };

      if (videoRef.current.readyState >= HTMLMediaElement.HAVE_METADATA) {
        applyTime();
      } else {
        videoRef.current.addEventListener('loadedmetadata', applyTime, { once: true });
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(progressSaveTimer.current);
    };
  }, [videoId, makePayload]);

  // ─── Main video events ────────────────────────────────────────────────────
  useEffect(() => {
    if (!manifestUrl || !videoRef.current) return;
    const video = videoRef.current;

    const startPlayWindow = () => {
      segmentStartTime.current = Date.now();
      lastWatchTrackedAt.current = Date.now();
    };
    const pausePlayWindow = () => {
      flushWatchTime();
      lastWatchTrackedAt.current = 0;
    };

    const enterBuffering = () => {
      if (isBufferingRef.current) return;
      isBufferingRef.current = true;
      bufferStartTime.current = Date.now();
      videoAnalytics.trackVideoEvent(makePayload({
        eventType:            'buffer_start',
        current_time_seconds: video?.currentTime ?? 0,
        buffered_ranges:      getBufferedRanges(video),
      }));
      if (segmentStartTime.current !== null) {
        const maxSecs = video?.duration > 0 ? video.duration : Infinity;
        totalWatchTime.current += Math.min(Math.round((Date.now() - segmentStartTime.current) / 1000), maxSecs);
        segmentStartTime.current = null;
      }
      videoAnalytics.forceFlushChunk();
      lastWatchTrackedAt.current = 0;
    };

    const exitBuffering = () => {
      if (!isBufferingRef.current) return;
      isBufferingRef.current = false;
      videoAnalytics.trackVideoEvent(makePayload({
        eventType:            'buffer_end',
        current_time_seconds: video?.currentTime ?? 0,
        buffer_duration_ms:   bufferStartTime.current ? Date.now() - bufferStartTime.current : 0,
      }));
      bufferStartTime.current = null;
      if (!video.paused) startPlayWindow();
    };

    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = manifestUrl;
    } else if (Hls.isSupported()) {
      const hls = new Hls({ xhrSetup: (xhr) => { xhr.withCredentials = true; } });
      hlsRef.current = hls;
      hls.loadSource(manifestUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.BUFFER_STALLED, enterBuffering);
      hls.on(Hls.Events.FRAG_BUFFERED, () => exitBuffering());
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        isHiddenRef.current = true;
        if (!video.paused) {
          const d = video.currentTime - lastTrackedVideoTime.current;
          if (d > 0.5) {
            videoAnalytics.trackVideoEvent(makePayload({
              eventType:            'watch_chunk',
              chunk_start_seconds:  Math.round(lastTrackedVideoTime.current),
              chunk_end_seconds:    Math.round(video.currentTime),
              duration:             Math.round(d),
              current_time_seconds: Math.round(video.currentTime),
            }));
          }
          lastTrackedVideoTime.current = video.currentTime;
          pausePlayWindow();
          videoAnalytics.trackVideoEvent(makePayload({
            eventType:            'tab_hide',
            current_time_seconds: Math.round(video.currentTime),
            reason:               'tab_hidden',
          }));
          scheduleSaveProgress(video.currentTime, true);
          videoAnalytics.flushAndBeacon();
        } else {
          scheduleSaveProgress(video.currentTime, true);
          videoAnalytics.flushAndBeacon();
        }
      } else {
        isHiddenRef.current = false;
        if (!video.paused && !isBufferingRef.current) {
          startPlayWindow();
          videoAnalytics.trackVideoEvent(makePayload({
            eventType:            'tab_show',
            current_time_seconds: Math.round(video.currentTime),
          }));
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    const handlePlay = () => {
      if (isSeekingRef.current || document.hidden) return;
      isEndedRef.current = false;
      isHiddenRef.current = false;
      startPlayWindow();
      setIsPlaying(true);
      videoAnalytics.trackVideoEvent(makePayload({
        eventType:            'play',
        current_time_seconds: Math.round(video.currentTime),
        duration:             0,
      }));
    };

    const handlePause = () => {
      if (isSeekingRef.current || hasSeeked.current) return;
      setIsPlaying(false);
      if (isEndedRef.current) { isEndedRef.current = false; return; }
      const d = video.currentTime - lastTrackedVideoTime.current;
      if (d > 0.5 && d < (video.duration ?? Infinity)) {
        videoAnalytics.trackVideoEvent(makePayload({
          eventType:            'watch_chunk',
          chunk_start_seconds:  Math.round(lastTrackedVideoTime.current),
          chunk_end_seconds:    Math.round(video.currentTime),
          duration:             Math.round(d),
          current_time_seconds: Math.round(video.currentTime),
        }));
      }
      lastTrackedVideoTime.current = video.currentTime;
      pausePlayWindow();
      videoAnalytics.forceFlushChunk();
      videoAnalytics.trackVideoEvent(makePayload({
        eventType:            'pause',
        current_time_seconds: Math.round(video.currentTime),
      }));
      scheduleSaveProgress(video.currentTime, true);
    };

    const handleSeeking = () => {
      isSeekingRef.current = true;
      if (!hasSeeked.current) {
        hasSeeked.current = true;
        const d = video.currentTime - lastTrackedVideoTime.current;
        if (d > 0.5 && d < 5) {
          videoAnalytics.trackVideoEvent(makePayload({
            eventType:            'watch_chunk',
            chunk_start_seconds:  Math.round(lastTrackedVideoTime.current),
            chunk_end_seconds:    Math.round(video.currentTime),
            duration:             Math.round(d),
            current_time_seconds: Math.round(video.currentTime),
          }));
        }
        prevTimeRef.current = video.currentTime;
        lastTrackedVideoTime.current = video.currentTime;
        pausePlayWindow();
        videoAnalytics.forceFlushChunk();
      }
      seekCountRef.current += 1;
      clearTimeout(seekTimerRef.current);
      seekTimerRef.current = setTimeout(() => { seekCountRef.current = 0; }, 1000);
    };

    const handleSeeked = debounce(() => {
      if (!videoRef.current) return;
      hasSeeked.current = false;
      isSeekingRef.current = false;
      const dest = video.currentTime;
      const from = lastTrackedVideoTime.current;
      lastTrackedVideoTime.current = dest;
      prevTimeRef.current = dest;
      lastWatchTrackedAt.current = Date.now();
      if (segmentStartTime.current) segmentStartTime.current = Date.now();
      if (seekCountRef.current <= 3) {
        videoAnalytics.trackVideoEvent(makePayload({
          eventType:            'seek',
          seek_from_seconds:    Math.round(from),
          current_time_seconds: Math.round(dest),
          seek_delta_seconds:   Math.round(Math.abs(dest - from)),
          duration:             0,
        }));
      }
      videoAnalytics.forceFlushChunk();
      scheduleSaveProgress(dest);
    }, 300);

    const handleEnded = () => {
      isEndedRef.current = true;
      setIsPlaying(false);
      pausePlayWindow();
      videoAnalytics.forceFlushChunk();
      videoAnalytics.trackVideoEvent(makePayload({
        eventType:              'completed',
        video_duration_seconds: video.duration,
        current_time_seconds:   Math.round(video.currentTime),
      }));
      if (video.duration > 0) scheduleSaveProgress(video.duration, true);
    };

    const handleTimeUpdate = () => {
      if (video.paused || video.ended || isSeekingRef.current || isHiddenRef.current || document.hidden) return;
      const ct = video.currentTime;
      const diff = Math.abs(ct - prevTimeRef.current);
      if (diff > 2 && prevTimeRef.current > 0) { isSeekingRef.current = true; prevTimeRef.current = ct; return; }
      prevTimeRef.current = ct;
      if (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) { enterBuffering(); return; }
      exitBuffering();
      if (segmentStartTime.current === null) segmentStartTime.current = Date.now();
      if (lastWatchTrackedAt.current === 0) return;
      const wallElapsed = Date.now() - lastWatchTrackedAt.current;
      if (wallElapsed >= getAdaptiveInterval(ct) * 1000) {
        const vd = ct - lastTrackedVideoTime.current;
        if (vd <= 0 || vd > (video.duration ?? Infinity)) return;
        lastWatchTrackedAt.current = Date.now();
        lastTrackedVideoTime.current = ct;
        videoAnalytics.trackVideoEvent(makePayload({
          eventType:            'watch_chunk',
          chunk_start_seconds:  Math.round(ct - vd),
          chunk_end_seconds:    Math.round(ct),
          duration:             Math.round(vd),
          current_time_seconds: Math.round(ct),
        }));
        scheduleSaveProgress(ct);
      }
    };

    const handleError = () => {
      const err = video.error;
      videoAnalytics.trackVideoEvent(makePayload({
        eventType:            'error',
        errorCode:            err?.code,
        errorMessage:         err?.message ?? 'Unknown error',
        current_time_seconds: Math.round(video.currentTime),
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
      pausePlayWindow();
      videoAnalytics.forceFlushChunk();
      if (!isEndedRef.current) scheduleSaveProgress(video.currentTime, true);
      videoAnalytics.trackVideoEvent(makePayload({
        eventType:            'close',
        current_time_seconds: Math.round(video.currentTime),
      }));
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [manifestUrl, videoId, flushWatchTime, makePayload, scheduleSaveProgress]);

  return (
    <>
      <style>{playerStyles}</style>
      <div className="vp-backdrop">
        <div className="vp-topbar">
          <span className="vp-label">🎬 Now Playing</span>
          <button className="vp-close" onClick={onClose} aria-label="ปิดวิดีโอ"><X size={18} /></button>
        </div>
        <div className="vp-body">
          <div className="vp-box">
            <video ref={videoRef} controls playsInline>Your browser does not support HTML5 video.</video>
            <div className={`vp-idle ${isPlaying ? 'gone' : ''}`}>
              <div className="vp-play-circle"><Play size={28} color="#fff" fill="#fff" /></div>
            </div>
          </div>
        </div>
        <div className="vp-spacer" />
      </div>
    </>
  );
};

export default VideoPlayer;