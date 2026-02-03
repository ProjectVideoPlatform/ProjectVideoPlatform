// utils/transaction.js
const mongoose = require('mongoose');

const withTransaction = async (session, callback) => {
  try {
    await callback(session);
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

module.exports = { withTransaction };