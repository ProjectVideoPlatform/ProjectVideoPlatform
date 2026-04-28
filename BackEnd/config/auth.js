const jwtConfig = {
  secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key',
  expiresIn: '24h',
  refreshSecret: process.env.JWT_REFRESH_SECRET || 'your-super-refresh-jwt-key', // ✅ เพิ่ม
};

module.exports = jwtConfig;