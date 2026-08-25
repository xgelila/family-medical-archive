import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Camera, ScanLine } from 'lucide-react';
import type { AttachmentRecord, ReportDetail, ReportKind } from '../types';
import { REPORT_TYPES, LAB_REPORT_TYPES, IMAGING_REPORT_TYPES } from '../types';
import { ocrStatusText, type OcrProgress } from '../utils/ocr';
import { createConfiguredOcrEngine, type OcrEngine } from '../utils/ocrEngine';
import { preprocessImage } from '../utils/ocrPreprocess';
import {
  buildCleanSentText,
  cleanAiReportStructured,
  cleanAiStructured,
  isMockStructuredReply,
  parseAiReplyContent,
  type AiStructuredExtraField,
  type AiStructuredItem,
  type AiStructuredNote,
  type AiReportFields,
} from '../utils/aiStructure';
import {
  parseRecognizedText,
  StructureError,
  type RecognizeDebugInfo,
} from '../utils/recognizeApi';
import type { OcrCandidate, ReportScanMeta } from '../utils/ocrCandidate';
import {
  addCustomReportType,
  matchTestPurposeToType,
  loadCustomReportTypes,
} from '../utils/customReportTypes';
import { cleanFreeText } from '../utils/displayName';
import { todayISO } from '../utils/dates';
import type { ItemDraft } from '../utils/labels';

/**
 * 「识别数据」面板（黑盒流程）。
 *
 * 用户完全不接触底层技术概念：界面不出现 OCR / 模型名 / 密钥 /
 * 原始文本 / 二次发送确认 / 离线解析等技术说明。
 *
 * 流程（项目模式——识别已有报告内的条数据）：
 *   1. 报告有图片后显示「识别数据」按钮 → 裁剪 → 本机读取文字 → 同源代理整理；
 *   2. 成功显示识别出的项目（全部待确认、无标准标签），由用户点击「添加到报告」；
 *   3. 失败只给自然语言错误与重试。
 *
 * 流程（整张报告模式——添加报告时识别整张报告，含报告信息候选）：
 *   1. 「识别整张报告」→ 裁剪一张整报告图片 → 同源代理一次返回报告信息候选 + 项目候选；
 *   2. 报告信息（医院/日期/类型/标题/备注）与项目全部为候选，可编辑；
 *   3. 下一步进入核对页后把候选填入报告表单（最终保存仍由用户触发）。
 *
 * 边界（严格）：
 * - 原附件绝不修改；图片绝不发送；只发送识别文字（text + mode）；
 * - 所有识别条目与报告信息恒为待确认候选，不自动设置标准标签、不自动进入趋势；
 * - 项目原文（raw）永不改写：Al/A1/AI 等相似字不做任何静默纠正，仅另列「识别名称」展示清理。
 * - PDF 不支持时提示「请上传报告图片」。
 */

type Phase = 'idle' | 'reading' | 'structuring' | 'done' | 'error';
type Mode = 'items' | 'report';

/** 整理请求（第 2 步）在调试面板中的明确状态：请求中 / 成功 / 超时 / 失败。 */
type RecognizePhase = 'idle' | 'requesting' | 'success' | 'timeout' | 'error';

interface DraftRow {
  name: string;
  displayName: string;
  resultKind: 'numeric' | 'qualitative';
  value: string;
  unit: string;
  refRange: string;
  method: string;
  confidence: number | null;
}

const STAGE_READING = '正在读取图片';
const STAGE_STRUCTURING = '正在整理检查项目';
const STAGE_REPORT_STRUCTURING = '正在整理整张报告…';

/** 仅本机调试面板的状态（不进入主流程 UI；字段均经安全截断，不含密钥/headers/正文全文）。 */
interface RecognitionDebug {
  ran: boolean;
  ocrCompleted: boolean;
  /** 本机 OCR 文本预览，最多 1000 字符（仅供本机调试）。 */
  ocrTextPreview: string;
  ocrTextLength: number;
  /** 整理请求（第 2 步）的明确状态：请求中 / 成功 / 超时 / 失败。 */
  recognizePhase: RecognizePhase;
  /** 整理请求的客户端 debug 元信息（含服务端回传的安全上游 debug）。 */
  client: RecognizeDebugInfo | null;
  /** 成功内容预览，最多 500 字。 */
  successPreview: string | null;
  /** 清洗后的中文错误。 */
  errorMessage: string | null;
}

const EMPTY_DEBUG: RecognitionDebug = {
  ran: false,
  ocrCompleted: false,
  ocrTextPreview: '',
  ocrTextLength: 0,
  recognizePhase: 'idle',
  client: null,
  successPreview: null,
  errorMessage: null,
};

/** OCR 文本最多展示前 1000 字符（仅本机调试）。 */
const READING_TEXT_DEBUG_MAX = 1000;
/** 成功内容预览最多 500 字。 */
const RESULT_DEBUG_PREVIEW_MAX = 500;

/** 结构化条目 → 面板行（无任何标签推荐字段） */
function itemToRow(it: AiStructuredItem): DraftRow {
  return {
    name: it.name,
    displayName: it.displayName !== '' ? it.displayName : it.name,
    resultKind: /^\s*[<>≤≥]?\s*\d/.test(it.result) ? 'numeric' : 'qualitative',
    value: it.result,
    unit: it.unit,
    refRange: it.referenceRange,
    method: it.method,
    confidence: it.confidence,
  };
}

function rowToCandidate(row: DraftRow): OcrCandidate {
  return {
    name: row.name,
    displayName: row.displayName,
    resultKind: row.resultKind,
    value: row.value,
    unit: row.unit,
    refRange: row.refRange,
    method: row.method,
    confirmed: false,
    // 恒为空：识别候选不产生标准标签，避免标签进入趋势。
    standardLabel: '',
    sourceLine: '',
    qualityHint: '',
    confidence: row.confidence == null ? null : Math.round(row.confidence * 100),
    avgConfidence: null,
    recommendedLabelId: '',
    recommendedLabel: '',
    labelStatus: '',
    labelConfidence: null,
    chosenLabel: '',
  };
}

function reportTypeCandidate(reportType: string, reportKind: ReportKind): string {
  const allowed =
    reportKind === 'imaging'
      ? IMAGING_REPORT_TYPES
      : reportKind === 'lab'
        ? LAB_REPORT_TYPES
        : REPORT_TYPES;
  return (allowed as readonly string[]).includes(reportType) ? reportType : '';
}

