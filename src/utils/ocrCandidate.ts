import type { ItemDraft } from './labels';
import { REPORT_TYPES, type LabelRecommendationStatus, type ReportDetail, type ReportKind, type ImagingReport, type ImagingExam } from '../types';

/**
 * OCR / AI 候选项的共享数据类型与转换（纯函数，可单测）。
 *
 * 边界（与全项目一致）：
 * - 每条候选项恒为 confirmed=false（待确认）；standardLabel 恒为空——识别流程不再产生标准标签；
 * - 以下字段仅为数据结构兼容而保留，恒为空：recommendedLabelId/recommendedLabel/
 *   labelStatus/labelConfidence/chosenLabel；不再参与识别与趋势；
 * - 只由用户点击「添加到报告」/「创建报告并添加已选项目」后追加到报告；
 *   绝不自动写入/覆盖/确认既有数据；
 * - 候选来源：识别流程（ReportRecognitionPanel）+ 本地清洗（aiStructure.ts）。
 */

export interface OcrCandidate {
  /** 报告原文项目名（OCR 原样字段，不做任何改写/映射/医学纠正） */
  name: string;
  /** 清洗后的展示名（低风险：去首尾空白/折叠空白/去控制字符；None 时与 name 相同） */
  displayName: string;
  resultKind: 'numeric' | 'qualitative';
  /** 结果值原文（含 < > ≤ ≥ 前缀时保留；绝不换算、不四舍五入） */
  value: string;
  /** 单位原文；空串 = 缺失 */
  unit: string;
  /** 参考区间原文；空串 = 缺失 */
  refRange: string;
  /** 检验方法原文（固定 schema 的 item.method）；空串 = 缺失/未识别 */
  method: string;
  /** 恒为 false：候选项必须人工确认 */
  confirmed: false;
  /**
   * 恒为空（未采用前）：绝不自动推导标准标签（如 TSH）；
   * 仅当该条目的推荐标签被用户显式「采用」后带出已确认标签（= chosenLabel，目录显示名）——
   * 这是「用户已确认」而非「自动推导」，且条目本身仍为待确认。
   */
  standardLabel: string;
  /** 该候选项来源的原文片段（可追溯核对） */
  sourceLine: string;
  /** 质量提示；AI 候选项通常为空 */
  qualityHint: string;
  /** 置信度（0-100）；null = 未知 */
  confidence: number | null;
  /** 平均置信度；null = 未知 */
  avgConfidence: number | null;
  /** 推荐标签 ID（受控目录内）；'' = 无推荐 */
  recommendedLabelId: string;
  /** 推荐标签显示名；'' = 无推荐 */
  recommendedLabel: string;
  /** 推荐状态：catalog / user-alias / ai / ''（全部为未确认候选） */
  labelStatus: LabelRecommendationStatus;
  /** 推荐置信度（0..1）；null = 未知 */
  labelConfidence: number | null;
  /**
   * 用户显式「采用」的标签（= 目录显示名）。仅在用户点击「采用」后非空；
   * 写入条目时作为 standardLabel（用户已确认该标签），但条目本身仍为待确认。
   */
  chosenLabel: string;
}

/** 整张报告识别的报告信息候选（全部待用户确认） */
export interface ReportScanMeta {
  reportKind: ReportKind;
  imaging: ImagingReport;
  exams?: ImagingExam[];
  hospital: string;
  reportDate: string;
  reportType: string;
  /** 新版多选报告类型；缺省时由 reportType 回退。 */
  reportTypes?: string[];
  /** 检验目的（固定报告字段，独立于 details/附件信息；识别后待用户确认） */
  testPurpose: string;
  title: string;
  notes: string;
}

/** 整张报告识别结果（报告信息候选 + 附加元数据 + 项目候选） */
export interface ReportScanResult {
  report: ReportScanMeta;
  details: ReportDetail[];
  items: OcrCandidate[];
}

/**
 * 把识别出的「检验目的」（testPurpose）映射为严格报告类型选项候选。
 *
 * 边界：只做**精确/包含命中**（在 REPORT_TYPES 严格列表内查找），绝不猜测、
 * 绝不自由联想；无命中返回空串（不自动回填，仍由用户选择）。
 * 例如「血常规检查」「肝功能检验」→ 命中严格选项；「健康体检」→ 空。
 */
export function testPurposeToReportType(testPurpose: string): string {
  const p = (testPurpose ?? '').trim();
  if (p === '') return '';
  for (const t of REPORT_TYPES) {
    if (p.includes(t)) return t;
  }
  return '';
}

/**
 * 候选项 → 报告表单中的草稿行：恒为待确认；标准标签仅在用户显式采用推荐后（chosenLabel）
 * 才带出，否则恒为空。可直接追加到批量编辑列表。
 *
 * 备注：固定 schema 的 item.method（检验方法）进入草稿的 testMethod 字段（检查项目字段），
 * 与单位、参考区间并列保存；不再并入 notes/备注。
 */
export function ocrCandidateToDraft(c: OcrCandidate): ItemDraft {
  return {
    name: c.name,
    resultKind: c.resultKind,
    value: c.value,
    unit: c.unit,
    refRange: c.refRange,
    testMethod: c.method || '',
    notes: '',
    confirmed: false,
    standardLabel: c.standardLabel || c.chosenLabel || '', // 采用后 = 已确认标签；未采用 = ''
  };
}
