module.exports = {
  login: {
    user: {
      maxAttempts: 5,
      window: 900, // 15 นาที (วินาที)
      lockMessage: 'Too many login attempts. Account locked for 15 minutes.'
    },
    ip: {
      maxAttempts: 20,
      window: 3600, // 1 ชั่วโมง
      lockMessage: 'Too many login attempts from this IP. Please try again later.'
    },
    block: {
      duration: 3600, // 1 ชั่วโมง สำหรับ IP ที่พยายามเกิน
      permanentThreshold: 50 // 50 ครั้งใน 24 ชั่วโมง
    }
  }
};