// Основные типы для бота
export interface UserSession {
  id: number;
  username?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  languageCode?: string | undefined;
  isPremium?: boolean | undefined;
  createdAt: Date;
  lastActivity: Date;
}

export interface TattooRequest {
  id: number;
  userId: number;
  description: string;
  style?: string;
  size?: string;
  placement?: string;
  budget?: number;
  images?: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}

export interface BotConfig {
  token: string;
  webhookUrl?: string;
  webhookPort?: number;
  databasePath: string;
  logLevel: string;
  webhookSecret?: string;
}

export interface LogContext {
  userId?: number;
  chatId?: number;
  command?: string;
  error?: Error;
}


