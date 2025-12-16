const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => next(),
  requireAdmin: (req, res, next) => next()
}));

jest.mock('../models/Video');
jest.mock('../models/User');
jest.mock('../models/Purchase');
jest.mock('../services/mediaConvert');

const Video = require('../models/Video');
const User = require('../models/User');
const Purchase = require('../models/Purchase');
const mediaConvert = require('../services/mediaConvert');

const adminRoutes = require('../routes/admin');

const app = express();
app.use(express.json());
app.use('/admin', adminRoutes);

describe('Admin Routes', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /admin/videos', () => {
    it('should return paginated videos', async () => {
      Video.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([
          { _id: '1', title: 'Test Video', toObject: () => ({ title: 'Test Video' }) }
        ])
      });

      Video.countDocuments.mockResolvedValue(1);
      Purchase.aggregate.mockResolvedValue([]);

      const res = await request(app).get('/admin/videos');

      expect(res.status).toBe(200);
      expect(res.body.videos).toHaveLength(1);
      expect(res.body.pagination.total).toBe(1);
    });
  });

  describe('GET /admin/videos/:id/analytics', () => {
    it('should return video analytics', async () => {
      Video.findOne.mockResolvedValue({
        _id: '123',
        id: 'vid001',
        title: 'Analytics Video',
        uploadStatus: 'completed',
        createdAt: new Date()
      });

      // แก้ไข: เพิ่ม chain methods ให้กับ Purchase.find
      Purchase.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue([
          { amount: 100, accessCount: 2 }
        ])
      });

      Purchase.aggregate.mockResolvedValue([]);

      const res = await request(app).get('/admin/videos/vid001/analytics');

      expect(res.status).toBe(200);
      expect(res.body.analytics.totalRevenue).toBe(100);
    });
  });

  describe('PUT /admin/videos/:id', () => {
    it('should update video details', async () => {
      const saveMock = jest.fn();

      Video.findOne.mockResolvedValue({
        title: 'Old',
        save: saveMock
      });

      const res = await request(app)
        .put('/admin/videos/vid001')
        .send({ title: 'New Title', price: 199 });

      expect(res.status).toBe(200);
      expect(saveMock).toHaveBeenCalled();
    });
  });

  describe('DELETE /admin/videos/:id', () => {
    it('should soft delete video', async () => {
      const saveMock = jest.fn();

      Video.findOne.mockResolvedValue({
        uploadStatus: 'completed',
        save: saveMock
      });

      const res = await request(app).delete('/admin/videos/vid001');

      expect(res.status).toBe(200);
      expect(saveMock).toHaveBeenCalled();
    });
  });

  describe('GET /admin/users', () => {
    it('should return users list', async () => {
      User.find.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([
          { _id: 'u1', email: 'admin@test.com', toObject: () => ({ email: 'admin@test.com' }) }
        ])
      });

      User.countDocuments.mockResolvedValue(1);
      Purchase.aggregate.mockResolvedValue([]);

      const res = await request(app).get('/admin/users');

      expect(res.status).toBe(200);
      expect(res.body.users).toHaveLength(1);
    });
  });

  describe('GET /admin/dashboard/stats', () => {
    it('should return dashboard statistics', async () => {
      Video.countDocuments
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(1);

      User.countDocuments.mockResolvedValue(5);
      Purchase.countDocuments.mockResolvedValue(20);
      Purchase.aggregate
        .mockResolvedValueOnce([{ total: 5000 }])
        .mockResolvedValueOnce([]);

      const res = await request(app).get('/admin/dashboard/stats');

      expect(res.status).toBe(200);
      expect(res.body.stats.totalRevenue).toBe(5000);
    });
  });
});