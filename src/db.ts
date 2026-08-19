import Dexie, { type Table } from 'dexie';
import type { LabelMapping, Member, Report, ReportItem, AttachmentRecord } from './types';

export class ArchiveDB extends Dexie {
  members!: Table<Member, string>;
  reports!: Table<Report, string>;
  items!: Table<ReportItem, string>;
  attachments!: Table<AttachmentRecord, string>;
  labelMappings!: Table<LabelMapping, string>;

  constructor() {
    super('family-medical-archive');
    this.version(1).stores({
      members: 'id, name, createdAt',
      reports: 'id, memberId, hospital, reportDate, createdAt',
      items: 'id, reportId, memberId, name, confirmed, createdAt',
      attachments: 'id, reportId, createdAt',
    });
    // v2：家庭级「名称→目录标签」用户确认映射（仅存名称到 ID，不含健康数值）
    this.version(2).stores({
      labelMappings: 'id, nameKey, catalogId, createdAt',
    });
  }
}

export const db = new ArchiveDB();

/** 生成唯一 id（浏览器可用 randomUUID） */
export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const now = () => Date.now();

/** 按成员级联删除（成员 + 其报告 + 条目 + 附件） */
export async function deleteMemberCascade(memberId: string): Promise<void> {
  await db.transaction('rw', db.members, db.reports, db.items, db.attachments, async () => {
    const reports = await db.reports.where('memberId').equals(memberId).toArray();
    const reportIds = reports.map((r) => r.id);
    await db.members.delete(memberId);
    if (reportIds.length > 0) {
      await db.reports.bulkDelete(reportIds);
      await db.items.where('reportId').anyOf(reportIds).delete();
      await db.attachments.where('reportId').anyOf(reportIds).delete();
    }
  });
}

/** 删除单份报告（连同条目与附件） */
export async function deleteReportCascade(reportId: string): Promise<void> {
  await db.transaction('rw', db.reports, db.items, db.attachments, async () => {
    await db.reports.delete(reportId);
    await db.items.where('reportId').equals(reportId).delete();
    await db.attachments.where('reportId').equals(reportId).delete();
  });
}
