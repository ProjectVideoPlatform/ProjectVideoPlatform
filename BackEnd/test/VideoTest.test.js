const request = require('supertest');
const express = require('express');

/* ---------------- MOCKS ---------------- */
jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    req.user = {
      _id: 'user123',
      role: 'user',
      purchasedVideos: [],
      save: jest.fn()
    };
    next();
  },
  requireAdmin: (req, res, next) => next()
}));

jest.mock('../models/Video');
jest.mock('../models/Purchase');

jest.mock('../services/s3Upload', () => ({
  generatePresignedUploadUrl: jest.fn(),
  validateVideoFile: jest.fn(),
  validateFileSize: jest.fn()
}));

jest.mock('../services/mediaConvert', () => ({
  createMediaConvertJob: jest.fn()
}));

jest.mock('../services/cloudfront', () => ({
  generateSignedCookies: jest.fn(),
  setCookiesInResponse: jest.fn()
}));

jest.mock('../config/aws', () => ({
  config: {
    uploadsBucket: 'uploads-bucket',
    hlsOutputBucket: 'hls-bucket',
    cloudFrontDomain: 'cdn.example.com'
  }
}));

const Video = require('../models/Video');
const Purchase = require('../models/Purchase');
const {
  generatePresignedUploadUrl
} = require('../services/s3Upload');
const {
  createMediaConvertJob
} = require('../services/mediaConvert');
const {
  generateSignedCookies
} = require('../services/cloudfront');

const videoRoutes = require('../routes/videos');

/* ---------------- APP ---------------- */
const app = express();
app.use(express.json());
app.use('/videos', videoRoutes);

/* ---------------- TESTS ---------------- */
describe('Video Routes', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  /* ---------- VIDEO PROGRESS ---------- */
  it('GET /videos/video-progress returns lastTime', async () => {
    Purchase.findOne.mockResolvedValue({ lastTime: 120 });

    const res = await request(app)
      .get('/videos/video-progress')
      .query({ videoId: 'vid1' });

    expect(res.status).toBe(200);
    expect(res.body.lastTime).toBe(120);
  });

  it('POST /videos/video-progress saves progress', async () => {
    const saveMock = jest.fn();
    Purchase.findOne.mockResolvedValue({
      lastTime: 0,
      save: saveMock
    });

    const res = await request(app)
      .post('/videos/video-progress')
      .send({ videoId: 'vid1', currentTime: 55 });

    expect(res.status).toBe(200);
    expect(saveMock).toHaveBeenCalled();
  });

  /* ---------- VIDEO LIST ---------- */
  it('GET /videos returns completed videos', async () => {
    Video.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([
        {
          _id: 'v1',
          toObject: () => ({ title: 'Test Video' })
        }
      ])
    });

    Video.countDocuments.mockResolvedValue(1);
    
    // แก้ไข: เพิ่ม chain method distinct ให้กับ Purchase.find
    Purchase.find.mockReturnValue({
      distinct: jest.fn().mockResolvedValue([])
    });

    const res = await request(app).get('/videos');

    expect(res.status).toBe(200);
    expect(res.body.videos.length).toBe(1);
  });

  /* ---------- SINGLE VIDEO ---------- */
  it('GET /videos/:id returns video info', async () => {
    Video.findOne.mockResolvedValue({
      _id: 'v1',
      id: 'vid1',
      uploadStatus: 'completed',
      toObject: () => ({ title: 'Video' })
    });

    Purchase.findOne.mockResolvedValue(null);

    const res = await request(app).get('/videos/vid1');

    expect(res.status).toBe(200);
    expect(res.body.video.title).toBe('Video');
  });

  /* ---------- UPLOAD INITIALIZE ---------- */
  it('POST /videos/upload/initialize initializes upload', async () => {
    Video.mockImplementation(() => ({
      save: jest.fn()
    }));

    generatePresignedUploadUrl.mockResolvedValue({
      uploadUrl: 'https://s3-upload',
      s3Key: 'key',
      fields: {}
    });

    const res = await request(app)
      .post('/videos/upload/initialize')
      .send({
        title: 'New Video',
        fileName: 'video.mp4',
        fileSize: 1000,
        contentType: 'video/mp4'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  /* ---------- UPLOAD COMPLETE ---------- */
  it('POST /videos/upload/:id/complete starts MediaConvert', async () => {
    const saveMock = jest.fn();

    Video.findOne.mockResolvedValue({
      id: 'vid1',
      uploadStatus: 'uploading',
      originalFileName: 'video.mp4',
      save: saveMock
    });

    createMediaConvertJob.mockResolvedValue({ Id: 'job123' });

    const res = await request(app)
      .post('/videos/upload/vid1/complete');

    expect(res.status).toBe(200);
    expect(res.body.jobId).toBe('job123');
  });

  /* ---------- PURCHASE ---------- */
  it('POST /videos/:id/purchase purchases video', async () => {
    Video.findOne.mockResolvedValue({
      _id: 'v1',
      price: 99
    });

    Purchase.findOne.mockResolvedValue(null);
    Purchase.mockImplementation(() => ({
      save: jest.fn()
    }));

    const res = await request(app)
      .post('/videos/v1/purchase');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  /* ---------- PLAY ---------- */
  it('POST /videos/:id/play returns manifest URL', async () => {
    Video.findOne.mockResolvedValue({
      _id: 'v1',
      id: 'vid1',
      uploadStatus: 'completed'
    });

    Purchase.hasAccess = jest.fn().mockResolvedValue(true);
    Purchase.findOne.mockResolvedValue({ recordAccess: jest.fn() });

    generateSignedCookies.mockReturnValue({
      cookies: { CloudFront: 'cookie' },
      expiresIn: 900
    });

    const res = await request(app)
      .post('/videos/v1/play');

    expect(res.status).toBe(200);
    expect(res.body.manifestUrl).toContain('.m3u8');
  });

  /* ---------- WEBHOOK ---------- */
  it('POST /videos/mediaconvert/webhook updates video status', async () => {
    Video.findOne.mockResolvedValue({
      uploadStatus: 'processing',
      save: jest.fn()
    });

    const res = await request(app)
      .post('/videos/mediaconvert/webhook')
      .send({
        detail: {
          status: 'COMPLETE',
          userMetadata: { VideoId: 'vid1' }
        }
      });

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });
});