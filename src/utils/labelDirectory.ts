import {
  CONTROLLED_LAB_CATALOG,
  findCatalogEntryById,
  buildCatalogBrief,
  type ControlledLabCatalogEntry,
} from '../data/controlledLabCatalog';
import { cleanDisplayName } from './displayName';
import type { LabelMapping, LabelRecommendationStatus } from '../types';

/**
 * 受控目录的「确定性匹配优先于模型」逻辑（纯函数，可单测）。
 *
 * 边界（严格，与 requirements 一致）：
 * - 规范化**仅用于匹配定位**（trim / 空白折叠 / 大小写），**绝不修改展示 raw**；
 * - 精确命中目录显示名/别名，或其规范化键命中用户已确认别名（LabelMapping）时，
 *   给推荐；否则可由模型从目录 ID 中给出推荐（全部仍是候选）；
 * - 目录外的模型推荐 ID 一律不通过（置空）；
 * - 所有推荐恒为「未确认」：本模块绝不写入条目、绝不设置 confirmed/standardLabel。
 */

/** 匹配用规范化：小写 + 展示层清理（空白折叠/去控制字符）。 */
export function normalizeNameForMatch(name: string): string {
  return cleanDisplayName(name).display.toLocaleLowerCase('zh-CN');
}

/**
 * 目录精确匹配：以规范化的名称对 displayName 与 aliases 逐一精确比较。
 * 只做“精确命中”，不做模糊/编辑距离/同音等猜测。未命中返回 null。
 *
 * 自动命中边界（与 docs/controlled-lab-catalog.md 一致）：
 * - 仅 evidenceStatus === 'verified_candidate' 的条目参与自动命中；
 * - needsReviewAliases（OCR 易混淆拼写，如 HbAlc）即使规范化一致也**不自动命中**；
 * - pending_review 条目只能由 AI 推荐（用户须显式「采用」），不自动命中；
 * - withheld 条目不参与任何推荐。
 */
export function matchCatalogByName(name: string): ControlledLabCatalogEntry | null {
  const key = normalizeNameForMatch(name);
  if (key === '') return null;
  for (const entry of CONTROLLED_LAB_CATALOG) {
    if (entry.evidenceStatus !== 'verified_candidate') continue;
    if (normalizeNameForMatch(entry.displayName) === key) return entry;
    if ((entry.needsReviewAliases ?? []).some((a) => normalizeNameForMatch(a) === key)) continue;
    for (const alias of entry.aliases) {
      if (normalizeNameForMatch(alias) === key) return entry;
    }
  }
  return null;
}

/** 用户已确认别名映射的最小只读视图（仅名称键 → 目录 ID/标签，不含健康数值）。 */
export interface UserAliasRecord {
  nameKey: string;
  catalogId: string;
  label: string;
}

export function mappingToUserAlias(m: LabelMapping): UserAliasRecord {
  return { nameKey: m.nameKey, catalogId: m.catalogId, label: m.label };
}

/**
 * 确定性推荐（先于模型）：
 * 1) 目录显示名/别名精确命中 → status 'catalog'；
 * 2) 否则规范化键命中用户已确认别名 → status 'user-alias'。
 * 返回 null 表示无确定性命中的推荐（此时才允许使用模型推荐）。
 */
export function recommendFromDirectory(
  name: string,
  userAliases: readonly UserAliasRecord[],
): { entry: ControlledLabCatalogEntry; status: LabelRecommendationStatus } | null {
  const hit = matchCatalogByName(name);
  if (hit) return { entry: hit, status: 'catalog' };
  const key = normalizeNameForMatch(name);
  if (key !== '') {
    for (const m of userAliases) {
      if (m.nameKey === key) {
        const entry = findCatalogEntryById(m.catalogId);
        if (entry) return { entry, status: 'user-alias' };
      }
    }
  }
  return null;
}

/** 模型推荐字段（来自结构化回复） */
export interface ModelLabelRecommendation {
  recommendedLabelId: string;
  recommendedLabel: string;
  labelConfidence: number | null;
  labelStatus: LabelRecommendationStatus;
}

export interface CleanedLabelRecommendation {
  recommendedLabelId: string;
  recommendedLabel: string;
  labelConfidence: number | null;
  labelStatus: LabelRecommendationStatus;
}

/** 无推荐 */
export function emptyLabelRecommendation(): CleanedLabelRecommendation {
  return {
    recommendedLabelId: '',
    recommendedLabel: '',
    labelConfidence: null,
    labelStatus: '',
  };
}

/**
 * 校验/清洗模型给出的推荐（本地、不信任模型）：
 * - 目录外 ID 一律不通过（置空）——模型**禁止**新建目录外标签；
 * - recommendedLabel 以目录显示名为准（不采纳模型自带的名称文本）；
 * - 状态仅允许 catalog / user-alias / ai 三值，非法置空。
 */
export function cleanModelRecommendation(raw: {
  recommendedLabelId?: unknown;
  recommendedLabel?: unknown;
  labelConfidence?: unknown;
  labelStatus?: unknown;
}): CleanedLabelRecommendation {
  const entry = findCatalogEntryById(
    typeof raw.recommendedLabelId === 'string' ? raw.recommendedLabelId.trim() : '',
  );
  // withheld（暂缓）条目即使模型给出 ID 也一律不通过；pending_review 允许作为 AI 候选。
  if (!entry || entry.evidenceStatus === 'withheld') return emptyLabelRecommendation();
  let status: LabelRecommendationStatus = '';
  if (
    raw.labelStatus === 'catalog' ||
    raw.labelStatus === 'user-alias' ||
    raw.labelStatus === 'ai'
  ) {
    status = raw.labelStatus;
  }
  let confidence: number | null = null;
  const cv = raw.labelConfidence;
  if (typeof cv === 'number' && Number.isFinite(cv)) {
    confidence = Math.max(0, Math.min(1, cv));
  } else if (typeof cv === 'string' && cv.trim() !== '') {
    const n = Number(cv);
    if (Number.isFinite(n)) confidence = Math.max(0, Math.min(1, n));
  }
  return {
    recommendedLabelId: entry.id,
    recommendedLabel: entry.displayName,
    labelConfidence: confidence,
    labelStatus: status,
  };
}

/**
 * 条目 → 应用层最终推荐：
 * 先确定性（目录命中/用户别名），无命中时才采用模型推荐（状态强制为 'ai'，若模型状态为
 * catalog/user-alias 则说明本地未命中，不信任模型自报状态）。
 */
export function resolveFinalRecommendation(
  name: string,
  userAliases: readonly UserAliasRecord[],
  modelRec: CleanedLabelRecommendation,
): CleanedLabelRecommendation {
  const deterministic = recommendFromDirectory(name, userAliases);
  if (deterministic) {
    return {
      recommendedLabelId: deterministic.entry.id,
      recommendedLabel: deterministic.entry.displayName,
      labelConfidence: null, // 确定性命中不依赖模型置信度
      labelStatus: deterministic.status,
    };
  }
  if (modelRec.recommendedLabelId !== '') {
    return { ...modelRec, labelStatus: 'ai' };
  }
  return emptyLabelRecommendation();
}

/** 发送到服务端的目录简表（直接复用目录常量构建函数，保持单一事实来源） */
export const getCatalogBriefForProxy = buildCatalogBrief;
