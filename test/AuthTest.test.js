const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

jest.mock('../models/User');
jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    req.user = {
      _id: 'user123',
      email: 'test@test.com',
      role: 'user'
    };
    next();
  }
}));

jest.mock('../config/auth', () => ({
  secret: 'test-secret',
  expiresIn: '1h'
}));

const User = require('../models/User');
const authRoutes = require('../routes/auth');

const app = express();
app.use(express.json());
app.use('/auth', authRoutes);

describe('Auth Routes', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // ---------------- REGISTER ----------------
  describe('POST /auth/register', () => {
    it('should register a new user', async () => {
      User.findOne.mockResolvedValue(null);
      User.mockImplementation(() => ({
        _id: 'user123',
        email: 'test@test.com',
        role: 'user',
        save: jest.fn()
      }));

      const res = await request(app)
        .post('/auth/register')
        .send({ email: 'test@test.com', password: '123456' });

      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe('test@test.com');
    });

    it('should reject missing email or password', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({ email: '' });

      expect(res.status).toBe(400);
    });

    it('should reject duplicate user', async () => {
      User.findOne.mockResolvedValue({ email: 'test@test.com' });

      const res = await request(app)
        .post('/auth/register')
        .send({ email: 'test@test.com', password: '123456' });

      expect(res.status).toBe(400);
    });
  });

  // ---------------- LOGIN ----------------
  describe('POST /auth/login', () => {
    it('should login successfully', async () => {
      User.findOne.mockResolvedValue({
        _id: 'user123',
        email: 'test@test.com',
        role: 'user',
        comparePassword: jest.fn().mockResolvedValue(true)
      });

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'test@test.com', password: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
    });

    it('should reject invalid credentials', async () => {
      User.findOne.mockResolvedValue(null);

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'wrong@test.com', password: '123456' });

      expect(res.status).toBe(401);
    });
  });

  // ---------------- ME ----------------
  describe('GET /auth/me', () => {
    it('should return current user profile', async () => {
      User.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        populate: jest.fn().mockResolvedValue({
          email: 'test@test.com',
          role: 'user'
        })
      });

      const res = await request(app).get('/auth/me');

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('test@test.com');
    });
  });

  // ---------------- VERIFY ----------------
  describe('GET /auth/verify', () => {
    it('should verify token and return user info', async () => {
      const res = await request(app).get('/auth/verify');

      expect(res.status).toBe(200);
      expect(res.body.loggedIn).toBe(true);
      expect(res.body.user.email).toBe('test@test.com');
    });
  });

  // ---------------- REFRESH ----------------
  describe('POST /auth/refresh', () => {
    it('should refresh JWT token', async () => {
      const res = await request(app).post('/auth/refresh');

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
    });
  });
});
