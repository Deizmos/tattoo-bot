import winston from 'winston';
import path from 'path';
import { LogContext } from '../types';

class Logger {
  private logger: winston.Logger;

  constructor(logLevel: string = 'info', logFile?: string) {
    const transports: winston.transport[] = [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp({ format: 'HH:mm:ss' }),
          winston.format.printf(({ timestamp, level, message, context }) => {
            const ctxStr = context ? ` [${JSON.stringify(context)}]` : '';
            return `${timestamp} ${level}: ${message}${ctxStr}`;
          })
        )
      })
    ];

    if (logFile) {
      transports.push(
        new winston.transports.File({
          filename: logFile,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          )
        })
      );
    }

    this.logger = winston.createLogger({
      level: logLevel,
      transports,
      defaultMeta: { service: 'tattoo-bot' }
    });
  }

  info(message: string, context?: LogContext): void {
    this.logger.info(message, { context });
  }

  error(message: string, context?: LogContext): void {
    this.logger.error(message, { context });
  }

  warn(message: string, context?: LogContext): void {
    this.logger.warn(message, { context });
  }

  debug(message: string, context?: LogContext): void {
    this.logger.debug(message, { context });
  }
}

export default Logger;


