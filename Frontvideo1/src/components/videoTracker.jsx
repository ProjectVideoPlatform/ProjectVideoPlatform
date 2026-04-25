'use strict';

// ── constants ──────────────────────────────────────────────────────────────────
const VALID_EVENT_TYPES = new Set([
  'play', 'watch', 'watch_chunk', 'pause', 'seek', 'completed', 'close', 'error',
  'tab_hide', 'tab_show',   // FIX: เพิ่ม event types ใหม่จาก VideoPlayer
  'buffer_start', 'buffer_end',
]);

const DEDUP_WINDOW_MS     = 300;
const MAX_DEDUP_CACHE     = 200;
const FLUSH_INTERVAL      = 5_000;
const MAX_BUFFER_SIZE     = 10;
const ADAPTIVE_BURST_SIZE = 50;
const CHUNK_MAX_AGE_MS    = 30_000;  // ใหม่: ตัด chunk ทุก 30 วินาที
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

// FIX #1: stable event_id per event (ไม่ใช้ currentTime ซึ่งเปลี่ยนตลอด)
function generateEventId() {
  return crypto.randomUUID();
}

// ── class ──────────────────────────────────────────────────────────────────────
class VideoAnalytics {
  constructor() {
    this.analyticsUrl = '/api/public/analytics/video';

    this.sessionId  = getSessionId();
    this.deviceType = getDeviceType();
    this.country    = getCountry();

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


  forceFlushChunk() {
    this._flushWatchChunk();
  }

  flushAndBeacon() {
    this._flushWatchChunk();
    this._flushSync();
  }

  destroy() {
    if (this._intervalId) clearInterval(this._intervalId);
    this._intervalId = null;
  }

  trackVideoEvent(data) {
    // FIX: รองรับทั้ง videoId (camelCase จาก VideoPlayer) และ video_id (snake_case)
    const videoId   = data?.videoId   ?? data?.video_id;
    const eventType = data?.eventType ?? data?.event_type;

    if (!videoId || !eventType) {
      console.warn('[VideoAnalytics] missing videoId or eventType', data);
      return;
    }
    if (!VALID_EVENT_TYPES.has(eventType)) {
      console.warn('[VideoAnalytics] unknown eventType:', eventType);
      return;
    }

    // ── dedup (ใช้ eventType ที่ normalize แล้ว) ───────────────────────────────
    const currentTimeSec = data.current_time_seconds ?? data.currentTime ?? 0;
    const dedupKey = eventType === 'watch' || eventType === 'watch_chunk'
      ? `${videoId}|watch|${Math.floor(Date.now() / DEDUP_WINDOW_MS)}|${Math.round(currentTimeSec)}`
      : `${videoId}|${eventType}|${Math.round(currentTimeSec)}`;
    const now      = Date.now();
    const lastSeen = this._dedupCache.get(dedupKey);
    if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) return;

    this._dedupCache.set(dedupKey, now);
    this._cleanDedupCache(now);
    this._lastEventAt = now;

    // ── FIX #2: build event ด้วย field names ที่ Worker คาดหวัง (snake_case) ──
    const watchDuration   = data.watch_duration_seconds ?? data.duration ?? 0;
    const totalWatch      = data.total_watch_seconds    ?? data.totalWatchTime ?? 0;
    const chunkStart      = data.chunk_start_seconds;
    const chunkEnd        = data.chunk_end_seconds;
    const maxProgress     = data.max_progress_seconds   ?? Math.round(currentTimeSec);

    const event = {
      event_id:              data.event_id ?? generateEventId(),   // FIX #1: มี event_id เสมอ
      video_id:              videoId,
      session_id:            data.session_id ?? data.sessionId ?? this.sessionId,
      event_type:            eventType,
     category:              data.video_category ?? 'unknown', // ✅ ได้ Category ไปให้ Python แล้ว
      watch_duration_seconds: typeof watchDuration === 'number' ? Math.round(watchDuration) : 0,
      total_watch_seconds:    typeof totalWatch    === 'number' ? Math.round(totalWatch)    : 0,
      current_time_seconds:   typeof currentTimeSec === 'number' ? Math.round(currentTimeSec) : 0,

      // chunk fields — ใส่เฉพาะเมื่อมีค่า (undefined จะถูก strip ทีหลัง)
      chunk_start_seconds:   typeof chunkStart === 'number' ? Math.round(chunkStart) : undefined,
      chunk_end_seconds:     typeof chunkEnd   === 'number' ? Math.round(chunkEnd)   : undefined,
      max_progress_seconds:  typeof maxProgress === 'number' ? Math.round(maxProgress) : 0,

      device_type:   this.deviceType,
      country_code:  this.country,
      event_time:    new Date().toISOString(),

      // optional fields
      ...(data.reason            && { reason:                  data.reason }),
      ...(data.errorCode         && { error_code:              data.errorCode }),
      ...(data.error_code        && { error_code:              data.error_code }),
      ...(data.errorMessage      && { error_message:           data.errorMessage }),
      ...(data.error_message     && { error_message:           data.error_message }),
      ...(data.videoDuration     && { video_duration_seconds:  Math.round(data.videoDuration) }),
      ...(data.seek_from_seconds !== undefined && { seek_from_seconds:  Math.round(data.seek_from_seconds) }),
      ...(data.seek_delta_seconds !== undefined && { seek_delta_seconds: Math.round(data.seek_delta_seconds) }),
      ...(data.buffered_ranges   && { buffered_ranges:         data.buffered_ranges }),
      ...(data.buffer_duration_ms !== undefined && { buffer_duration_ms: data.buffer_duration_ms }),
    };

    // strip undefined fields
    Object.keys(event).forEach(k => event[k] === undefined && delete event[k]);

   const coalesced = this._coalesceWatch(event);
  if (coalesced === null) {
    if (this.buffer.length >= MAX_BUFFER_SIZE) this._flush();
    return;
  }

  this.buffer.push(coalesced);

  // ✅ Flush ทันทีถ้าเป็น critical event หรือ buffer เริ่มเยอะ
  const CRITICAL_EVENTS = ['play', 'pause', 'completed', 'error', 'close'];
  if (CRITICAL_EVENTS.includes(coalesced.event_type) || this.buffer.length >= MAX_BUFFER_SIZE) {
    this._flush();
  }
}
  // ── private: coalescer ─────────────────────────────────────────────────────

