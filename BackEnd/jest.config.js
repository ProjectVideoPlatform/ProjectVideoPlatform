module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'routes/**/*.js',
    'models/**/*.js',
    'controllers/**/*.js',
    'services/**/*.js',
    'middleware/**/*.js',
    'utils/**/*.js',
    '!**/*.test.js',
    '!**/node_modules/**'
  ],
  testMatch: ['**/test/**/*.test.js'],
  coverageProvider: 'v8', // เพิ่มบรรทัดนี้เข้าไปครับ,
  // ลบ transformIgnorePatterns ออก
  // ลบ moduleNameMapper ออก
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  verbose: true
};