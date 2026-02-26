// VideoTracker.jsx
class VideoAnalytics {
    constructor(config) {
        // ✅ ต้องประกาศ properties ก่อน
        this.analyticsUrl = config.analyticsUrl || 'http://localhost:3000/api/public/analytics/video';
        this.buffer = [];
        this.flushInterval = 5000;
        this.maxBufferSize = 20;
        this.pendingFlush = false;
        this.currentUserId = null; // เรียก getUserId ใน constructor เพื่อกำหนดค่าเริ่มต้น
        // ✅ เรียก generateSessionId หลังจากประกาศ method แล้ว
        this.sessionId = this.generateSessionId();  // ตอนนี้ generateSessionId ถูกประกาศแล้ว
        
        this.init();
    }
// เพิ่มไว้ใน class VideoAnalytics
updateUserId(newId) {
    if (newId) {
        console.log('🔄 Analytics UserID updated to:', newId);
        this.currentUserId = newId;
    } else {
        console.log('🧹 Analytics UserID cleared (Logout)');
        // กลับไปใช้ Guest ID หรือสุ่มใหม่
        this.currentUserId = null;
    }
}
    // ✅ method declarations อยู่ข้างบนทั้งหมด
    generateSessionId() {
        let sessionId = sessionStorage.getItem('analytics_session_id');
        if (!sessionId) {
            sessionId = 'sess_' + Math.random().toString(36).substr(2, 9);
            sessionStorage.setItem('analytics_session_id', sessionId);
        }
        return sessionId;
    }

 

    getDeviceInfo() {
        const ua = navigator.userAgent;
        if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
            return 'tablet';
        }
        if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) {
            return 'mobile';
        }
        return 'desktop';
    }

    getCountry() {
        const metaTag = document.querySelector('meta[name="country"]');
        if (metaTag) {
            return metaTag.getAttribute('content');
        }
        return 'TH';
    }

    init() {
        // ใช้ fetch อย่างเดียว ไม่ใช้ beacon
        setInterval(() => this.flush(), this.flushInterval);
        
        window.addEventListener('beforeunload', () => {
            if (this.buffer.length > 0) {
                this.flush(true);
            }
        });
    }

    trackVideoEvent(data) {
        // ✅ ตรวจสอบ data
        if (!data || typeof data !== 'object') {
            console.error('❌ Invalid data:', data);
            return;
        }

        const event = {
            videoId: data.videoId || '',
            userId: data.userId || this.currentUserId ,
            device: this.getDeviceInfo(),
            country: this.getCountry(),
            eventType: data.eventType || 'unknown',
            currentTime: data.currentTime || 0,
            sessionId: this.sessionId,
            timestamp: new Date().toISOString()
        };

        // ✅ ตรวจสอบข้อมูลสำคัญ
        if (!event.videoId) {
            console.warn('⚠️ Missing videoId');
        }
        if (!event.eventType) {
            console.warn('⚠️ Missing eventType');
        }

        this.buffer.push(event);
        console.log('📊 Analytics event:', event);

        if (this.buffer.length >= this.maxBufferSize) {
            this.flush();
        }
    }

    async flush(force = false) {
        if (this.pendingFlush || this.buffer.length === 0) return;

        this.pendingFlush = true;
        const events = [...this.buffer];
        this.buffer = [];

        try {
            console.log(`📤 Sending ${events.length} events to ${this.analyticsUrl}`);
            
            const response = await fetch(this.analyticsUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    events: events,
                    batch: true
                }),
                keepalive: true
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`HTTP ${response.status}: ${text}`);
            }

            const result = await response.json();
            console.log(`✅ Flushed ${events.length} events:`, result);

        } catch (error) {
            console.error('❌ Flush failed:', error);
            if (!force) {
                this.buffer = [...events, ...this.buffer];
            }
        } finally {
            this.pendingFlush = false;
        }
    }
}

// ✅ Create singleton instance
const videoAnalytics = new VideoAnalytics({
    analyticsUrl: 'http://localhost:3000/api/public/analytics/video'
});

export default videoAnalytics;