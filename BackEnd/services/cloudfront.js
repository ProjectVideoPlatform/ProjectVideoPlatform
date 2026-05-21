const fs = require('fs');
const { getSignedCookies, getSignedUrl } = require('aws-cloudfront-sign');
const { config } = require('../config/aws');
const path = require('path');
// สร้าง CloudFront Signed Cookies
// ต้อง import getSignedCookies และ getSignedUrl จาก 'aws-cloudfront-sign'
// สมมติว่ามีการ import ที่ต้นไฟล์ เช่น:
// import { getSignedCookies, getSignedUrl } from 'aws-cloudfront-sign';
// import fs from 'fs';
// import path from 'path';
// import config from './config'; // หรือที่เก็บค่า .env ของคุณ

// ⚠️ แก้ไข: เพิ่ม URL ที่ต้องการเซ็นชื่อเป็นพารามิเตอร์ตัวแรก
const generateSignedCookies = (videoId, expirationMinutes = 15) => {
    try {
        // const privateKeyPath = path.resolve(config.cloudFrontPrivateKeyPath);
        // console.log('Private key path:', privateKeyPath);

        // if (!fs.existsSync(privateKeyPath)) {
        //     throw new Error('Private key file not found!');
        // }
 
        // const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
        // console.log('Private key loaded:', privateKey.startsWith('-----BEGIN'));
        // console.log('Private key length:', privateKey.length);
      const privateKey = fs.readFileSync(
  process.env.CLOUDFRONT_PRIVATE_KEY_PATH,
  'utf8'
);
        const expires = Math.floor(Date.now() / 1000) + (expirationMinutes * 60);

        // กำหนด Resource ให้ตรงกับ URL ที่จะใช้เป็นพารามิเตอร์ตัวแรกของ getSignedCookies
        const resourceUrl = `https://${config.cloudFrontDomain}/videos/${videoId}/*`;

        const policy = JSON.stringify({
            Statement: [{
                Resource: resourceUrl, // ใช้ resourceUrl เดียวกันกับด้านบน
                Condition: {
                    DateLessThan: {
                        'AWS:EpochTime': expires
                    },
                    IpAddress: {
                        'AWS:SourceIp': '0.0.0.0/0' // Allow from any IP, can be restricted
                    }
                }
            }]
        });

        // 🟢 การแก้ไขหลัก: getSignedCookies ต้องรับ (url, options)
        const cookies = getSignedCookies(resourceUrl, {
            keypairId: config.cloudFrontKeyPairId,
            privateKeyString: privateKey,
            policy: policy
        });

        return {
            cookies,
            expiresAt: new Date(expires * 1000),
            expiresIn: expirationMinutes * 60
        };
    } catch (error) {
        console.error('Failed to generate signed cookies:', error);
        throw new Error('Failed to generate secure access credentials');
    }
};


// ฟังก์ชัน generateSignedUrl ถูกต้องอยู่แล้วตามรูปแบบ (url, options)
// ไม่ต้องแก้ไข
const generateSignedUrl = (filePath, expirationMinutes = 15) => {
    try {
        const privateKey = fs.readFileSync(config.cloudFrontPrivateKeyPath, 'utf8');
        const expires = Math.floor(Date.now() / 1000) + (expirationMinutes * 60);

        const signedUrl = getSignedUrl({
            url: `https://${config.cloudFrontDomain}/${filePath}`,
            keypairId: config.cloudFrontKeyPairId,
            privateKeyString: privateKey,
            expireTime: expires
        });

        return {
            url: signedUrl,
            expiresAt: new Date(expires * 1000),
            expiresIn: expirationMinutes * 60
        };
    } catch (error) {
        console.error('Failed to generate signed URL:', error);
        throw new Error('Failed to generate secure access URL');
    }
};


// ⚠️ แก้ไข: เพิ่ม URL และเปลี่ยน privateKey เป็น privateKeyString
const generateThumbnailAccess = (videoId, expirationMinutes = 60) => {
    try {
        const privateKey = fs.readFileSync(config.cloudFrontPrivateKeyPath, 'utf8');
        const expires = Math.floor(Date.now() / 1000) + (expirationMinutes * 60);

        // กำหนด Resource ให้ตรงกับ URL ที่จะใช้เป็นพารามิเตอร์ตัวแรกของ getSignedCookies
        const resourceUrl = `https://${config.cloudFrontDomain}/videos/${videoId}/thumbnails/*`;

        const policy = JSON.stringify({
            Statement: [{
                Resource: resourceUrl, // ใช้ resourceUrl เดียวกันกับด้านบน
                Condition: {
                    DateLessThan: {
                        'AWS:EpochTime': expires
                    }
                }
            }]
        });

        // 🟢 การแก้ไข: getSignedCookies ต้องรับ (url, options) และใช้ privateKeyString
        const cookies = getSignedCookies(resourceUrl, {
            keypairId: config.cloudFrontKeyPairId,
            privateKeyString: privateKey, // ⚠️ แก้ไข: เปลี่ยนจาก privateKey เป็น privateKeyString
            policy: policy
        });

        return {
            cookies,
            expiresAt: new Date(expires * 1000),
            expiresIn: expirationMinutes * 60
        };
    } catch (error) {
        console.error('Failed to generate thumbnail access:', error);
        throw new Error('Failed to generate thumbnail access credentials');
    }
};
// Validate CloudFront configuration
const validateConfiguration = () => {
  const required = [
    'cloudFrontDomain',
    'cloudFrontKeyPairId',
    'cloudFrontPrivateKeyPath'
  ];
  
  const missing = required.filter(key => !config[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing CloudFront configuration: ${missing.join(', ')}`);
  }
  
  if (!fs.existsSync(config.cloudFrontPrivateKeyPath)) {
    throw new Error(`CloudFront private key file not found: ${config.cloudFrontPrivateKeyPath}`);
  }
  
  return true;
};

// Helper function to set cookies in response
const setCookiesInResponse = (res, cookies) => {
  Object.keys(cookies).forEach(key => {
    res.cookie(key, cookies[key], {
        domain: '.toteja.co', // กำหนด domain ถ้าจำเป็น
      httpOnly: true,
      secure: true,       // local HTTP
      sameSite: "NONE",
      path: '/'
    });
  });
};
module.exports = {
  generateSignedCookies,
  generateSignedUrl,
  generateThumbnailAccess,
  validateConfiguration,
  setCookiesInResponse
};