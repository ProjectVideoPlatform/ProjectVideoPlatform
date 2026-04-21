'use strict';

// ── constants ──────────────────────────────────────────────────────────────────
const VALID_EVENT_TYPES = new Set([
  'play', 'watch', 'watch_chunk', 'pause', 'seek', 'completed', 'close', 'error',
]);

const DEDUP_WINDOW_MS     = 300;
const MAX_DEDUP_CACHE     = 200;
const FLUSH_INTERVAL      = 8_000;
const MAX_BUFFER_SIZE     = 30;
const ADAPTIVE_BURST_SIZE = 50;

// ── helpers ────────────────────────────────────────────────────────────────────
function getSessionId() {
  let id = sessionStorage.getItem('va_session');
  if (!id) {
    id = 'sess_' + crypto.randomUUID().slice(0, 12);
    sessionStorage.setItem('va_session', id);
  }
  return id;
}

function getDeviceType() {
  const ua = navigator.userAgent;
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) return 'tablet';
  if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle/i.test(ua)) return 'mobile';
  return 'desktop';
}

function getCountry() {
  return document.querySelector('meta[name="country"]')?.getAttribute('content') ?? 'TH';
}

// ── class ──────────────────────────────────────────────────────────────────────
class VideoAnalytics {
  constructor() {
    this.analyticsUrl = 'http://localhost:3000/api/public/analytics/video';

    this.sessionId  = getSessionId();
    this.deviceType = getDeviceType();
    this.country    = getCountry();

    this.currentUserId = null;
    this.buffer        = [];

    this._dedupCache  = new Map();
    this._watchChunk  = null;
    this._lastEventAt = 0;

    this._isFlushing  = false;
    this._flushQueued = false;
    this._intervalId  = null;
    this._syncFlushed = false;

    this._init();
  }

  // ── public API ─────────────────────────────────────────────────────────────

  updateUserId(id) {
    this.currentUserId = id ?? null;
  }

  forceFlushChunk() {
    this._flushWatchChunk();
  }

  // ── ใช้ตอน tab hidden / unmount ───────────────────────────────────────────
  // push watchChunk เข้า buffer แล้ว sendBeacon ทันที
  // กัน race condition กับ Tracker's own visibilitychange listener
  flushAndBeacon() {
    this._flushWatchChunk();
    this._flushSync();
  }

  destroy() {
    if (this._intervalId) clearInterval(this._intervalId);
    this._intervalId = null;
  }

  trackVideoEvent(data) {
    if (!data?.videoId || !data?.eventType) {
      console.warn('[VideoAnalytics] missing videoId or eventType', data);
      return;
    }
    if (!VALID_EVENT_TYPES.has(data.eventType)) {
      console.warn('[VideoAnalytics] unknown eventType:', data.eventType);
      return;
    }

    // ── dedup ──────────────────────────────────────────────────────────────────
    const dedupKey = data.eventType === 'watch'
      ? `${data.videoId}|watch|${Math.floor(Date.now() / DEDUP_WINDOW_MS)}|${Math.round(data.currentTime ?? 0)}`
      : `${data.videoId}|${data.eventType}|${Math.round(data.currentTime ?? 0)}`;
    const now      = Date.now();
    const lastSeen = this._dedupCache.get(dedupKey);
    if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) return;

    this._dedupCache.set(dedupKey, now);
    this._cleanDedupCache(now);
    this._lastEventAt = now;

    // ── build event ────────────────────────────────────────────────────────────
    const event = {
      videoId:        data.videoId,
      userId:         data.userId ?? this.currentUserId ?? 'anonymous',
      sessionId:      this.sessionId,
      eventType:      data.eventType,
      duration:       typeof data.duration       === 'number' ? Math.round(data.duration)       : 0,
      totalWatchTime: typeof data.totalWatchTime === 'number' ? Math.round(data.totalWatchTime) : 0,
      currentTime:    typeof data.currentTime    === 'number' ? Math.round(data.currentTime)    : 0,
      device:         this.deviceType,
      country:        this.country,
      timestamp:      new Date().toISOString(),
      ...(data.reason        && { reason:        data.reason }),
      ...(data.errorCode     && { errorCode:     data.errorCode }),
      ...(data.errorMessage  && { errorMessage:  data.errorMessage }),
      ...(data.videoDuration && { videoDuration: Math.round(data.videoDuration) }),
      max_progress_seconds: typeof data.max_progress_seconds === 'number'
        ? data.max_progress_seconds
        : Math.round(data.currentTime ?? 0),
    };

    const coalesced = this._coalesceWatch(event);
    if (coalesced === null) {
      if (this.buffer.length >= MAX_BUFFER_SIZE) this._flush();
      return;
    }

