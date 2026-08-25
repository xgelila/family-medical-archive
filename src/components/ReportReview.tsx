import { useEffect, useRef, useState } from 'react';
import { db, now, uid } from '../db';
import {
  type AttachmentRecord,
  type Member,
  type Report,
  type ReportDetail,
  type ReportItem,
  type ReportKind,
  type ImagingReport,
  LAB_REPORT_TYPES,
  IMAGING_REPORT_TYPES,
} from '../types';
import { emptyDraft, nonEmptyItemDrafts, pendingItemCount, type ItemDraft } from '../utils/labels';
import type { ReportScanMeta } from '../utils/ocrCandidate';
import {
  canSaveEditReport,
  isCurrentEditLoadRequest,
  loadEditReportData,
  type EditLoadStatus,
} from '../utils/editLoad';
import {
  addCustomReportType,
  loadCustomReportTypes,
  matchTestPurposeToType,
  mergeReportTypes,
  validateCustomReportTypeName,
  type CustomReportType,
} from '../utils/customReportTypes';
import { Field, ConfirmButton } from './Kit';
import { todayISO } from '../utils/dates';

/**
 * 统一报告编辑/核对界面（新建向导第 4 步「核对并保存」+ 编辑已有报告）。
 *
 * 设计：
 * - 直接展示并编辑报告字段（成员/医院/日期/报告类型/检验目的/标题/备注）、
 *   附加元数据（details）与检查项目（items），全部为可编辑项；
 * - **检验目的（testPurpose）与报告类型/检查类别（reportType）是两个独立概念**：
 *   testPurpose 是报告结构的固定字段（如「血红蛋白」「糖化血红蛋白」「血常规检查」），
 *   独立于 reportType（严格受控选项，如「血常规」「甲状腺功能」）。两者分开显示与保存，
 *   绝不把检验目的强行伪装成报告类型；当检验目的无法匹配严格 REPORT_TYPES 时，
 *   reportType 保持为空，检验目的仍作为固定字段原样展示/保存；
 * - 新建模式（向导注入 initialReportMeta/initialItems/initialDetails/attachments）：
 *   识别结果一次性传入，不挂载旧版识别面板；
 * - 编辑模式（editingReport 传入）：从数据库加载既有项目/附件，保存时保持报告 id 与
 *   createdAt，附件支持移除/添加，项目/详情/确认状态原样保留；
 * - 保存时把识别结果一次性写入数据库（reports/items/attachments），保持既有
 *   保存/导出/趋势分组行为（items 经 nonEmptyItemDrafts 过滤，确认状态原样保留）。
 */