 _coalesceWatch(event) {
  if (event.event_type !== 'watch' && event.event_type !== 'watch_chunk') {
    this._flushWatchChunk();
    return event;
  }

  const chunkStart = typeof event.chunk_start_seconds === 'number'
    ? event.chunk_start_seconds
    : Math.max(0, event.current_time_seconds - (event.watch_duration_seconds || 0));
  const chunkEnd = typeof event.chunk_end_seconds === 'number'
    ? event.chunk_end_seconds
    : event.current_time_seconds;

  if (!this._watchChunk) {
    this._watchChunk = {
      ...event,
      _firstSeen: Date.now(),   // ✅ เก็บเวลาเริ่มสร้าง
      event_type:             'watch_chunk',
      chunk_start_seconds:    chunkStart,
      chunk_end_seconds:      chunkEnd,
      max_progress_seconds:   chunkEnd,
      watch_duration_seconds: event.watch_duration_seconds || 0,
    };
    return null;
  }

  const prevEnd    = this._watchChunk.chunk_end_seconds;
  const gap        = chunkStart - prevEnd;
  const chunkAgeMs = Date.now() - (this._watchChunk._firstSeen || 0);

  // ✅ ตัด chunk ถ้านานเกิน 30 วินาที หรือ gap กระโดด
  if (chunkAgeMs > CHUNK_MAX_AGE_MS || Math.abs(gap) > 2) {
    this._flushWatchChunk();
    this._watchChunk = {
      ...event,
      _firstSeen:             Date.now(),
      event_type:             'watch_chunk',
      chunk_start_seconds:    chunkStart,
      chunk_end_seconds:      chunkEnd,
      max_progress_seconds:   chunkEnd,
      watch_duration_seconds: event.watch_duration_seconds || 0,
    };
    return null;
  }

  // สะสมต่อ
  this._watchChunk.chunk_end_seconds    = chunkEnd;
  this._watchChunk.max_progress_seconds = Math.max(this._watchChunk.max_progress_seconds || 0, chunkEnd);
  this._watchChunk.watch_duration_seconds =
    (this._watchChunk.watch_duration_seconds || 0) + (event.watch_duration_seconds || 0);
  if (typeof event.total_watch_seconds === 'number') {
    this._watchChunk.total_watch_seconds = Math.max(
      this._watchChunk.total_watch_seconds || 0,
      event.total_watch_seconds,
    );
  }
  this._watchChunk.event_id   = generateEventId();
  this._watchChunk.event_time = event.event_time;
  return null;
}
  _flushWatchChunk() {
    if (!this._watchChunk) return;

    const { chunk_start_seconds, chunk_end_seconds, watch_duration_seconds } = this._watchChunk;
    const positionSpan = chunk_end_seconds - chunk_start_seconds;

    // FIX #3: ไม่ drop เงียบๆ — log แล้วยังส่ง (ข้อมูลเล็กก็มีประโยชน์)
    if (positionSpan < 0.5 || watch_duration_seconds < 0.5) {
      console.debug('[VideoAnalytics] small watch_chunk, sending anyway:', {
        positionSpan, duration: watch_duration_seconds,
      });
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
        credentials: 'include',
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
    this._isFlushing  = false;
    this._flushQueued = false;
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