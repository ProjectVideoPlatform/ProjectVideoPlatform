const express = require("express");
const router = express.Router();
const { createPayment, handleKPlusCallback } = require("../controllers/paymentController");

// Normal create QR
router.post("/create", createPayment);

// Callback (raw body)
router.post(
  "/callback",
  express.raw({ type: "*/*" }),
  handleKPlusCallback
);

module.exports = router;