export function ReportReview({
  members,
  initialMemberId,
  initialReportMeta,
  initialItems,
  initialDetails,
  attachments: initialAttachments = [],
  editingReport,
  onDone,
  onBack,
}: {
  members: Member[];
  initialMemberId: string;
  initialReportMeta?: ReportScanMeta;
  /** 新建模式注入的识别项目/详情/附件（编辑模式忽略，从数据库加载）。 */
  initialItems?: ItemDraft[];
  initialDetails?: ReportDetail[];
  attachments?: AttachmentRecord[];
  /** 编辑模式：传入既有报告，从其加载项目/附件并在保存时保持报告 id。 */
  editingReport?: Report | null;
  onDone: (saved: boolean) => void;
  onBack?: (draft: {
    memberId: string;
    reportMeta: ReportScanMeta;
    items: ItemDraft[];
    details: ReportDetail[];
  }) => void;
}) {
  const [reportKind, setReportKind] = useState<ReportKind>(editingReport?.reportKind ?? initialReportMeta?.reportKind ?? 'lab');
  // 识别结果的 exams 可能由兼容层放在 reportMeta.exams，而 imaging 只含旧版单项字段；
  // 初始化时合并两者，避免首屏把 AI 已识别的子检查覆盖成空数组。
  const initialImaging = editingReport?.imaging ?? {
    ...(initialReportMeta?.imaging ?? { examPart: '', examMethod: '', findings: '', impression: '', measurements: '' }),
    ...(initialReportMeta?.exams ? { exams: initialReportMeta.exams } : {}),
  };
  const [imaging, setImaging] = useState<ImagingReport>(initialImaging);
  const imagingExams = imaging.exams ?? (imaging.examPart || imaging.findings || imaging.impression || imaging.measurements ? [{ examPart: imaging.examPart, examMethod: imaging.examMethod, findings: imaging.findings, impression: imaging.impression, measurements: imaging.measurements }] : []);
  const updateExam = (index: number, patch: Partial<NonNullable<ImagingReport['exams']>[number]>) => setImaging((v) => ({ ...v, exams: (v.exams ?? imagingExams).map((e, i) => i === index ? { ...e, ...patch } : e) }));
  const addExam = () => setImaging((v) => ({ ...v, exams: [...(v.exams ?? imagingExams), { examPart: '', examMethod: '', findings: '', impression: '', measurements: '' }] }));
  const removeExam = (index: number) => setImaging((v) => ({ ...v, exams: (v.exams ?? imagingExams).filter((_, i) => i !== index) }));
  const [memberId, setMemberId] = useState(editingReport?.memberId ?? initialMemberId);
  const [hospital, setHospital] = useState(
    editingReport?.hospital ?? initialReportMeta?.hospital ?? '',
  );
  const [reportDate, setReportDate] = useState(
    editingReport?.reportDate ?? initialReportMeta?.reportDate ?? todayISO(),
  );
  const initialTypes = editingReport?.reportTypes?.filter(Boolean) ?? initialReportMeta?.reportTypes?.filter(Boolean) ?? [];
  const [reportTypes, setReportTypes] = useState<string[]>(
    initialTypes.length > 0 ? [...new Set(initialTypes)] : ((editingReport?.reportType ?? initialReportMeta?.reportType ?? '') ? [editingReport?.reportType ?? initialReportMeta?.reportType ?? ''] : []),
  );
  const reportType = reportTypes[0] ?? '';
  const setReportType = (value: string) => setReportTypes(value ? [value] : []);
  const [testPurpose, setTestPurpose] = useState(
    editingReport?.testPurpose ?? initialReportMeta?.testPurpose ?? '',
  );
  const [title, setTitle] = useState(editingReport?.title ?? initialReportMeta?.title ?? '');
  const [notes, setNotes] = useState(editingReport?.notes ?? initialReportMeta?.notes ?? '');
  const [details, setDetails] = useState<ReportDetail[]>(
    editingReport?.details ?? initialDetails ?? [],
  );
  const [items, setItems] = useState<ItemDraft[]>(editingReport ? [] : (initialItems ?? []));
  const [attachments, setAttachments] = useState<AttachmentRecord[]>(
    editingReport ? [] : initialAttachments,
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // 编辑模式：既有项目/附件异步加载状态（P0 防覆盖竞态）。新建模式无需加载。
  const [editStatus, setEditStatus] = useState<EditLoadStatus>('idle');
  const [editError, setEditError] = useState('');
  const [loadedReportId, setLoadedReportId] = useState<string | null>(null);
  const editLoadRequestRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  // 移动端项目卡片「更多」折叠的展开项索引集合
  const [moreOpen, setMoreOpen] = useState<Set<number>>(new Set());
  const toggleMore = (i: number) =>
    setMoreOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  // 用户自定义报告类型（持久化，识别/AI 不自动新增）
  const [customTypes, setCustomTypes] = useState<CustomReportType[]>([]);
  const [, setCustomTypesLoaded] = useState(false);
  // 未匹配检验目的的一次性建议状态：pending（待选择）/ saved（已存为新类型）/ skip（取消）
  const [purposeChoice, setPurposeChoice] = useState<'pending' | 'saved' | 'skip'>('pending');
  const [newTypeError, setNewTypeError] = useState('');

  // 加载自定义报告类型
  useEffect(() => {
    let alive = true;
    loadCustomReportTypes().then((cts) => {
      if (alive) {
        setCustomTypes(cts);
        setCustomTypesLoaded(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // 编辑既有报告：从数据库加载既有项目与附件（新建模式不加载，直接用注入值）。
  // P0 安全性：加载完成前禁用保存（不覆盖既有数据）；失败显示短错误与「重试」。
  const startEditLoad = (reportId: string) => {
    const requestId = ++editLoadRequestRef.current;
    setEditStatus('loading');
    setEditError('');
    // 先撤销上一份报告的成功标记，加载期间保存必须保持关闭。
    setLoadedReportId(null);
    void loadEditReportData(reportId)
      .then(({ items: loadedItems, attachments: loadedAtts }) => {
        if (!isCurrentEditLoadRequest({
          requestId,
          currentRequestId: editLoadRequestRef.current,
          reportId,
          currentReportId: editingReport?.id ?? null,
        })) return;
        setItems(loadedItems);
        setAttachments(loadedAtts);
        setLoadedReportId(reportId);
        setEditStatus('ready');
      })
      .catch((e) => {
        if (!isCurrentEditLoadRequest({
          requestId,
          currentRequestId: editLoadRequestRef.current,
          reportId,
          currentReportId: editingReport?.id ?? null,
        })) return;
        setEditError(`加载失败：${e instanceof Error ? e.message : String(e)}`);
        setEditStatus('error');
      });
  };

  useEffect(() => {
    if (!editingReport) {
      // 新建模式：无需加载，也不阻塞保存。
      ++editLoadRequestRef.current;
      setEditStatus('idle');
      setLoadedReportId(null);
      setEditError('');
      return;
    }
    startEditLoad(editingReport.id);
  }, [editingReport]);

  const retryEditLoad = () => {
    if (editingReport) startEditLoad(editingReport.id);
  };

  // 识别出的旧版自由文本报告类型保留展示，避免保存时静默丢失。
  const allTypes = mergeReportTypes(customTypes);
  const kindTypes = reportKind === 'imaging' ? [...IMAGING_REPORT_TYPES, ...customTypes.filter((t) => t.reportKind === 'imaging').map((t) => t.name)] : reportKind === 'lab' ? [...LAB_REPORT_TYPES, ...customTypes.filter((t) => !t.reportKind || t.reportKind === 'lab').map((t) => t.name)] : allTypes;
  // 类型目录按报告大类联动；旧报告中的已存类型始终保留，避免编辑保存时静默丢失。
  const typeInKind = (kindTypes as readonly string[]).includes(reportType);
  const isCustomLabType = reportKind === 'lab' && customTypes.some((t) => t.name === reportType && (!t.reportKind || t.reportKind === 'lab'));
  const legacyType = reportType !== '' && !typeInKind && !isCustomLabType &&
    (reportKind === 'other' || (reportKind === 'lab' && !(IMAGING_REPORT_TYPES as readonly string[]).includes(reportType)) || (reportKind === 'imaging' && !(LAB_REPORT_TYPES as readonly string[]).includes(reportType)))
    ? reportType : '';
  const inferredExamTypes = reportKind === 'imaging'
    ? imagingExams.flatMap((exam) => IMAGING_REPORT_TYPES.filter((type) => type !== '其他检查' && exam.examPart.trim().includes(type.replace('超声', ''))))
    : [];
  const selectableTypes = [...new Set([...kindTypes, ...reportTypes, ...inferredExamTypes])];
  const visibleTypes = [...new Set([...selectableTypes, ...(legacyType ? [legacyType] : [])])];
  const toggleReportType = (type: string) => setReportTypes((prev) => prev.includes(type) ? prev.filter((v) => v !== type) : [...prev, type]);
  const [reportTypeOpen, setReportTypeOpen] = useState(false);
  useEffect(() => {
    if (reportKind !== 'imaging' || inferredExamTypes.length === 0) return;
    setReportTypes((prev) => [...new Set([...prev, ...inferredExamTypes])]);
  }, [reportKind, imagingExams.map((e) => e.examPart).join('|')]);

  // 检验目的未匹配任何报告类型（内置 + 自定义 + 已确认别名）时，显示一次性轻量建议。
  const purposeMatched =
    testPurpose.trim() !== '' ? matchTestPurposeToType(testPurpose, customTypes, reportKind) : '';
  const showPurposePrompt =
    testPurpose.trim() !== '' && purposeMatched === '' && purposeChoice === 'pending';

  // 一次性建议：确认后把检验目的原文存为新的自定义报告类型，并立即选中当前报告类型。
  const handleSaveAsNewType = async () => {
    const name = testPurpose.trim();
    const v = validateCustomReportTypeName(name, allTypes);
    if (!v.ok) {
      setNewTypeError(v.error);
      return;
    }
    const rec = await addCustomReportType(v.normalized, [testPurpose], reportKind);
    if (rec) {
      setCustomTypes((prev) => [...prev, rec]);
      setReportType(rec.name); // 确认新增后当前类型立即选中
      setNewTypeError('');
      setPurposeChoice('saved');
    } else {
      setNewTypeError('保存失败：名称为空、过长或已存在');
    }
  };

  const fieldsReady =
    memberId !== '' && hospital.trim() !== '' && reportDate !== '' && (reportKind !== 'lab' || pendingItemCount(items) === 0);
  // P0：编辑模式仅在「已加载成功且 reportId 一致」时允许保存（防覆盖竞态）；新建模式不受限。
  const editReady = canSaveEditReport({
    editing: !!editingReport,
    status: editStatus,
    loadedReportId,
    editingReportId: editingReport?.id ?? null,
  });
  const canSave = fieldsReady && editReady;
  const pendingCount = pendingItemCount(items);

  const scrollToPending = () => {
    const el = document.querySelector('[data-item-pending="true"]');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const setItem = (i: number, patch: Partial<ItemDraft>) =>
    setItems((list) => list.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const addFiles = (list: File[] | null) => {
    if (!list || list.length === 0) return;
    const t = now();
    const recs: AttachmentRecord[] = list.map((file) => ({
      id: uid(),
      reportId: editingReport?.id ?? '',
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      kind: file.type.startsWith('image/')
        ? 'image'
        : file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
          ? 'pdf'
          : 'other',
      blob: file,
      createdAt: t,
    }));
    setAttachments((prev) => [...prev, ...recs]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const removeAttachment = (id: string) =>
    setAttachments((prev) => prev.filter((a) => a.id !== id));

  const save = async () => {
    if (!canSave) return;
    // P0 双重校验：编辑模式下，若加载尚未成功或 reportId 错位，绝不落库（防空数组覆盖）。
    if (editingReport && (editStatus !== 'ready' || loadedReportId !== editingReport.id)) return;
    setBusy(true);
    setError('');
    try {
      const ts = now();
      const reportId = editingReport?.id ?? uid();
      const report: Report = {
        id: reportId,
        memberId,
        reportKind,
        imaging: reportKind === 'imaging' ? { ...imaging, ...(imagingExams.length ? { exams: imagingExams } : {}) } : undefined,
        hospital: hospital.trim(),
        reportDate,
        // 报告类型/检查类别：严格受控选项；检验目的无法匹配时保持为空。
        reportTypes: reportTypes.length > 0 ? reportTypes : (reportType ? [reportType] : []),
        reportType: reportTypes[0] ?? (editingReport?.reportType ?? '').trim(),
        // 检验目的：报告结构的固定字段，独立保存（不混入 details/附件信息）
        testPurpose: testPurpose.trim(),
        title: title.trim(),
        notes: notes.trim(),
        details: details
          .filter((d) => d.value.trim() !== '')
          .map((d) => ({ label: d.label.trim() || '附加信息', value: d.value.trim() })),
        attachmentIds: attachments.map((a) => a.id),
        createdAt: editingReport?.createdAt ?? ts,
        updatedAt: ts,
      };

      await db.transaction('rw', db.reports, db.items, db.attachments, async () => {
        await db.reports.put(report);
        await db.items.where('reportId').equals(reportId).delete();
        const clean = nonEmptyItemDrafts(items).map((it, idx): ReportItem => ({
          id: it.id ?? uid(),
          reportId,
          memberId,
          index: idx,
          name: it.name,
          resultKind: it.resultKind,
          value: it.value,
          unit: it.unit,
          refRange: it.refRange,
          notes: it.notes,
          testMethod: (it.testMethod ?? '').trim(),
          confirmed: it.confirmed,
          standardLabel: (it.standardLabel ?? '').trim(),
          createdAt: editingReport?.createdAt ?? ts,
          updatedAt: ts,
        }));
        if (clean.length > 0) await db.items.bulkAdd(clean);

        // 附件统一写入 reportId；清理被移除的旧附件
        const oldAtts = await db.attachments.where('reportId').equals(reportId).toArray();
        const keep = new Set(attachments.map((a) => a.id));
        for (const a of oldAtts) if (!keep.has(a.id)) await db.attachments.delete(a.id);
        for (const a of attachments) {
          await db.attachments.put({ ...a, reportId });
        }
      });
      onDone(true);
    } catch (e) {
      setError(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card form-card report-review">
      <div className="review-head">
        <h4>{editingReport ? '编辑报告（核对并保存）' : '核对并保存'}</h4>
        <p className="dim">
          {editingReport
            ? '以下为既有报告字段 / 检查项目 / 附件，均可直接编辑核对；确认无误后保存。'
            : '以下为识别出的候选字段 / 检查项目 / 详情，均可直接编辑核对；确认无误后保存。'}
        </p>
        {editingReport && editStatus === 'loading' && (
          <div className="edit-loading dim" role="status">正在加载既有项目与附件…</div>
        )}
        {editingReport && editStatus === 'error' && (
          <div className="edit-load-error" role="alert">
            <span className="error-text">{editError}</span>
            <button type="button" className="btn btn-sm" onClick={retryEditLoad}>
              重试
            </button>
          </div>
        )}
        {pendingCount > 0 && reportKind === 'lab' && (
          <div className="pending-bar">
            <span className="chip chip-warn">{pendingCount} 项待确认</span>
            <button type="button" className="btn btn-sm" onClick={scrollToPending}>
              定位下一项
            </button>
          </div>
        )}
      </div>

      <div className="form-grid">
        <Field label="成员 *">
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">请选择成员</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="报告大类">
          <select value={reportKind} onChange={(e) => setReportKind(e.target.value as ReportKind)}>
            <option value="lab">检验</option><option value="imaging">检查</option>
          </select>
        </Field>
        <Field label="医院 / 体检机构 *">
          <input
            value={hospital}
            onChange={(e) => setHospital(e.target.value)}
            placeholder="如：市第一人民医院"
          />
        </Field>
        <Field label="报告日期 *">
          <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
        </Field>
        <Field label="报告类型 / 检查类别" hint={reportKind === 'imaging' ? '可多选；至少选择一项或保留原类型' : '检验报告可选择一项'}>
          <details className="report-type-dropdown" open={reportTypeOpen} onToggle={(e) => setReportTypeOpen(e.currentTarget.open)}>
            <summary className="report-type-summary">
              <span>{reportTypes.length ? `已选 ${reportTypes.length} 项` : '请选择'}</span>
              <span aria-hidden="true">▾</span>
            </summary>
            <div className="report-type-menu" role="group" aria-label="报告类型选项">
              {visibleTypes.map((t) => (
                <label key={t} className="report-type-option">
                  <input type={reportKind === 'imaging' ? 'checkbox' : 'radio'} name="report-type" checked={reportTypes.includes(t)} onChange={() => reportKind === 'imaging' ? toggleReportType(t) : setReportType(t)} />
                  <span>{t}</span>
                </label>
              ))}
            </div>
          </details>
          {reportTypes.length > 0 && <div className="report-type-selected" aria-label="已选报告类型">{reportTypes.map((t) => <span key={t} className="chip">{t}</span>)}</div>}
          {reportTypes.length === 0 && <small className="error-text">未匹配报告类型：报告仍可保存，检验项目仍可进入趋势；但按报告类型筛选/统计不会命中。建议补选已有类型，或在下方明确保存为新类型。</small>}
        </Field>
        {reportKind === 'imaging' ? (
          <Field label="检查项目">
            <input value={testPurpose} onChange={(e) => setTestPurpose(e.target.value)} placeholder="如：腹部超声检查" />
          </Field>
        ) : (
          <Field label="检验目的">
            <input value={testPurpose} onChange={(e) => setTestPurpose(e.target.value)} placeholder="如：血常规检查" />
          </Field>
        )}
        <Field label="标题">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="可选，如 2025 年度体检"
          />
        </Field>
        <Field label="备注">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="可选" />
        </Field>
      </div>

      {reportTypes.length === 0 && (
        <div className="purpose-suggestion" role="alert">
          <strong>未匹配报告类型</strong>
          <p>报告仍可保存，检验项目可进入趋势；按报告类型筛选/统计不会命中，建议补选类型。</p>
          <p className="dim">请在上方选择已有类型，或在下方明确点击“保存为新报告类型”。</p>
        </div>
      )}

      {showPurposePrompt && (
        <div className="purpose-suggestion" role="note">
          <p>
            识别到的新报告类型：{testPurpose}。未匹配任何现有报告类型，可保存为新的{reportKind === 'imaging' ? '检查' : '检验'}报告类型：
          </p>
          <div className="btn-row purpose-actions">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => void handleSaveAsNewType()}
            >
              将「{testPurpose}」保存为新的报告类型
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setPurposeChoice('skip')}
            >
              取消
            </button>
          </div>
          {newTypeError && <p className="error-text">{newTypeError}</p>}
          <p className="dim">
            保存后当前报告类型将自动选中该新类型；检验目的（testPurpose）仍作为独立字段保留并可编辑。
            完整管理（查看/删除/手动新增）请在「数据管理」页进行。
          </p>
        </div>
      )}

      {editingReport && (
        <div className="att-section">
          <div className="att-head">
            <strong>原始附件（图片 / PDF）</strong>
            <small>可移除或添加；仅保存到本机</small>
          </div>
          {editStatus === 'loading' ? (
            <div className="dim" role="status">正在加载附件…</div>
          ) : editStatus === 'error' ? (
            <div className="dim">附件加载失败，请点击上方「重试」。</div>
          ) : (
            <>
              <div className="att-row">
                {attachments.length === 0 ? (
                  <span className="dim">尚未添加附件</span>
                ) : (
                  attachments.map((a) => (
                    <span key={a.id} className="att-chip-row">
                      <span className="att-chip" title={a.name}>
                        {a.kind === 'image' ? '🖼️' : a.kind === 'pdf' ? '📄' : '📎'} {a.name}
                      </span>
                      <ConfirmButton
                        label="移除"
                        confirmText={`移除附件「${a.name}」`}
                        danger
                        small
                        onConfirm={() => removeAttachment(a.id)}
                      />
                    </span>
                  ))
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.pdf"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  addFiles(e.target.files ? Array.from(e.target.files) : null);
                  if (fileRef.current) fileRef.current.value = '';
                }}
              />
              <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                + 添加图片/PDF 附件
              </button>
            </>
          )}
        </div>
      )}

      {reportKind === 'imaging' && (
        <div className="card imaging-editor" data-testid="imaging-fields">
          <h4>检查信息</h4>
          {imagingExams.map((exam, index) => <div className="imaging-exam-card" key={index} data-testid="imaging-exam">
            {imagingExams.length > 1 ? <strong>子检查 {index + 1}</strong> : <strong>检查信息</strong>}{index > 0 && <button type="button" onClick={() => removeExam(index)}>删除</button>}
            <Field label="检查部位"><input value={exam.examPart} onChange={(e) => updateExam(index, { examPart: e.target.value })} placeholder="待补充/未识别" /></Field>
            {imagingExams.length > 1 && imagingExams.every((e) => (e.examMethod ?? '').trim() === (imagingExams[0]?.examMethod ?? '').trim()) && index > 0 ? (
              <div className="imaging-method-shared dim">检查方法同上（可在子检查 1 的“检查方法”中编辑）</div>
            ) : (
              <Field label={imagingExams.length > 1 && imagingExams.every((e) => (e.examMethod ?? '').trim() === (imagingExams[0]?.examMethod ?? '').trim()) ? '检查方法（各子检查相同）' : '检查方法'}><input value={exam.examMethod ?? ''} onChange={(e) => updateExam(index, { examMethod: e.target.value })} placeholder="待补充/未识别" /></Field>
            )}
            <Field label="测量值"><input value={exam.measurements} onChange={(e) => updateExam(index, { measurements: e.target.value })} placeholder="待补充/未识别" /></Field>
            <Field label="所见"><textarea value={exam.findings} onChange={(e) => updateExam(index, { findings: e.target.value })} placeholder="待补充/未识别" /></Field>
            <Field label="结论"><textarea value={exam.impression} onChange={(e) => updateExam(index, { impression: e.target.value })} placeholder="待补充/未识别" /></Field>
          </div>)}
          <button type="button" onClick={addExam}>添加检查部位</button>
        </div>
      )}
      {reportKind === 'other' && <Field label="原文 / 详情"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>}

      <div className="item-editor" style={reportKind === 'lab' ? undefined : { display: 'none' }} data-report-kind={reportKind}>
        <div className="att-head">
          <strong>
            检查项目（
            {editingReport && editStatus !== 'ready' ? '…' : items.length}
            ）
          </strong>
          <small>项目名保留报告原文；检验方法随项目保存，不做自动推断。</small>
          <div className="item-head-actions">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setItems((l) => l.map((it) => ({ ...it, confirmed: true })))}
              disabled={items.length === 0 || (editingReport ? editStatus !== 'ready' : false)}
            >
              全部标记已确认
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setItems((l) => [...l, emptyDraft()])}
              disabled={editingReport ? editStatus !== 'ready' : false}
            >
              + 添加项目
            </button>
          </div>
        </div>

        {editingReport && editStatus === 'loading' ? (
          <div className="edit-loading dim" role="status">正在加载检查项目…</div>
        ) : editingReport && editStatus === 'error' ? (
          <div className="edit-load-error" role="alert">
            <span className="error-text">项目加载失败。</span>
            <button type="button" className="btn btn-sm" onClick={retryEditLoad}>
              重试
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="dim" style={{ padding: '8px 0' }}>
            尚无检查项目，可点击「+ 添加项目」手动录入，或返回上一步识别整张报告。
          </div>
        ) : (
          <>
            {/* 桌面端：宽表格（保留） */}
            <div className="table-wrap item-table-desktop">
              <table className="data-table item-edit-table">
                <thead>
                  <tr>
                    <th className="col-status">状态</th>
                    <th className="col-name">项目名（报告原文）*</th>
                    <th className="col-value">数值 / 定性结果</th>
                    <th>单位</th>
                    <th>参考区间</th>
                    <th>检验方法</th>
                    <th>备注</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr
                      key={i}
                      className={it.confirmed ? '' : 'row-pending'}
                      data-item-pending={it.confirmed ? undefined : true}
                    >
                      <td>
                        <button
                          type="button"
                          className={`status-toggle ${it.confirmed ? 'st-ok' : 'st-warn'}`}
                          onClick={() => setItem(i, { confirmed: !it.confirmed })}
                        >
                          {it.confirmed ? '✓ 已确认' : '！待确认'}
                        </button>
                      </td>
                      <td>
                        <input
                          value={it.name}
                          onChange={(e) => setItem(i, { name: e.target.value })}
                          placeholder="如：血红蛋白"
                        />
                      </td>
                      <td>
                        <div className="value-cell">
                          <input
                            value={it.value}
                            onChange={(e) => setItem(i, { value: e.target.value })}
                            placeholder="如 145 / 阴性"
                          />
                          <select
                            value={it.resultKind}
                            title="结果类型"
                            onChange={(e) =>
                              setItem(i, { resultKind: e.target.value as ItemDraft['resultKind'] })
                            }
                          >
                            <option value="numeric">数值</option>
                            <option value="qualitative">定性</option>
                          </select>
                        </div>
                      </td>
                      <td>
                        <input
                          value={it.unit}
                          onChange={(e) => setItem(i, { unit: e.target.value })}
                          placeholder="如 g/L"
                          style={{ width: 90 }}
                        />
                      </td>
                      <td>
                        <input
                          value={it.refRange}
                          onChange={(e) => setItem(i, { refRange: e.target.value })}
                          placeholder="如 130-175"
                          style={{ width: 110 }}
                        />
                      </td>
                      <td>
                        <input
                          value={it.testMethod}
                          onChange={(e) => setItem(i, { testMethod: e.target.value })}
                          placeholder="如 化学发光法"
                          style={{ width: 110 }}
                          title="检验/试验方法（检查项目字段，与单位、参考区间并列保存）"
                        />
                      </td>
                      <td>
                        <input
                          value={it.notes}
                          onChange={(e) => setItem(i, { notes: e.target.value })}
                          placeholder="可选"
                          style={{ width: 130 }}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => setItems((l) => l.filter((_, idx) => idx !== i))}
                        >
                          删
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 移动端（max-width:640px）：纵向项目卡片，默认只显示状态/项目名/结果/单位，
                参考区间/检验方法/备注放进「更多」折叠；删除放在卡片底部危险操作区。 */}
            <div className="item-cards-mobile">
              {items.map((it, i) => (
                <div
                  key={i}
                  className={`item-card ${it.confirmed ? '' : 'item-card-pending'}`}
                  data-item-pending={it.confirmed ? undefined : true}
                >
                  <div className="item-card-top">
                    <button
                      type="button"
                      className={`status-toggle ${it.confirmed ? 'st-ok' : 'st-warn'}`}
                      aria-pressed={it.confirmed}
                      onClick={() => setItem(i, { confirmed: !it.confirmed })}
                    >
                      {it.confirmed ? '✓ 已确认' : '！待确认'}
                    </button>
                    <span className="item-card-idx">#{i + 1}</span>
                  </div>
                  <label className="item-card-name">
                    <span>项目名 *</span>
                    <input
                      value={it.name}
                      onChange={(e) => setItem(i, { name: e.target.value })}
                      placeholder="如：血红蛋白"
                    />
                  </label>
                  <div className="item-card-result-row">
                    <label className="item-card-value">
                      <span>结果</span>
                      <input
                        value={it.value}
                        onChange={(e) => setItem(i, { value: e.target.value })}
                        placeholder="如 145 / 阴性"
                      />
                    </label>
                    <label className="item-card-unit">
                      <span>单位</span>
                      <input
                        value={it.unit}
                        onChange={(e) => setItem(i, { unit: e.target.value })}
                        placeholder="如 g/L"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="item-card-more-toggle"
                    aria-expanded={moreOpen.has(i)}
                    onClick={() => toggleMore(i)}
                  >
                    更多（参考区间 / 检验方法 / 备注）{moreOpen.has(i) ? '▴' : '▾'}
                  </button>
                  {moreOpen.has(i) && (
                    <div className="item-card-more">
                      <label>
                        <span>参考区间</span>
                        <input
                          value={it.refRange}
                          onChange={(e) => setItem(i, { refRange: e.target.value })}
                          placeholder="如 130-175"
                        />
                      </label>
                      <label>
                        <span>检验方法</span>
                        <input
                          value={it.testMethod}
                          onChange={(e) => setItem(i, { testMethod: e.target.value })}
                          placeholder="如 化学发光法"
                        />
                      </label>
                      <label>
                        <span>备注</span>
                        <input
                          value={it.notes}
                          onChange={(e) => setItem(i, { notes: e.target.value })}
                          placeholder="可选"
                        />
                      </label>
                    </div>
                  )}
                  <div className="item-card-danger">
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => setItems((l) => l.filter((_, idx) => idx !== i))}
                    >
                      删除该项目
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 报告详情：检查项目是报告一级主内容，故报告详情固定放到检查项目列表底部；
          仍可折叠，入口默认可见。不混入附件信息。 */}
      <div className="details-section">
        <button type="button" className="details-toggle" onClick={() => setDetailsOpen((v) => !v)}>
          <span>报告详情（送检医生 / 检验者 / 审核者等附加信息）</span>
          <span className="dim">
            {details.length > 0 ? `${details.length} 项` : '无'} {detailsOpen ? '▴' : '▾'}
          </span>
        </button>
        {detailsOpen && (
          <div className="details-editor">
            {details.length === 0 && (
              <div className="dim">识别出的附加信息会显示在这里，也可手动添加。</div>
            )}
            {details.map((d, i) => (
              <div key={i} className="details-row">
                <input
                  className="details-label"
                  value={d.label}
                  placeholder="名称（如 检验目的）"
                  onChange={(e) =>
                    setDetails((list) =>
                      list.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)),
                    )
                  }
                />
                <input
                  className="details-value"
                  value={d.value}
                  placeholder="值"
                  onChange={(e) =>
                    setDetails((list) =>
                      list.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x)),
                    )
                  }
                />
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  aria-label="删除该行"
                  onClick={() => setDetails((list) => list.filter((_, idx) => idx !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setDetails((list) => [...list, { label: '', value: '' }])}
            >
              + 添加一行
            </button>
          </div>
        )}
      </div>

      <div className="review-note dim">
        {editingReport
          ? `保存时将更新 ${attachments.length} 个原始附件。`
          : attachments.length > 0
            ? `将保存 ${attachments.length} 个原始附件（含已编辑图片）。`
            : '本次未添加附件。'}
      </div>

      <div className="form-actions">
        {pendingCount > 0 && reportKind === 'lab' && (
          <span className="confirm-gate-note" role="alert">
            还有 {pendingCount} 项待确认，请逐项确认后才能保存生成正式记录。
          </span>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canSave || busy}
          onClick={() => void save()}
        >
          {busy ? '保存中…' : '保存报告'}
        </button>
        {onBack && (
          <button
            type="button"
            className="btn btn-ghost"
            aria-label="返回上一步"
            onClick={() => onBack({
              memberId,
              reportMeta: {
                reportKind,
                imaging: reportKind === 'imaging'
                  ? { ...imaging, ...(imagingExams.length ? { exams: imagingExams } : {}) }
                  : { examPart: '', examMethod: '', findings: '', impression: '', measurements: '' },
                hospital,
                reportDate,
                reportType,
                reportTypes,
                testPurpose,
                title,
                notes,
              },
              items,
              details,
            })}
            disabled={busy}
          >
            ← 返回上一步
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => onDone(false)}
          disabled={busy}
        >
          取消
        </button>
        {error && <span className="error-text">{error}</span>}
      </div>
    </div>
  );
}
