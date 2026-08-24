// 数据模型：家庭体检档案（本地优先）
export type Gender = '男' | '女' | '未填写';

export interface Member {
  id: string;
  name: string;
  gender: Gender;
  birthDate: string; // YYYY-MM-DD，可空
  relation: string; // 本人/配偶/父亲/母亲/儿子/女儿/其他（自由填写）
  createdAt: number;
  updatedAt: number;
}

export type AttachmentKind = 'image' | 'pdf' | 'other';

export interface AttachmentRecord {
  id: string;
  reportId: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  blob: Blob;
  createdAt: number;
}

export type ItemResultKind = 'numeric' | 'qualitative';

export type ReportKind = 'lab' | 'imaging' | 'other';

/** 报告大类对应的受控报告类型选项。other 仅用于旧数据兼容。 */
export const LAB_REPORT_TYPES = [
  '综合体检', '血常规', '尿常规', '肝功能', '肾功能', '血脂', '血糖',
  '糖化血红蛋白', '甲状腺功能', '肿瘤标志物',
] as const;
/** 检查大类下的少量受控类型；「其他检查」保留为自定义/旧数据兼容入口。 */
export const IMAGING_REPORT_TYPES = ['腹部超声', '甲状腺超声', '乳腺超声', '其他检查'] as const;

/** 影像报告的结构化字段（不拆入检验项目）。 */
export interface ImagingExam {
  examPart: string;
  examMethod?: string;
  findings: string;
  impression: string;
  measurements: string;
}

export interface ImagingReport {
  /** Legacy single-exam fields retained for backwards compatibility. */
  examPart: string;
  examMethod: string;
  findings: string;
  impression: string;
  measurements: string;
  exams?: ImagingExam[];
}

/** Normalize legacy imaging data without inventing an empty exam. */
export function normalizeImagingReport(value?: Partial<ImagingReport> | null): ImagingReport | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const legacy = {
    examPart: typeof value.examPart === 'string' ? value.examPart : '',
    examMethod: typeof value.examMethod === 'string' ? value.examMethod : '',
    findings: typeof value.findings === 'string' ? value.findings : '',
    impression: typeof value.impression === 'string' ? value.impression : '',
    measurements: typeof value.measurements === 'string' ? value.measurements : '',
  };
  const exams = Array.isArray(value.exams) ? value.exams.filter((e): e is ImagingExam => !!e && typeof e === 'object').map((e) => ({
    examPart: typeof e.examPart === 'string' ? e.examPart : '',
    ...(typeof e.examMethod === 'string' ? { examMethod: e.examMethod } : {}),
    findings: typeof e.findings === 'string' ? e.findings : '',
    impression: typeof e.impression === 'string' ? e.impression : '',
    measurements: typeof e.measurements === 'string' ? e.measurements : '',
  })) : undefined;
  return { ...legacy, ...(exams ? { exams } : {}) };
}

// 体检条目（一张报告下的一个检查项目）
export interface ReportItem {
  id: string;
  reportId: string;
  memberId: string;
  index: number; // 报告内展示顺序
  name: string; // 报告原文项目名，如“血红蛋白”“促甲状腺激素”（始终保留原文，不因标准标签而改写）
  resultKind: ItemResultKind;
  value: string; // 原始录入文本（数值型填数字原文，定性填 阴性/阳性 等）
  unit: string; // 单位，如 g/L；空串表示缺失
  refRange: string; // 参考区间原文，如 130-175
  /** 检验/试验方法（如“化学发光法”“胶体金法”），检查项目字段；空串 = 缺失/未识别。 */
  testMethod?: string;
  notes: string; // 备注
  confirmed: boolean; // true=已确认，false=待确认
  /**
   * 可选标准标签（如 TSH）。仅由用户显式选择/填写，绝不对项目名做自动映射、模糊匹配或猜测。
   * 空串/缺省 = 未设置；标准标签仅作兼容保留，不影响趋势。待确认项目不参与趋势。
   */
  standardLabel?: string;
  createdAt: number;
  updatedAt: number;
}

