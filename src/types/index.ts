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
  masterChatId?: string;
}

export interface LogContext {
  userId?: number;
  chatId?: number;
  command?: string;
  error?: Error;
  requestId?: number | undefined;
  masterChatId?: string;
  masterId?: number;
  replyId?: number;
  clientId?: number;
}

export interface RequestSession {
  step: 'waiting_for_description' | 'waiting_for_confirm';
  data: {
    userId: number;
    userInfo: {
      id: number;
      username?: string;
      firstName?: string;
      lastName?: string;
    };
    description?: string;
  };
}

export interface ReplySession {
  step: 'waiting_for_message';
  data: {
    clientId: number;
    clientInfo: {
      id: number;
      username?: string | undefined;
      firstName?: string | undefined;
      lastName?: string | undefined;
    };
    requestId?: number | undefined;
  };
}

export interface MasterReply {
  id: number;
  requestId: number;
  clientId: number;
  masterId: number;
  message: string;
  createdAt: Date;
}


