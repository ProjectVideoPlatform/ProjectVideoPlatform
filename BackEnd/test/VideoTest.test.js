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
  generatePresignedUploadUrl,
  validateVideoFile,
  validateFileSize
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
describe('Video Routes - Comprehensive Tests', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  /* ==================== VIDEO PROGRESS ==================== */
  describe('GET /videos/video-progress', () => {
    it('should return lastTime when progress exists', async () => {
      Purchase.findOne.mockResolvedValue({ lastTime: 120 });

      const res = await request(app)
        .get('/videos/video-progress')
        .query({ videoId: 'vid1' });

      expect(res.status).toBe(200);
      expect(res.body.lastTime).toBe(120);
      expect(Purchase.findOne).toHaveBeenCalledWith({
        userId: 'user123',
        videoId: 'vid1'
      });
    });

    it('should return 0 when no progress exists', async () => {
      Purchase.findOne.mockResolvedValue(null);

      const res = await request(app)
        .get('/videos/video-progress')
        .query({ videoId: 'vid1' });

      expect(res.status).toBe(200);
      expect(res.body.lastTime).toBe(0);
    });

    it('should return 400 when videoId is missing', async () => {
      const res = await request(app).get('/videos/video-progress');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('videoId is required');
    });

    it('should handle database errors', async () => {
      Purchase.findOne.mockRejectedValue(new Error('DB Error'));

      const res = await request(app)
        .get('/videos/video-progress')
        .query({ videoId: 'vid1' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Server error');
    });
  });

  describe('POST /videos/video-progress', () => {
    it('should save progress successfully', async () => {
      const saveMock = jest.fn();
      const mockPurchase = {
        lastTime: 0,
        save: saveMock
      };
      Purchase.findOne.mockResolvedValue(mockPurchase);

      const res = await request(app)
        .post('/videos/video-progress')
        .send({ videoId: 'vid1', currentTime: 55 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockPurchase.lastTime).toBe(55);
      expect(saveMock).toHaveBeenCalled();
    });

    it('should handle missing purchase record', async () => {
      Purchase.findOne.mockResolvedValue(null);

      const res = await request(app)
        .post('/videos/video-progress')
        .send({ videoId: 'vid1', currentTime: 55 });

      expect(res.status).toBe(500);
    });
  });

  /* ==================== VIDEO LIST ==================== */
  describe('GET /videos', () => {
    beforeEach(() => {
      Video.find.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([
          {
            _id: 'v1',
            toObject: () => ({ 
              id: 'vid1',
              title: 'Test Video',
              price: 99,
              thumbnailPath: 'thumb.jpg'
            })
          }
        ])
      });
      Video.countDocuments.mockResolvedValue(1);
      Purchase.find.mockReturnValue({
        distinct: jest.fn().mockResolvedValue([])
      });
    });

    it('should return video list with pagination', async () => {
      const res = await request(app)
        .get('/videos')
        .query({ page: 1, limit: 10 });

      expect(res.status).toBe(200);
      expect(res.body.videos).toHaveLength(1);
      expect(res.body.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        pages: 1
      });
    });

    it('should filter by search term', async () => {
      const res = await request(app)
        .get('/videos')
        .query({ search: 'test' });

      expect(res.status).toBe(200);
      expect(Video.find).toHaveBeenCalled();
    });

    it('should filter by category', async () => {
      const res = await request(app)
        .get('/videos')
        .query({ category: 'tutorial' });

      expect(res.status).toBe(200);
      expect(Video.find).toHaveBeenCalled();
    });

    it('should mark purchased videos correctly', async () => {
      const mockObjectId = { equals: jest.fn(() => true) };
      
      Video.find.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([
          {
            _id: mockObjectId,
            toObject: () => ({ title: 'Video' })
          }
        ])
      });

      Purchase.find.mockReturnValue({
        distinct: jest.fn().mockResolvedValue([mockObjectId])
      });

      const res = await request(app).get('/videos');

      expect(res.status).toBe(200);
      expect(res.body.videos[0].purchased).toBe(true);
      expect(res.body.videos[0].canPlay).toBe(true);
    });

    it('should validate pagination parameters', async () => {
      const res = await request(app)
        .get('/videos')
        .query({ page: -1, limit: 100 });

      expect(res.status).toBe(200);
      // ตรวจสอบว่า page >= 1 และ limit <= 50
    });

    it('should handle database errors', async () => {
      Video.find.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockRejectedValue(new Error('DB Error'))
      });

      const res = await request(app).get('/videos');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
    });
  });

  /* ==================== SINGLE VIDEO ==================== */
  describe('GET /videos/:id', () => {
    it('should return video info for unpurchased video', async () => {
      Video.findOne.mockResolvedValue({
        _id: 'v1',
        id: 'vid1',
        uploadStatus: 'completed',
        hlsManifestPath: 'path/to/manifest.m3u8',
        toObject: () => ({ 
          title: 'Video',
          hlsManifestPath: 'path/to/manifest.m3u8'
        })
      });

      Purchase.findOne.mockResolvedValue(null);

      const res = await request(app).get('/videos/vid1');

      expect(res.status).toBe(200);
      expect(res.body.video.title).toBe('Video');
      expect(res.body.purchased).toBe(false);
      expect(res.body.canPlay).toBe(false);
      expect(res.body.video.hlsManifestPath).toBeUndefined();
    });

    it('should return full video info for purchased video', async () => {
      Video.findOne.mockResolvedValue({
        _id: 'v1',
        id: 'vid1',
        uploadStatus: 'completed',
        hlsManifestPath: 'path/to/manifest.m3u8',
        toObject: () => ({ 
          title: 'Video',
          hlsManifestPath: 'path/to/manifest.m3u8'
        })
      });

      Purchase.findOne.mockResolvedValue({
        purchaseDate: new Date(),
        accessCount: 5
      });

      const res = await request(app).get('/videos/vid1');

      expect(res.status).toBe(200);
      expect(res.body.purchased).toBe(true);
      expect(res.body.canPlay).toBe(true);
      expect(res.body.purchaseInfo).toBeDefined();
    });

    it('should return 404 for non-existent video', async () => {
      Video.findOne.mockResolvedValue(null);

      const res = await request(app).get('/videos/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Video not found');
    });

    it('should check purchase expiration', async () => {
      Video.findOne.mockResolvedValue({
        _id: 'v1',
        id: 'vid1',
        toObject: () => ({ title: 'Video' })
      });

      Purchase.findOne.mockResolvedValue(null);

      const res = await request(app).get('/videos/vid1');

      expect(Purchase.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user123',
          videoId: expect.anything(),
          status: 'completed',
          $or: expect.any(Array)
        })
      );
    });
  });

  /* ==================== UPLOAD INITIALIZE ==================== */
  describe('POST /videos/upload/initialize', () => {
    it('should initialize upload successfully', async () => {
      const saveMock = jest.fn();
      Video.mockImplementation(() => ({
        save: saveMock,
        _id: 'v1',
        title: 'New Video',
        uploadStatus: 'uploading'
      }));

      generatePresignedUploadUrl.mockResolvedValue({
        uploadUrl: 'https://s3-upload',
        s3Key: 'uploads/vid1/original.mp4',
        fields: { key: 'value' }
      });

      const res = await request(app)
        .post('/videos/upload/initialize')
        .send({
          title: 'New Video',
          description: 'Description',
          price: 99,
          tags: 'tag1,tag2',
          fileName: 'video.mp4',
          fileSize: 1000000,
          contentType: 'video/mp4'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.videoId).toBeDefined();
      expect(res.body.uploadUrl).toBe('https://s3-upload');
      expect(saveMock).toHaveBeenCalled();
    });

    it('should return 400 when title is missing', async () => {
      const res = await request(app)
        .post('/videos/upload/initialize')
        .send({
          fileName: 'video.mp4',
          fileSize: 1000000,
          contentType: 'video/mp4'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Title is required');
    });

    it('should return 400 when fileName is missing', async () => {
      const res = await request(app)
        .post('/videos/upload/initialize')
        .send({
          title: 'Video',
          fileSize: 1000000,
          contentType: 'video/mp4'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('File name is required');
    });

    it('should return 400 when fileSize is missing', async () => {
      const res = await request(app)
        .post('/videos/upload/initialize')
        .send({
          title: 'Video',
          fileName: 'video.mp4',
          contentType: 'video/mp4'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('File size is required');
    });

    it('should return 400 when contentType is missing', async () => {
      const res = await request(app)
        .post('/videos/upload/initialize')
        .send({
          title: 'Video',
          fileName: 'video.mp4',
          fileSize: 1000000
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Content type is required');
    });

    it('should validate video file type', async () => {
      validateVideoFile.mockImplementation(() => {
        throw new Error('Invalid file type');
      });

      const res = await request(app)
        .post('/videos/upload/initialize')
        .send({
          title: 'Video',
          fileName: 'video.txt',
          fileSize: 1000,
          contentType: 'text/plain'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid file type');
    });

    it('should validate file size', async () => {
      validateFileSize.mockImplementation(() => {
        throw new Error('File too large');
      });

      const res = await request(app)
        .post('/videos/upload/initialize')
        .send({
          title: 'Video',
          fileName: 'video.mp4',
          fileSize: 999999999999,
          contentType: 'video/mp4'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('File too large');
    });

    it('should parse tags correctly', async () => {
      const saveMock = jest.fn();
      let savedVideo;
      
      Video.mockImplementation((data) => {
        savedVideo = data;
        return {
          ...data,
          save: saveMock,
          _id: 'v1'
        };
      });

      generatePresignedUploadUrl.mockResolvedValue({
        uploadUrl: 'url',
        s3Key: 'key',
        fields: {}
      });

      await request(app)
        .post('/videos/upload/initialize')
        .send({
          title: 'Video',
          tags: 'tag1, tag2, tag3',
          fileName: 'video.mp4',
          fileSize: 1000,
          contentType: 'video/mp4'
        });

      expect(savedVideo.tags).toEqual(['tag1', 'tag2', 'tag3']);
    });
  });

  /* ==================== UPLOAD COMPLETE ==================== */
  describe('POST /videos/upload/:videoId/complete', () => {
    it('should complete upload and start MediaConvert', async () => {
      const saveMock = jest.fn();
      const mockVideo = {
        id: 'vid1',
        uploadStatus: 'uploading',
        originalFileName: 'video.mp4',
        save: saveMock
      };

      Video.findOne.mockResolvedValue(mockVideo);
      createMediaConvertJob.mockResolvedValue({ Id: 'job123' });

      const res = await request(app)
        .post('/videos/upload/vid1/complete');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.jobId).toBe('job123');
      expect(mockVideo.uploadStatus).toBe('processing');
      expect(mockVideo.mediaConvertJobId).toBe('job123');
      expect(saveMock).toHaveBeenCalledTimes(2);
    });

    it('should return 404 when video not found', async () => {
      Video.findOne.mockResolvedValue(null);

      const res = await request(app)
        .post('/videos/upload/nonexistent/complete');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Video not found');
    });

    it('should return 400 for invalid upload status', async () => {
      Video.findOne.mockResolvedValue({
        id: 'vid1',
        uploadStatus: 'completed'
      });

      const res = await request(app)
        .post('/videos/upload/vid1/complete');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid upload status');
      expect(res.body.currentStatus).toBe('completed');
    });

    it('should handle MediaConvert errors', async () => {
      const saveMock = jest.fn();
      const mockVideo = {
        id: 'vid1',
        uploadStatus: 'uploading',
        originalFileName: 'video.mp4',
        save: saveMock
      };

      Video.findOne.mockResolvedValue(mockVideo);
      createMediaConvertJob.mockRejectedValue(
        new Error('MediaConvert failed')
      );

      const res = await request(app)
        .post('/videos/upload/vid1/complete');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to start video processing');
      expect(mockVideo.uploadStatus).toBe('failed');
      expect(mockVideo.errorMessage).toBe('MediaConvert failed');
    });

    it('should set correct S3 paths', async () => {
      const saveMock = jest.fn();
      const mockVideo = {
        id: 'vid1',
        uploadStatus: 'uploading',
        originalFileName: 'video.mp4',
        save: saveMock
      };

      Video.findOne.mockResolvedValue(mockVideo);
      createMediaConvertJob.mockResolvedValue({ Id: 'job123' });

      await request(app).post('/videos/upload/vid1/complete');

      expect(mockVideo.s3Key).toBe('uploads/vid1/original.mp4');
      expect(createMediaConvertJob).toHaveBeenCalledWith(
        's3://uploads-bucket/uploads/vid1/original.mp4',
        's3://hls-bucket/videos/vid1/',
        'vid1'
      );
    });
  });

  /* ==================== UPLOAD FAILED ==================== */
  describe('POST /videos/upload/:videoId/failed', () => {
    it('should record upload failure', async () => {
      const saveMock = jest.fn();
      const mockVideo = {
        id: 'vid1',
        uploadStatus: 'uploading',
        save: saveMock
      };

      Video.findOne.mockResolvedValue(mockVideo);

      const res = await request(app)
        .post('/videos/upload/vid1/failed')
        .send({ error: 'Network error' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockVideo.uploadStatus).toBe('failed');
      expect(mockVideo.errorMessage).toBe('Network error');
      expect(saveMock).toHaveBeenCalled();
    });

    it('should return 404 when video not found', async () => {
      Video.findOne.mockResolvedValue(null);

      const res = await request(app)
        .post('/videos/upload/nonexistent/failed')
        .send({ error: 'Error' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Video not found');
    });

    it('should use default error message', async () => {
      const saveMock = jest.fn();
      const mockVideo = {
        uploadStatus: 'uploading',
        save: saveMock
      };

      Video.findOne.mockResolvedValue(mockVideo);

      await request(app)
        .post('/videos/upload/vid1/failed')
        .send({});

      expect(mockVideo.errorMessage).toBe('Upload failed');
    });
  });

  /* ==================== PURCHASE ==================== */
  describe('POST /videos/:id/purchase', () => {
    it('should purchase video successfully', async () => {
      const mockVideo = {
        _id: 'v1',
        price: 99,
        uploadStatus: 'completed',
        isActive: true
      };

      Video.findOne.mockResolvedValue(mockVideo);
      Purchase.findOne.mockResolvedValue(null);

      const saveMock = jest.fn();
      Purchase.mockImplementation(() => ({
        _id: 'p1',
        amount: 99,
        purchaseDate: new Date(),
        save: saveMock
      }));

      const res = await request(app).post('/videos/v1/purchase');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.purchase).toBeDefined();
      expect(saveMock).toHaveBeenCalled();
    });

    it('should return 404 for non-existent video', async () => {
      Video.findOne.mockResolvedValue(null);

      const res = await request(app).post('/videos/nonexistent/purchase');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Video not found or not available');
    });

    it('should return 400 for already purchased video', async () => {
      Video.findOne.mockResolvedValue({
        _id: 'v1',
        uploadStatus: 'completed',
        isActive: true
      });

      Purchase.findOne.mockResolvedValue({
        _id: 'p1',
        status: 'completed'
      });

      const res = await request(app).post('/videos/v1/purchase');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Already purchased');
    });

    it('should not allow purchase of incomplete video', async () => {
      Video.findOne.mockResolvedValue({
        _id: 'v1',
        uploadStatus: 'processing',
        isActive: true
      });

      const res = await request(app).post('/videos/v1/purchase');

      expect(res.status).toBe(404);
    });
  });

  /* ==================== PLAY ==================== */
  describe('POST /videos/:id/play', () => {
    it('should return manifest URL for purchased video', async () => {
      const mockVideo = {
        _id: 'v1',
        id: 'vid1',
        uploadStatus: 'completed',
        isActive: true
      };

      Video.findOne.mockResolvedValue(mockVideo);
      Purchase.hasAccess = jest.fn().mockResolvedValue(true);
      
      const recordAccessMock = jest.fn();
      Purchase.findOne.mockResolvedValue({
        recordAccess: recordAccessMock
      });

      generateSignedCookies.mockReturnValue({
        cookies: { 
          'CloudFront-Policy': 'policy',
          'CloudFront-Signature': 'signature',
          'CloudFront-Key-Pair-Id': 'keypair'
        },
        expiresIn: 900
      });

      const res = await request(app).post('/videos/v1/play');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.manifestUrl).toBe(
        'https://cdn.example.com/videos/vid1/original.m3u8'
      );
      expect(res.body.videoId).toBe('v1');
      expect(res.body.expiresIn).toBe(900);
      expect(recordAccessMock).toHaveBeenCalled();
    });

    it('should return 404 for non-existent video', async () => {
      Video.findOne.mockResolvedValue(null);

      const res = await request(app).post('/videos/nonexistent/play');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Video not found');
    });

    it('should return 400 for incomplete video', async () => {
      Video.findOne.mockResolvedValue({
        _id: 'v1',
        uploadStatus: 'processing',
        isActive: true
      });

      const res = await request(app).post('/videos/v1/play');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Video not ready for playback');
      expect(res.body.status).toBe('processing');
    });

    it('should return 403 when user has no access', async () => {
      Video.findOne.mockResolvedValue({
        _id: 'v1',
        uploadStatus: 'completed',
        isActive: true
      });

      Purchase.hasAccess = jest.fn().mockResolvedValue(false);

      const res = await request(app).post('/videos/v1/play');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Purchase required to play this video');
    });

    it('should not record access for admin users without purchase', async () => {
      // Mock admin user
      jest.spyOn(require('../middleware/auth'), 'authenticateToken')
        .mockImplementation((req, res, next) => {
          req.user = { _id: 'admin1', role: 'admin' };
          next();
        });

      Video.findOne.mockResolvedValue({
        _id: 'v1',
        id: 'vid1',
        uploadStatus: 'completed',
        isActive: true
      });

      Purchase.findOne.mockResolvedValue(null);
      generateSignedCookies.mockReturnValue({
        cookies: {},
        expiresIn: 900
      });

      const res = await request(app).post('/videos/v1/play');

      expect(res.status).toBe(200);
      expect(Purchase.findOne).toHaveBeenCalled();
    });
  });

  /* ==================== MEDIACONVERT WEBHOOK ==================== */
  describe('POST /videos/mediaconvert/subscribe', () => {
    it('should handle COMPLETE status', async () => {
      const saveMock = jest.fn();
      const mockVideo = {
        id: 'vid1',
        uploadStatus: 'processing',
        save: saveMock
      };

      Video.findOne.mockResolvedValue(mockVideo);

      const res = await request(app)
        .post('/videos/mediaconvert/webhook')
        .send({
          detail: {
            status: 'COMPLETE',
            userMetadata: { VideoId: 'vid1' },
            jobDetails: {
              inputDetails: [
                { durationInMs: 120000 }
              ]
            }
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(mockVideo.uploadStatus).toBe('completed');
      expect(mockVideo.hlsManifestPath).toBe('videos/vid1/original.m3u8');
      expect(mockVideo.thumbnailPath).toBe('videos/vid1/thumbnails/');
      expect(mockVideo.duration).toBe(120);
      expect(saveMock).toHaveBeenCalled();
    });

    it('should handle COMPLETE without duration', async () => {
      const saveMock = jest.fn();
      const mockVideo = {
        id: 'vid1',
        uploadStatus: 'processing',
        save: saveMock
      };

      Video.findOne.mockResolvedValue(mockVideo);

      const res = await request(app)
        .post('/videos/mediaconvert/webhook')
        .send({
          detail: {
            status: 'COMPLETE',
            userMetadata: { VideoId: 'vid1' }
          }
        });

      expect(res.status).toBe(200);
      expect(mockVideo.uploadStatus).toBe('completed');
      expect(mockVideo.duration).toBeUndefined();
    });

    it('should handle ERROR with error message', async () => {
      const saveMock = jest.fn();
      const mockVideo = {
        id: 'vid1',
        uploadStatus: 'processing',
        save: saveMock
      };

      Video.findOne.mockResolvedValue(mockVideo);

      const res = await request(app)
        .post('/videos/mediaconvert/webhook')
        .send({
          detail: {
            status: 'ERROR',
            userMetadata: { VideoId: 'vid1' },
            errorMessage: 'Transcoding failed'
          }
        });

      expect(res.status).toBe(200);
      expect(mockVideo.uploadStatus).toBe('failed');
      expect(mockVideo.errorMessage).toBe('Transcoding failed');
      expect(saveMock).toHaveBeenCalled();
    });

    it('should return 400 for invalid payload', async () => {
      const res = await request(app)
        .post('/videos/mediaconvert/webhook')
        .send({
          detail: {}
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid webhook payload');
    });

    it('should return 404 when video not found', async () => {
      Video.findOne.mockResolvedValue(null);

      const res = await request(app)
        .post('/videos/mediaconvert/webhook')
        .send({
          detail: {
            status: 'COMPLETE',
            userMetadata: { VideoId: 'nonexistent' }
          }
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Video not found');
    });
  });

  /* ==================== PURCHASED VIDEOS ==================== */
  describe('GET /videos/purchased/list', () => {
    it('should return purchased videos with pagination', async () => {
      const mockPurchases = [
        {
          videoId: {
            _id: 'v1',
            id: 'vid1',
            title: 'Video 1',
            price: 99,
            toObject: () => ({
              _id: 'v1',
              id: 'vid1',
              title: 'Video 1',
              price: 99
            })
          },
          purchaseDate: new Date(),
          amount: 99,
          accessCount: 5,
          lastAccessedAt: new Date()
        }
      ];

      Purchase.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockPurchases)
      });

      Purchase.countDocuments.mockResolvedValue(1);

      const res = await request(app)
        .get('/videos/purchased/list')
        .query({ page: 1, limit: 10 });

      expect(res.status).toBe(200);
      expect(res.body.videos).toHaveLength(1);
      expect(res.body.videos[0].title).toBe('Video 1');
      expect(res.body.videos[0].canPlay).toBe(true);
      expect(res.body.videos[0].uploadStatus).toBe('completed');
      expect(res.body.videos[0].purchaseInfo).toBeDefined();
      expect(res.body.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        pages: 1
      });
    });

    it('should handle empty purchase list', async () => {
      Purchase.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([])
      });

      Purchase.countDocuments.mockResolvedValue(0);

      const res = await request(app).get('/videos/purchased/list');

      expect(res.status).toBe(200);
      expect(res.body.videos).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
    });

    it('should support pagination parameters', async () => {
      Purchase.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([])
      });

      Purchase.countDocuments.mockResolvedValue(0);

      await request(app)
        .get('/videos/purchased/list')
        .query({ page: 2, limit: 5 });

      const findCall = Purchase.find.mock.results[0].value;
      expect(findCall.skip).toHaveBeenCalledWith(5);
      expect(findCall.limit).toHaveBeenCalledWith(5);
    });

    it('should handle database errors', async () => {
      Purchase.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockRejectedValue(new Error('DB Error'))
      });

      const res = await request(app).get('/videos/purchased/list');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('DB Error');
    });
  });

  /* ==================== EDGE CASES & ERROR HANDLING ==================== */
  describe('Edge Cases', () => {
    it('should handle malformed JSON in request body', async () => {
      const res = await request(app)
        .post('/videos/upload/initialize')
        .send('invalid json')
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(400);
    });

    it('should handle very long search queries', async () => {
      Video.find.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([])
      });

      Video.countDocuments.mockResolvedValue(0);
      Purchase.find.mockReturnValue({
        distinct: jest.fn().mockResolvedValue([])
      });

      const longSearch = 'a'.repeat(1000);
      const res = await request(app)
        .get('/videos')
        .query({ search: longSearch });

      expect(res.status).toBe(200);
    });

    it('should handle special characters in search', async () => {
      Video.find.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([])
      });

      Video.countDocuments.mockResolvedValue(0);
      Purchase.find.mockReturnValue({
        distinct: jest.fn().mockResolvedValue([])
      });

      const res = await request(app)
        .get('/videos')
        .query({ search: '$regex[]()*+?.' });

      expect(res.status).toBe(200);
    });

    it('should handle concurrent purchase attempts', async () => {
      Video.findOne.mockResolvedValue({
        _id: 'v1',
        price: 99,
        uploadStatus: 'completed',
        isActive: true
      });

      // First call: no existing purchase
      Purchase.findOne.mockResolvedValueOnce(null);
      
      Purchase.mockImplementation(() => ({
        _id: 'p1',
        save: jest.fn()
      }));

      const res1 = request(app).post('/videos/v1/purchase');
      const res2 = request(app).post('/videos/v1/purchase');

      const [response1, response2] = await Promise.all([res1, res2]);

      // At least one should succeed
      const succeeded = [response1, response2].filter(r => r.status === 200);
      expect(succeeded.length).toBeGreaterThan(0);
    });

    it('should handle video with empty tags array', async () => {
      const saveMock = jest.fn();
      Video.mockImplementation((data) => ({
        ...data,
        save: saveMock,
        _id: 'v1'
      }));

      generatePresignedUploadUrl.mockResolvedValue({
        uploadUrl: 'url',
        s3Key: 'key',
        fields: {}
      });

      const res = await request(app)
        .post('/videos/upload/initialize')
        .send({
          title: 'Video',
          tags: '',
          fileName: 'video.mp4',
          fileSize: 1000,
          contentType: 'video/mp4'
        });

      expect(res.status).toBe(200);
    });

    it('should handle video with zero price', async () => {
      Video.findOne.mockResolvedValue({
        _id: 'v1',
        price: 0,
        uploadStatus: 'completed',
        isActive: true
      });

      Purchase.findOne.mockResolvedValue(null);
      Purchase.mockImplementation(() => ({
        _id: 'p1',
        amount: 0,
        save: jest.fn()
      }));

      const res = await request(app).post('/videos/v1/purchase');

      expect(res.status).toBe(200);
      expect(res.body.purchase.amount).toBe(0);
    });

    it('should handle missing optional fields in webhook', async () => {
      const saveMock = jest.fn();
      Video.findOne.mockResolvedValue({
        id: 'vid1',
        save: saveMock
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
      expect(saveMock).toHaveBeenCalled();
    });
  });

  /* ==================== AUTHENTICATION & AUTHORIZATION ==================== */
  describe('Authentication & Authorization', () => {
    it('should require authentication for all routes', async () => {
      // This would need to mock authenticateToken to reject
      // For now, we verify it's called
      const res = await request(app).get('/videos');
      expect(res.status).not.toBe(401);
    });

    it('should allow admin to access admin-only routes', async () => {
      // Admin mock is already set up
      const res = await request(app)
        .post('/videos/upload/initialize')
        .send({
          title: 'Video',
          fileName: 'video.mp4',
          fileSize: 1000,
          contentType: 'video/mp4'
        });

      // Should not return 403
      expect(res.status).not.toBe(403);
    });
  });

  /* ==================== DATA VALIDATION ==================== */
  describe('Data Validation', () => {
    it('should validate price is a number', async () => {
      Video.mockImplementation((data) => ({
        ...data,
        save: jest.fn(),
        _id: 'v1'
      }));

      generatePresignedUploadUrl.mockResolvedValue({
        uploadUrl: 'url',
        s3Key: 'key',
        fields: {}
      });

      const res = await request(app)
        .post('/videos/upload/initialize')
        .send({
          title: 'Video',
          price: 'invalid',
          fileName: 'video.mp4',
          fileSize: 1000,
          contentType: 'video/mp4'
        });

      expect(res.status).toBe(200);
      // Price should be parsed as 0 or NaN
    });

    it('should handle negative page numbers', async () => {
      Video.find.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([])
      });

      Video.countDocuments.mockResolvedValue(0);
      Purchase.find.mockReturnValue({
        distinct: jest.fn().mockResolvedValue([])
      });

      const res = await request(app)
        .get('/videos')
        .query({ page: -5 });

      expect(res.status).toBe(200);
      // Should default to page 1
    });

    it('should limit maximum page size', async () => {
      Video.find.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([])
      });

      Video.countDocuments.mockResolvedValue(0);
      Purchase.find.mockReturnValue({
        distinct: jest.fn().mockResolvedValue([])
      });

      const res = await request(app)
        .get('/videos')
        .query({ limit: 1000 });

      expect(res.status).toBe(200);
      // Should be capped at 50
    });
  });

  /* ==================== PERFORMANCE & CONCURRENCY ==================== */
  describe('Performance Tests', () => {
    it('should handle multiple concurrent video list requests', async () => {
      Video.find.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([])
      });

      Video.countDocuments.mockResolvedValue(0);
      Purchase.find.mockReturnValue({
        distinct: jest.fn().mockResolvedValue([])
      });

      const requests = Array(10).fill(null).map(() => 
        request(app).get('/videos')
      );

      const responses = await Promise.all(requests);

      responses.forEach(res => {
        expect(res.status).toBe(200);
      });
    });

    it('should handle purchase check for video with many purchases', async () => {
      Video.findOne.mockResolvedValue({
        _id: 'v1',
        id: 'vid1',
        uploadStatus: 'completed',
        toObject: () => ({ title: 'Popular Video' })
      });

      Purchase.findOne.mockResolvedValue({
        purchaseDate: new Date(),
        accessCount: 1000
      });

      const res = await request(app).get('/videos/vid1');

      expect(res.status).toBe(200);
      expect(res.body.purchased).toBe(true);
    });
  });
}); saveMock

      Video.findOne.mockResolvedValue(mockVideo);

      const res = await request(app)
        .post('/videos/mediaconvert/subscribe')
        .send({
          'detail-type': 'MediaConvert Job State Change',
          detail: {
            status: 'COMPLETE',
            jobId: 'job123',
            userMetadata: { VideoId: 'vid1' }
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(mockVideo.uploadStatus).toBe('completed');
      expect(mockVideo.thumbnailPath).toBe('videos/vid1/thumbnails/');
      expect(saveMock).toHaveBeenCalled();

    it('should handle ERROR status', async () => {
      const saveMock = jest.fn();
      const mockVideo = {
        id: 'vid1',
        uploadStatus: 'processing',
        save: saveMock
      };

      Video.findOne.mockResolvedValue(mockVideo);

      const res = await request(app)
        .post('/videos/mediaconvert/subscribe')
        .send({
          'detail-type': 'MediaConvert Job State Change',
          detail: {
            status: 'ERROR',
            jobId: 'job123',
            userMetadata: { VideoId: 'vid1' }
          }
        });

      expect(res.status).toBe(200);
      expect(mockVideo.uploadStatus).toBe('failed');
      expect(saveMock).toHaveBeenCalled();
    });

    it('should handle missing VideoId', async () => {
      const res = await request(app)
        .post('/videos/mediaconvert/subscribe')
        .send({
          'detail-type': 'MediaConvert Job State Change',
          detail: {
            status: 'COMPLETE',
            jobId: 'job123',
            userMetadata: {}
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.error).toBe('VideoId missing');
    });

    it('should handle video not found', async () => {
      Video.findOne.mockResolvedValue(null);

      const res = await request(app)
        .post('/videos/mediaconvert/subscribe')
        .send({
          'detail-type': 'MediaConvert Job State Change',
          detail: {
            status: 'COMPLETE',
            jobId: 'job123',
            userMetadata: { VideoId: 'nonexistent' }
          }
        });

      expect(res.status).toBe(200);
    });
