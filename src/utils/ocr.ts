import { createWorker, PSM, type LoggerMessage, type Worker } from 'tesseract.js';

/**
 * 纯浏览器本地 OCR（tesseract.js 7 + 打包在本项目的同源资源）。
 *
 * 第一版思路：只用本地 Tesseract 识别图片并输出**原始文字**。
 * - 不对词坐标做行重组、不做表格解析、不做 PSM 多模式重跑、不做质量门槛、
 *   不做本地候选解析，也不做任何 OCR 自动结构化；
 * - 识别出的原始文字由同源代理上交给配置的服务做结构化
 *   （见 ReportRecognitionPanel / utils/aiStructure.ts；文字才会发送，图片绝不发送）。
 *
 * 隐私/边界：
 * - 所有处理在本机浏览器完成：图片/文本/模型/引擎资源均不离开设备；
 * - worker、内核（WebAssembly LSTM）与中文模型（chi_sim）随应用打包，
 *   从本应用同源加载（public/ocr/），首次使用即被浏览器/Service Worker 缓存；
 * - 不调用任何云端 API、不发送遥测、不上传报告。
 */

export interface OcrProgress {
  status: string;
  progress: number; // 0..1
}

export interface OcrRecognized {
  /** Tesseract 原始全文（仅原样文本，不做行重组/解析） */
  rawText: string;
}

/** 计算同一源下的本地 OCR 资源目录（兼容 dev / 子路径部署 / base './'） */
function ocrResourceUrls() {
  const base = import.meta.env.BASE_URL; // dev: '/'；build(base './')：'./'
  const dir = new URL(`${base}ocr/`, window.location.href).href;
  return {
    workerPath: `${dir}worker.min.js`,
    corePath: `${dir}core`, // 目录：worker 按浏览器能力自动选择 LSTM 内核变体
    langPath: `${dir}lang`, // 目录：内含 chi_sim.traineddata.gz
  };
}

const STATUS_TEXT: Record<string, string> = {
  'initializing tesseract': '正在加载本地识别引擎…',
  'loading language traineddata': '正在加载中文识别模型…',
  'recognizing text': '正在识别图片…',
};

export function ocrStatusText(raw: string): string {
  return STATUS_TEXT[raw] ?? raw;
}

/**
 * 已知无害的 Tesseract 参数警告白名单（参数名）。
 *
 * 与 tesseract.js v7 worker-script 的 initParamNames 保持一致：这些「仅初始化」参数在
 * LSTM-only 内核/训练数据环境中可能触发 `Warning: Parameter not found: <name>`（原生引擎
 * 不识别该名称）或 `Attempted to set parameters that can only be set during initialization`
 * 提示。它们来自引擎/训练数据对旧参数的查询，纯属噪音，不影响识别结果。
 * 本项目源码从不主动设置这些参数（见 ocr.test.ts 的源级回归校验），警告多由 worker/训练
 * 数据自身在初始化时输出。
 */
const HARMLESS_INIT_ONLY_PARAMS = [
  'ambigs_debug_level',
  'user_words_suffix',
  'user_patterns_suffix',
  'load_system_dawg',
  'load_freq_dawg',
  'load_unambig_dawg',
  'load_punc_dawg',
  'load_number_dawg',
  'load_bigram_dawg',
  'tessedit_ocr_engine_mode',
  'tessedit_init_config_only',
  'language_model_ngram_on',
  'language_model_use_sigmoidal_certainty',
];

/**
 * 精确过滤已知无害的 Tesseract 参数警告（白名单 + 前缀精确匹配）。
 *
 * - 仅当整条消息恰好是 `Warning: Parameter not found: <已知参数名>`（参数名在白名单内），
 *   或 tesseract.js 自身的 `Attempted to set parameters that can only be set during
 *   initialization...` 信息时返回 true（应抑制）；
 * - 任何真实错误（识别失败、初始化失败、引擎异常、未知参数、其他未知警告）一律返回 false
 *   （保留），绝不被吞掉；
 * - `Estimating resolution as <n>` 返回 false（保留）：属引擎对图片分辨率的正常估算提示，
 *   非参数兼容问题，**有意保留**（不纳入过滤）。
 *
 * 接线说明（不可安全消除）：tesseract.js v7 的 createWorker 未提供把原生引擎的
 * print/printErr（console）输出路由到回调的受支持选项（logger 仅收进度、errorHandler 仅收
 * job 错误），这些原生警告在 OCR Web Worker 内部直接打印到其 console，主线程无法经
 * createWorker 选项截获。要真正消除噪音只能 monkeypatch worker 的 console 或修改
 * wasm/worker 产物——均违反本项目的「最小/安全」约束（不 monkeypatch 全局 console、不改
 * wasm/traineddata），故本函数不接线，仅作为经测试的白名单判定器导出备用。
 */