/** 仅从影像子检查部位的明确关键词补充现有预设，不对自由文本作模糊猜测。 */
function explicitImagingTypesFromExams(
  exams: Array<{ examPart: string; examMethod: string }> | undefined,
): string[] {
  const text = (exams ?? []).map((exam) => `${exam.examPart} ${exam.examMethod}`).join('');
  const matched: string[] = [];
  if (text.includes('甲状腺')) matched.push('甲状腺超声');
  if (text.includes('乳腺')) matched.push('乳腺超声');
  if (text.includes('腹部')) matched.push('腹部超声');
  return matched;
}

/**
 * 向导带回的既有识别草稿（ItemDraft，已在 ReportReview 编辑过）→ 面板候选行（DraftRow）。
 * 仅用于返回识别页时展示已有候选，不要求重新识别即可查看。
 * 注意：method 现已保存为草稿的 testMethod 字段（检查项目字段），此处直接读取还原。
 */
function draftToRow(it: ItemDraft): DraftRow {
  return {
    name: it.name,
    displayName: it.name,
    resultKind: it.resultKind,
    value: it.value,
    unit: it.unit,
    refRange: it.refRange,
    method: it.testMethod ?? '',
    confidence: null,
  };
}

/** 向导带回的既有附加详情（ReportDetail[]）→ 面板「附加识别信息」的 extraFields 展示。 */
function detailsToExtraFields(details: ReportDetail[]): AiStructuredExtraField[] {
  return details.map((d) => ({
    section: '其他',
    key: d.label,
    value: d.value,
    sourceText: '',
  }));
}

/** 表单未覆盖的 report 字段（用于「附加识别信息」折叠区展示）；仅展示非空值。 */
const REPORT_EXTRA_LABELS: ReadonlyArray<[keyof AiReportFields, string]> = [
  ['branch', '分院'],
  ['reportNo', '报告编号'],
  ['personName', '姓名'],
  ['gender', '性别'],
  ['age', '年龄'],
  ['patientId', '病历号'],
  ['clinicalDiagnosis', '临床诊断'],
  ['sampleDate', '采样日期'],
  ['receiveDate', '接收日期'],
  ['printDate', '打印日期'],
  ['senderDoctor', '送检医生'],
  ['inspector', '检验者'],
  ['reviewer', '审核者'],
];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 把识别出的附加信息（表单未覆盖的 report 字段 + extraFields/notes/unresolvedText）整理为 KV 元数据列表。 */
function buildReportDetails(
  report: AiReportFields | null,
  extras: {
    extraFields: AiStructuredExtraField[];
    notes: AiStructuredNote[];
    unresolvedText: string;
  },
): ReportDetail[] {
  const out: ReportDetail[] = [];
  if (report) {
    for (const [key, label] of REPORT_EXTRA_LABELS) {
      const raw = report[key];
      const v = typeof raw === 'string' ? raw.trim() : '';
      if (v !== '') out.push({ label, value: v });
    }
  }
  for (const f of extras.extraFields) {
    const v = f.value.trim();
    if (v === '') continue;
    const section = f.section === 'header' ? '页眉' : f.section === 'footer' ? '页脚' : '附加';
    out.push({ label: f.key.trim() !== '' ? `${section}·${f.key.trim()}` : section, value: v });
  }
  for (const n of extras.notes) {
    const v = n.text.trim();
    if (v !== '') out.push({ label: '备注', value: v });
  }
  if (extras.unresolvedText.trim() !== '') {
    out.push({ label: '未识别原文', value: extras.unresolvedText.trim() });
  }
  return out;
}

export interface ReportRecognitionPanelHandle {
  /** 用户确认识别结果并进入核对页（仅识别完成/带回候选可触发，供外层统一底部操作栏调用）。 */
  enterReview: () => void;
}

interface ReportRecognitionPanelProps {
  attachments: AttachmentRecord[];
  onImport: (candidates: OcrCandidate[]) => void;
  onReportScan?: (scan: {
    report: ReportScanMeta;
    details: ReportDetail[];
    items: OcrCandidate[];
  }) => void;
  memberSelected?: boolean;
  /** 整张报告识别的既有报告信息候选（由向导带回，返回识别页时无需重新识别即可查看）。 */
  initialReportMeta?: ReportScanMeta;
  /** 既有识别项目候选（由向导带回，返回识别页时展示为候选行）。 */
  initialItems?: ItemDraft[];
  /** 既有附加识别详情（由向导带回，返回识别页时在「附加识别信息」中展示）。 */
  initialDetails?: ReportDetail[];
  /** 仅走「整张报告」流程时隐藏无效的「仅识别检查项目」入口（如新建向导路线 A）。 */
  reportModeOnly?: boolean;
  /** 识别阶段变化回调（用于外层在识别进行中禁用冲突操作）。 */
  onPhaseChange?: (phase: Phase) => void;
  /** 整张报告识别成功时自动回调 onReportScan（新建向导流程：成功即带结果自动进入核对页）。 */
  autoReportScan?: boolean;
}

export const ReportRecognitionPanel = forwardRef<
  ReportRecognitionPanelHandle,
  ReportRecognitionPanelProps