/** 报告附加元数据（识别出的非核心字段，如送检医生/检验者/审核者/采样日期等，KV 形式保留展示） */
export interface ReportDetail {
  label: string;
  value: string;
}

/**
 * 用户自定义报告类型/检查类别（持久化，家庭级/本地）。
 *
 * - 仅在用户在核对页明确「作为新的报告类型保存」（或手动新增）后写入，
 *   识别/AI 绝不自动新增到库；
 * - 名称已去首尾/内部空白并做合理长度校验，且不与内置 REPORT_TYPES 或已有自定义类型重复；
 * - aliases 为「已确认的检验目的别名」：当用户把某段检验目的（testPurpose）确认为该自定义类型时
 *   记录其原文，供下次识别 testPurpose 时严格匹配（仅名称/别名的精确/包含命中，不做猜测）。
 */
export interface CustomReportType {
  id: string;
  name: string;
  /** 已确认的检验目的别名（原文，trim 后折叠空白；用于识别 testPurpose 匹配） */
  aliases: string[];
  /** 自定义类型所属大类，防止检验/检查选项串类。旧数据缺省按 lab 兼容。 */
  reportKind?: ReportKind;
  createdAt: number;
  updatedAt: number;
}

/** 归一化报告类型：优先使用新多值字段，旧数据回退为单元素数组。 */
export function normalizeReportTypes(report: Pick<Report, 'reportTypes' | 'reportType'>): string[] {
  const types = Array.isArray(report.reportTypes)
    ? report.reportTypes.filter((type): type is string => typeof type === 'string').map((type) => type.trim()).filter(Boolean)
    : [];
  if (types.length > 0) return [...new Set(types)];
  const legacy = typeof report.reportType === 'string' ? report.reportType.trim() : '';
  return legacy ? [legacy] : [];
}