export function isHarmlessTesseractWarning(message: string): boolean {
  if (typeof message !== 'string') return false;
  const trimmed = message.trim();

  // `Warning: Parameter not found: <param>`：仅当参数名在白名单内才视为无害。
  const paramNotFound = /^Warning: Parameter not found:\s*(.+)$/.exec(trimmed);
  if (paramNotFound) {
    return HARMLESS_INIT_ONLY_PARAMS.includes(paramNotFound[1].trim());
  }

  // tesseract.js 自身的「仅初始化」提示（worker-script console.log，固定前缀，无害）。
  if (
    trimmed.startsWith('Attempted to set parameters that can only be set during initialization')
  ) {
    return true;
  }

  return false;
}

/**
 * 一个可取消的本地 OCR 会话。create 时加载引擎与中文模型（同源打包资源）并固定
 * 单一页面分割模式（PSM.AUTO，不做多模式重跑）；recognize 只对单张图片做一次识别，
 * 仅返回原始文本与进度。terminate 可随时取消并释放资源。
 */
export class LocalOcrSession {
  private worker: Worker | null = null;

  private constructor(worker: Worker) {
    this.worker = worker;
  }

  /** 创建会话：加载 worker + 内核（同源本地资源，不联网）。第一个参数为主线程共享的进度回调。 */
  static async create(onProgress: (p: OcrProgress) => void): Promise<LocalOcrSession> {
    const { workerPath, corePath, langPath } = ocrResourceUrls();
    const worker = await createWorker(['chi_sim'], 1 /* OEM.LSTM_ONLY */, {
      workerPath,
      corePath,
      langPath,
      gzip: true,
      logger: (m: LoggerMessage) => {
        onProgress({ status: m.status, progress: Math.min(1, Math.max(0, m.progress)) });
      },
      errorHandler: () => {
        // 单个 job 的错误会由对应 Promise 拒绝，此处避免未捕获异常再抛出。
      },
    });
    // 固定单一版面模式（PSM.AUTO）：不提供布局模式选项，也不做多模式重跑。
    //
    // tesseract.js v7 兼容约束：setParameters 只允许设置 Tesseract 的**运行时**参数
    // （如 tessedit_pageseg_mode）。下列参数在 v7 中只能在初始化时经 createWorker 的
    // config 参数设置，经 setParameters 传入会打印 `Parameter not found: ...` 或
    // `Attempted to set parameters that can only be set during initialization` 警告且无效：
    //   load_system_dawg / load_freq_dawg / load_unambig_dawg / load_punc_dawg /
    //   load_number_dawg / load_bigram_dawg / tessedit_ocr_engine_mode /
    //   tessedit_init_config_only / language_model_ngram_on /
    //   language_model_use_sigmoidal_certainty / ambigs_debug_level /
    //   user_words_suffix / user_patterns_suffix
    // 此处绝不配置上述任何 init-only 参数（见 utils/ocr.test.ts 的源级回归校验）。
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    return new LocalOcrSession(worker);
  }

  /** 识别一张图片（Blob 或预处理后的 Canvas），只访问文本输出，返回原始文字。 */
  async recognize(image: Blob | HTMLCanvasElement): Promise<OcrRecognized> {
    if (!this.worker) throw new Error('OCR 会话已终止');
    // 只请求 text 输出：不访问 blocks/paragraphs/words/bbox，不做任何重组或解析。
    const { data } = await this.worker.recognize(image, {}, { text: true });
    return { rawText: (data.text ?? '').trim() };
  }

  /** 取消并释放：终止 worker（可安全重复调用/在卸载时调用）。 */
  async terminate(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    if (w) {
      try {
        await w.terminate();
      } catch {
        // worker 已退出等情况直接忽略
      }
    }
  }
}