>(function ReportRecognitionPanel(
  {
    attachments,
    onImport,
    onReportScan,
    memberSelected = false,
    initialReportMeta,
    initialItems,
    initialDetails,
    reportModeOnly = false,
    onPhaseChange,
    autoReportScan = false,
  }: ReportRecognitionPanelProps,
  ref,
) {
  const images = useMemo(() => attachments.filter((a) => a.kind === 'image'), [attachments]);
  const hasPdfOnly = attachments.length > 0 && images.length === 0;

  const [selectedId, setSelectedId] = useState('');
  useEffect(() => {
    if (!images.some((a) => a.id === selectedId)) setSelectedId(images[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);

  const [phase, setPhase] = useState<Phase>('idle');
  // 把阶段变化暴露给外层（识别进行中禁用冲突操作）
  useEffect(() => {
    onPhaseChange?.(phase);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);
  // 新建报告默认走「整张报告」模式（一次拿到报告信息 + 项目）；编辑旧报告无 onReportScan，仅识别项目。
  const [mode, setMode] = useState<Mode>(onReportScan ? 'report' : 'items');
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [error, setError] = useState('');
  // 由向导带回的既有候选（返回识别页时无需重新识别即可查看；新识别仍会覆盖）
  const [rows, setRows] = useState<DraftRow[]>(() => (initialItems ?? []).map(draftToRow));
  const [message, setMessage] = useState('');

  // 仅本机调试面板：默认折叠，只在识别流程运行过或出错后显示。
  const [debugInfo, setDebugInfo] = useState<RecognitionDebug>(EMPTY_DEBUG);
  const [debugOpen, setDebugOpen] = useState(false);

  // 整张报告模式的报告信息候选（全部可编辑；由下一步写入表单）
  // 初值由向导带回的既有 reportMeta 提供，返回识别页时无需重新识别即可查看。
  const [reportMeta, setReportMeta] = useState<ReportScanMeta>(() => ({
    reportKind: initialReportMeta?.reportKind ?? 'lab',
    imaging: initialReportMeta?.imaging ?? {
      examPart: '',
      examMethod: '',
      findings: '',
      impression: '',
      measurements: '',
    },
    hospital: initialReportMeta?.hospital ?? '',
    reportDate: initialReportMeta?.reportDate ?? '',
    reportType: initialReportMeta?.reportType ?? initialReportMeta?.reportTypes?.[0] ?? '',
    reportTypes:
      initialReportMeta?.reportTypes ??
      (initialReportMeta?.reportType ? [initialReportMeta.reportType] : []),
    testPurpose: initialReportMeta?.testPurpose ?? '',
    title: initialReportMeta?.title ?? '',
    notes: initialReportMeta?.notes ?? '',
  }));
  const [aiReportDateHint, setAiReportDateHint] = useState('');
  const [aiReportTypeHint, setAiReportTypeHint] = useState('');
  const [newTypeChoice, setNewTypeChoice] = useState<'pending' | 'saved' | 'skip'>('pending');
  const [newTypeError, setNewTypeError] = useState('');
  const saveRecognizedType = async () => {
    const raw = aiReportTypeHint.trim();
    if (!raw) return;
    const rec = await addCustomReportType(raw, [raw], reportMeta.reportKind);
    if (rec) {
      setCustomTypes((prev) => [...prev, rec]);
      setReportMeta((m) => ({
        ...m,
        reportType: rec.name,
        reportTypes: [...new Set([...(m.reportTypes ?? []), rec.name])],
      }));
      setAiReportTypeHint('');
      setNewTypeChoice('saved');
      setNewTypeError('');
    } else setNewTypeError('保存失败：名称为空、过长或已存在');
  };

  // 识别结果中的「附加信息」（extraFields/notes/unresolvedText + 表单未覆盖的 report 字段），
  // 默认折叠展示，不写入表单。初值由向导带回的既有 details 提供。
  const [scanExtras, setScanExtras] = useState<{
    report: AiReportFields | null;
    extraFields: AiStructuredExtraField[];
    notes: AiStructuredNote[];
    unresolvedText: string;
  }>(() => ({
    report: null,
    extraFields: detailsToExtraFields(initialDetails ?? []),
    notes: [],
    unresolvedText: '',
  }));
  const [extrasOpen, setExtrasOpen] = useState(false);
  // 用户自定义报告类型（识别 testPurpose 匹配时纳入，仅严格匹配，不自动新增）
  const [customTypes, setCustomTypes] = useState<
    { name: string; aliases: string[]; reportKind?: ReportKind }[]
  >([]);
  useEffect(() => {
    let alive = true;
    loadCustomReportTypes().then((cts) => {
      if (alive)
        setCustomTypes(
          cts.map((c) => ({ name: c.name, aliases: c.aliases, reportKind: c.reportKind })),
        );
    });
    return () => {
      alive = false;
    };
  }, []);

  const lastBlobRef = useRef<Blob | null>(null);
  // 通过引擎工厂创建 Tesseract 本地 OCR 会话；统一接口 create/recognize/terminate。
  const engineFactoryRef = useRef<ReturnType<typeof createConfiguredOcrEngine> | null>(null);
  const sessionRef = useRef<OcrEngine | null>(null);
  const cancelledRef = useRef(false);

  // 卸载时释放 worker，避免后台残留识别
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (sessionRef.current) void sessionRef.current.terminate();
    };
  }, []);

  const setPhaseClean = (p: Phase) => {
    setPhase(p);
    if (p !== 'error') setError('');
  };

  /** 全流程：读取（本机）→ 整理（同源代理，仅文字 + 模式） */
  const run = async (blob: Blob, m: Mode) => {
    cancelledRef.current = false;
    lastBlobRef.current = blob;
    setRows([]);
    setMessage('');
    setMode(m);
    setPhaseClean('reading');
    setDebugInfo({ ...EMPTY_DEBUG, ran: true });
    setDebugOpen(false);
    setScanExtras({ report: null, extraFields: [], notes: [], unresolvedText: '' });
    setExtrasOpen(false);
    setProgress({ status: 'initializing tesseract', progress: 0 });
    if (m === 'report') {
      // 新识别一律从空开始，识别出的新结果覆盖旧候选（含从向导带回的既有 reportMeta）
      setReportMeta({
        reportKind: 'lab',
        imaging: { examPart: '', examMethod: '', findings: '', impression: '', measurements: '' },
        hospital: '',
        reportDate: '',
        reportType: '',
        testPurpose: '',
        title: '',
        notes: '',
      });
      setAiReportDateHint('');
      setAiReportTypeHint('');
    }

    let rawText = '';
    try {
      // 仅本机：预处理（缩放/灰度）后识别，返回文字（内部使用，不展示）
      const { canvas } = await preprocessImage(blob, {
        mode: 'enhanced',
        enhance: 'grayscale',
        maxShortSide: 1400,
        autoLevel: true,
        denoise: false,
        rotate90: 0,
        crop: null,
      });
      if (!engineFactoryRef.current) engineFactoryRef.current = createConfiguredOcrEngine();
      const session = await engineFactoryRef.current.create((p) => {
        if (!cancelledRef.current) setProgress(p);
      });
      if (cancelledRef.current) {
        void session.terminate();
        return;
      }
      sessionRef.current = session;
      const result = await session.recognize(canvas);
      if (sessionRef.current) {
        const s = sessionRef.current;
        sessionRef.current = null;
        void s.terminate();
      }
      rawText = result.rawText;
      setDebugInfo((prev) => ({
        ...prev,
        ocrCompleted: true,
        ocrTextLength: rawText.length,
        ocrTextPreview: rawText.slice(0, READING_TEXT_DEBUG_MAX),
      }));
    } catch (e) {
      if (!cancelledRef.current) {
        const msg = '图片读取失败，请重新裁剪或换一张更清晰的图片后重试。';
        setError(msg);
        setDebugInfo((prev) => ({ ...prev, ocrCompleted: false, errorMessage: msg }));
        setPhaseClean('error');
      }
      return;
    }

    if (cancelledRef.current) return;
    if (rawText.trim() === '') {
      setError('未能从图片中读取到文字，请重新裁剪或换一张更清晰的图片。');
      setPhaseClean('error');
      return;
    }

    // 整理：只发送识别文字与模式（图片绝不发送；不再发送目录/标签映射）
    setPhaseClean('structuring');
    setProgress(null);
    // recognize-request-start：请求发出前先把第 2 步标记为「请求中」，
    // 并保留上一次请求的 client 元信息（不清空），避免长时间显示为「—」。
    setDebugInfo((prev) => ({ ...prev, recognizePhase: 'requesting' }));
    try {
      const reply = await parseRecognizedText(rawText, { mode: m });
      // recognize-response：整理成功，展示明确的「成功」状态与请求元信息
      setDebugInfo((prev) => ({
        ...prev,
        recognizePhase: 'success',
        client: reply.debug ?? null,
        successPreview: reply.content.slice(0, RESULT_DEBUG_PREVIEW_MAX),
        errorMessage: null,
      }));
      const parsed = parseAiReplyContent(reply.content);
      // 本地 schema 清洗（固定 schema report/items/extraFields/notes/unresolvedText；
      // 兼容旧 originalName/reportType/title）：结果恒为待确认、无标准标签。
      // mock（开发）时 sample 项目的 sourceText=项目名，无法在真实 OCR 原文中逐字命中
      // （OCR 会打散字符），故把识别返回的项目名补入 grounding 文本，使真实清洗路径保留
      // ground-truth 项目（“整张报告模式走项目列表”）；真实模式仍只用 OCR 原文，安全不受影响。
      const cleanSentText = buildCleanSentText(parsed, rawText, {
        includeParsedItemNames: isMockStructuredReply(reply.debug?.server ?? null),
      });
      const cleaned =
        m === 'report'
          ? cleanAiReportStructured(parsed, cleanSentText)
          : cleanAiStructured(parsed, cleanSentText);
      if (m === 'report') {
        if (cleaned.items.length === 0 && !cleaned.report.hospital && !cleaned.report.reportDate) {
          const diagnostic =
            reply.debug?.server && typeof reply.debug.server === 'object'
              ? (reply.debug.server as { stage?: unknown; errorCode?: unknown }).stage
              : null;
          setError(
            typeof diagnostic === 'string'
              ? `上游已返回，但${diagnostic === 'response-parse' ? '响应内容无法解析' : '未提取到有效报告字段'}，请重试；也可手动录入检查项。`
              : '上游已返回，但未提取到有效报告字段，请重试；也可手动录入检查项。',
          );
          setPhaseClean('error');
          return;
        }
        setRows(cleaned.items.map((it) => itemToRow(it)));
        setReportMeta((prev) => ({
          ...prev,
          reportKind: cleaned.report.reportKind as ReportKind,
          imaging: cleaned.imaging,
          exams: cleaned.imaging.exams,
        }));
        const hospital = cleanFreeText(cleaned.report.hospital);
        const title = cleanFreeText(cleaned.report.title);
        const recognizedKind = cleaned.report.reportKind as ReportKind;
        const cleanedReportTypes = cleaned.report.reportTypes
          .map((t) => reportTypeCandidate(t.trim(), recognizedKind))
          .filter((t): t is string => t !== '');
        const explicitImagingTypes =
          recognizedKind === 'imaging' ? explicitImagingTypesFromExams(cleaned.imaging.exams) : [];
        const mergedReportTypes = [...new Set([...cleanedReportTypes, ...explicitImagingTypes])];
        const rpType = reportTypeCandidate(cleaned.report.reportType.trim(), recognizedKind);
        // testPurpose is display-only metadata for imaging; never infer an imaging report type from it.
        const purposeType =
          cleaned.report.reportKind === 'lab'
            ? matchTestPurposeToType(cleaned.report.testPurpose, customTypes, 'lab')
            : '';
        const dateRaw = cleaned.report.reportDate.trim();
        const dateOk = ISO_DATE_RE.test(dateRaw) ? dateRaw : '';
        setReportMeta((prev) => ({
          reportKind: prev.reportKind,
          // Keep the complete cleaned imaging payload, including every exams[] entry.
          // Do not read the previous state here: this updater runs after the payload
          // updater above and would otherwise restore the old single/empty exam.
          imaging: cleaned.imaging,
          exams: cleaned.imaging.exams,
          hospital: prev.hospital !== '' ? prev.hospital : hospital,
          // 默认「今天」视为未填写：允许被识别出的报告日期候选替换（用户仍可改）
          reportDate:
            prev.reportDate !== '' && prev.reportDate !== todayISO()
              ? prev.reportDate
              : dateOk || prev.reportDate,
          reportType:
            prev.reportType !== ''
              ? prev.reportType
              : mergedReportTypes[0] || rpType || purposeType,
          reportTypes: prev.reportTypes?.length
            ? prev.reportTypes
            : mergedReportTypes.length
              ? mergedReportTypes
              : rpType || purposeType
                ? [rpType || purposeType]
                : [],
          // 检验目的是报告结构的固定字段，独立保留（不混入 details/附件信息）
          testPurpose:
            prev.testPurpose !== '' ? prev.testPurpose : cleaned.report.testPurpose.trim(),
          title: prev.title !== '' ? prev.title : title,
          notes: prev.notes,
        }));
        setAiReportDateHint(dateOk === '' && dateRaw !== '' ? dateRaw : '');
        setAiReportTypeHint(
          cleaned.report.reportType.trim() !== '' && rpType === ''
            ? cleaned.report.reportType.trim()
            : '',
        );
      } else {
        if (cleaned.items.length === 0) {
          setError('未能整理出检查项目，请重试；也可手动录入检查项。');
          setPhaseClean('error');
          return;
        }
        setRows(cleaned.items.map((it) => itemToRow(it)));
      }
      // 附加信息（extraFields/notes/unresolvedText 与表单未覆盖的 report 字段）折叠展示
      setScanExtras({
        report: cleaned.report,
        extraFields: cleaned.extraFields,
        notes: cleaned.notes,
        unresolvedText: cleaned.unresolvedText,
      });
      setExtrasOpen(false);
      setPhaseClean('done');
    } catch (e) {
      const msg =
        e instanceof StructureError || e instanceof Error ? e.message : '识别失败，请稍后重试。';
      setError(msg);
      // recognize-error / recognize-timeout：失败也要保留最后一次请求元信息，
      // 并明确标记为「超时」或「失败」，绝不被静默覆盖成空。
      setDebugInfo((prev) => ({
        ...prev,
        recognizePhase: e instanceof StructureError && e.debug?.timeout ? 'timeout' : 'error',
        client: e instanceof StructureError ? (e.debug ?? null) : prev.client,
        errorMessage: msg,
      }));
      setPhaseClean('error');
    }
  };

  /** 直接对已选图片发起识别，不再打开裁剪/编辑浮窗。 */
  const runOnSelected = (m: Mode) => {
    if (!selectedImage) return;
    setError('');
    setPhaseClean('idle');
    setMode(m);
    void run(selectedImage.blob, m);
  };

  const retry = () => {
    if (lastBlobRef.current) void run(lastBlobRef.current, mode);
    else runOnSelected(mode);
  };

  const addToReport = () => {
    if (rows.length === 0) return;
    onImport(rows.map(rowToCandidate));
    const count = rows.length;
    setRows([]);
    setPhaseClean('idle');
    setMessage(`已将 ${count} 项添加到下方项目列表（仍为待确认，请核对后确认）。`);
  };

  /** 构造整张报告扫描结果（报告信息候选 + 附加详情 + 项目候选）。 */
  const buildScan = (): {
    report: ReportScanMeta;
    details: ReportDetail[];
    items: OcrCandidate[];
  } => ({
    report: {
      reportKind: reportMeta.reportKind,
      imaging: {
        ...reportMeta.imaging,
        ...(reportMeta.exams ? { exams: reportMeta.exams } : {}),
      },
      hospital: reportMeta.hospital.trim(),
      reportDate: reportMeta.reportDate,
      reportType: reportMeta.reportTypes?.[0] ?? reportMeta.reportType,
      reportTypes: reportMeta.reportTypes,
      testPurpose: reportMeta.testPurpose.trim(),
      title: reportMeta.title.trim(),
      notes: reportMeta.notes.trim(),
    },
    details: buildReportDetails(scanExtras.report, {
      extraFields: scanExtras.extraFields,
      notes: scanExtras.notes,
      unresolvedText: scanExtras.unresolvedText,
    }),
    items: rows.map(rowToCandidate),
  });

  // 新建向导中由用户点击 CTA 后进入核对页，避免识别完成后自动跳转。
  const enterReview = () => {
    // Returning from review remounts this panel with a seeded draft, so phase is
    // idle even though the completed recognition result is still actionable.
    if (onReportScan && mode === 'report' && (phase === 'done' || showResults))
      onReportScan(buildScan());
  };

  // 由父向导统一渲染底部操作栏时，通过 ref 暴露“进入核对并保存”动作（保持同屏同一操作栏）。
  useImperativeHandle(
    ref,
    () => ({
      enterReview,
    }),
    [enterReview],
  );

  /** 用户显式「采用」推荐标签：已随标签功能移除，此处不再提供。 */

  const percent = phase === 'reading' && progress ? Math.round(progress.progress * 100) : null;

  // 识别进行中（读取/整理）：禁用面板主按钮，避免再次发起并发 run()。
  const busy = phase === 'reading' || phase === 'structuring';

  // 已有识别结果（从向导带回）：返回识别页时无需重新识别即可查看。
  const hasSeededMeta =
    reportMeta.hospital !== '' ||
    reportMeta.reportDate !== '' ||
    reportMeta.reportType !== '' ||
    reportMeta.testPurpose !== '' ||
    reportMeta.title !== '' ||
    reportMeta.notes !== '';
  const hasExtrasContent =
    scanExtras.extraFields.length > 0 ||
    scanExtras.notes.length > 0 ||
    scanExtras.unresolvedText !== '' ||
    (scanExtras.report !== null &&
      REPORT_EXTRA_LABELS.some(([k]) => {
        const raw = scanExtras.report?.[k];
        return typeof raw === 'string' && raw.trim() !== '';
      }));
  // 展示识别结果：识别完成（done），或为向导带回的既有候选（不再要求重新识别才能看到）。
  const showResults = phase === 'done' || rows.length > 0 || hasSeededMeta || hasExtrasContent;

  const reportModeAvailable = !!onReportScan;
  const selectedImage = images.find((a) => a.id === selectedId);

  return (
    <div className="recognition-panel" role="region" aria-label="识别报告数据">
      {images.length === 0 ? (
        <p className="recog-empty">
          {hasPdfOnly
            ? '当前报告只有 PDF 附件：请上传报告图片后再使用自动识别，或手动添加检查项目。'
            : '当前报告还没有图片附件：请先添加报告图片。'}
        </p>
      ) : (
        <div className="recog-controls">
          {images.length > 1 && (
            <label className="ocr-select-label">
              选择图片：
              <select
                value={selectedId}
                onChange={(e) => {
                  setSelectedId(e.target.value);
                  setPhaseClean('idle');
                  setRows([]);
                  setReportMeta({
                    reportKind: 'lab',
                    imaging: {
                      examPart: '',
                      examMethod: '',
                      findings: '',
                      impression: '',
                      measurements: '',
                    },
                    hospital: '',
                    reportDate: '',
                    reportType: '',
                    reportTypes: [],
                    testPurpose: '',
                    title: '',
                    notes: '',
                  });
                  setScanExtras({ report: null, extraFields: [], notes: [], unresolvedText: '' });
                  setDebugInfo(EMPTY_DEBUG);
                  setProgress(null);
                  setAiReportDateHint('');
                  setAiReportTypeHint('');
                  lastBlobRef.current = null;
                  setMessage('');
                }}
              >
                {images.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="btn-row recog-main-row">
            {reportModeAvailable && (
              <button
                type="button"
                className="btn btn-primary recog-main-btn recog-main-cta"
                disabled={!memberSelected || busy}
                title={
                  memberSelected
                    ? '识别整张报告：一次返回报告信息与检查项目（全部待确认）'
                    : '请先在上方选择成员，再识别整张报告。'
                }
                onClick={() => runOnSelected('report')}
              >
                <ScanLine size={18} strokeWidth={2} aria-hidden="true" /> 识别整张报告
              </button>
            )}
            {!reportModeOnly && (
              <button
                type="button"
                className="btn recog-main-btn"
                disabled={busy}
                onClick={() => runOnSelected('items')}
              >
                <Camera size={18} strokeWidth={2} aria-hidden="true" /> 仅识别检查项目
              </button>
            )}
          </div>
          {reportModeAvailable && !memberSelected && (
            <span className="recog-hint">
              请先选择成员后再识别整张报告；识别内容全部为待确认候选。
            </span>
          )}
          {!reportModeAvailable && (
            <span className="recog-hint">只识别所选图片的内容；识别结果请核对。</span>
          )}
        </div>
      )}

      {phase === 'reading' && (
        <div className="recog-progress" role="status">
          <div className="ocr-progress-row">
            <span>{progress ? ocrStatusText(progress.status) : STAGE_READING}</span>
            <span>{percent ?? 0}%</span>
          </div>
          <div
            className="ocr-progress-track"
            role="progressbar"
            aria-valuenow={percent ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="ocr-progress-bar" style={{ width: `${percent ?? 0}%` }} />
          </div>
        </div>
      )}

      {phase === 'structuring' && (
        <div className="recog-progress" role="status">
          <div className="recog-stage">
            <span className="spinner" aria-hidden="true" />
            <span>{mode === 'report' ? STAGE_REPORT_STRUCTURING : STAGE_STRUCTURING}…</span>
          </div>
        </div>
      )}

      {message && <p className="recog-imported">{message}</p>}

      {error && (
        <div className="recog-error" role="alert">
          <p>{error}</p>
          <div className="btn-row">
            <button type="button" className="btn btn-sm btn-primary" onClick={retry}>
              重试
            </button>
            {!autoReportScan && (
              <button type="button" className="btn btn-sm" onClick={() => runOnSelected(mode)}>
                重新裁剪
              </button>
            )}
          </div>
        </div>
      )}

      {showResults && mode === 'report' && autoReportScan && (
        <div className="wizard-summary recog-summary" aria-label="识别结果摘要">
          <strong>识别结果摘要</strong>
          <p>
            当前图片「{selectedImage?.name ?? '未选择'}」识别已完成 · 报告大类：
            {reportMeta.reportKind === 'imaging'
              ? '影像'
              : reportMeta.reportKind === 'lab'
                ? '检验'
                : '其他'}
          </p>
          <p>
            {reportMeta.reportType
              ? `识别到的报告类型：${reportMeta.reportType}`
              : '报告类型：未匹配'}
          </p>
          <p>
            {reportMeta.reportKind === 'imaging'
              ? `影像子检查：${reportMeta.imaging.exams?.length ?? 0} 项`
              : `检验项目：${rows.length} 项`}
          </p>
          <p className="dim">报告类型、检验目的/检查项目及具体项目请在下一步核对页编辑。</p>
        </div>
      )}

      {showResults && mode === 'report' && !autoReportScan && (
        <div className="recog-report-meta">
          <div className="att-head">
            <strong>识别出的报告信息（候选）</strong>
            <small>下一步进入核对页后填入报告表单；可先在上方手填标题/备注。</small>
          </div>
          <div className="form-grid">
            <label className="crop-zoom-label">
              医院 / 体检机构
              <input
                value={reportMeta.hospital}
                onChange={(e) => setReportMeta((m) => ({ ...m, hospital: e.target.value }))}
                placeholder="如：市第一人民医院"
              />
            </label>
            <label className="crop-zoom-label">
              报告日期
              <input
                type="date"
                value={reportMeta.reportDate}
                onChange={(e) => {
                  setReportMeta((m) => ({ ...m, reportDate: e.target.value }));
                  setAiReportDateHint('');
                }}
              />
              {aiReportDateHint !== '' && (
                <small className="dim">
                  识别候选「{aiReportDateHint}」不是有效日期，未自动填入
                </small>
              )}
            </label>
            <label className="crop-zoom-label">
              报告类型 / 检查类别
              <select
                value={reportMeta.reportType}
                onChange={(e) => {
                  setReportMeta((m) => ({ ...m, reportType: e.target.value }));
                  setAiReportTypeHint('');
                }}
              >
                <option value="">（不选择）</option>
                {(reportMeta.reportKind === 'imaging'
                  ? [
                      ...IMAGING_REPORT_TYPES,
                      ...customTypes.filter((c) => c.reportKind === 'imaging').map((c) => c.name),
                    ]
                  : reportMeta.reportKind === 'lab'
                    ? [
                        ...LAB_REPORT_TYPES,
                        ...customTypes.filter((c) => c.reportKind === 'lab').map((c) => c.name),
                      ]
                    : []
                ).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              {aiReportTypeHint !== '' && (
                <div className="purpose-suggestion" role="note">
                  <small>识别到的新报告类型：{aiReportTypeHint}</small>
                  {newTypeChoice === 'pending' && (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => void saveRecognizedType()}
                    >
                      保存为新报告类型
                    </button>
                  )}
                  {newTypeChoice === 'saved' && <small className="dim">已保存并选中</small>}
                  {newTypeError && <p className="error-text">{newTypeError}</p>}
                </div>
              )}
            </label>
            <label className="crop-zoom-label">
              {reportMeta.reportKind === 'imaging' ? '检查目的' : '检验目的'}
              <input
                value={reportMeta.testPurpose}
                onChange={(e) => setReportMeta((m) => ({ ...m, testPurpose: e.target.value }))}
                placeholder={
                  reportMeta.reportKind === 'imaging' ? '如：腹部超声检查' : '如：血常规检查'
                }
              />
            </label>
            <label className="crop-zoom-label">
              标题
              <input
                value={reportMeta.title}
                onChange={(e) => setReportMeta((m) => ({ ...m, title: e.target.value }))}
                placeholder="可选，如 2025 年度体检"
              />
            </label>
            <label className="crop-zoom-label">
              备注
              <input
                value={reportMeta.notes}
                onChange={(e) => setReportMeta((m) => ({ ...m, notes: e.target.value }))}
                placeholder="可选"
              />
            </label>
          </div>
        </div>
      )}

      {showResults && rows.length > 0 && !autoReportScan && (
        <div className="recog-result">
          <div className="att-head">
            <strong>识别结果（{rows.length} 项）</strong>
            <small>
              全部仍为待确认；「识别名称」仅为展示清理，项目原文不修改；识别结果不自动设置标准标签，也不会自动进入趋势。
            </small>
          </div>
          <div className="table-wrap">
            <table className="data-table recognition-items-table">
              <thead>
                <tr>
                  <th className="col-name">项目名（原文）*</th>
                  <th className="col-value">数值 / 定性结果</th>
                  <th>单位</th>
                  <th>参考区间</th>
                  <th>方法</th>
                  <th className="col-status">状态</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="row-pending">
                    <td>
                      <input
                        value={r.name}
                        title="项目名（报告原文，未做任何纠正，可手动修改）"
                        onChange={(e) =>
                          setRows((list) =>
                            list.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)),
                          )
                        }
                        placeholder="项目名"
                      />
                      <div className="recog-name-hint">识别名称：{r.displayName}</div>
                    </td>
                    <td>
                      <div className="value-cell">
                        <input
                          value={r.value}
                          onChange={(e) =>
                            setRows((list) =>
                              list.map((x, idx) =>
                                idx === i ? { ...x, value: e.target.value } : x,
                              ),
                            )
                          }
                          placeholder="结果"
                        />
                        <select
                          value={r.resultKind}
                          title="结果类型"
                          onChange={(e) =>
                            setRows((list) =>
                              list.map((x, idx) =>
                                idx === i
                                  ? { ...x, resultKind: e.target.value as DraftRow['resultKind'] }
                                  : x,
                              ),
                            )
                          }
                        >
                          <option value="numeric">数值</option>
                          <option value="qualitative">定性</option>
                        </select>
                      </div>
                    </td>
                    <td>
                      <input
                        value={r.unit}
                        onChange={(e) =>
                          setRows((list) =>
                            list.map((x, idx) => (idx === i ? { ...x, unit: e.target.value } : x)),
                          )
                        }
                        placeholder="单位"
                        style={{ width: 90 }}
                      />
                    </td>
                    <td>
                      <input
                        value={r.refRange}
                        onChange={(e) =>
                          setRows((list) =>
                            list.map((x, idx) =>
                              idx === i ? { ...x, refRange: e.target.value } : x,
                            ),
                          )
                        }
                        placeholder="参考区间"
                        style={{ width: 110 }}
                      />
                    </td>
                    <td>
                      <input
                        value={r.method}
                        title="检验方法（候选）"
                        onChange={(e) =>
                          setRows((list) =>
                            list.map((x, idx) =>
                              idx === i ? { ...x, method: e.target.value } : x,
                            ),
                          )
                        }
                        placeholder="方法"
                        style={{ width: 100 }}
                      />
                    </td>
                    <td>
                      <span className="status-toggle st-warn">待确认</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => setRows((list) => list.filter((_, idx) => idx !== i))}
                      >
                        删
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ocr-actions">
            {mode !== 'report' ? (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={addToReport}
                disabled={rows.length === 0}
              >
                添加到报告（{rows.length} 项）
              </button>
            ) : null}
            {!autoReportScan && (
              <button type="button" className="btn btn-sm" onClick={() => runOnSelected(mode)}>
                重新识别
              </button>
            )}
          </div>
        </div>
      )}

      {showResults && hasExtrasContent && (
        <div className="recog-extras">
          <button
            type="button"
            className="recog-debug-toggle"
            aria-expanded={extrasOpen}
            onClick={() => setExtrasOpen((v) => !v)}
          >
            <span>ℹ️ 附加识别信息（表单未覆盖字段 / 备注 / 未解析原文）</span>
            <span className="recog-debug-caret">{extrasOpen ? '▾' : '▸'}</span>
          </button>
          {extrasOpen && hasExtrasContent && (
            <div className="recog-extras-body">
              {scanExtras.report && (
                <div className="recog-extras-section">
                  <strong>报告附加字段</strong>
                  <div className="recog-extras-kv">
                    {REPORT_EXTRA_LABELS.map(([k, label]) => {
                      const raw = scanExtras.report?.[k];
                      const v = typeof raw === 'string' ? raw.trim() : '';
                      return v === '' ? null : (
                        <div key={k} className="recog-extras-kv-row">
                          <span className="dim">{label}</span>
                          <span>{v}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {scanExtras.extraFields.length > 0 && (
                <div className="recog-extras-section">
                  <strong>附加字段（extraFields）</strong>
                  <ul>
                    {scanExtras.extraFields.map((f, i) => (
                      <li key={i}>
                        <span className="dim">[{f.section}] </span>
                        {f.key && <b>{f.key}：</b>}
                        {f.value || '—'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {scanExtras.notes.length > 0 && (
                <div className="recog-extras-section">
                  <strong>备注（notes）</strong>
                  <ul>
                    {scanExtras.notes.map((n, i) => (
                      <li key={i}>{n.text || '—'}</li>
                    ))}
                  </ul>
                </div>
              )}
              {scanExtras.unresolvedText !== '' && (
                <div className="recog-extras-section">
                  <strong>未解析原文</strong>
                  <pre className="recog-extras-pre">{scanExtras.unresolvedText}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {debugInfo.ran && (
        <div className="recog-debug">
          <button
            type="button"
            className="recog-debug-toggle"
            aria-expanded={debugOpen}
            onClick={() => setDebugOpen((v) => !v)}
          >
            <span>🔧 识别调试</span>
            <span className="recog-debug-caret">{debugOpen ? '▾' : '▸'}</span>
          </button>
          {debugOpen && (
            <div className="recog-debug-body">
              <p className="recog-debug-note">
                以下为仅本机调试信息，用于排查「识别服务暂时无法连接」；不含任何密钥/请求头/原始正文全文。
              </p>
              <ol className="recog-debug-timeline">
                {/* 1. 本机图片读取（OCR） */}
                <li>
                  <div className="recog-debug-step">1. 本机图片读取（OCR）</div>
                  <div className="recog-debug-detail">
                    {debugInfo.ocrCompleted ? (
                      <>
                        <span className="recog-debug-ok">✓ 已读取</span>
                        <span>识别文字长度：{debugInfo.ocrTextLength} 字符</span>
                      </>
                    ) : (
                      <span className="recog-debug-bad">✕ 未完成（读取失败或取消）</span>
                    )}
                  </div>
                  {debugInfo.ocrTextPreview !== '' && (
                    <pre className="recog-debug-pre">
                      {debugInfo.ocrTextPreview}
                      {debugInfo.ocrTextLength > READING_TEXT_DEBUG_MAX ? '…' : ''}
                    </pre>
                  )}
                  {debugInfo.ocrTextPreview !== '' && (
                    <div className="recog-debug-meta">
                      <span>仅本机调试 · 仅显示前 {READING_TEXT_DEBUG_MAX} 字符</span>
                      <button
                        type="button"
                        className="btn btn-xs"
                        onClick={() =>
                          void navigator.clipboard?.writeText(debugInfo.ocrTextPreview)
                        }
                      >
                        复制文本预览
                      </button>
                    </div>
                  )}
                </li>

                {/* 2. 文字整理请求（客户端） */}
                <li>
                  <div className="recog-debug-step">2. 文字整理请求</div>
                  <div className="recog-debug-detail">
                    <span>
                      状态：
                      {debugInfo.recognizePhase === 'requesting'
                        ? '请求中…'
                        : debugInfo.recognizePhase === 'success'
                          ? '✓ 成功'
                          : debugInfo.recognizePhase === 'timeout'
                            ? '✕ 超时'
                            : debugInfo.recognizePhase === 'error'
                              ? '✕ 失败'
                              : '—'}
                    </span>
                    <span>HTTP 状态：{debugInfo.client?.status ?? '—'}</span>
                    <span>耗时：{debugInfo.client?.durationMs ?? '—'} ms</span>
                    <span>超时：{debugInfo.client?.timeout ? '是' : '否'}</span>
                    {debugInfo.client?.errorCode && (
                      <span>错误码：{debugInfo.client.errorCode}</span>
                    )}
                  </div>
                  {debugInfo.recognizePhase === 'requesting' && (
                    <div className="recog-debug-detail">
                      <span className="recog-debug-ok">请求已发出，等待整理结果…</span>
                    </div>
                  )}
                  {debugInfo.client?.errorMessage && (
                    <div className="recog-debug-error">
                      <span className="recog-debug-bad">✕ 清洗后错误：</span>
                      {debugInfo.client.errorMessage}
                    </div>
                  )}
                </li>

                {/* 3. 服务端上游 */}
                <li>
                  <div className="recog-debug-step">3. 服务端上游</div>
                  <div className="recog-debug-detail">
                    <span>
                      已尝试：
                      {debugInfo.client?.server?.upstreamTried.length
                        ? debugInfo.client.server.upstreamTried.join(' → ')
                        : '—'}
                    </span>
                    <span>命中上游：{debugInfo.client?.server?.selectedUpstream ?? '（无）'}</span>
                    <span>
                      请求模型名：
                      {debugInfo.client?.server?.selectedUpstreamModel ?? '（无）'}
                    </span>
                    <span>
                      请求地址：
                      {debugInfo.client?.server?.selectedUpstreamEndpoint ?? '（无）'}
                    </span>
                    <span>失败上游：{debugInfo.client?.server?.failedUpstream ?? '（无）'}</span>
                    {debugInfo.client?.server?.fallbackReason && (
                      <span>回退原因：{debugInfo.client.server.fallbackReason}</span>
                    )}
                    {debugInfo.client?.server && (
                      <span>服务端耗时：{debugInfo.client.server.durationMs} ms</span>
                    )}
                  </div>
                  {(debugInfo.client?.server?.attempts?.length ?? 0) > 0 && (
                    <div className="recog-debug-attempts">
                      <div className="recog-debug-detail">
                        <span>上游时间线（每次尝试的结果类别）：</span>
                      </div>
                      <ul className="recog-debug-attempt-list">
                        {debugInfo.client?.server?.attempts.map((att, idx) => (
                          <li key={idx}>
                            <span className="recog-debug-attempt-name">{att.upstream}</span>
                            {att.model && <span>模型：{att.model}</span>}
                            {att.endpoint && <span>地址：{att.endpoint}</span>}
                            <span>状态：{att.status ?? '—'}</span>
                            <span>耗时：{att.durationMs} ms</span>
                            <span>结果：{att.outcome}</span>
                            {att.errorCategory && <span>类别：{att.errorCategory}</span>}
                          </li>
                        ))}
                      </ul>
                      {debugInfo.client?.server?.finalFailureReason && (
                        <div className="recog-debug-detail">
                          <span className="recog-debug-bad">最终失败原因：</span>
                          <span>{debugInfo.client.server.finalFailureReason}</span>
                          {debugInfo.client.server.finalStatus != null && (
                            <span>（HTTP 状态：{debugInfo.client.server.finalStatus}）</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </li>

                {/* 4. 返回结果 */}
                <li>
                  <div className="recog-debug-step">4. 返回结果</div>
                  {debugInfo.successPreview !== null ? (
                    <>
                      <div className="recog-debug-detail">
                        <span className="recog-debug-ok">✓ 整理成功</span>
                      </div>
                      <pre className="recog-debug-pre">
                        {debugInfo.successPreview}
                        {debugInfo.successPreview.length >= RESULT_DEBUG_PREVIEW_MAX ? '…' : ''}
                      </pre>
                      <div className="recog-debug-meta">
                        仅本机调试 · 内容预览最多 {RESULT_DEBUG_PREVIEW_MAX} 字
                      </div>
                    </>
                  ) : debugInfo.errorMessage ? (
                    <div className="recog-debug-error">
                      <span className="recog-debug-bad">✕ {debugInfo.errorMessage}</span>
                    </div>
                  ) : (
                    <div className="recog-debug-detail">—</div>
                  )}
                </li>
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
