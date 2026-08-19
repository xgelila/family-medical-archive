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
  notes: string; // 备注
  confirmed: boolean; // true=已确认，false=待确认
  /**
   * 可选标准标签（如 TSH）。仅由用户显式选择/填写，绝不对项目名做自动映射、模糊匹配或猜测。
   * 空串/缺省 = 未设置，该条目不参与跨报告趋势。
   */
  standardLabel?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Report {
  id: string;
  memberId: string;
  hospital: string; // 医院/体检机构
  reportDate: string; // YYYY-MM-DD
  reportType: string; // 体检类型
  title: string;
  notes: string;
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
  '血糖/糖化血红蛋白',
  '甲状腺功能',
  '肿瘤标志物',
  '影像检查',
  '其他',
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

/** 甲功报告类型的精确标识（多选框提示区只在该类型下出现） */
export const THYROID_REPORT_TYPE = '甲状腺功能' as const;

/**
 * 血糖类报告类型的精确标识（血糖常用项目快速添加区只在该严格选项下出现）。
 * 与 REPORT_TYPES 中既有的严格选项「血糖/糖化血红蛋白」一致（不含其他自由文本）。
 */
export const GLUCOSE_REPORT_TYPE = '血糖/糖化血红蛋白' as const;

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
