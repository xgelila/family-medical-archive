import { db, uid } from '../db';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  type AttachmentRecord,
  type ExportPayload,
  type LabelMapping,
  type Member,
  type Report,
  type ReportItem,
  type SerializedAttachment,
} from '../types';

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error ?? new Error('读取附件失败'));
    fr.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  if (!res.ok) throw new Error('附件数据解析失败');
  return res.blob();
}

export function downloadJson(payload: ExportPayload, filename: string): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** 导出全部数据（含附件 base64 与家庭级标签映射） */
export async function buildExport(): Promise<ExportPayload> {
  const [members, reports, items, attachments, labelMappings] = await Promise.all([
    db.members.toArray(),
    db.reports.toArray(),
    db.items.toArray(),
    db.attachments.toArray(),
    db.labelMappings.toArray(),
  ]);
  const serialized: SerializedAttachment[] = await Promise.all(
    attachments.map(async (a) => ({
      id: a.id,
      reportId: a.reportId,
      name: a.name,
      mimeType: a.mimeType,
      size: a.size,
      kind: a.kind,
      createdAt: a.createdAt,
      dataUrl: await blobToDataUrl(a.blob),
    })),
  );
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'family-medical-archive',
    members,
    reports,
    items,
    attachments: serialized,
    labelMappings,
  };
}

export type ImportResult =
  | { ok: true; summary: { members: number; reports: number; items: number; attachments: number } }
  | { ok: false; error: string };

export function validatePayload(
  obj: unknown,
): { ok: true; payload: ExportPayload } | { ok: false; error: string } {
  if (!obj || typeof obj !== 'object') return { ok: false, error: '不是有效的 JSON 数据。' };
  const p = obj as Partial<ExportPayload>;
  if (p.format !== EXPORT_FORMAT)
    return { ok: false, error: '文件格式不是「family-medical-archive」。' };
  if (p.version !== EXPORT_VERSION)
    return {
      ok: false,
      error: `不支持的数据版本：${String(p.version)}（当前支持 v${EXPORT_VERSION}）。`,
    };
  if (
    !Array.isArray(p.members) ||
    !Array.isArray(p.reports) ||
    !Array.isArray(p.items) ||
    !Array.isArray(p.attachments)
  ) {
    return { ok: false, error: '数据结构不完整（缺少 members/reports/items/attachments 数组）。' };
  }
  return { ok: true, payload: p as ExportPayload };
}

function ensureId(id: unknown, _prefix: string): string {
  return typeof id === 'string' && id !== '' ? id : uid();
}

export interface CleanImportData {
  members: Member[];
  reports: Report[];
  items: ReportItem[];
  attachments: AttachmentRecord[];
  labelMappings: LabelMapping[];
}

/**
 * 清洗导入数据（纯逻辑，不写库，可单测）：
 * - 附件 reportId 必须指向“存在且已导入”的报告，否则跳过，绝不生成孤立附件；
 * - 报告 attachmentIds 只保留“确实已导入且属于该报告”的附件引用，删除孤立/无效引用。
 */
