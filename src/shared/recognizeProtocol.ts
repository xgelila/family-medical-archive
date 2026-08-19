/**
 * 识别代理协议（浏览器 ↔ 本机 Vite 代理 之间的请求/响应结构）。
 *
 * 安全边界（严格）：
 * - 请求正文只包含：识别文字（text）、识别模式（mode）；
 * - **绝不发送**：图片、密钥、历史报告全文、健康数值历史、交换记录、受控目录或标签映射；
 * - 代理（Node 侧）把极简系统提示词与用户文字拼成消息；鉴权配置只在 Node 侧。
 */

export type RecognizeMode = 'items' | 'report';

/** 识别代理请求体 */
export interface RecognizeRequestBody {
  text: string;
  mode: RecognizeMode;
}

/** 识别代理 2xx 响应体（仅 content，不透传任何上游字段） */
export interface RecognizeReplyBody {
  content: string;
}

export const RECOGNIZE_MODES: readonly RecognizeMode[] = ['items', 'report'];

export function isRecognizeMode(v: unknown): v is RecognizeMode {
  return v === 'items' || v === 'report';
}
