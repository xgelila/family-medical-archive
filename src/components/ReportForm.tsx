import { useEffect, useRef, useState } from 'react';
import { db, now, uid } from '../db';
import {
  REPORT_TYPES,
  GLUCOSE_STANDARD_LABELS,
  THYROID_STANDARD_LABELS,
  type AttachmentRecord,
  type AttachmentKind,
  type Member,
  type Report,
  type ReportDetail,
  type ReportItem,
} from '../types';
import {
  emptyDraft,
  isGlucoseReportType,
  isThyroidReportType,
  nonEmptyItemDrafts,
  quickAddGlucoseDraft,
  quickAddThyroidDraft,
  type ItemDraft,
} from '../utils/labels';
import { Field, ConfirmButton } from './Kit';
import { todayISO } from '../utils/dates';
import { ocrCandidateToDraft, type ReportScanMeta } from '../utils/ocrCandidate';
import { ReportRecognitionPanel } from './ReportRecognitionPanel';

export function ReportForm({
  members,
  editingReport,
  initialMemberId,
  initialFiles,
  initialItems,
  initialDetails,
  initialReportMeta,
  onDone,
}: {
  members: Member[];
  editingReport: Report | null;
  initialMemberId: string;
  initialFiles?: File[];
  /** 新建向导前置步骤（如自动识别）产生的初始检查项目，仅新建报告时注入；编辑时忽略。 */
  initialItems?: ItemDraft[];
  /** 新建向导前置步骤（如自动识别）产生的初始附加元数据，仅新建报告时注入；编辑时忽略。 */
  initialDetails?: ReportDetail[];
  /** 新建向导前置步骤（如自动识别）产生的初始报告元数据（医院/日期/类型/标题/备注），
   *  仅新建报告时挂载注入一次，注入后用户仍可编辑。 */
  initialReportMeta?: ReportScanMeta;
  onDone: (saved: boolean) => void;
}) {
  const [memberId, setMemberId] = useState(editingReport?.memberId ?? initialMemberId);
  const [hospital, setHospital] = useState(editingReport?.hospital ?? '');
  const [reportDate, setReportDate] = useState(editingReport?.reportDate ?? todayISO());
  const [reportType, setReportType] = useState(editingReport?.reportType ?? '');
  const [testPurpose, setTestPurpose] = useState(editingReport?.testPurpose ?? '');
  const [title, setTitle] = useState(editingReport?.title ?? '');
  const [notes, setNotes] = useState(editingReport?.notes ?? '');
  const [details, setDetails] = useState<ReportDetail[]>(editingReport?.details ?? []);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [allConfirmed, setAllConfirmed] = useState(true);
  const [newAttachments, setNewAttachments] = useState<AttachmentRecord[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [showRecognition, setShowRecognition] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const recognitionRef = useRef<HTMLDivElement>(null);

  // 编辑既有报告时：若其报告类型为旧版自由文本（不在严格选项内），原值仍需保留展示，避免保存时静默丢失。
  const legacyType =
    editingReport && editingReport.reportType && editingReport.reportType !== ''
      ? (REPORT_TYPES as readonly string[]).includes(editingReport.reportType)
        ? ''
        : editingReport.reportType
      : '';

  // 加载既有条目与附件
  useEffect(() => {
    const load = async () => {
      if (!editingReport) return;
      const [its, atts] = await Promise.all([
        db.items.where('reportId').equals(editingReport.id).toArray(),
        db.attachments.where('reportId').equals(editingReport.id).toArray(),
      ]);
      setItems(
        [...its]
          .sort((a, b) => a.index - b.index)
          .map((it) => ({
            id: it.id,
            name: it.name,
            resultKind: it.resultKind,
            value: it.value,
            unit: it.unit,
            refRange: it.refRange,
            notes: it.notes,
            confirmed: it.confirmed,
            standardLabel: (it.standardLabel ?? '').trim(),
          })),
      );
      setNewAttachments(atts);
    };
    void load();
  }, [editingReport]);

  // 只要报告存在图片附件，「识别数据」面板默认自动展开（无图片时不展开）；仅在“从无图→有图”时触发一次，
  // 用户手动收起后不会被后续重复展开覆盖（编辑既有报告时附件异步加载也会触发一次）。
  const imageCount = newAttachments.filter((a) => a.kind === 'image').length;
  const prevImageCount = useRef(0);
  useEffect(() => {
    const prev = prevImageCount.current;
    prevImageCount.current = imageCount;
    if (prev === 0 && imageCount > 0) {
      setShowRecognition(true);
      requestAnimationFrame(() =>
        recognitionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
      );
    }
  }, [imageCount]);

  // 附件区主按钮：展开「识别数据」面板并触发/聚焦到选择图片流程；无图片时直接拉起文件选择器。
  const handleRecognitionButton = () => {
    const next = !showRecognition;
    setShowRecognition(next);
    if (!next) return;
    const hasImage = newAttachments.some((a) => a.kind === 'image');
    if (!hasImage) {
      requestAnimationFrame(() => fileRef.current?.click());
    } else {
      requestAnimationFrame(() =>
        recognitionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
      );
    }
  };

  const canSave = memberId && hospital.trim() !== '' && reportDate !== '';

  const addFile = async (file: File) => {
    const kind: AttachmentKind = file.type.startsWith('image/')
      ? 'image'
      : file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
        ? 'pdf'
        : 'other';
    const rec: AttachmentRecord = {
      id: uid(),
      reportId: editingReport?.id ?? '',
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      kind,
      blob: file,
      createdAt: now(),
    };
    setNewAttachments((list) => [...list, rec]);
    if (fileRef.current) fileRef.current.value = '';
  };

  // 从「新建入口」选择的文件在挂载时写入附件；图片会触发「识别数据」面板自动展开。
  const initialFilesHandled = useRef(false);
  useEffect(() => {
    if (initialFilesHandled.current) return;
    initialFilesHandled.current = true;
    if (!initialFiles || initialFiles.length === 0) return;
    for (const f of initialFiles) void addFile(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 新建向导前置步骤（自动识别）注入的初始报告元数据 / 项目 / 附加元数据：仅在「新建」且非编辑时写入一次。
  // 注入的识别条目恒为待确认；识别出的附加元数据默认展开以便核对。
  const initialItemsHandled = useRef(false);
  useEffect(() => {
    if (initialItemsHandled.current) return;
    initialItemsHandled.current = true;
    if (editingReport) return;
    // 整张报告识别出的报告信息候选：仅非空字段覆盖默认值（用户之后仍可改）
    if (initialReportMeta) {
      if (initialReportMeta.hospital) setHospital(initialReportMeta.hospital);
      if (initialReportMeta.reportDate) setReportDate(initialReportMeta.reportDate);
      if (initialReportMeta.reportType) setReportType(initialReportMeta.reportType);
      if (initialReportMeta.testPurpose) setTestPurpose(initialReportMeta.testPurpose);
      if (initialReportMeta.title) setTitle(initialReportMeta.title);
      if (initialReportMeta.notes) setNotes(initialReportMeta.notes);
    }
    if (initialItems && initialItems.length > 0) {
      setItems(initialItems);
      setAllConfirmed(initialItems.every((it) => it.confirmed));
    }
    if (initialDetails && initialDetails.length > 0) {
      setDetails(initialDetails);
      setDetailsOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setItem = (i: number, patch: Partial<ItemDraft>) =>
    setItems((list) => list.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const confirmAll = () => {
    setItems((list) => list.map((it) => ({ ...it, confirmed: true })));
    setAllConfirmed(true);
  };

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError('');
    try {
      const ts = now();
      const reportId = editingReport?.id ?? uid();
      const report: Report = {
        id: reportId,
        memberId,
        hospital: hospital.trim(),
        reportDate,
        reportType: reportType.trim(),
        testPurpose: testPurpose.trim(),
        title: title.trim(),
        notes: notes.trim(),
        details: details
          .filter((d) => d.value.trim() !== '')
          .map((d) => ({ label: d.label.trim() || '附加信息', value: d.value.trim() })),
        attachmentIds: newAttachments.map((a) => a.id),
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
          // 原始字段保持原值（含首尾/行内空格），绝不 trim 改写落库 raw；
          // trim 仅在 nonEmptyItemDrafts 中用于「空项目」判断。
          name: it.name, // 报告原文项目名
          resultKind: it.resultKind,
          value: it.value, // 原始录入文本
          unit: it.unit,
          refRange: it.refRange,
          notes: it.notes,
          confirmed: it.confirmed,
          // 标准标签为受控/显式字段：trim 做安全归一化（空串 = 未设置）
          standardLabel: (it.standardLabel ?? '').trim(),
          createdAt: ts,
          updatedAt: ts,
        }));
        if (clean.length > 0) await db.items.bulkAdd(clean);

        // 附件统一写入 reportId；清理被移除的旧附件
        const oldAtts = await db.attachments.where('reportId').equals(reportId).toArray();
        const keep = new Set(newAttachments.map((a) => a.id));
        for (const a of oldAtts) if (!keep.has(a.id)) await db.attachments.delete(a.id);
        for (const a of newAttachments) {
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
    <div className="card form-card report-form">
      <h4>
        {editingReport
          ? `编辑报告：${editingReport.reportDate} ${editingReport.hospital}`
          : '新建体检报告'}
      </h4>

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
        <Field label="报告类型 / 检查类别" hint="严格选项，不作自动分类">
          <select
            value={reportType}
            onChange={(e) => setReportType(e.target.value)}
            title="新增/编辑报告仅可从以下选项中选择；选择「甲状腺功能」将显示甲功常用项目快速添加候选"
          >
            <option value="">（不选择）</option>
            {legacyType && <option value={legacyType}>（保留原类型：{legacyType}）</option>}
            {REPORT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="检验目的">
          <input
            value={testPurpose}
            onChange={(e) => setTestPurpose(e.target.value)}
            placeholder="如：血常规检查"
          />
        </Field>
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

      <div className="details-section">
        <button type="button" className="details-toggle" onClick={() => setDetailsOpen((v) => !v)}>
          <span>报告详情（送检医生 / 检验者 / 审核者 / 采样日期等附加信息）</span>
          <span className="dim">
            {details.length > 0 ? `${details.length} 项` : '选填'} {detailsOpen ? '▴' : '▾'}
          </span>
        </button>
        {detailsOpen && (
          <div className="details-editor">
            {details.length === 0 && (
              <div className="dim">暂无附加信息；识别报告后会自动填入，也可手动添加。</div>
            )}
            {details.map((d, i) => (
              <div key={i} className="details-row">
                <input
                  className="details-label"
                  value={d.label}
                  placeholder="名称（如 送检医生）"
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

      <div className="att-section">
        <div className="att-head">
          <strong>原始附件（图片 / PDF）</strong>
          <small>仅保存到本机；点击可查看/打开</small>
        </div>
        <div className="att-row">
          {newAttachments.map((a) => (
            <AttachmentThumb
              key={a.id}
              att={a}
              onRemove={() => setNewAttachments((l) => l.filter((x) => x.id !== a.id))}
            />
          ))}
          {newAttachments.length === 0 && <span className="dim">尚未添加附件</span>}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.pdf"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            for (const f of files) void addFile(f);
            if (fileRef.current) fileRef.current.value = '';
          }}
        />
        <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
          + 添加图片/PDF 附件
        </button>
        <button
          type="button"
          className={`btn btn-sm ${showRecognition ? 'btn-primary' : ''}`}
          onClick={handleRecognitionButton}
          title="展开「识别数据」：选择一张报告图片，裁剪后自动读取并整理成检查项目（图片仅在本机处理）。有图片时面板自动选中第一张；无图片时直接打开图片选择。"
        >
          📷 识别数据{showRecognition ? '（收起）' : ''}
        </button>
      </div>

      <div ref={recognitionRef} className="recognition-section-host">
        {showRecognition && (
          <ReportRecognitionPanel
            attachments={newAttachments}
            memberSelected={memberId !== ''}
            initialReportMeta={{ hospital, reportDate, reportType, testPurpose, title, notes }}
            onImport={(cands) => {
              setItems((list) => [...list, ...cands.map(ocrCandidateToDraft)]);
              setAllConfirmed(false);
            }}
            onReportScan={
              editingReport
                ? undefined /* 已有报告内识别走原流程；整张报告识别仅用于新建报告 */
                : (scan) => {
                    // 新建报告：识别结果作为主来源，非空即覆盖默认值（用户之后仍可改）
                    if (scan.report.hospital) setHospital(scan.report.hospital);
                    if (scan.report.reportDate) setReportDate(scan.report.reportDate);
                    if (scan.report.reportType) setReportType(scan.report.reportType);
                    if (scan.report.testPurpose) setTestPurpose(scan.report.testPurpose);
                    if (scan.report.title) setTitle(scan.report.title);
                    if (scan.report.notes) setNotes(scan.report.notes);
                    if (scan.details.length > 0) {
                      setDetails(scan.details);
                      setDetailsOpen(true);
                    }
                    setItems((list) => [...list, ...scan.items.map(ocrCandidateToDraft)]);
                    setAllConfirmed(false);
                  }
            }
          />
        )}
      </div>

      <p className="recog-note" role="note">
        识别结果需人工核对后确认。
      </p>

      {/* 甲功常用项目快速添加：仅当报告类型精确为「甲状腺功能」时出现；可选、非强制 */}
      {isThyroidReportType(reportType) && (
        <div className="thyroid-quickadd" role="note">
          <div className="att-head" style={{ marginBottom: 4 }}>
            <strong>甲功常用项目快速添加（可选）</strong>
          </div>
          <p className="dim" style={{ margin: '0 0 8px' }}>
            仅提供以下 5
            个明确候选；不会预填数值、不要求补齐。其它医院项目请照常自行添加，保存后不会被丢弃。
          </p>
          <div className="quick-add-btns">
            {THYROID_STANDARD_LABELS.map((l) => {
              const already = items.some((it) => (it.standardLabel ?? '').trim() === l);
              return (
                <button
                  key={l}
                  type="button"
                  className="btn btn-sm"
                  disabled={already}
                  title={
                    already
                      ? `已存在标签「${l}」的项目`
                      : `添加「${l}」空项目（标签已显式设置，数值留空待填）`
                  }
                  onClick={() => {
                    setItems((list) => [...list, quickAddThyroidDraft(l)]);
                    setAllConfirmed(false);
                  }}
                >
                  {already ? `✓ ${l}` : `+ ${l}`}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 血糖常用项目快速添加：仅当报告类型精确为「血糖/糖化血红蛋白」时出现；
          只添加空白待确认条目且不设置标准标签（血糖不做自动标准化），不根据 OCR 文本自动触发 */}
      {isGlucoseReportType(reportType) && (
        <div className="thyroid-quickadd" role="note">
          <div className="att-head" style={{ marginBottom: 4 }}>
            <strong>血糖常用项目快速添加（可选）</strong>
          </div>
          <p className="dim" style={{ margin: '0 0 8px' }}>
            仅提供以下 5 个明确候选；按钮只添加<b>空白待确认条目且不设置标准标签</b>（血糖不做自动项
            目标准化），数值/单位/参考区间留空待填。绝不根据 OCR 文本自动触发添加。
          </p>
          <div className="quick-add-btns">
            {GLUCOSE_STANDARD_LABELS.map((l) => {
              const already = items.some((it) => it.name.trim() === l);
              return (
                <button
                  key={l}
                  type="button"
                  className="btn btn-sm"
                  disabled={already}
                  title={already ? `已存在同名列「${l}」的项目` : `添加「${l}」空白待确认项目`}
                  onClick={() => {
                    setItems((list) => [...list, quickAddGlucoseDraft(l)]);
                    setAllConfirmed(false);
                  }}
                >
                  {already ? `✓ ${l}` : `+ ${l}`}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="item-editor">
        <div className="att-head">
          <strong>检查项目（{items.length}）</strong>
          <small>
            新录入项目默认「待确认」；数值/定性结果按医院报告原文录入，不做换算。『项目名』保留报告原文；
            『标准标签』为可选字段，仅由你显式选择/填写（如
            TSH），不会依项目名自动推断，未设置标准标签的项目不参与跨报告趋势。每人逐项核对后标记「已确认」。
          </small>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {!allConfirmed && (
              <button type="button" className="btn btn-sm" onClick={confirmAll}>
                全部标记已确认
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => {
                setItems((l) => [...l, emptyDraft()]);
                setAllConfirmed(false);
              }}
            >
              + 添加项目
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="dim" style={{ padding: '8px 0' }}>
            尚无检查项目，点击「+
            添加项目」手动录入（项目名、数值/定性结果、单位、参考区间、可选标准标签、备注）。
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table item-edit-table">
              <thead>
                <tr>
                  <th className="col-name">项目名（报告原文）*</th>
                  <th className="col-value">数值 / 定性结果</th>
                  <th>单位</th>
                  <th>参考区间</th>
                  <th className="col-label">标准标签（可选）</th>
                  <th>备注</th>
                  <th className="col-status">状态</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className={it.confirmed ? '' : 'row-pending'}>
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
                      {isThyroidReportType(reportType) ? (
                        <StandardLabelCell
                          value={it.standardLabel}
                          onChange={(v) => setItem(i, { standardLabel: v })}
                        />
                      ) : (
                        <input
                          value={it.standardLabel}
                          onChange={(e) => setItem(i, { standardLabel: e.target.value })}
                          placeholder="可选，如：身高"
                          style={{ width: 120 }}
                          title="标准标签：仅由你显式填写，跨报告趋势按此标签 + 单位严格匹配"
                        />
                      )}
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
                        className={`status-toggle ${it.confirmed ? 'st-ok' : 'st-warn'}`}
                        onClick={() => {
                          setItem(i, { confirmed: !it.confirmed });
                          setAllConfirmed(false);
                        }}
                      >
                        {it.confirmed ? '✓ 已确认' : '！待确认'}
                      </button>
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
        )}
      </div>

      <div className="form-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canSave || busy}
          onClick={() => void save()}
        >
          {busy ? '保存中…' : '保存报告'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => onDone(false)}>
          取消
        </button>
        {error && <span className="error-text">{error}</span>}
      </div>
    </div>
  );
}

/**
 * 标准标签单元格（仅「甲状腺功能」报告类型使用）：
 * 提供明确、精确的 5 个甲功候选（TSH/FT3/FT4/TPOAb/TgAb）。标签只能由用户显式选择/填写；
 * 选择「自定义…」后进入自由文本输入，保存时原样保留。不做任何自动映射或猜测。
 */
function StandardLabelCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [custom, setCustom] = useState(
    value.trim() !== '' && !(THYROID_STANDARD_LABELS as readonly string[]).includes(value.trim()),
  );
  if (custom) {
    return (
      <div className="std-label-custom">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="自定义标准标签"
          style={{ width: 110 }}
        />
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          title="返回候选列表"
          onClick={() => {
            setCustom(false);
            onChange('');
          }}
        >
          ✖
        </button>
      </div>
    );
  }
  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '__custom__') setCustom(true);
        else onChange(v);
      }}
      title="标准标签：仅限以上明确候选或自定义；未设置则不参与跨报告趋势"
    >
      <option value="">（不设置）</option>
      {THYROID_STANDARD_LABELS.map((l) => (
        <option key={l} value={l}>
          {l}
        </option>
      ))}
      <option value="__custom__">✍️ 自定义…</option>
    </select>
  );
}

function AttachmentThumb({ att, onRemove }: { att: AttachmentRecord; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(att.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [att]);

  const open = () => {
    if (url) window.open(url, '_blank');
  };

  if (att.kind === 'image') {
    return (
      <div className="att-thumb">
        {url && <img src={url} alt={att.name} onClick={open} />}
        <div className="att-thumb-meta">
          <span>{att.name}</span>
          <ConfirmButton
            label="移除"
            confirmText={`移除附件「${att.name}」`}
            danger
            small
            onConfirm={onRemove}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="att-chip-row">
      <button type="button" className="att-chip" onClick={open}>
        📄 {att.name}
      </button>
      <ConfirmButton
        label="移除"
        confirmText={`移除附件「${att.name}」`}
        danger
        small
        onConfirm={onRemove}
      />
    </div>
  );
}
