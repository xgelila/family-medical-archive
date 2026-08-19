import { db, now, uid } from '../db';
import type { LabelMapping, LabelMappingSource } from '../types';
import { normalizeNameForMatch } from './labelDirectory';

/**
 * 家庭级/本地「名称 → 目录标签」用户确认映射（LabelMapping）。
 *
 * 边界（严格）：
 * - 仅保存「项目名（规范化键）→ 目录 ID/标准标签名」，**绝不含任何历史健康数值**；
 * - 只允许在用户显式「采用」某个推荐标签（或明确选择目录标签）时写入；
 * - 映射仅用于“下次识别的推荐”，推荐仍须逐项确认；
 * - 映射本身不算确认条目：条目是否确认仍由用户逐项点击决定。
 */

export type { LabelMapping, LabelMappingSource };

/** 匹配键：用目录匹配的同一套规范化（仅用于定位，不是展示值）。 */
export function mappingNameKey(name: string): string {
  return normalizeNameForMatch(name);
}

/** 写库前的输入（不含 id/时间戳） */
export interface NewLabelMapping {
  rawName: string;
  catalogId: string;
  label: string;
  source: LabelMappingSource;
}

/** 读取全部标签映射（按确认时间升序）。 */
export async function loadLabelMappings(): Promise<LabelMapping[]> {
  return db.labelMappings.orderBy('createdAt').toArray();
}

/**
 * 保存（幂等）一条映射：以 nameKey 定位，同键更新而不是重复插入。
 * 调用方必须保证是用户显式确认动作。
 */
export async function saveLabelMapping(input: NewLabelMapping): Promise<LabelMapping> {
  const nameKey = mappingNameKey(input.rawName);
  const ts = now();
  const existing = await db.labelMappings.where('nameKey').equals(nameKey).first();
  const rec: LabelMapping = existing
    ? {
        ...existing,
        rawName: input.rawName.trim(),
        catalogId: input.catalogId,
        label: input.label.trim(),
        source: input.source,
        updatedAt: ts,
      }
    : {
        id: uid(),
        nameKey,
        rawName: input.rawName.trim(),
        catalogId: input.catalogId,
        label: input.label.trim(),
        source: input.source,
        createdAt: ts,
        updatedAt: ts,
      };
  await db.labelMappings.put(rec);
  return rec;
}

/** 删除一条映射（用户主动移除）。 */
export async function deleteLabelMapping(id: string): Promise<void> {
  await db.labelMappings.delete(id);
}
