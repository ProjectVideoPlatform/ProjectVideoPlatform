// VideoPlayer.jsx — Hybrid analytics (video-time diff + seek anchor reset)
//
//  DURATION APPROACH:
//    watch_duration_seconds = video-time diff (end - start)
//    → buffer/lag ไม่กระทบ เพราะ video.currentTime ไม่เดินตอน buffer
//    → ดีกว่า wall-clock ตรงที่ buffer 10 วิ ไม่ทำให้ duration พอง
//
//  FIX 1 (current_time_seconds โดด):
//    browser บางตัว (Chrome/Safari) กระโดด video.currentTime ไปที่ seek dest
//    ก่อนที่ seeking event จะ fire → handleSeeking เลยได้ ct = dest แทน pre-seek
//    แก้โดยเพิ่ม lastVideoTimeRef ที่ timeupdate อัปเดตระหว่างเล่นปกติ
//    (timeupdate ไม่ fire ระหว่าง seek → ค่านี้จะเป็น pre-seek เสมอ)
//    handleSeeking ใช้ lastVideoTimeRef.current แทน video.currentTime
//
//  FIX 2 (seek ย้อนกลับ นับ duration ซ้ำ):
//    ดู 0→25s → seek ย้อนไป 5s → เล่นต่อถึง 30s
//    chunk หลัง seek ที่ผิด: start=5, end=30, duration=25 (ช่วง 5-25 นับซ้ำ)
//    แก้โดย: seek ย้อนหลัง (dest < from) → startChunk(from) ไม่ใช่ startChunk(dest)
//    chunk หลัง seek ที่ถูก: start=25(from), end=30, duration=5 ✅
//
//  FIX 3 (lastVideoTimeRef stale ตอน seek ขณะ paused):
//    timeupdate ไม่ fire ตอน paused → lastVideoTimeRef ค้างที่ 0
//    แก้โดย sync lastVideoTimeRef ใน handlePlay และ handlePause ด้วย
//    แต่ต้อง skip ถ้า isRestoringProgressRef=true (ดู FIX 4)
//
//  FIX 4 (restore race condition → chunk duration พอง):
//    sequence ที่ผิด:
//      video.play() → handlePlay(ct=1) → lastVideoTimeRef=1 → startChunk(1)
//      fetch returns → currentTime=53 → browser fires play again
//      handlePlay(ct=53) → lastVideoTimeRef=53  ← ตรงนี้ที่ผิด
//      seeking fires → flushChunk(end=53) → dur=52 ❌
//    แก้: handlePlay และ handlePause ไม่ sync lastVideoTimeRef
//         และไม่ startChunk ถ้า isRestoringProgressRef=true
//         lastVideoTimeRef จะยัง = 1 → handleSeeking flush(1) → dur=1 ✅
//         หลัง seeked clear flag → play fires → startChunk(53) ✅
//
//  FIX 5 (pause event ขณะ seeking → analytics งง):
//    browser fire pause → seeking → seeked → play ทุกครั้งที่ seek ขณะเล่น
//    pause ตอน isSeekingRef=true ไม่ใช่ user pause จริง → ไม่ส่ง analytics
//    แต่ยัง sync lastVideoTimeRef เพื่อให้ handleSeeking ได้ pre-seek time ✅
//
import React, { useRef, useEffect, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { X, Play } from 'lucide-react';
import videoAnalytics from './VideoTracker';
import { fetchVideoProgress, saveVideoProgress } from './services/videoProgress';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const getAdaptiveInterval = (t) => t < 60 ? 5 : t < 300 ? 10 : 30;

function getOrCreateSessionId() {
  let s = sessionStorage.getItem('video_session_id');
  if (!s) { s = crypto.randomUUID(); sessionStorage.setItem('video_session_id', s); }
  return s;
}

// ─── Debug Logger ─────────────────────────────────────────────────────────────
const DEBUG = (() => {
  try {
    return (
      localStorage.getItem('vp_debug') === '1' ||
      new URLSearchParams(window.location.search).get('vp_debug') === '1'
    );
  } catch { return false; }
})();

const log = (label, data = {}) => {
  if (!DEBUG) return;
  const ts = performance.now().toFixed(1);
  console.log(`%c[VP ${ts}ms] ${label}`, 'color:#e8445a;font-weight:bold;', data);
};

// ─── Styles ───────────────────────────────────────────────────────────────────
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
    transition: opacity .25s;
    cursor: pointer;
    pointer-events: none;
  }
  .vp-idle.visible { pointer-events: all; opacity: 1; }
  .vp-idle.gone    { pointer-events: none; opacity: 0; }
  .vp-play-circle {
    width: 68px; height: 68px; border-radius: 50%;
    background: rgba(232,68,90,.85);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 6px 28px rgba(232,68,90,.55);
  }
  .vp-spacer { height: 10px; flex-shrink: 0; }
  @media (max-width: 640px) { .vp-spacer { height: 76px; } }
