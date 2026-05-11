// node-api/grpc/recommendation.client.js
'use strict';

const grpc       = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path       = require('path');

const PROTO_PATH = path.join(__dirname, '../proto/recommendation.proto');

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase:    true,
  longs:       String,
  enums:       String,
  defaults:    true,
  oneofs:      true,
});

const grpcObj = grpc.loadPackageDefinition(packageDef).recommendation;

const client = new grpcObj.RecommendationService(
  process.env.RECOMMENDATION_GRPC_HOST || 'localhost:50051',
  grpc.credentials.createInsecure()
);

// wrap เป็น Promise ให้ใช้ง่าย
function getRecommended(userId, limit = 12) {
  return new Promise((resolve, reject) => {
    client.GetRecommended({ user_id: userId, limit }, (err, response) => {
      if (err) return reject(err);
      resolve(response);
    });
  });
}

function getTrending(limit = 12) {
  return new Promise((resolve, reject) => {
    client.GetTrending({ limit }, (err, response) => {
      if (err) return reject(err);
      resolve(response);
    });
  });
}

function getCoWatch(videoId, limit = 10) {
  return new Promise((resolve, reject) => {
    client.GetCoWatch({ video_id: videoId, limit }, (err, response) => {
      if (err) return reject(err);
      resolve(response);
    });
  });
}

module.exports = { getRecommended, getTrending, getCoWatch };