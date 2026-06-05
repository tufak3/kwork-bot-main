const winston = require('winston');
const path = require('path');
const fs = require('fs');

const LOGS_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

const fmt = winston.format;

const consoleFormat = fmt.combine(
  fmt.colorize(),
  fmt.timestamp({ format: 'HH:mm:ss' }),
  fmt.printf(({ timestamp, level, message, ...meta }) => {
    const extra = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${timestamp} ${level}: ${message}${extra}`;
  })
);

const fileFormat = fmt.combine(
  fmt.timestamp(),
  fmt.errors({ stack: true }),
  fmt.json()
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    new winston.transports.File({
      filename: path.join(LOGS_DIR, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
    }),
    new winston.transports.File({
      filename: path.join(LOGS_DIR, 'combined.log'),
      format: fileFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(LOGS_DIR, 'exceptions.log'),
      format: fileFormat,
    }),
  ],
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(LOGS_DIR, 'rejections.log'),
      format: fileFormat,
    }),
  ],
});

module.exports = logger;
