// Simple request logger middleware for Express
module.exports = function requestLogger(req, res, next) {
  console.log(`${req.method} ${req.originalUrl}`);
  next();
};