    this.buffer.push(coalesced);
    if (this.buffer.length >= MAX_BUFFER_SIZE) this._flush();
  }

  // ── private: coalescer ─────────────────────────────────────────────────────

  _coalesceWatch(event) {
    if (event.eventType !== 'watch') {
      this._flushWatchChunk();
      return event;
    }

    const chunkStart = Math.max(0, event.currentTime - (event.duration || 0));

    if (!this._watchChunk) {
      this._watchChunk = {
        ...event,
        eventType:            'watch_chunk',
        chunk_start_seconds:  chunkStart,
        chunk_end_seconds:    event.currentTime,
        max_progress_seconds: event.currentTime,
      };
      return null;
    }

    const prevEnd = this._watchChunk.chunk_end_seconds;
    const gap     = chunkStart - prevEnd;

    if (Math.abs(gap) > 2) {
      this._flushWatchChunk();
      this._watchChunk = {
        ...event,
        eventType:            'watch_chunk',
        chunk_start_seconds:  chunkStart,
        chunk_end_seconds:    event.currentTime,
        max_progress_seconds: event.currentTime,
      };
      return null;
    }

    this._watchChunk.chunk_end_seconds    = event.currentTime;
    this._watchChunk.max_progress_seconds = Math.max(
      this._watchChunk.max_progress_seconds || 0,
      event.currentTime,
    );
    this._watchChunk.duration       = (this._watchChunk.duration || 0) + (event.duration || 0);
    this._watchChunk.totalWatchTime = event.totalWatchTime || this._watchChunk.totalWatchTime;
    this._watchChunk.timestamp      = event.timestamp;

    return null;
  }

  _flushWatchChunk() {
    if (!this._watchChunk) return;

    const { chunk_start_seconds, chunk_end_seconds, duration } = this._watchChunk;
    const positionSpan = chunk_end_seconds - chunk_start_seconds;

    if (positionSpan < 0.5 || duration < 0.5) {
      this._watchChunk = null;
      return;
    }

    this.buffer.push(this._watchChunk);
    this._watchChunk = null;
  }

  // ── private: flush ─────────────────────────────────────────────────────────

  _init() {
    this._intervalId = setInterval(() => {
      if (this.buffer.length === 0 && !this._watchChunk) return;
      const burstReady    = this.buffer.length > ADAPTIVE_BURST_SIZE;
      const inactiveReady = this._lastEventAt > 0
        && Date.now() - this._lastEventAt > FLUSH_INTERVAL;
      if (burstReady || inactiveReady) this._flush();
    }, 1_000);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        // VideoPlayer's flushAndBeacon() จะ push watchChunk + sendBeacon ก่อนแล้ว
        // Tracker ทำ _flushSync เพื่อ flush events ที่เหลือใน buffer (ถ้ามี)
        this._syncFlushed = true;
        this._flushSync();
      } else {
        this._syncFlushed = false;
      }
    });

    window.addEventListener('beforeunload', () => {
      if (!this._syncFlushed) this._flushSync();
    });
  }

  async _flush() {
    this._flushWatchChunk();
    if (this.buffer.length === 0) return;

    if (this._isFlushing) {
      this._flushQueued = true;
      return;
    }

    this._isFlushing = true;
    const events = this.buffer.splice(0);

    try {
      const res = await fetch(this.analyticsUrl, {
        method:    'POST',
        headers:   { 'Content-Type': 'application/json' },
        body:      JSON.stringify({ events }),
        keepalive: true,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error('[VideoAnalytics] flush failed:', err.message);
      this.buffer.unshift(...events);
    } finally {
      this._isFlushing = false;
      if (this._flushQueued) {
        this._flushQueued = false;
        this._flush();
      }
    }
  }

  _flushSync() {
    // reset flush state ก่อน กัน async _flush ที่ค้างอยู่ trigger queue flush
    this._isFlushing  = false;
    this._flushQueued = false; // ✅ กัน queued flush ยิงหลัง sync
    this._flushWatchChunk();
    if (this.buffer.length === 0) return;

    const events  = this.buffer.splice(0);
    const payload = JSON.stringify({ events });

    const ok = navigator.sendBeacon?.(
      this.analyticsUrl,
      new Blob([payload], { type: 'application/json' }),
    );

    // sendBeacon fail (payload > 64KB) → คืน buffer ไว้ให้ async flush ลอง
    if (!ok) this.buffer.unshift(...events);
  }

  _cleanDedupCache(now) {
    if (this._dedupCache.size <= MAX_DEDUP_CACHE) return;
    for (const [k, t] of this._dedupCache) {
      if (now - t > 5_000) this._dedupCache.delete(k);
      if (this._dedupCache.size <= MAX_DEDUP_CACHE / 2) break;
    }
  }
}

// singleton
const videoAnalytics = new VideoAnalytics();
export default videoAnalytics;