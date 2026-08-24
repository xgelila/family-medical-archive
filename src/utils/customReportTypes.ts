import { db, now, uid } from '../db';
import { REPORT_TYPES, type CustomReportType, type ReportKind } from '../types';

/**
 * 用户自定义报告类型集合（持久化，家庭级/本地）。
 *
 * 边界（严格）：
 * - 内置 REPORT_TYPES 永不修改；自定义类型是独立持久化集合（Dexie v3 表 customReportTypes）；
 * - 仅用户在核对页明确「作为新的报告类型保存」或手动新增后写入；识别/AI 绝不自动新增；
 * - 名称去首尾/内部空白、做合理长度校验，且不与内置或已有自定义类型重复；空值不入库；
 * - aliases 记录「已确认的检验目的别名」，用于识别 testPurpose 的严格匹配（不做猜测/自由联想）。
 */

export type { CustomReportType };

/** 名称规范化：去首尾空白 + 折叠内部空白（如「心 脏 超 声」→「心脏超声」）。 */
export function normalizeReportTypeName(name: string): string {
  return (name ?? '').trim().replace(/\s+/g, '');
}

/** 别名规范化：与名称同一套（去空白 + 折叠）。 */
export function normalizeAlias(alias: string): string {
  return (alias ?? '').trim().replace(/\s+/g, '');
}

/** 自定义类型的默认最大名称长度（字）。 */
export const MAX_CUSTOM_TYPE_NAME = 20;

/** 合并内置 + 自定义类型（去重，内置在前），供下拉/筛选/统计使用。 */
export function mergeReportTypes(custom: readonly Pick<CustomReportType, 'name'>[], reportKind?: ReportKind): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of REPORT_TYPES) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  for (const c of custom) {
    if (reportKind && 'reportKind' in c && c.reportKind && c.reportKind !== reportKind) continue;
    const n = normalizeReportTypeName(c.name);
    if (n !== '' && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

export type NameValidation =
  { ok: true; normalized: string } | { ok: false; error: string; normalized: string };

/**
 * 校验自定义类型名称：空值、长度、与已有类型（内置 + 自定义）重复。
 * 返回规范化后的名称；失败时给出中文错误。
 */
export function validateCustomReportTypeName(
  name: string,
  existingNames: readonly string[],
  maxLen = MAX_CUSTOM_TYPE_NAME,
): NameValidation {
  const normalized = normalizeReportTypeName(name);
  if (normalized === '') return { ok: false, error: '名称不能为空', normalized };
  if (normalized.length > maxLen)
    return { ok: false, error: `名称过长（最多 ${maxLen} 字）`, normalized };
  if (existingNames.includes(normalized))
    return { ok: false, error: '该名称已存在，不能重复添加', normalized };
  return { ok: true, normalized };
}

/**
 * 严格匹配 testPurpose 到报告类型（内置 + 用户自定义名称 + 已确认别名）。
 * 只做精确/包含命中，绝不猜测；无命中返回空串（不自动回填，仍由用户决定）。
 * 例如「血常规检查」→ 内置「血常规」；「心脏彩超」（已确认别名）→ 自定义「心脏超声」。
 */
export function matchTestPurposeToType(
  testPurpose: string,
  custom: readonly Pick<CustomReportType, 'name' | 'aliases' | 'reportKind'>[],
  reportKind?: ReportKind,
): string {
  const p = (testPurpose ?? '').trim();
  if (p === '') return '';
  for (const t of mergeReportTypes(custom, reportKind)) {
    if (p.includes(t)) return t;
  }
  // 已确认别名：别名原文命中即映射到所属自定义类型（仅精确/包含命中）
  for (const c of custom) {
    if (reportKind && c.reportKind && c.reportKind !== reportKind) continue;
    for (const alias of c.aliases ?? []) {
      if (alias !== '' && p.includes(alias)) return c.name;
    }
  }
  return '';
}

/** 读取全部自定义报告类型（按创建时间升序）。 */
export async function loadCustomReportTypes(): Promise<CustomReportType[]> {
  return db.customReportTypes.orderBy('createdAt').toArray();
}

/** 当前可用的完整报告类型列表（内置 + 自定义，去重）。 */
export async function loadAllReportTypes(): Promise<string[]> {
  return mergeReportTypes(await loadCustomReportTypes());
}

/**
 * 新增一个自定义报告类型（幂等去重）。名称经规范化/长度/重复校验；
 * 失败（空/过长/重复）返回 null，不写库。aliases 去空去重后保存（剔除与名称相同的项）。
 * 返回已写入的记录（含新 id）。
 */
export async function addCustomReportType(
  name: string,
  aliases: readonly string[] = [],
  reportKind?: ReportKind,
): Promise<CustomReportType | null> {
  const custom = await loadCustomReportTypes();
  const existing = mergeReportTypes(custom);
  const v = validateCustomReportTypeName(name, existing);
  if (!v.ok) return null;
  const ts = now();
  const rec: CustomReportType = {
    id: uid(),
    name: v.normalized,
    aliases: [
      ...new Set(aliases.map(normalizeAlias).filter((a) => a !== '' && a !== v.normalized)),
    ],
    ...(reportKind ? { reportKind } : {}),
    createdAt: ts,
    updatedAt: ts,
  };
  await db.customReportTypes.put(rec);
  return rec;
}

/** 删除一个自定义报告类型（内置类型不存在删除入口；此处仅按自定义 id 删除）。 */
export async function deleteCustomReportType(id: string): Promise<void> {
  await db.customReportTypes.delete(id);
}
