import type { OcrCandidate } from './ocrCandidate';
import { cleanDisplayName } from './displayName';
import type { LabelRecommendationStatus } from '../types';
import {
  EXTRA_FIELD_SECTIONS,
  emptyStructureReport,
  emptyStructureImaging,
  type StructureReport,
  type StructureImaging,
} from '../shared/structureSchema';

/**
 * 识别服务返回值的**本地 JSON/schema 校验与清洗**（纯函数，可单测）。
 *
 * 边界（严格）：
 * - 模型输出必须/尽量落到固定 schema（report/items/extraFields/notes/unresolvedText）；
 * - 兼容旧字段 originalName（等价于新字段 name）与旧 report 字段 reportType/title；
 * - 模型返回中文 key 或自由结构时只做**最小映射**（如 检验项目列表→items、项目名称→name、
 *   检验结果→result、报告→report），**不引入任何医学猜测**；
 * - 缺字段一律补空字符串/空数组；额外未知 key 保守忽略（不猜测、不丢原文）；
 * - 模型返回的任何 standardLabel / 推荐标签字段一律丢弃，清洗后的候选恒为无标准标签；
 * - 清洗后的候选恒为 confirmed=false（待确认），绝不自动覆盖、删除、确认或进入趋势；
 * - displayName：仅做低风险展示清理（去首尾空白/折叠空白/去控制字符），
 *   name（原文）保持原样，Al/A1/AI 等相似字不做任何静默纠正；
 * - 不信任模型：无法解析时全部置空，绝不猜测补全。
 */

export interface AiStructuredItem {
  /** 报告原文项目名（逐字保留，不做任何修正；Al/A1/AI 原样） */
  name: string;
  /** 展示用清理名（仅展示层，不覆盖 name） */
  displayName: string;
  result: string;
  unit: string;
  referenceRange: string;
  /** 检验方法（缺失/未识别为 ''） */
  method: string;
  sourceText: string;
  confidence: number | null; // 0..1，缺失/非法时置 null
  /** 恒为空：绝不接受模型给出的标准标签 */
  standardLabel: '';
  /** 恒为 false：AI 候选必须由用户逐项勾选后才追加 */
  confirmed: false;
  /** 以下推荐标签字段恒为空：模型返回的任何推荐一律忽略（保留类型以便数据结构兼容） */
  recommendedLabelId: string;
  recommendedLabel: string;
  labelConfidence: number | null;
  labelStatus: LabelRecommendationStatus;
}

export interface AiStructuredExtraField {
  section: string; // header | footer | other
  key: string;
  value: string;
  sourceText: string;
}

export interface AiStructuredNote {
  text: string;
  sourceText: string;
}

export interface AiRejectedItem {
  item: unknown;
  reason: string;
}

/** 固定 report 字段 + 兼容旧式的 reportType/title（默认空，仅用于回填表单）。 */
export interface AiImagingFields extends StructureImaging {}

export interface AiReportFields extends StructureReport {
  /** 兼容旧式输出（新固定 schema 已不再含）；默认 '' */
  reportType: string;
  /** 兼容旧式输出；默认 '' */
  title: string;
}

/** 统一的清洗结果（report/items 两种模式共用）。 */
export interface AiCleanResult {
  report: AiReportFields;
  imaging: AiImagingFields;
  items: AiStructuredItem[];
  extraFields: AiStructuredExtraField[];
  notes: AiStructuredNote[];
  unresolvedText: string;
  rejected: AiRejectedItem[];
}

/* ------------------------------------------------------------------ *
 * mock 适配：让 sample 的 ground-truth 项目穿过真实清洗路径。
 * ------------------------------------------------------------------ */

/**
 * 判断结构化响应是否来自开发 mock（仅本机 dev）。
 * 依据服务端 debug：mock 分支不尝试任何上游（upstreamTried 为空、selectedUpstream 为 null）。
 * 真实模式恒有至少一次上游尝试，因此该判据可靠且无需改动响应结构。
 */
export function isMockStructuredReply(
  server: { upstreamTried: readonly string[]; selectedUpstream: string | null } | null,
): boolean {
  return server !== null && server.upstreamTried.length === 0 && server.selectedUpstream === null;
}

