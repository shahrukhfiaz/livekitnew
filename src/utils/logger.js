const winston = require('winston');

// Configure logger for cloud environment (Railway)
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize(),
    winston.format.printf(({ level, message, timestamp }) => {
      return `${timestamp} ${level}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console()
    // File transports removed for Railway deployment
    // as they don't work well in containerized environments
  ],
});

module.exports = logger;
