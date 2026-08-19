import { useEffect, useMemo, useRef, useState } from 'react';
import type { AttachmentRecord } from '../types';
import { REPORT_TYPES } from '../types';
import { ImageCropModal, type CroppedImage } from './ImageCropModal';
import { ocrStatusText, type OcrProgress } from '../utils/ocr';
import { createConfiguredOcrEngine, type OcrEngine } from '../utils/ocrEngine';
import { preprocessImage } from '../utils/ocrPreprocess';
import {
  cleanAiReportStructured,
  cleanAiStructured,
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
import { cleanFreeText } from '../utils/displayName';
import { todayISO } from '../utils/dates';

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
 *   3. 只有点击「创建报告并添加已选项目」才会把候选填入报告表单（最终保存仍由用户触发）。
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

function reportTypeCandidate(reportType: string): string {
  return (REPORT_TYPES as readonly string[]).includes(reportType) ? reportType : '';
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
  ['testPurpose', '检验目的'],
  ['sampleDate', '采样日期'],
  ['receiveDate', '接收日期'],
  ['printDate', '打印日期'],
  ['senderDoctor', '送检医生'],
  ['inspector', '检验者'],
  ['reviewer', '审核者'],
];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function ReportRecognitionPanel({
  attachments,
  onImport,
  onReportScan,
  memberSelected = false,
  initialReportMeta,
}: {
  attachments: AttachmentRecord[];
  onImport: (candidates: OcrCandidate[]) => void;
  onReportScan?: (scan: { report: ReportScanMeta; items: OcrCandidate[] }) => void;
  memberSelected?: boolean;
  initialReportMeta?: ReportScanMeta;
}) {
  const images = useMemo(() => attachments.filter((a) => a.kind === 'image'), [attachments]);
  const hasPdfOnly = attachments.length > 0 && images.length === 0;

  const [selectedId, setSelectedId] = useState('');
  useEffect(() => {
    if (!images.some((a) => a.id === selectedId)) setSelectedId(images[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);

  const [phase, setPhase] = useState<Phase>('idle');
  const [mode, setMode] = useState<Mode>('items');
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [message, setMessage] = useState('');
  const [cropOpen, setCropOpen] = useState(false);

  // 仅本机调试面板：默认折叠，只在识别流程运行过或出错后显示。
  const [debugInfo, setDebugInfo] = useState<RecognitionDebug>(EMPTY_DEBUG);
  const [debugOpen, setDebugOpen] = useState(false);

  // 整张报告模式的报告信息候选（全部可编辑；点击「创建报告并添加已选项目」才写入表单）
  const [reportMeta, setReportMeta] = useState<ReportScanMeta>({
    hospital: '',
    reportDate: '',
    reportType: '',
    title: '',
    notes: '',
  });
  const [aiReportDateHint, setAiReportDateHint] = useState('');
  const [aiReportTypeHint, setAiReportTypeHint] = useState('');

  // 识别结果中的「附加信息」（extraFields/notes/unresolvedText + 表单未覆盖的 report 字段），
  // 默认折叠展示，不写入表单。
  const [scanExtras, setScanExtras] = useState<{
    report: AiReportFields | null;
    extraFields: AiStructuredExtraField[];
    notes: AiStructuredNote[];
    unresolvedText: string;
  }>({ report: null, extraFields: [], notes: [], unresolvedText: '' });
  const [extrasOpen, setExtrasOpen] = useState(false);

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
      setReportMeta({
        ...(initialReportMeta ?? {
          hospital: '',
          reportDate: '',
          reportType: '',
          title: '',
          notes: '',
        }),
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
      // 兼容旧 originalName/reportType/title）：结果恒为待确认、无标准标签
      const cleaned =
        m === 'report'
          ? cleanAiReportStructured(parsed, rawText)
          : cleanAiStructured(parsed, rawText);
      if (m === 'report') {
        if (cleaned.items.length === 0 && !cleaned.report.hospital && !cleaned.report.reportDate) {
          setError('未能识别出报告信息或检查项目，请重试；也可手动录入检查项。');
          setPhaseClean('error');
          return;
        }
        setRows(cleaned.items.map((it) => itemToRow(it)));
        const hospital = cleanFreeText(cleaned.report.hospital);
        const title = cleanFreeText(cleaned.report.title);
        const rpType = reportTypeCandidate(cleaned.report.reportType.trim());
        const dateRaw = cleaned.report.reportDate.trim();
        const dateOk = ISO_DATE_RE.test(dateRaw) ? dateRaw : '';
        setReportMeta((prev) => ({
          hospital: prev.hospital !== '' ? prev.hospital : hospital,
          // 默认「今天」视为未填写：允许被识别出的报告日期候选替换（用户仍可改）
          reportDate:
            prev.reportDate !== '' && prev.reportDate !== todayISO()
              ? prev.reportDate
              : dateOk || prev.reportDate,
          reportType: prev.reportType !== '' ? prev.reportType : rpType,
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

  const openCrop = (m: Mode) => {
    if (!selectedId) return;
    setError('');
    setPhaseClean('idle');
    setMode(m);
    setCropOpen(true);
  };

  const retry = () => {
    if (lastBlobRef.current) void run(lastBlobRef.current, mode);
    else openCrop(mode);
  };

  const addToReport = () => {
    if (rows.length === 0) return;
    onImport(rows.map(rowToCandidate));
    const count = rows.length;
    setRows([]);
    setPhaseClean('idle');
    setMessage(`已将 ${count} 项添加到下方项目列表（仍为待确认，请核对后确认）。`);
  };

  const createReportAndAddItems = () => {
    if (!onReportScan) return;
    onReportScan({
      report: {
        hospital: reportMeta.hospital.trim(),
        reportDate: reportMeta.reportDate,
        reportType: reportMeta.reportType,
        title: reportMeta.title.trim(),
        notes: reportMeta.notes.trim(),
      },
      items: rows.map(rowToCandidate),
    });
    const count = rows.length;
    setRows([]);
    setPhaseClean('idle');
    setMessage(
      count > 0
        ? `已将报告信息与 ${count} 项待确认项目填入下方表单，请核对后点「保存报告」。`
        : '已将报告信息填入下方表单，请核对后点「保存报告」。',
    );
  };

  /** 用户显式「采用」推荐标签：已随标签功能移除，此处不再提供。 */

  const percent = phase === 'reading' && progress ? Math.round(progress.progress * 100) : null;

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
            <button
              type="button"
              className="btn btn-primary recog-main-btn"
              onClick={() => openCrop('items')}
            >
              📷 识别数据
            </button>
            {reportModeAvailable && (
              <button
                type="button"
                className="btn recog-main-btn"
                disabled={!memberSelected}
                title={
                  memberSelected
                    ? '识别整张报告：一次返回报告信息候选与检查项目候选（全部待确认）'
                    : '请先在上方选择成员，再识别整张报告。'
                }
                onClick={() => openCrop('report')}
              >
                🧾 识别整张报告（含报告信息）
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
            <button type="button" className="btn btn-sm" onClick={() => openCrop(mode)}>
              重新裁剪
            </button>
          </div>
        </div>
      )}

      {phase === 'done' && mode === 'report' && (
        <div className="recog-report-meta">
          <div className="att-head">
            <strong>识别出的报告信息（候选）</strong>
            <small>
              仅在你点击「创建报告并添加已选项目」后填入下方报告表单；可先在上方手填标题/备注。
            </small>
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
                {REPORT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              {aiReportTypeHint !== '' && (
                <small className="dim">
                  识别候选「{aiReportTypeHint}」不在严格选项内，未自动填入：请手动选择
                </small>
              )}
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
          {rows.length === 0 && (
            <div className="ocr-actions">
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={createReportAndAddItems}
              >
                创建报告并添加已选项目（0 项，仅报告信息）
              </button>
            </div>
          )}
        </div>
      )}

      {phase === 'done' && rows.length > 0 && (
        <div className="recog-result">
          <div className="att-head">
            <strong>识别结果（{rows.length} 项）</strong>
            <small>
              全部仍为待确认；「识别名称」仅为展示清理，项目原文不修改；识别结果不自动设置标准标签，也不会自动进入趋势。
            </small>
          </div>
          <div className="table-wrap">
            <table className="data-table item-edit-table">
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
            {mode === 'report' && onReportScan ? (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={createReportAndAddItems}
              >
                创建报告并添加已选项目（{rows.length} 项）
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={addToReport}
                disabled={rows.length === 0}
              >
                添加到报告（{rows.length} 项）
              </button>
            )}
            <button type="button" className="btn btn-sm" onClick={() => openCrop(mode)}>
              重新识别
            </button>
          </div>
        </div>
      )}

      {phase === 'done' &&
        scanExtras.report !== null &&
        (REPORT_EXTRA_LABELS.some(([k]) => (scanExtras.report?.[k] ?? '').trim() !== '') ||
          scanExtras.extraFields.length > 0 ||
          scanExtras.notes.length > 0 ||
          scanExtras.unresolvedText !== '') && (
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
            {extrasOpen && scanExtras.report && (
              <div className="recog-extras-body">
                <div className="recog-extras-section">
                  <strong>报告附加字段</strong>
                  <div className="recog-extras-kv">
                    {REPORT_EXTRA_LABELS.map(([k, label]) => {
                      const v = (scanExtras.report?.[k] ?? '').trim();
                      return v === '' ? null : (
                        <div key={k} className="recog-extras-kv-row">
                          <span className="dim">{label}</span>
                          <span>{v}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
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

      {cropOpen && selectedImage && (
        <ImageCropModal
          key={selectedImage.id}
          blob={selectedImage.blob}
          onCancel={() => setCropOpen(false)}
          onConfirm={(cropped: CroppedImage) => {
            setCropOpen(false);
            void run(cropped.blob, mode);
          }}
        />
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
}
