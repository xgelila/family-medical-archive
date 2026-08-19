import {
  GLUCOSE_REPORT_TYPE,
  GLUCOSE_STANDARD_LABELS,
  THYROID_REPORT_TYPE,
  THYROID_STANDARD_LABELS,
} from '../types';

/**
 * 标准标签与甲功快速添加的纯逻辑（可单测）：
 * - 标准标签只由用户显式选择/填写，不存在按项目名自动映射的入口；
 * - 甲功快速添加仅生成「带显式标准标签、数值为空」的草稿项目，不预填数值、不要求补齐。
 */

/** 尚未保存的检查项目草稿（报告表单行内编辑用，纯数据，可单测） */
export interface ItemDraft {
  id?: string;
  name: string; // 报告原文项目名
  resultKind: 'numeric' | 'qualitative';
  value: string;
  unit: string;
  refRange: string;
  notes: string;
  confirmed: boolean;
  standardLabel: string; // 空串 = 未设置
}

export function emptyDraft(): ItemDraft {
  return {
    name: '',
    resultKind: 'numeric',
    value: '',
    unit: '',
    refRange: '',
    notes: '',
    confirmed: false,
    standardLabel: '',
  };
}

/** 甲功快速添加：为某个候选标准标签生成一条空项目（明确设置标签，不得默认数值） */
export function quickAddThyroidDraft(label: string): ItemDraft {
  return { ...emptyDraft(), name: label, standardLabel: label };
}

/**
 * 血糖快速添加：仅生成**空白待确认、不设置标准标签**的草稿项目（血糖不做自动标准化）。
 * 不预填数值/单位/参考区间，不要求补齐，不根据 OCR 文本自动触发。
 */
export function quickAddGlucoseDraft(name: string): ItemDraft {
  return { ...emptyDraft(), name, standardLabel: '' };
}

/**
 * 保存前的空项目过滤：trim 仅用于「判断项目名是否为空」，
 * 绝不 trim 改写 name/value/unit/refRange/notes 等原始字段（落库保持原值，
 * 含首尾/行内空格）。
 */
export function nonEmptyItemDrafts(items: readonly ItemDraft[]): ItemDraft[] {
  return items.filter((it) => it.name.trim() !== '');
}

/** 报告类型是否展示「甲功常用项目快速添加」区：必须精确等于「甲状腺功能」 */
export function isThyroidReportType(reportType: string): boolean {
  return reportType === THYROID_REPORT_TYPE;
}

/**
 * 报告类型是否展示「血糖常用项目快速添加」区：必须精确等于严格选项「血糖/糖化血红蛋白」。
 * 不包含模糊匹配（如用户手写的“血糖报告”等自由文本一律不展示）。
 */
export function isGlucoseReportType(reportType: string): boolean {
  return reportType === GLUCOSE_REPORT_TYPE;
}

/** 标准标签候选项：甲功类型下仅提供 5 个明确候选；其他类型无预置候选（用户自定义仍须显式填写） */
export function standardLabelCandidatesForType(reportType: string): readonly string[] {
  return isThyroidReportType(reportType)
    ? THYROID_STANDARD_LABELS
    : isGlucoseReportType(reportType)
      ? GLUCOSE_STANDARD_LABELS
      : [];
}