/**
 * 生成「整理」清洗所用的 grounding 文本。
 * - 真实模式：直接用 OCR 原文（sourceText 由模型从原文逐字抽取，必须能命中）；
 * - mock 模式（includeParsedItemNames）：sample 项目的 sourceText=项目名，无法在真实 OCR
 *   原文中逐字命中（OCR 会打散字符），故把识别返回的项目名补入 grounding 文本，
 *   使**真实清洗路径**保留这些 ground-truth 项目（不做任何医学猜测，不改响应结构）。
 * 不把健康数据复制到其它源码：仅使用本次识别响应中已返回的项目名。
 */
export function buildCleanSentText(
  parsed: unknown,
  rawText: string,
  opts: { includeParsedItemNames?: boolean } = {},
): string {
  if (!opts.includeParsedItemNames) return rawText;
  if (!isPlainObject(parsed)) return rawText;
  const items = pickByAlias(parsed, TOP_ALIASES, 'items');
  if (!Array.isArray(items)) return rawText;
  const names: string[] = [];
  for (const it of items) {
    if (!isPlainObject(it)) continue;
    const n = readString(it, ITEM_ALIASES, 'name').trim();
    if (n !== '') names.push(n);
  }
  if (names.length === 0) return rawText;
  return [rawText, ...names].join('\n');
}

export function emptyAiCleanResult(): AiCleanResult {
  return {
    report: { ...emptyStructureReport(), reportType: '', title: '' },
    imaging: emptyStructureImaging(),
    items: [],
    extraFields: [],
    notes: [],
    unresolvedText: '',
    rejected: [],
  };
}

/** 兼容旧签名（内容与 emptyAiCleanResult 完全一致）。 */
export function emptyAiReportCleanResult(): AiCleanResult {
  return emptyAiCleanResult();
}

/** 清洗选项（保留为空：已不再需要目录校验，仅为兼容旧调用签名）。 */
export interface AiCleanOptions {
  catalogIds?: ReadonlySet<string>;
  catalogLabels?: ReadonlyMap<string, string>;
}

