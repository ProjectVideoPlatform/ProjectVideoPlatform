'use strict';

// ── constants ──────────────────────────────────────────
const VALID_EVENT_TYPES = new Set([
  'play', 'watch', 'pause', 'seek', 'completed', 'close', 'error',
]);

const DEDUP_WINDOW_MS  = 300;   // ป้องกัน double-fire ภายใน 300ms
const MAX_DEDUP_CACHE  = 200;
const FLUSH_INTERVAL   = 8_000;
const MAX_BUFFER_SIZE  = 30;

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
    this.analyticsUrl = config.analyticsUrl
      ?? (typeof window !== 'undefined'
        ? `${window.location.origin}/api/public/analytics/video`
        : 'http://localhost:3000/api/public/analytics/video');

    this.sessionId    = getSessionId();
    this.deviceType   = getDeviceType(); // cache ครั้งเดียว
    this.country      = getCountry();

    this.currentUserId = null;
    this.buffer        = [];
    this.pendingFlush  = false;

    // dedup cache: key → timestamp
    this._dedupCache   = new Map();

    this._init();
  }

  // ── public API ─────────────────────────────────────────

  updateUserId(id) {
    this.currentUserId = id ?? null;
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
  console.log('[TRACKER IN]', {
    eventType: data.eventType,
    duration: data.duration,        // ← ถ้า undefined = VideoPlayer ไม่ส่งมา
    totalWatchTime: data.totalWatchTime,
    currentTime: data.currentTime,
    userId: data.userId,            // ← ถ้า undefined = userIdRef ไม่ทำงาน
    stack: new Error().stack.split('\n')[2], // ← บอกว่า call มาจากไหน
  });
    // ── dedup ──────────────────────────────────────────
    // key = video + eventType + currentTime ปัดวินาที
    // ป้องกัน timeupdate ยิง event เดิมซ้ำภายใน DEDUP_WINDOW_MS
    const dedupKey = `${data.videoId}|${data.eventType}|${Math.round(data.currentTime ?? 0)}`;
    const now = Date.now();
    const lastSeen = this._dedupCache.get(dedupKey);

    if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) {
      return; // ซ้ำ → ทิ้ง
    }

    this._dedupCache.set(dedupKey, now);
    this._cleanDedupCache(now);

    // ── build event ────────────────────────────────────
    // FIX: forward ทุก numeric/string field จาก VideoPlayer
    const event = {
      videoId:      data.videoId,
      userId:       data.userId ?? this.currentUserId ?? 'anonymous',
      sessionId:    this.sessionId,
      eventType:    data.eventType,
      // duration: วินาทีที่ดูจริงใน segment นี้ (watch/pause/close ส่งมา)
      duration:     typeof data.duration === 'number' ? Math.round(data.duration) : 0,
      // totalWatchTime: สะสมตลอด session
      totalWatchTime: typeof data.totalWatchTime === 'number'
        ? Math.round(data.totalWatchTime) : 0,
      currentTime:  typeof data.currentTime === 'number'
        ? Math.round(data.currentTime) : 0,
      device:       this.deviceType,
      country:      this.country,
      timestamp:    new Date().toISOString(),
    };

    this.buffer.push(event);

    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      this._flush();
    }
  }

  // ── private ────────────────────────────────────────────

  _init() {
    // interval flush
    setInterval(() => {
      if (this.buffer.length > 0) this._flush();
    }, FLUSH_INTERVAL);

    // flush ก่อน tab ปิด / hide
    window.addEventListener('beforeunload', () => this._flushSync());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this._flushSync();
    });
  }

  // flush ปกติ — async fetch
  async _flush() {
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

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

    } catch (err) {
      console.error('[VideoAnalytics] flush failed:', err.message);
      // คืน events กลับ buffer (prepend ไม่ให้ซ้ำกับของใหม่)
      this.buffer.unshift(...events);
    } finally {
      this.pendingFlush = false;
    }
  }

  // flush แบบ sync สำหรับ beforeunload/visibilitychange
  // sendBeacon ไม่ถูก browser cancel แม้ tab ปิด
  _flushSync() {
    if (this.buffer.length === 0) return;

    const events = this.buffer.splice(0);
    const payload = JSON.stringify({ events });

    const ok = navigator.sendBeacon?.(
      this.analyticsUrl,
      new Blob([payload], { type: 'application/json' }),
    );

    if (!ok) {
      // sendBeacon ไม่รองรับ → คืนกลับให้ flush ปกติจัดการ
      this.buffer.unshift(...events);
    }
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