export interface Report {
  id: string;
  memberId: string;
  hospital: string; // 医院/体检机构
  reportDate: string; // YYYY-MM-DD
  /** 新版可同时保存多个检查/报告类型。 */
  reportTypes?: string[];
  /** 兼容旧数据；保存时通常为 reportTypes 第一项。 */
  reportType: string; // 体检类型
  /** 报告大类；旧数据缺失时按 lab 处理。 */
  reportKind?: ReportKind;
  /** 检验目的（固定报告字段，独立于 details 附加信息；不混入附件信息或通用附加信息） */
  testPurpose?: string;
  /** 影像报告字段；lab/other 可缺省。 */
  imaging?: ImagingReport;
  title: string;
  notes: string;
  /** 附加元数据（送检医生/检验者/审核者/采样/接收/打印日期/临床诊断等），可选，向后兼容 */
  details?: ReportDetail[];
  attachmentIds: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * 家庭级/本地「名称 → 标准标签目录」的用户确认映射（LabelMapping）。
 *
 * - 仅在用户显式「采用」某个推荐标签（或明确选择目录标签）时写入，供下次识别复用；
 * - 只保存「项目名（规范化键）→ 目录 ID/标签」，**绝不含任何历史健康数值**；
 * - 映射仅用于推荐，推荐仍须用户逐项确认；未确认/未采用的推荐绝不写入条目。
 */
export interface LabelMapping {
  id: string;
  /** 规范化匹配键（仅用于匹配定位，不是展示值） */
  nameKey: string;
  /** 用户看到的原始项目名（trim 后保留原文，不做医学纠正） */
  rawName: string;
  /** 受控目录 canonical id */
  catalogId: string;
  /** 目录显示名快照（用户采用后写入条目的 standardLabel 值） */
  label: string;
  /** 来源：directory-match / user-alias / ai-recommendation */
  source: LabelMappingSource;
  createdAt: number;
  updatedAt: number;
}

export type LabelMappingSource = 'directory-match' | 'user-alias' | 'ai-recommendation';

/** 推荐标签的状态（全部恒为「未确认的候选」，绝不等于用户确认） */
export type LabelRecommendationStatus = '' | 'catalog' | 'user-alias' | 'ai';

export interface SerializedAttachment {
  id: string;
  reportId: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  dataUrl: string; // base64 data URL，便于 JSON 导入导出
  createdAt: number;
}

export const EXPORT_FORMAT = 'family-medical-archive';
export const EXPORT_VERSION = 1;

export interface ExportIntegrity {
  algorithm: 'SHA-256';
  payloadHash: string;
}

export interface ExportPayload {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string; // ISO
  app: string;
  members: Member[];
  reports: Report[];
  items: ReportItem[];
  attachments: SerializedAttachment[];
  /** 可选：家庭级标签映射（旧版导出文件缺省） */
  labelMappings?: LabelMapping[];
  /** 可选：用户自定义报告类型（旧版导出文件缺省；导入时缺省为空数组，不报错） */
  customReportTypes?: CustomReportType[];
  /** v1-compatible optional integrity metadata; backups remain unencrypted plaintext. */
  integrity?: ExportIntegrity;
}

export const EMPTY_MEMBER: Member = {
  id: '',
  name: '',
  gender: '未填写',
  birthDate: '',
  relation: '',
  createdAt: 0,
  updatedAt: 0,
};

/**
 * 报告类型/检查类别——严格选项列表：新增/编辑报告时仅可从以下各项中选择（含“不选择”）。
 * 不做模糊匹配、不做额外自动分类。
 */
export const REPORT_TYPES = [
  '综合体检',
  '血常规',
  '尿常规',
  '肝功能',
  '肾功能',
  '血脂',
  '血糖',
  '糖化血红蛋白',
  '甲状腺功能',
  '肿瘤标志物',
  '影像检查',
  '其他',
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

/** 甲功报告类型的精确标识（多选框提示区只在该类型下出现） */
export const THYROID_REPORT_TYPE = '甲状腺功能' as const;

/**
 * 血糖报告类型的精确标识（血糖常用项目快速添加区在该严格选项下出现）。
 * 与 REPORT_TYPES 中既有的严格选项「血糖」一致（不含其他自由文本）。
 */
export const GLUCOSE_REPORT_TYPE = '血糖' as const;

/** 糖化血红蛋白报告类型的精确标识（同属血糖快速添加区）。 */
export const HBA1C_REPORT_TYPE = '糖化血红蛋白' as const;

/**
 * 旧版合并报告类型「血糖/糖化血红蛋白」——拆分前的历史保存值。
 * 仅用于「保留原值显示」与「编辑旧报告时保留快速添加」的兼容用途；
 * 绝不作为可选报告类型加入 REPORT_TYPES，也绝不把历史记录强行判定为「血糖」或「糖化血红蛋白」。
 */
export const LEGACY_GLUCOSE_COMBINED_TYPE = '血糖/糖化血红蛋白' as const;

/**
 * 甲功常用项目标准标签候选——首版仅提供这 5 个明确、精确的候选项。
 * 映射必须由用户显式选择/确认，禁止按项目名自动映射、模糊匹配、猜测或自动合并。
 */
export const THYROID_STANDARD_LABELS = ['TSH', 'FT3', 'FT4', 'TPOAb', 'TgAb'] as const;

/**
 * 血糖常用项目快速添加候选——仅这 5 个明确名称。
 * 按钮只添加**空白待确认条目且不设置标准标签**（血糖不做自动标准化）；
 * 绝不根据 OCR 文本自动触发或自动映射。
 */
export const GLUCOSE_STANDARD_LABELS = [
  '空腹血糖',
  '餐后2小时血糖',
  '随机血糖',
  '糖化血红蛋白',
  '估算平均血糖',
] as const;
