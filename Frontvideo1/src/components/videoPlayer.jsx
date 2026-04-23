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
//    นับแค่เวลาที่ดูใหม่จริงๆ หลังจาก seek dest
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
//  เปิด: localStorage.setItem('vp_debug', '1')  → refresh
//  ปิด:  localStorage.removeItem('vp_debug')    → refresh
//  หรือ URL: ?vp_debug=1
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

  // ─── Chunk tracking ───────────────────────────────────────────────────────
  //
  //  chunkStartVideoTime — video.currentTime ณ เริ่ม chunk
  //                        null = ไม่มี active chunk
  //
  //  HYBRID LOGIC:
  //    duration = video.currentTime_end - chunkStartVideoTime  (video-time diff)
  //    → buffer ไม่เดิน currentTime → duration ไม่พอง ✅
  //
  //    seek → handleSeeking flush chunk ด้วย lastVideoTimeRef (pre-seek)
  //         → handleSeeked เรียก startChunk(dest) → anchor reset เป็น dest
  //         → chunk ถัดไป: duration = newEnd - dest (นับจาก 0 หลัง seek) ✅
  //
  //  total_watch_seconds = ผลรวม duration ทุก chunk (playback time รวม, ดูซ้ำบวกซ้ำ)
  //
  const chunkStartVideoTime = useRef(null);
  const totalWatchSeconds   = useRef(0);

  // ─── Seek state ───────────────────────────────────────────────────────────
  const isSeekingRef  = useRef(false);
  const seekFromRef   = useRef(0);
  const seekTimerRef  = useRef(null);
  const seekCountRef  = useRef(0);

  // ─── Last known video time (set by timeupdate, always pre-seek) ───────────
  //  browser บางตัว (Chrome/Safari) กระโดด currentTime ไปที่ seek dest
  //  ก่อน seeking event จะ fire → video.currentTime ณ handleSeeking = dest แล้ว
  //  lastVideoTimeRef ถูก set ใน timeupdate ซึ่งไม่ fire ระหว่าง seek
  //  → ค่านี้จะเป็นตำแหน่งก่อน seek เสมอ ใช้แทน video.currentTime ใน handleSeeking
  const lastVideoTimeRef = useRef(0);

  // ─── Chunk origin time (เวลาที่ startChunk ถูกเรียกครั้งแรกของ chunk นี้) ──
  //  ใช้แก้กรณี seek ย้อนกลับ (dest < from):
  //
  //  ปัญหา: ถ้าดู 0→25 แล้ว seek ย้อนไป 5s แล้วเล่นต่อถึง 30s
  //    chunk หลัง seek จะได้ start=5, end=30, duration=25
  //    แต่ช่วง 5-25 ดูไปแล้วใน chunk ก่อนหน้า → นับซ้ำ
  //
  //  วิธีแก้: seek ย้อนหลัง → startChunk(from) ไม่ใช่ startChunk(dest)
  //    chunk หลัง seek: start=25 (from), end=30, duration=5 ✅
  //    บันทึกแค่เวลาที่ดูใหม่จริงๆ หลังจาก seek dest
  //
  //  chunkOriginTimeRef เก็บ videoTime ตอน startChunk ครั้งล่าสุด
  //  → ใช้ใน handleSeeked เพื่อตัดสินใจ anchor ที่ถูกต้อง
  const chunkOriginTimeRef = useRef(0);

  // ─── Misc refs ────────────────────────────────────────────────────────────
  const isHiddenRef = useRef(false);
  const isEndedRef  = useRef(false);
  const sessionId   = useRef(getOrCreateSessionId());

  // ─── Progress (purchased videos only) ────────────────────────────────────
  const isOwnedRef            = useRef(false);
  const lastSavedProgressTime = useRef(-1);
  const progressSaveTimer     = useRef(null);

  // ─── safeTime ─────────────────────────────────────────────────────────────
  //  clamp video.currentTime ไม่ให้เกิน duration
  //  browser บางตัว seek เกิน duration แล้วค่อย clamp → chunk_end / current_time ผิดได้
  const safeTime = useCallback((t, video) => {
    if (!video) return t;
    const dur = video.duration;
    if (!dur || !isFinite(dur)) return t;
    return Math.min(t, dur);
  }, []);

  // ─── makePayload ──────────────────────────────────────────────────────────
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

  // ═══════════════════════════════════════════════════════════════════════════
  //  startChunk(videoTime)
  //    บันทึก video-time เป็น anchor ของ chunk ใหม่
  //    เรียกหลัง seek → anchor reset → duration chunk ถัดไปนับจาก 0
  // ═══════════════════════════════════════════════════════════════════════════
  const startChunk = useCallback((videoTime) => {
    chunkStartVideoTime.current = videoTime;
    chunkOriginTimeRef.current  = videoTime; // เก็บ origin ของ chunk นี้ไว้
    log('startChunk', { anchor: videoTime.toFixed(2) });
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  //  flushChunk(videoTime, reason)
  //    duration = videoTime - chunkStartVideoTime  (video-time diff)
  //    ถ้าไม่มี active chunk → SKIP เงียบๆ ไม่ error
  // ═══════════════════════════════════════════════════════════════════════════
  const flushChunk = useCallback((videoTime, reason = '') => {
    if (chunkStartVideoTime.current === null) {
      log('flushChunk SKIP — no active chunk', { reason });
      return false;
    }

    const start    = chunkStartVideoTime.current;
    const end      = videoTime;
    const duration = end - start; // video-time diff

    // reset ก่อนเสมอ ป้องกัน double-flush
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
      current_time_seconds:   Math.round(end), // end คือ pre-seek time เสมอ ✅
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

  // ─── Progress save ────────────────────────────────────────────────────────
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
        videoRef.current.currentTime = savedTime;
        lastSavedProgressTime.current = savedTime;
      };

      if (videoRef.current.readyState >= HTMLMediaElement.HAVE_METADATA) applyTime();
      else videoRef.current.addEventListener('loadedmetadata', applyTime, { once: true });
    });

    return () => {
      cancelled = true;
      clearTimeout(progressSaveTimer.current);
    };
  }, [videoId]);

  // ─── Overlay click ────────────────────────────────────────────────────────
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

    // ── HLS setup ─────────────────────────────────────────────────────────
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = manifestUrl;
    } else if (Hls.isSupported()) {
      const hls = new Hls({ xhrSetup: (xhr) => { xhr.withCredentials = true; } });
      hlsRef.current = hls;
      hls.loadSource(manifestUrl);
      hls.attachMedia(video);
    }

    // ── Tab visibility ─────────────────────────────────────────────────────
    //  hidden  → flush chunk ที่เล่นอยู่ (video.currentTime หยุดเดินตอน hidden)
    //  visible → startChunk ใหม่ถ้ายังเล่นอยู่
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
    //  guard double-fire: ถ้ามี active chunk แล้วไม่ต้องเริ่มใหม่
    const handlePlay = () => {
      setIsPlaying(true);
      const ct = safeTime(video.currentTime, video);
      log('EVENT play', {
        ct:            ct.toFixed(2),
        isSeeking:     isSeekingRef.current,
        hasActiveChunk: chunkStartVideoTime.current !== null,
      });

      if (isSeekingRef.current || document.hidden) return;
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
    const handlePause = () => {
      const ct = safeTime(video.currentTime, video);
      log('EVENT pause', {
        ct:        ct.toFixed(2),
        isSeeking: isSeekingRef.current,
        isEnded:   isEndedRef.current,
      });

      if (isSeekingRef.current) return;
      if (isEndedRef.current)   return;

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
    //
    //  FIX: ใช้ lastVideoTimeRef.current แทน video.currentTime
    //
    //  เหตุผล: browser บางตัว (Chrome/Safari) race condition —
    //    currentTime กระโดดไปที่ seek dest ก่อน seeking event fire
    //    → video.currentTime ณ จุดนี้ = dest ไม่ใช่ตำแหน่งก่อน seek
    //
    //  lastVideoTimeRef ถูก set ใน timeupdate ซึ่งไม่ fire ระหว่าง seek
    //    → เป็น pre-seek position เสมอ ✅
    //    → flushChunk ได้ duration ถูกต้อง ✅
    //    → current_time_seconds ใน payload ตรงกับ chunk_end เสมอ ✅
    //
    const handleSeeking = () => {
      if (!isSeekingRef.current) {
        const ct = safeTime(lastVideoTimeRef.current, video); // ← FIX
        log('EVENT seeking START', {
          ct:             ct.toFixed(2),
          hasActiveChunk: chunkStartVideoTime.current !== null,
        });
        seekFromRef.current  = ct;
        flushChunk(ct, 'seek-start'); // flush ด้วย pre-seek time จริงๆ ✅
        isSeekingRef.current = true;
      }
      seekCountRef.current += 1;
      clearTimeout(seekTimerRef.current);
      seekTimerRef.current = setTimeout(() => { seekCountRef.current = 0; }, 1000);
    };

    // ── seeked ────────────────────────────────────────────────────────────
    //
    //  seek ไปข้างหน้า (dest >= from):
    //    startChunk(dest) → anchor = dest, duration chunk ใหม่นับจาก dest ✅
    //
    //  seek ย้อนกลับ (dest < from):
    //    startChunk(from) → anchor = from (pre-seek)
    //    chunk ถัดไป: start=from, end=X, duration = X - from
    //    → นับแค่เวลาที่ดูใหม่จริงๆ หลัง seek dest ไม่นับช่วงที่เคยดูไปแล้ว ✅
    //
    //  ทั้งสองกรณี: chunk_start_seconds ใน payload จะถูก override เป็น origin
    //  ที่ flushChunk ใช้จาก chunkStartVideoTime ซึ่ง = from เสมอ
    //
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
        videoAnalytics.trackVideoEvent(makePayload({
          event_type:           'seek',
          seek_from_seconds:    Math.round(from),
          current_time_seconds: Math.round(dest),
          seek_delta_seconds:   Math.round(dest - from),
        }));
      }

      if (!video.paused && !document.hidden) {
        if (dest < from) {
          // seek ย้อนกลับ → anchor เป็น from เพื่อนับแค่เวลาใหม่หลัง dest
          // duration chunk ถัดไป = newEnd - from (ไม่นับช่วง dest..from ที่ดูแล้ว)
          startChunk(from);
          log('seeked BACKWARD — anchor reset to from', { from: from.toFixed(2) });
        } else {
          // seek ไปข้างหน้า → anchor เป็น dest ปกติ
          startChunk(dest);
        }
      }

      scheduleSaveProgress(dest);
      videoAnalytics.forceFlushChunk();
    };

    // ── timeupdate ────────────────────────────────────────────────────────
    //  1. อัปเดต lastVideoTimeRef — ต้องทำก่อนทุกอย่าง
    //     timeupdate fires ระหว่างเล่นปกติเท่านั้น (ไม่ fire ระหว่าง seek)
    //     → lastVideoTimeRef จะเป็น pre-seek position เสมอ
    //  2. periodic flush ทุก N วิ (video-time based, buffer ไม่นับ)
    const handleTimeUpdate = () => {
      if (
        video.paused         ||
        video.ended          ||
        isSeekingRef.current ||
        isHiddenRef.current  ||
        document.hidden
      ) return;

      const ct = safeTime(video.currentTime, video);

      // อัปเดต lastVideoTimeRef ทุกครั้งที่ timeupdate fire ระหว่างเล่นปกติ
      // ค่านี้จะถูกใช้ใน handleSeeking เพื่อ flush chunk ด้วย pre-seek time ✅
      lastVideoTimeRef.current = ct;

      // ไม่มี active chunk (หลัง buffer exit ฯลฯ) → เริ่มใหม่
      if (chunkStartVideoTime.current === null) {
        log('timeupdate — no active chunk, starting', { ct: ct.toFixed(2) });
        startChunk(ct);
        return;
      }

      // video-time diff สำหรับ interval check (consistent กับ duration ที่จะ flush)
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

    // ── register events ───────────────────────────────────────────────────
    video.addEventListener('play',       handlePlay);
    video.addEventListener('pause',      handlePause);
    video.addEventListener('seeking',    handleSeeking);
    video.addEventListener('seeked',     handleSeeked);
    video.addEventListener('ended',      handleEnded);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.play().catch(() => {});

    // ── cleanup ───────────────────────────────────────────────────────────
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

  // ─── Render ───────────────────────────────────────────────────────────────
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