/** 容忍 Markdown 代码块 / 前后多余文字，提取第一个 JSON 对象；无法解析返回 null。 */
export function parseAiReplyContent(content: string): unknown {
  if (typeof content !== 'string' || content.trim() === '') return null;
  let s = content.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  if (start < 0) return null; // 没有任何对象：要么为空要么是纯文本/数组，都不接受
  const lastBrace = s.lastIndexOf('}');
  if (lastBrace > start) s = s.slice(start, lastBrace + 1);
  try {
    const parsed: unknown = JSON.parse(s);
    // 只接受顶层为 JSON 对象的返回
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toStringField(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** 数值置信度清洗：合法数字 clamp 到 [0,1]，否则 null。 */
export function cleanConfidence(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Math.max(0, Math.min(1, v));
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.max(0, Math.min(1, n));
  }
  return null;
}

/** 空推荐：识别流程不再使用标签推荐，字段恒为空。 */
function emptyRecommendation(): {
  recommendedLabelId: string;
  recommendedLabel: string;
  labelConfidence: number | null;
  labelStatus: LabelRecommendationStatus;
} {
  return {
    recommendedLabelId: '',
    recommendedLabel: '',
    labelConfidence: null,
    labelStatus: '',
  };
}

/* ------------------------------------------------------------------ *
 * 中文 key → 固定 schema key 的「最小映射」表（不做医学猜测）。
 * ------------------------------------------------------------------ */

type AliasMap = Record<string, readonly string[]>;

/** 顶层 key 别名（值 → 固定顶层 key）。 */
const TOP_ALIASES: AliasMap = {
  report: ['report', '报告', '报告信息', '头部', '头部信息'],
  imaging: ['imaging', '影像', '影像信息', '影像报告'],
  items: [
    'items',
    'itemList',
    '检验项目列表',
    '检查项目列表',
    '项目列表',
    '检验项目',
    '检查项目',
    '项目',
    '检验项目明细',
  ],
  extraFields: ['extraFields', 'extra', '附加字段', '额外字段', '其他字段', '其它字段'],
  notes: ['notes', 'note', '备注', '备注信息'],
  unresolvedText: ['unresolvedText', 'unresolved', '未解析文本', '未解析', '无法解析'],
};

/** report 字段别名（值 → 固定 report key）。 */
const REPORT_ALIASES: AliasMap = {
  reportKind: ['reportKind', '报告大类', '报告类别'],
  hospital: ['hospital', '医院', '医院名称', '机构', '体检机构', '医疗机构'],
  branch: ['branch', '分院', '院区', '院区名称'],
  reportNo: ['reportNo', '报告编号', '报告号', '编号', '检验编号', '报告单号'],
  personName: ['personName', '姓名', '病人姓名', '患者姓名', '被检者姓名', '被检者'],
  gender: ['gender', '性别'],
  age: ['age', '年龄'],
  patientId: ['patientId', '病历号', '病历编号', '患者编号', '病人编号', '登记号', '档案号'],
  clinicalDiagnosis: ['clinicalDiagnosis', '临床诊断', '诊断'],
  testPurpose: ['testPurpose', '检验目的', '检查目的', '送检目的'],
  reportDate: ['reportDate', '报告日期', '报告时间', '出具日期'],
  sampleDate: ['sampleDate', '采样日期', '标本采集日期', '采集日期'],
  receiveDate: ['receiveDate', '接收日期', '送检日期', '收到日期'],
  printDate: ['printDate', '打印日期', '报告打印日期'],
  senderDoctor: ['senderDoctor', '送检医生', '开单医生', '申请医生', '送检医师'],
  inspector: ['inspector', '检验者', '检验人员', '操作者', '检验技师'],
  reviewer: ['reviewer', '审核者', '审核人', '复核者', '签发人', '审核医师'],
  // 兼容旧式 report 字段（新固定 schema 已不再含，仅供回填）
  reportTypes: ['reportTypes', '报告类型列表', '检查类别列表', '体检类型列表'],
  reportType: ['reportType', '报告类型', '检查类别', '体检类型'],
  title: ['title', '标题', '报告标题'],
};

const IMAGING_ALIASES: AliasMap = {
  exams: ['exams', '检查部位列表', '子检查', '检查列表'],
  examPart: ['examPart', '检查部位', '部位'],
  examMethod: ['examMethod', '检查方式', '检查方法', '方式'],
  findings: ['findings', '所见', '影像所见'],
  impression: ['impression', '结论', '影像结论', '诊断意见'],
  measurements: ['measurements', '测量值', '测量', '影像测量'],
};

/** item 字段别名（值 → 固定 item key）。 */
const ITEM_ALIASES: AliasMap = {
  name: ['name', '项目名称', '项目名', '检查项目', '检验项目', '名称', 'originalName'],
  result: ['result', '检验结果', '检查结果', '结果', '结果值', '测定值', '数值', 'value'],
  referenceRange: ['referenceRange', '参考区间', '参考范围', '参考值', '正常范围', '正常参考范围'],
  unit: ['unit', '单位'],
  method: ['method', '检验方法', '检测方法', '测定方法', '方法'],
  sourceText: ['sourceText', '来源文本', '原文', '原文片段', '来源'],
  confidence: ['confidence', '置信度'],
};

/** extraFields 条目字段别名。 */
const EXTRA_FIELD_ALIASES: AliasMap = {
  section: ['section', '区段', '区块', '归属'],
  key: ['key', '字段名', '字段', '名称', 'name'],
  value: ['value', '值', '内容', '字段值'],
  sourceText: ['sourceText', '来源文本', '原文', '来源'],
};

/** notes 条目字段别名。 */
const NOTE_ALIASES: AliasMap = {
  text: ['text', '内容', '文本', '备注'],
  sourceText: ['sourceText', '来源文本', '原文', '来源'],
};

/** 在 obj 中按别名表找到第一个命中的 key 并返回其值；未命中返回 undefined。 */
function pickByAlias(obj: Record<string, unknown>, map: AliasMap, canonical: string): unknown {
  const aliases = map[canonical];
  if (!aliases) return obj[canonical];
  for (const a of aliases) {
    if (Object.prototype.hasOwnProperty.call(obj, a)) return obj[a];
  }
  return undefined;
}

/** 在 obj 中按别名表读取字符串字段（缺省/非字符串 → ''）。 */
function readString(obj: Record<string, unknown>, map: AliasMap, canonical: string): string {
  return toStringField(pickByAlias(obj, map, canonical));
}

function readStringArray(obj: Record<string, unknown>, map: AliasMap, canonical: string): string[] {
  const value = pickByAlias(obj, map, canonical);
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
}

/** 对单个 item 条目清洗（缺字段补空；是否接受由 validateItem 决定）。 */
function cleanRawItem(raw: Record<string, unknown>): AiStructuredItem {
  const name = readString(raw, ITEM_ALIASES, 'name');
  const rec = emptyRecommendation();
  return {
    name, // 原文保留（含首尾/行内空格，不 trim 改写）
    displayName: cleanDisplayName(name).display,
    result: readString(raw, ITEM_ALIASES, 'result'),
    unit: readString(raw, ITEM_ALIASES, 'unit'),
    referenceRange: readString(raw, ITEM_ALIASES, 'referenceRange'),
    method: readString(raw, ITEM_ALIASES, 'method'),
    sourceText: readString(raw, ITEM_ALIASES, 'sourceText'),
    confidence: cleanConfidence(pickByAlias(raw, ITEM_ALIASES, 'confidence')),
    standardLabel: '', // 模型返回的任何标准标签在这里被丢弃
    confirmed: false,
    recommendedLabelId: rec.recommendedLabelId,
    recommendedLabel: rec.recommendedLabel,
    labelConfidence: rec.labelConfidence,
    labelStatus: rec.labelStatus,
  };
}

/** 清洗 report 对象（缺字段补空；兼容旧 reportType/title）。 */
function cleanImaging(raw: unknown): AiImagingFields {
  const base = emptyStructureImaging();
  if (!isPlainObject(raw)) return base;
  const out: AiImagingFields = { ...base };
  for (const key of ['examPart', 'examMethod', 'findings', 'impression', 'measurements'] as const) {
    out[key] = readString(raw, IMAGING_ALIASES, key);
  }
  const rawExams = pickByAlias(raw, IMAGING_ALIASES, 'exams');
  if (Array.isArray(rawExams)) {
    out.exams = rawExams.filter(isPlainObject).map((exam) => ({
      examPart: readString(exam, IMAGING_ALIASES, 'examPart'),
      examMethod: readString(exam, IMAGING_ALIASES, 'examMethod'),
      findings: readString(exam, IMAGING_ALIASES, 'findings'),
      impression: readString(exam, IMAGING_ALIASES, 'impression'),
      measurements: readString(exam, IMAGING_ALIASES, 'measurements'),
    }));
  } else if (out.examPart || out.examMethod || out.findings || out.impression || out.measurements) {
    out.exams = [{ examPart: out.examPart, examMethod: out.examMethod, findings: out.findings, impression: out.impression, measurements: out.measurements }];
  }
  return out;
}

function cleanReport(raw: unknown): AiReportFields {
  const base = emptyAiCleanResult().report;
  if (!isPlainObject(raw)) return base;
  const out: AiReportFields = { ...base };
  out.reportTypes = readStringArray(raw, REPORT_ALIASES, 'reportTypes');
  out.reportType = readString(raw, REPORT_ALIASES, 'reportType');
  if (out.reportTypes.length === 0 && out.reportType.trim() !== '') out.reportTypes = [out.reportType.trim()];
  for (const key of Object.keys(base) as (keyof AiReportFields)[]) {
    if (key === 'reportTypes' || key === 'reportType') continue;
    out[key] = readString(raw, REPORT_ALIASES, key) as never;
  }
  return out;
}

/** 清洗 extraFields 数组（缺字段补空；section 归一为 header/footer/other）。 */
function cleanExtraFields(raw: unknown): AiStructuredExtraField[] {
  if (!Array.isArray(raw)) return [];
  const out: AiStructuredExtraField[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    const section = readString(entry, EXTRA_FIELD_ALIASES, 'section').trim();
    out.push({
      section: EXTRA_FIELD_SECTIONS.includes(section) ? section : 'other',
      key: readString(entry, EXTRA_FIELD_ALIASES, 'key'),
      value: readString(entry, EXTRA_FIELD_ALIASES, 'value'),
      sourceText: readString(entry, EXTRA_FIELD_ALIASES, 'sourceText'),
    });
  }
  return out;
}

/** 清洗 notes 数组（缺字段补空）。 */
function cleanNotes(raw: unknown): AiStructuredNote[] {
  if (!Array.isArray(raw)) return [];
  const out: AiStructuredNote[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    out.push({
      text: readString(entry, NOTE_ALIASES, 'text'),
      sourceText: readString(entry, NOTE_ALIASES, 'sourceText'),
    });
  }
  return out;
}

/** 条目接受条件：核心字段必须存在，sourceText 必须能在本次 OCR 输入中逐字命中。 */
function validateItem(it: AiStructuredItem, sentText: string): string | null {
  if (it.name.trim() === '') return '项目名为空，已忽略';
  if (it.result.trim() === '') return '结果为空，已忽略';
  if (it.sourceText.trim() === '') return 'sourceText 为空，已忽略';
  if (!sentText.includes(it.sourceText)) return 'sourceText 未在输入中逐字命中，已忽略';
  return null;
}

/** 统一清洗入口：report/items 两种模式共用。 */
function cleanPayload(payload: unknown, sentText: string): AiCleanResult {
  const base = emptyAiCleanResult();
  if (!isPlainObject(payload)) return base;

  const report = cleanReport(pickByAlias(payload, TOP_ALIASES, 'report'));
  const imaging = cleanImaging(pickByAlias(payload, TOP_ALIASES, 'imaging'));

  const items: AiStructuredItem[] = [];
  const rejected: AiRejectedItem[] = [];
  const rawItems = pickByAlias(payload, TOP_ALIASES, 'items');
  if (Array.isArray(rawItems)) {
    for (const raw of rawItems) {
      if (!isPlainObject(raw)) {
        rejected.push({ item: raw, reason: '条目不是 JSON 对象，已忽略' });
        continue;
      }
      const it = cleanRawItem(raw);
      const reason = validateItem(it, sentText);
      if (reason !== null) {
        rejected.push({ item: raw, reason });
        continue;
      }
      items.push(it);
    }
  }

  const extraFields = cleanExtraFields(pickByAlias(payload, TOP_ALIASES, 'extraFields'));
  const notes = cleanNotes(pickByAlias(payload, TOP_ALIASES, 'notes'));
  const unresolvedText = readString(payload, TOP_ALIASES, 'unresolvedText').trim();

  // 影像/other 不产生检验项目；旧响应缺失 reportKind 默认 lab。
  const reportKind = report.reportKind === 'imaging' || report.reportKind === 'other' ? report.reportKind : 'lab';
  report.reportKind = reportKind;
  return { report, imaging, items: reportKind === 'lab' ? items : [], extraFields, notes, unresolvedText, rejected };
}

/**
 * 对模型返回做本地清洗（items 模式）。返回统一 AiCleanResult（含 report 字段，通常为空）。
 */
export function cleanAiStructured(
  payload: unknown,
  sentText: string,
  _opts: AiCleanOptions = {},
): AiCleanResult {
  return cleanPayload(payload, sentText);
}

/**
 * 对模型返回做本地清洗（report 模式）。返回统一 AiCleanResult（含 report 字段）。
 * 与 cleanAiStructured 共用同一清洗逻辑，仅为保持旧调用方语义。
 */
export function cleanAiReportStructured(
  payload: unknown,
  sentText: string,
  _opts: AiCleanOptions = {},
): AiCleanResult {
  return cleanPayload(payload, sentText);
}

/** AI 清洗后的候选项 → 报告表单可追加的本地 OCR 候选（待确认、无标准标签）。 */
export function aiStructureItemToCandidate(it: AiStructuredItem): OcrCandidate {
  const resultKind: OcrCandidate['resultKind'] = /^\s*[<>≤≥]?\s*\d/.test(it.result)
    ? 'numeric'
    : 'qualitative';
  return {
    name: it.name,
    displayName: it.displayName,
    resultKind,
    value: it.result,
    unit: it.unit,
    refRange: it.referenceRange,
    method: it.method,
    confirmed: false,
    standardLabel: '',
    sourceLine: it.sourceText,
    qualityHint: '',
    confidence: it.confidence == null ? null : Math.round(it.confidence * 100),
    avgConfidence: null,
    recommendedLabelId: it.recommendedLabelId,
    recommendedLabel: it.recommendedLabel,
    labelStatus: it.labelStatus,
    labelConfidence: it.labelConfidence,
    chosenLabel: '',
  };
}
