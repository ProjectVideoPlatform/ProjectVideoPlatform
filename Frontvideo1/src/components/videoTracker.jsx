'use strict';

// ── constants ──────────────────────────────────────────
const VALID_EVENT_TYPES = new Set([
  'play', 'watch', 'watch_chunk', 'pause', 'seek', 'completed', 'close', 'error',
]);

const DEDUP_WINDOW_MS     = 300;
const MAX_DEDUP_CACHE     = 200;
const FLUSH_INTERVAL      = 8_000;
const MAX_BUFFER_SIZE     = 30;
const ADAPTIVE_BURST_SIZE = 50;

// ── helpers ────────────────────────────────────────────
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

// ── class ──────────────────────────────────────────────
class VideoAnalytics {
  constructor(config = {}) {
    this.analyticsUrl = 'http://localhost:3000/api/public/analytics/video';

    this.sessionId  = getSessionId();
    this.deviceType = getDeviceType();
    this.country    = getCountry();

    this.currentUserId = null;
    this.buffer        = [];
    this.pendingFlush  = false;

    this._dedupCache = new Map();
    this._watchChunk = null;
    this._lastEventAt = 0;

    this._init();
  }

  // ── public API ─────────────────────────────────────────

  updateUserId(id) {
    this.currentUserId = id ?? null;
  }

  forceFlushChunk() {
    this._flushWatchChunk();
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

    // ── dedup ──────────────────────────────────────────
    // แก้ไข #1: watch event ใช้ timestamp จริง (wall clock) เป็น key
    // เดิมใช้ Math.floor(currentTime/5) ทำให้ watch events ที่ต่างช่วงเวลา
    // แต่ตกใน bucket เดียวกัน ถูก dedup ออกหมด → _watchChunk ไม่มีข้อมูล
    const dedupKey = data.eventType === 'watch'
      ? `${data.videoId}|watch|${Math.floor(Date.now() / DEDUP_WINDOW_MS)}`
      : `${data.videoId}|${data.eventType}|${Math.round(data.currentTime ?? 0)}`;

    const now      = Date.now();
    const lastSeen = this._dedupCache.get(dedupKey);
    if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) return;

    this._dedupCache.set(dedupKey, now);
    this._cleanDedupCache(now);
    this._lastEventAt = now;

    // ── build event ────────────────────────────────────
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
      ...(typeof data.chunk_start_seconds === 'number' && { chunk_start_seconds: data.chunk_start_seconds }),
      ...(typeof data.chunk_end_seconds   === 'number' && { chunk_end_seconds:   data.chunk_end_seconds }),
      max_progress_seconds: typeof data.max_progress_seconds === 'number'
        ? data.max_progress_seconds
        : Math.round(data.currentTime ?? 0),
    };

    // ── coalescer ──────────────────────────────────────
    const coalesced = this._coalesceWatch(event);
    if (coalesced === null) {
      if (this.buffer.length >= MAX_BUFFER_SIZE) this._flush();
      return;
    }

    this.buffer.push(coalesced);
    if (this.buffer.length >= MAX_BUFFER_SIZE) this._flush();
  }

  // ── private: coalescer ─────────────────────────────────

  _coalesceWatch(event) {
    if (event.eventType !== 'watch') {
      this._flushWatchChunk();
      return event;
    }

    if (!this._watchChunk) {
      // แก้ไข #2: คำนวณ chunk_start_seconds จาก currentTime - duration
      // (duration คือ videoDelta จริงที่ส่งมาจาก VideoPlayer หลังแก้ไข #3)
      // ไม่ใช้ Math.max(0, ...) เพื่อไม่ให้ start collapse เป็น 0 ผิดๆ
      const chunkStart = event.currentTime - (event.duration || 0);
      this._watchChunk = {
        ...event,
        eventType:            'watch_chunk',
        chunk_start_seconds:  chunkStart,
        chunk_end_seconds:    event.currentTime,
        max_progress_seconds: event.currentTime,
      };
      return null;
    }

    // merge
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

    const { chunk_start_seconds, chunk_end_seconds } = this._watchChunk;

    // แก้ไข #3: ใช้ threshold เล็กน้อย (0.5s) แทน strict > 0
    // ป้องกัน floating point ทำให้ chunk ที่ valid ถูกทิ้ง
    if ((chunk_end_seconds - chunk_start_seconds) < 0.5) {
      this._watchChunk = null;
      return;
    }

    this.buffer.push(this._watchChunk);
    this._watchChunk = null;
  }

  // ── private: flush ────────────────────────────────────

  _init() {
    setInterval(() => {
      if (this.buffer.length === 0 && !this._watchChunk) return;
      const burstReady    = this.buffer.length > ADAPTIVE_BURST_SIZE;
      const inactiveReady = this._lastEventAt > 0
        && Date.now() - this._lastEventAt > FLUSH_INTERVAL;
      if (burstReady || inactiveReady) this._flush();
    }, 1_000);

    window.addEventListener('beforeunload', () => this._flushSync());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this._flushSync();
    });
  }

  async _flush() {
    this._flushWatchChunk();
    if (this.pendingFlush || this.buffer.length === 0) return;

    this.pendingFlush = true;
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
      this.pendingFlush = false;
    }
  }

  _flushSync() {
    this._flushWatchChunk();
    if (this.buffer.length === 0) return;

    const events  = this.buffer.splice(0);
    const payload = JSON.stringify({ events });

    const ok = navigator.sendBeacon?.(
      this.analyticsUrl,
      new Blob([payload], { type: 'application/json' }),
    );

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