const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { config } = require("../config/aws");

const s3 = new S3Client({ region: "ap-southeast-1" });

// Generate presigned URL for direct upload to S3
async function generatePresignedUploadUrl(videoId, fileName, fileSize, contentType) {
  const ext = fileName.split(".").pop();
  const key = `uploads/${videoId}/original.${ext}`;
  
  const command = new PutObjectCommand({
    Bucket: config.uploadsBucket,
    Key: key,
    ContentType: contentType,
    ContentLength: fileSize,
    Metadata: {
      'video-id': videoId,
      'original-filename': fileName
    }
  });

  // URL expires in 1 hour
  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
  
  return {
    uploadUrl: signedUrl,
    s3Key: key,
    fields: {
      'Content-Type': contentType,
      'Content-Length': fileSize
    }
  };
}

// Validate file type
function validateVideoFile(fileName, contentType) {
  const allowedTypes = ["video/mp4", "video/webm", "video/mpeg", "video/quicktime"];
  const allowedExtensions = ["mp4", "webm", "mpeg", "mov"];
  
  const ext = fileName.split(".").pop().toLowerCase();
  
  if (!allowedTypes.includes(contentType)) {
    throw new Error("Invalid content type. Only video files are allowed.");
  }
  
  if (!allowedExtensions.includes(ext)) {
    throw new Error("Invalid file extension. Allowed: mp4, webm, mpeg, mov");
  }
  
  return true;
}

// Validate file size (max 2GB)
function validateFileSize(fileSize) {
  const maxSize = 2 * 1024 * 1024 * 1024; // 2GB
  if (fileSize > maxSize) {
    throw new Error("File too large. Maximum size is 2GB.");
  }
  return true;
}

module.exports = {
  generatePresignedUploadUrl,
  validateVideoFile,
  validateFileSize
};