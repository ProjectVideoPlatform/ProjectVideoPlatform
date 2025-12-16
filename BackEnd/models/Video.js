const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema({
  id: { 
    type: String, 
    required: true, 
    unique: true 
  },
  title: { 
    type: String, 
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  originalFileName: String,
  uploadStatus: {
    type: String,
    enum: ['uploading', 'uploaded', 'processing', 'completed', 'failed'],
    default: 'uploading'
  },
  mediaConvertJobId: String,
  hlsManifestPath: String, // path ใน S3 ของ master.m3u8
  thumbnailPath: String,
  duration: Number, // duration in seconds
  fileSize: Number, // file size in bytes
  price: { 
    type: Number, 
    default: 0,
    min: 0
  },
  tags: [String],
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Update the updatedAt field before saving
videoSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Index for better query performance
videoSchema.index({ uploadStatus: 1, isActive: 1 });
videoSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Video', videoSchema);