export async function buildCleanImport(payload: ExportPayload): Promise<CleanImportData> {
  const { members, reports, items, attachments } = payload;

  const cleanMembers = members.map((m, i) => {
    const id = ensureId(m.id, 'm');
    return {
      id,
      name: typeof m.name === 'string' && m.name.trim() ? m.name.trim() : `成员${i + 1}`,
      gender: (m.gender as Member['gender']) ?? '未填写',
      birthDate: typeof m.birthDate === 'string' ? m.birthDate : '',
      relation: typeof m.relation === 'string' ? m.relation : '',
      createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
      updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : Date.now(),
    };
  });

  const reportIds = new Set<string>();
  const inputReportsByInputId = new Map<string, Report>();
  const cleanReports: Report[] = [];
  for (const r of reports) {
    const id = ensureId(r.id, 'r');
    if (typeof r.id === 'string' && r.id !== '') inputReportsByInputId.set(r.id, r);
    reportIds.add(id);
    cleanReports.push({
      id,
      memberId: ensureId(r.memberId, 'm'),
      hospital: typeof r.hospital === 'string' ? r.hospital : '未填写',
      reportDate: typeof r.reportDate === 'string' ? r.reportDate : '',
      reportType: typeof r.reportType === 'string' ? r.reportType : '',
      title: typeof r.title === 'string' ? r.title : '',
      notes: typeof r.notes === 'string' ? r.notes : '',
      attachmentIds: [], // 附件清洗完成后按引用重建
      createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
      updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
    });
  }

  const cleanItems: ReportItem[] = [];
  items.forEach((it, i) => {
    const reportId = ensureId(it.reportId, 'r');
    if (!reportIds.has(reportId)) return; // 指向不存在报告 → 丢弃，保证一致性
    cleanItems.push({
      id: ensureId(it.id, 'i'),
      reportId,
      memberId: ensureId(it.memberId, 'm'),
      index: typeof it.index === 'number' ? it.index : i,
      name: typeof it.name === 'string' && it.name.trim() ? it.name.trim() : '未命名项目',
      resultKind: it.resultKind === 'qualitative' ? 'qualitative' : 'numeric',
      value: typeof it.value === 'string' ? it.value : '',
      unit: typeof it.unit === 'string' ? it.unit : '',
      refRange: typeof it.refRange === 'string' ? it.refRange : '',
      notes: typeof it.notes === 'string' ? it.notes : '',
      confirmed: it.confirmed !== false,
      standardLabel: typeof it.standardLabel === 'string' ? it.standardLabel.trim() : '', // 兼容旧数据：缺省视为未设置
      createdAt: typeof it.createdAt === 'number' ? it.createdAt : Date.now(),
      updatedAt: typeof it.updatedAt === 'number' ? it.updatedAt : Date.now(),
    });
  });

  // 附件：reportId 不在已导入报告集合中 → 跳过（避免生成孤立附件）；数据损坏 → 跳过。
  const attachmentRefs = new Map<string, { id: string; reportId: string }>(); // 原 id → 最终导入信息
  const cleanAttachments: AttachmentRecord[] = [];
  for (const a of attachments) {
    const reportId = ensureId(a.reportId, 'r');
    if (!reportIds.has(reportId)) continue;
    try {
      const blob = await dataUrlToBlob(a.dataUrl);
      const id = ensureId(a.id, 'a');
      attachmentRefs.set(typeof a.id === 'string' && a.id !== '' ? a.id : id, { id, reportId });
      cleanAttachments.push({
        id,
        reportId,
        name: typeof a.name === 'string' ? a.name : '附件',
        mimeType:
          typeof a.mimeType === 'string' ? a.mimeType : blob.type || 'application/octet-stream',
        size: typeof a.size === 'number' ? a.size : blob.size,
        kind: a.kind === 'image' || a.kind === 'pdf' ? a.kind : 'other',
        blob,
        createdAt: typeof a.createdAt === 'number' ? a.createdAt : Date.now(),
      });
    } catch {
      // 附件损坏则跳过
    }
  }

  // 标签映射（家庭级/本地）：字段清洗；catalogId/label 必须为非空字符串，nameKey 缺失时按 rawName 重建。
  const cleanLabelMappings: LabelMapping[] = [];
  for (const m of payload.labelMappings ?? []) {
    if (!m || typeof m !== 'object') continue;
    const rawName = typeof m.rawName === 'string' ? m.rawName.trim().slice(0, 200) : '';
    const catalogId = typeof m.catalogId === 'string' ? m.catalogId.trim().slice(0, 200) : '';
    const label = typeof m.label === 'string' ? m.label.trim().slice(0, 200) : '';
    if (rawName === '' || catalogId === '' || label === '') continue;
    cleanLabelMappings.push({
      id: ensureId(m.id, 'lm'),
      nameKey:
        typeof m.nameKey === 'string' && m.nameKey.trim() !== ''
          ? m.nameKey.trim().slice(0, 200)
          : rawName,
      rawName,
      catalogId,
      label,
      source: ['directory-match', 'user-alias', 'ai-recommendation'].includes(m.source as string)
        ? (m.source as LabelMapping['source'])
        : 'ai-recommendation',
      createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
      updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : Date.now(),
    });
  }

  // 报告 attachmentIds：只保留“已导入且确实属于该报告”的附件引用 → 删除孤立/无效引用。
  for (const r of cleanReports) {
    const input = inputReportsByInputId.get(r.id);
    if (!input || !Array.isArray(input.attachmentIds)) {
      r.attachmentIds = [];
      continue;
    }
    const kept: string[] = [];
    for (const raw of input.attachmentIds) {
      if (typeof raw !== 'string') continue;
      const ref = attachmentRefs.get(raw);
      if (ref && ref.reportId === r.id) kept.push(ref.id);
    }
    r.attachmentIds = [...new Set(kept)];
  }

  return {
    members: cleanMembers,
    reports: cleanReports,
    items: cleanItems,
    attachments: cleanAttachments,
    labelMappings: cleanLabelMappings,
  };
}

/** 导入：整体覆盖现有本地数据（提示后执行）。附件 base64 还原为 Blob。 */
export async function importPayload(obj: unknown): Promise<ImportResult> {
  const v = validatePayload(obj);
  if (!v.ok) return v;
  try {
    const clean = await buildCleanImport(v.payload);
    await db.transaction(
      'rw',
      db.members,
      db.reports,
      db.items,
      db.attachments,
      db.labelMappings,
      async () => {
        await db.members.clear();
        await db.reports.clear();
        await db.items.clear();
        await db.attachments.clear();
        await db.labelMappings.clear();

        if (clean.members.length > 0) await db.members.bulkAdd(clean.members);
        if (clean.reports.length > 0) await db.reports.bulkAdd(clean.reports);
        if (clean.items.length > 0) await db.items.bulkAdd(clean.items);
        if (clean.attachments.length > 0) await db.attachments.bulkAdd(clean.attachments);
        if (clean.labelMappings.length > 0) await db.labelMappings.bulkAdd(clean.labelMappings);
      },
    );

    return {
      ok: true,
      summary: {
        members: clean.members.length,
        reports: clean.reports.length,
        items: clean.items.length,
        attachments: clean.attachments.length,
      },
    };
  } catch (e) {
    return { ok: false, error: `导入失败：${e instanceof Error ? e.message : String(e)}` };
  }
}
