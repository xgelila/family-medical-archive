import { db, uid } from '../db';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  REPORT_TYPES,
  type AttachmentRecord,
  type CustomReportType,
  type ExportPayload,
  type LabelMapping,
  type Member,
  type Report,
  type ReportItem,
  type SerializedAttachment,
} from '../types';
import { normalizeReportTypeName } from './customReportTypes';

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error ?? new Error('读取附件失败'));
    fr.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  // Never fetch arbitrary URLs during import: backups must contain self-contained data URLs.
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) throw new Error('附件必须是 data URL');
  const match = /^data:([!#$%&'*+\-.^_`|~0-9A-Za-z]+\/[!#$%&'*+\-.^_`|~0-9A-Za-z]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match || match[2] !== ';base64' || match[3] === '') throw new Error('附件 data URL 格式无效');
  const mime = match[1];
  const encoded = match[3].replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw new Error('附件 base64 无效');
  const raw = atob(encoded);
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

async function payloadHash(payload: Omit<ExportPayload, 'integrity'>): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
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

/** 导出全部数据（含附件 base64 与家庭级标签映射、用户自定义报告类型） */
export async function buildExport(): Promise<ExportPayload> {
  const [members, reports, items, attachments, labelMappings, customReportTypes] =
    await Promise.all([
      db.members.toArray(),
      db.reports.toArray(),
      db.items.toArray(),
      db.attachments.toArray(),
      db.labelMappings.toArray(),
      db.customReportTypes.toArray(),
    ]);
  if (attachments.length > 500) throw new Error('导出失败：附件数量超过 500 个。');
  const serialized: SerializedAttachment[] = [];
  let totalBytes = 0;
  for (const a of attachments) {
    if (a.size > 25 * 1024 * 1024 || a.blob.size > 25 * 1024 * 1024)
      throw new Error(`导出失败：附件「${a.name || a.id}」超过单个 25 MiB 限制。`);
    if (totalBytes + a.blob.size > 200 * 1024 * 1024)
      throw new Error('导出失败：附件总大小超过 200 MiB 限制。');
    totalBytes += a.blob.size;
    serialized.push({
      id: a.id, reportId: a.reportId, name: a.name, mimeType: a.mimeType,
      size: a.size, kind: a.kind, createdAt: a.createdAt,
      dataUrl: await blobToDataUrl(a.blob),
    });
  }
  const result = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'family-medical-archive',
    members,
    reports,
    items,
    attachments: serialized,
    labelMappings,
    customReportTypes,
  } satisfies Omit<ExportPayload, 'integrity'>;
  return { ...result, integrity: { algorithm: 'SHA-256' as const, payloadHash: await payloadHash(result) } };

}

export type ImportResult =
  | { ok: true; summary: { members: number; reports: number; items: number; attachments: number; skippedAttachments: number }; warnings: string[] }
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
    !Array.isArray(p.members) || !Array.isArray(p.reports) || !Array.isArray(p.items) || !Array.isArray(p.attachments)
  ) return { ok: false, error: '数据结构不完整（缺少 members/reports/items/attachments 数组）。' };
  const ids = (arr: unknown[], field: string): boolean => {
    const seen = new Set<string>();
    for (const value of arr) {
      if (!value || typeof value !== 'object' || typeof (value as Record<string, unknown>)[field] !== 'string') return false;
      const id = (value as Record<string, unknown>)[field] as string;
      if (!id || seen.has(id)) return false;
      seen.add(id);
    }
    return true;
  };
  if (!ids(p.members, 'id') || !ids(p.reports, 'id') || !ids(p.items, 'id') || !ids(p.attachments, 'id'))
    return { ok: false, error: '数据包含缺失或重复 ID。' };
  const memberIds = new Set(p.members.map((m) => m.id));
  const reportIds = new Set(p.reports.map((r) => r.id));
  if (p.reports.some((r) => typeof r.memberId !== 'string' || !memberIds.has(r.memberId)))
    return { ok: false, error: '报告关联的成员不存在。' };
  if (p.items.some((i) => typeof i.reportId !== 'string' || !reportIds.has(i.reportId)))
    return { ok: false, error: '检查项目关联的报告不存在。' };
  if (p.attachments.length > 500) return { ok: false, error: '附件数量超过限制。' };
  if (p.integrity && (p.integrity.algorithm !== 'SHA-256' || typeof p.integrity.payloadHash !== 'string'))
    return { ok: false, error: '备份完整性信息无效。' };
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
  customReportTypes: CustomReportType[];
  skippedAttachments: number;
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
      reportKind: r.reportKind === 'imaging' || r.reportKind === 'other' ? r.reportKind : 'lab',
      imaging: r.imaging && typeof r.imaging === 'object' ? {
        examPart: typeof r.imaging.examPart === 'string' ? r.imaging.examPart : '',
        examMethod: typeof r.imaging.examMethod === 'string' ? r.imaging.examMethod : '',
        findings: typeof r.imaging.findings === 'string' ? r.imaging.findings : '',
        impression: typeof r.imaging.impression === 'string' ? r.imaging.impression : '',
        measurements: typeof r.imaging.measurements === 'string' ? r.imaging.measurements : '',
        ...(Array.isArray(r.imaging.exams) ? { exams: r.imaging.exams.filter((e) => e && typeof e === 'object').map((e) => ({
          examPart: typeof e.examPart === 'string' ? e.examPart : '',
          ...(typeof e.examMethod === 'string' ? { examMethod: e.examMethod } : {}),
          findings: typeof e.findings === 'string' ? e.findings : '',
          impression: typeof e.impression === 'string' ? e.impression : '',
          measurements: typeof e.measurements === 'string' ? e.measurements : '',
        })) } : {}),
      } : undefined,
      hospital: typeof r.hospital === 'string' ? r.hospital : '未填写',
      reportDate: typeof r.reportDate === 'string' ? r.reportDate : '',
      testPurpose: typeof r.testPurpose === 'string' ? r.testPurpose : '',
      reportTypes: Array.isArray(r.reportTypes)
        ? r.reportTypes.filter((type): type is string => typeof type === 'string')
        : (typeof r.reportType === 'string' && r.reportType ? [r.reportType] : []),
      reportType: typeof r.reportType === 'string' ? r.reportType : '',
      title: typeof r.title === 'string' ? r.title : '',
      notes: typeof r.notes === 'string' ? r.notes : '',
      details: Array.isArray(r.details)
        ? r.details
            .filter((d) => d && typeof d.label === 'string' && typeof d.value === 'string')
            .map((d) => ({ label: d.label, value: d.value }))
        : undefined,
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
      testMethod: typeof it.testMethod === 'string' ? it.testMethod.trim() : '',
      confirmed: it.confirmed !== false,
      standardLabel: typeof it.standardLabel === 'string' ? it.standardLabel.trim() : '', // 兼容旧数据：缺省视为未设置
      createdAt: typeof it.createdAt === 'number' ? it.createdAt : Date.now(),
      updatedAt: typeof it.updatedAt === 'number' ? it.updatedAt : Date.now(),
    });
  });

  // 附件：reportId 不在已导入报告集合中 → 跳过（避免生成孤立附件）；数据损坏 → 跳过。
  const attachmentRefs = new Map<string, { id: string; reportId: string }>(); // 原 id → 最终导入信息
  const cleanAttachments: AttachmentRecord[] = [];
  let totalAttachmentBytes = 0;
  let skippedAttachments = 0;
  for (const a of attachments) {
    if (cleanAttachments.length >= 500) { skippedAttachments += attachments.length - cleanAttachments.length; break; }
    const reportId = ensureId(a.reportId, 'r');
    if (!reportIds.has(reportId)) { skippedAttachments++; continue; }
    try {
      const blob = await dataUrlToBlob(a.dataUrl);
      if (blob.size > 25 * 1024 * 1024 || totalAttachmentBytes + blob.size > 200 * 1024 * 1024) { skippedAttachments++; continue; }
      totalAttachmentBytes += blob.size;
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
      skippedAttachments++;
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

  // 用户自定义报告类型：名称去空白/截断、与内置/已有自定义去重；缺省（旧数据）为空数组不报错。
  const cleanCustomReportTypes: CustomReportType[] = [];
  const usedTypeNames = new Set<string>(REPORT_TYPES as readonly string[]);
  for (const c of payload.customReportTypes ?? []) {
    if (!c || typeof c !== 'object') continue;
    const name = normalizeReportTypeName(typeof c.name === 'string' ? c.name : '');
    if (name === '' || name.length > 20) continue;
    if (usedTypeNames.has(name)) continue; // 与内置或已加入的自定义类型重复则跳过
    usedTypeNames.add(name);
    const aliases = Array.isArray(c.aliases)
      ? [
          ...new Set(
            c.aliases.map((a) => normalizeReportTypeName(a)).filter((a) => a !== '' && a !== name),
          ),
        ]
      : [];
    cleanCustomReportTypes.push({
      id: ensureId(c.id, 'crt'),
      name,
      aliases,
      ...(c.reportKind === 'imaging' || c.reportKind === 'lab' || c.reportKind === 'other' ? { reportKind: c.reportKind } : {}),
      createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
      updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : Date.now(),
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
    customReportTypes: cleanCustomReportTypes,
    skippedAttachments,
  };
}

/** 导入：整体覆盖现有本地数据（提示后执行）。附件 base64 还原为 Blob。 */
export async function importPayload(obj: unknown): Promise<ImportResult> {
  const v = validatePayload(obj);
  if (!v.ok) return v;
  try {
    // v1 旧备份可无 integrity；一旦声明则必须严格匹配，防止损坏/篡改后覆盖本地数据。
    if (v.payload.integrity) {
      const { integrity: _integrity, ...unsigned } = v.payload;
      const actual = await payloadHash(unsigned);
      if (actual !== v.payload.integrity.payloadHash.toLowerCase())
        return { ok: false, error: '导入拒绝：备份完整性校验失败（SHA-256 不匹配），文件可能已损坏或被修改。' };
    }
    const clean = await buildCleanImport(v.payload);
    await db.transaction(
      'rw',
      [db.members, db.reports, db.items, db.attachments, db.labelMappings, db.customReportTypes],
      async () => {
        await db.members.clear();
        await db.reports.clear();
        await db.items.clear();
        await db.attachments.clear();
        await db.labelMappings.clear();
        await db.customReportTypes.clear();

        if (clean.members.length > 0) await db.members.bulkAdd(clean.members);
        if (clean.reports.length > 0) await db.reports.bulkAdd(clean.reports);
        if (clean.items.length > 0) await db.items.bulkAdd(clean.items);
        if (clean.attachments.length > 0) await db.attachments.bulkAdd(clean.attachments);
        if (clean.labelMappings.length > 0) await db.labelMappings.bulkAdd(clean.labelMappings);
        if (clean.customReportTypes.length > 0)
          await db.customReportTypes.bulkAdd(clean.customReportTypes);
      },
    );

    return {
      ok: true,
      summary: {
        members: clean.members.length,
        reports: clean.reports.length,
        items: clean.items.length,
        attachments: clean.attachments.length,
        skippedAttachments: clean.skippedAttachments,
      },
      warnings: clean.skippedAttachments > 0
        ? [`有 ${clean.skippedAttachments} 个附件损坏、关联无效或超出限制，已跳过。`]
        : [],
    };
  } catch (e) {
    return { ok: false, error: `导入失败：${e instanceof Error ? e.message : String(e)}` };
  }
}
