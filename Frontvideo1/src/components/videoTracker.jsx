'use strict';

// ── constants ──────────────────────────────────────────
const VALID_EVENT_TYPES = new Set([
  'play', 'watch', 'watch_chunk', 'pause', 'seek', 'completed', 'close', 'error',
]);

const DEDUP_WINDOW_MS     = 300;    // ป้องกัน double-fire ภายใน 300ms
const MAX_DEDUP_CACHE     = 200;
const FLUSH_INTERVAL      = 8_000; // inactivity flush threshold
const MAX_BUFFER_SIZE     = 30;
const ADAPTIVE_BURST_SIZE = 50;    // flush ทันทีถ้า buffer > 50

// ── ลบ WATCH_THROTTLE_MS และ WATCH_PROGRESS_DELTA ออกแล้ว ──
// YouTube / Netflix philosophy: client ส่ง "honest data" ทุก 10s
// การ throttle ที่ client = ข้อมูล retention เพี้ยน
// ให้ ClickHouse Materialized View จัดการ aggregation แทน

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

    // coalescer state — merge watch events เป็น watch_chunk
    // ไม่ throttle แล้ว แต่ยัง coalesce เพื่อลด row explosion
    // flush chunk ทันทีเมื่อ: non-watch event มา / buffer stall / tab hidden
    this._watchChunk = null;

    // adaptive buffer state
    this._lastEventAt = 0;

    this._init();
  }

  // ── public API ─────────────────────────────────────────

  updateUserId(id) {
    this.currentUserId = id ?? null;
  }

  /**
   * เรียกจาก VideoPlayer เมื่อ:
   * - BUFFER_STALLED (HLS buffer หมด — มี gap จริงในการดู)
   * - tab hidden (user ออกจากหน้า)
   * การ flush ทำให้ chunk ที่ค้างไม่รวม gap เข้าไป → retention ถูกต้อง
   */
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

    // ── dedup (300ms window) ────────────────────────────
    // ป้องกัน double-fire จาก timeupdate เท่านั้น ไม่ใช่ throttle
   const timeKey  = data.eventType === 'watch'
  ? Math.floor((data.currentTime ?? 0) / 5)  // bucket 5s — ป้องกัน double-fire แต่ไม่ตัด progress ใหม่
  : Math.round(data.currentTime ?? 0);
const dedupKey = `${data.videoId}|${data.eventType}|${timeKey}`;
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
    };

    // ── coalescer ──────────────────────────────────────
    // watch → accumulate เป็น chunk (ยังไม่ push buffer)
    // non-watch → flush chunk ที่ค้าง แล้วส่งตรง
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
      // non-watch มา → flush chunk ก่อน → ไม่รวม gap เข้า chunk
      this._flushWatchChunk();
      return event;
    }

    if (!this._watchChunk) {
      // ก้อนแรกที่เข้ามาของ Chunk นี้
      this._watchChunk = {
        ...event,
        eventType:   'watch_chunk',
        // ✅ แก้ไข: คำนวณจุดเริ่มต้น โดยเอา currentTime ถอยหลังกลับไปด้วย duration
        startTime:   Math.max(0, event.currentTime - (event.duration || 0)), 
        endTime:     event.currentTime,
        maxProgress: event.currentTime,
      };
      return null;
    }

    // merge — สะสม startTime (ไม่เปลี่ยน), อัปเดต endTime/maxProgress/duration ไว้ใน chunk เดียว
    this._watchChunk.endTime        = event.currentTime;
    this._watchChunk.maxProgress    = Math.max(this._watchChunk.maxProgress, event.currentTime);
    this._watchChunk.duration       = (this._watchChunk.duration || 0) + (event.duration || 0);
    this._watchChunk.totalWatchTime = event.totalWatchTime || this._watchChunk.totalWatchTime;
    this._watchChunk.timestamp      = event.timestamp; // timestamp ล่าสุดเสมอ

    return null;
  }

_flushWatchChunk() {
  if (!this._watchChunk) return;

  // ✅ ทิ้ง chunk ที่ไม่มี range — single event ไม่มีข้อมูล retention จริง
  if (this._watchChunk.endTime <= this._watchChunk.startTime) {
    this._watchChunk = null;
    return;
  }

  this.buffer.push(this._watchChunk);
  this._watchChunk = null;
}
  // ── private: flush ────────────────────────────────────

  _init() {
    // adaptive flush — check ทุก 1 วิ
    setInterval(() => {
      if (this.buffer.length === 0 && !this._watchChunk) return;
      const burstReady    = this.buffer.length > ADAPTIVE_BURST_SIZE;
      const inactiveReady = this._lastEventAt > 0
        && Date.now() - this._lastEventAt > FLUSH_INTERVAL;
      if (burstReady || inactiveReady) this._flush();
    }, 1_000);

    window.addEventListener('beforeunload', () => this._flushSync());
    // fallback สำหรับ tracker เท่านั้น — VideoPlayer handle visibility ก่อน
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