`;

// ─── Constants ────────────────────────────────────────────────────────────────
const PROGRESS_SAVE_INTERVAL_SEC = 10;
const MIN_CHUNK_DURATION_SEC     = 1;
const MAX_CHUNK_DURATION_SEC     = 600;

// ─── Component ────────────────────────────────────────────────────────────────
const VideoPlayer = ({ manifestUrl, onClose, videoId, videoCategory }) => {
  const videoRef = useRef(null);
  const hlsRef   = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);

  const chunkStartVideoTime = useRef(null);
  const totalWatchSeconds   = useRef(0);

  const isSeekingRef  = useRef(false);
  const seekFromRef   = useRef(0);
  const seekTimerRef  = useRef(null);
  const seekCountRef  = useRef(0);

  // sync ใน: timeupdate, handlePlay, handlePause (ยกเว้น isRestoring=true)
  const lastVideoTimeRef   = useRef(0);
  const chunkOriginTimeRef = useRef(0);

  const isHiddenRef = useRef(false);
  const isEndedRef  = useRef(false);
  const sessionId   = useRef(getOrCreateSessionId());

  // true ระหว่าง applyTime() → handleSeeked
  // ป้องกัน handlePlay/handlePause sync lastVideoTimeRef ด้วย savedTime
  const isRestoringProgressRef = useRef(false);

  // set = true ใน handleSeeked, clear ใน handlePlay
  // กัน play event ที่ browser fire หลัง seeked ไม่ให้ส่ง analytics
  const justSeekedRef = useRef(false);

  // true ระหว่าง mount → fetchVideoProgress return
  // block startChunk ทุกชนิด (play, timeupdate) จนกว่าจะรู้ว่า owned หรือไม่
  // ป้องกัน startChunk(0) ก่อน fetch return → chunk ค้างผ่าน restore seek ❌
  const fetchPendingRef = useRef(true);

  const isOwnedRef            = useRef(false);
  const lastSavedProgressTime = useRef(-1);
  const progressSaveTimer     = useRef(null);

  const safeTime = useCallback((t, video) => {
    if (!video) return t;
    const dur = video.duration;
    if (!dur || !isFinite(dur)) return t;
    return Math.min(t, dur);
  }, []);

  const makePayloadRef = useRef(null);
  makePayloadRef.current = (o = {}) => ({
    event_id:            crypto.randomUUID(),
    session_id:          sessionId.current,
    video_id:            videoId,
    video_category:      videoCategory || undefined,
    timestamp:           new Date().toISOString(),
    total_watch_seconds: Math.round(totalWatchSeconds.current),
    ...o,
  });
  const makePayload = useCallback((o) => makePayloadRef.current(o), []);

  const startChunk = useCallback((videoTime) => {
    chunkStartVideoTime.current = videoTime;
    chunkOriginTimeRef.current  = videoTime;
    log('startChunk', { anchor: videoTime.toFixed(2) });
  }, []);

  const flushChunk = useCallback((videoTime, reason = '') => {
    if (chunkStartVideoTime.current === null) {
      log('flushChunk SKIP — no active chunk', { reason });
      return false;
    }

    const start    = chunkStartVideoTime.current;
    const end      = videoTime;
    const duration = end - start;

    chunkStartVideoTime.current = null;

    log('flushChunk attempt', {
      reason,
      start:       start.toFixed(2),
      end:         end.toFixed(2),
      duration:    duration.toFixed(2),
      totalBefore: totalWatchSeconds.current.toFixed(2),
    });

    if (duration < MIN_CHUNK_DURATION_SEC) {
      log('flushChunk DROPPED — too short', { duration: duration.toFixed(2) });
      return false;
    }
    if (duration > MAX_CHUNK_DURATION_SEC) {
      log('flushChunk DROPPED — too long (drift?)', { duration: duration.toFixed(2) });
      return false;
    }

    totalWatchSeconds.current += duration;

    const payload = makePayload({
      event_type:             'watch_chunk',
      chunk_start_seconds:    Math.round(start),
      chunk_end_seconds:      Math.round(end),
      watch_duration_seconds: Math.round(duration),
      current_time_seconds:   Math.round(end),
    });

    log('flushChunk SENT', {
      chunk_start: Math.round(start),
      chunk_end:   Math.round(end),
      duration:    Math.round(duration),
      totalAfter:  totalWatchSeconds.current.toFixed(2),
    });

    videoAnalytics.trackVideoEvent(payload);
    return true;
  }, [makePayload]);

  const scheduleSaveProgress = useCallback((currentTime, immediate = false) => {
    if (!isOwnedRef.current) return;
    const doSave = () => {
      const t = Math.floor(currentTime);
      if (Math.abs(t - lastSavedProgressTime.current) >= PROGRESS_SAVE_INTERVAL_SEC) {
        lastSavedProgressTime.current = t;
        saveVideoProgress(videoId, t);
      }
    };
    clearTimeout(progressSaveTimer.current);
    if (immediate) doSave();
    else progressSaveTimer.current = setTimeout(doSave, 3000);
  }, [videoId]);

  // ─── Progress restore on mount ────────────────────────────────────────────
  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;

    fetchVideoProgress(videoId).then((result) => {
      if (cancelled || !result) return;
      if (!result.owned) { isOwnedRef.current = false; return; }

      isOwnedRef.current = true;
      const savedTime = result.lastTime || 0;
      if (savedTime <= 5 || !videoRef.current) return;

      const applyTime = () => {
        if (cancelled || !videoRef.current) return;

        const duration = videoRef.current.duration;
        const NEAR_END_THRESHOLD = 10;
        if (duration && savedTime >= duration - NEAR_END_THRESHOLD) return;

        isRestoringProgressRef.current = true;
        videoRef.current.currentTime = savedTime;
        lastSavedProgressTime.current = savedTime;
        // flag ถูก clear ใน handleSeeked
      };

      if (videoRef.current.readyState >= HTMLMediaElement.HAVE_METADATA) applyTime();
      else videoRef.current.addEventListener('loadedmetadata', applyTime, { once: true });
    });

    return () => {
      cancelled = true;
      clearTimeout(progressSaveTimer.current);
    };
  }, [videoId]);

  const handleOverlayClick = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.paused ? v.play().catch(() => {}) : v.pause();
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  //  MAIN EVENT SETUP
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!manifestUrl || !videoRef.current) return;
    const video = videoRef.current;

    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = manifestUrl;
    } else if (Hls.isSupported()) {
      const hls = new Hls({ xhrSetup: (xhr) => { xhr.withCredentials = true; } });
      hlsRef.current = hls;
      hls.loadSource(manifestUrl);
      hls.attachMedia(video);
    }

    const handleVisibility = () => {
      const ct = safeTime(video.currentTime, video);
      if (document.visibilityState === 'hidden') {
        isHiddenRef.current = true;
        log('tab HIDDEN', { ct: ct.toFixed(2), paused: video.paused });
        if (!video.paused) {
          flushChunk(ct, 'tab-hide');
          videoAnalytics.flushAndBeacon();
        }
        scheduleSaveProgress(ct, true);
      } else {
        isHiddenRef.current = false;
        log('tab VISIBLE', { ct: ct.toFixed(2), paused: video.paused });
        if (!video.paused && !isSeekingRef.current) {
          startChunk(ct);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // ── play ──────────────────────────────────────────────────────────────
    //  FIX 4: isRestoring=true → skip ทั้งหมด (ไม่ sync ref, ไม่ startChunk)
    //  browser fire play อีกครั้งหลัง currentTime=savedTime set
    //  ถ้า sync lastVideoTimeRef=savedTime → handleSeeking flush chunk ด้วย
    //  end=savedTime → duration พอง ❌
    const handlePlay = () => {
      setIsPlaying(true);
      const ct = safeTime(video.currentTime, video);

      log('EVENT play', {
        ct:             ct.toFixed(2),
        isSeeking:      isSeekingRef.current,
        isRestoring:    isRestoringProgressRef.current,
        hasActiveChunk: chunkStartVideoTime.current !== null,
      });

      // FIX 4: ไม่แตะ lastVideoTimeRef และไม่ startChunk ระหว่าง restore
      if (isRestoringProgressRef.current) {
        log('play IGNORED — restoring progress');
        return;
      }

      // FIX 3: sync lastVideoTimeRef (หลัง restore check)
      lastVideoTimeRef.current = ct;

      if (isSeekingRef.current || document.hidden) return;

      // FIX 6: browser fire play หลัง seeked ทุกครั้ง (seek ขณะเล่น)
      // ไม่ใช่ user play จริง → ไม่ส่ง play analytics
      // startChunk จัดการใน handleSeeked แล้ว → ที่นี่แค่ clear flag
      if (justSeekedRef.current) {
        justSeekedRef.current = false;
        log('play IGNORED — post-seek browser play (FIX 6)');
        return;
      }

      if (chunkStartVideoTime.current !== null) {
        log('play IGNORED — chunk already active');
        return;
      }

      isEndedRef.current  = false;
      isHiddenRef.current = false;
      startChunk(ct);

      videoAnalytics.trackVideoEvent(makePayload({
        event_type:           'play',
        current_time_seconds: Math.round(ct),
      }));
    };

    // ── pause ─────────────────────────────────────────────────────────────
    //  FIX 4: isRestoring=true → skip ทั้งหมด
    //  FIX 5: isSeeking=true → sync lastVideoTimeRef แต่ไม่ส่ง analytics
    //    browser fire pause → seeking → seeked → play ทุกครั้งที่ seek ขณะเล่น
    //    pause ระหว่าง seek ไม่ใช่ user pause จริง → ไม่ flushChunk ไม่ส่ง event
    //    (handleSeeking จัดการ flush แล้ว)
// ── pause ─────────────────────────────────────────────────────────────
  // ── pause ─────────────────────────────────────────────────────────────
    const handlePause = () => {
      let ct = safeTime(video.currentTime, video);

      // --- [FIX] ป้องกัน Browser ยิง pause ด้วยเวลาปลายทาง ---
      const delta = ct - lastVideoTimeRef.current;
      if (Math.abs(delta) > 1.5 && chunkStartVideoTime.current !== null) {
         ct = lastVideoTimeRef.current; // บังคับใช้เวลาก่อน Seek เพื่อปิด Chunk
      }
      // --------------------------------------------------

      log('EVENT pause', {
        ct:          ct.toFixed(2),
        isSeeking:   isSeekingRef.current,
        isRestoring: isRestoringProgressRef.current,
        isEnded:     isEndedRef.current,
      });

      if (isRestoringProgressRef.current) {
        log('pause IGNORED — restoring progress');
        return;
      }

      lastVideoTimeRef.current = ct;

      if (isSeekingRef.current) {
        log('pause IGNORED — browser pause during seek (FIX 5)');
        return;
      }

      if (isEndedRef.current) return;

      setIsPlaying(false);
      flushChunk(ct, 'pause');

      videoAnalytics.trackVideoEvent(makePayload({
        event_type:           'pause',
        current_time_seconds: Math.round(ct),
      }));

      scheduleSaveProgress(ct, true);
      videoAnalytics.forceFlushChunk();
    };
    // ── seeking ───────────────────────────────────────────────────────────
    const handleSeeking = () => {
      if (!isSeekingRef.current) {
        const ct = safeTime(lastVideoTimeRef.current, video);
        log('EVENT seeking START', {
          ct:             ct.toFixed(2),
          hasActiveChunk: chunkStartVideoTime.current !== null,
          isRestoring:    isRestoringProgressRef.current,
        });
        seekFromRef.current = ct;

        if (!isRestoringProgressRef.current) {
          flushChunk(ct, 'seek-start');
        } else {
          chunkStartVideoTime.current = null;
          log('seeking RESTORE — cancel pending chunk', { ct: ct.toFixed(2) });
        }
        isSeekingRef.current = true;
      }
      seekCountRef.current += 1;
      clearTimeout(seekTimerRef.current);
      seekTimerRef.current = setTimeout(() => { seekCountRef.current = 0; }, 1000);
    };

    // ── seeked ────────────────────────────────────────────────────────────
// ── seeked ────────────────────────────────────────────────────────────
    const handleSeeked = () => {
      const dest = safeTime(video.currentTime, video);
      const from = seekFromRef.current;
      isSeekingRef.current = false;

      log('EVENT seeked', {
        from:       from.toFixed(2),
        dest:       dest.toFixed(2),
        isBackward: dest < from,
        paused:     video.paused,
      });

      if (seekCountRef.current <= 5) {
       // แก้เป็น
videoAnalytics.trackVideoEvent(makePayload({
  event_type:           'seek',
  seek_from_seconds:    Math.round(from),
  seek_to_seconds:      Math.round(dest),          // ✅ ตรงกับ column ใหม่
  current_time_seconds: Math.round(dest),
}));
      }

      if (isRestoringProgressRef.current) {
        log('seeked RESTORE — clear flag', { dest: dest.toFixed(2) });
        isRestoringProgressRef.current = false;
      } else if (!video.paused && !document.hidden) {
        justSeekedRef.current = true;
        
        // --- [FIX] เริ่ม Chunk ใหม่จากเวลาหลัง Seek เสมอ ---
        startChunk(dest);
        // ---------------------------------------------
      }

      scheduleSaveProgress(dest);
    };

    // ── timeupdate ────────────────────────────────────────────────────────
// ── timeupdate ────────────────────────────────────────────────────────
    const handleTimeUpdate = () => {
      if (
        video.paused         ||
        video.ended          ||
        video.seeking        || // แนะนำให้เพิ่ม native video.seeking เพื่อความชัวร์
        isSeekingRef.current ||
        isHiddenRef.current  ||
        document.hidden
      ) return;

      const ct = safeTime(video.currentTime, video);

      // --- [FIX] ป้องกัน Race Condition ก่อนเกิด Event Seeking ---
      // เวลาเล่นปกติ delta จะขยับแค่ ~0.25 วิ 
      // ถ้าเวลาโดดเกิน 1.5 วิ (ไปข้างหน้า) หรือติดลบ (ถอยหลัง) แสดงว่าเกิดการ Seek
      const delta = ct - lastVideoTimeRef.current;
      if (Math.abs(delta) > 1.5 && chunkStartVideoTime.current !== null) {
        // คืนค่าออกไปเลย ปล่อยให้ handleSeeking ดึง lastVideoTimeRef ตัวเก่า (ก่อน Seek) ไปใช้
        return; 
      }
      // --------------------------------------------------------

      lastVideoTimeRef.current = ct;

      if (chunkStartVideoTime.current === null) {
        log('timeupdate — no active chunk, starting', { ct: ct.toFixed(2) });
        startChunk(ct);
        return;
      }

      const elapsed = ct - chunkStartVideoTime.current;

      if (elapsed >= getAdaptiveInterval(ct)) {
        log('timeupdate — periodic flush', { ct: ct.toFixed(2), elapsed: elapsed.toFixed(2) });
        flushChunk(ct, 'periodic');
        startChunk(ct);
        scheduleSaveProgress(ct);
      }
    };
    // ── ended ─────────────────────────────────────────────────────────────
    const handleEnded = () => {
      isEndedRef.current = true;
      setIsPlaying(false);

      const endTime = safeTime(video.currentTime, video);
      log('EVENT ended', {
        endTime:  endTime.toFixed(2),
        duration: video.duration?.toFixed(2),
        total:    totalWatchSeconds.current.toFixed(2),
      });

      flushChunk(endTime, 'ended');
      videoAnalytics.forceFlushChunk();

      videoAnalytics.trackVideoEvent(makePayload({
        event_type:             'completed',
        current_time_seconds:   Math.round(endTime),
        video_duration_seconds: Math.round(video.duration),
      }));

      if (video.duration > 0) scheduleSaveProgress(video.duration, true);
    };

    video.addEventListener('play',       handlePlay);
    video.addEventListener('pause',      handlePause);
    video.addEventListener('seeking',    handleSeeking);
    video.addEventListener('seeked',     handleSeeked);
    video.addEventListener('ended',      handleEnded);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.play().catch(() => {});

    return () => {
      video.removeEventListener('play',       handlePlay);
      video.removeEventListener('pause',      handlePause);
      video.removeEventListener('seeking',    handleSeeking);
      video.removeEventListener('seeked',     handleSeeked);
      video.removeEventListener('ended',      handleEnded);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      document.removeEventListener('visibilitychange', handleVisibility);

      clearTimeout(seekTimerRef.current);

      const ct = safeTime(video.currentTime, video);
      log('CLEANUP', {
        isEnded: isEndedRef.current,
        ct:      ct.toFixed(2),
        total:   totalWatchSeconds.current.toFixed(2),
      });

      if (!isEndedRef.current) {
        flushChunk(ct, 'close');
        scheduleSaveProgress(ct, true);
      }

      videoAnalytics.trackVideoEvent(makePayload({
        event_type:           'close',
        current_time_seconds: Math.round(ct),
      }));
      videoAnalytics.forceFlushChunk();

      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [manifestUrl, videoId, flushChunk, startChunk, makePayload, scheduleSaveProgress, safeTime]);

  return (
    <>
      <style>{playerStyles}</style>
      <div className="vp-backdrop">
        <div className="vp-topbar">
          <span className="vp-label">🎬 Now Playing</span>
          <button className="vp-close" onClick={onClose} aria-label="ปิดวิดีโอ">
            <X size={18} />
          </button>
        </div>
        <div className="vp-body">
          <div className="vp-box">
            <video ref={videoRef} controls playsInline>
              Your browser does not support HTML5 video.
            </video>
            <div
              className={`vp-idle ${isPlaying ? 'gone' : 'visible'}`}
              onClick={handleOverlayClick}
              aria-label="เล่นวิดีโอ"
              role="button"
            >
              <div className="vp-play-circle">
                <Play size={28} color="#fff" fill="#fff" />
              </div>
            </div>
          </div>
        </div>
        <div className="vp-spacer" />
      </div>
    </>
  );
};

export default VideoPlayer;