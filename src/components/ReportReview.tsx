import { useEffect, useRef, useState } from 'react';
import { db, now, uid } from '../db';
import {
  type AttachmentRecord,
  type Member,
  type Report,
  type ReportDetail,
  type ReportItem,
} from '../types';
import { emptyDraft, nonEmptyItemDrafts, type ItemDraft } from '../utils/labels';
import type { ReportScanMeta } from '../utils/ocrCandidate';
import {
  addCustomReportType,
  deleteCustomReportType,
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
  onBack?: () => void;
}) {
  const [memberId, setMemberId] = useState(editingReport?.memberId ?? initialMemberId);
  const [hospital, setHospital] = useState(
    editingReport?.hospital ?? initialReportMeta?.hospital ?? '',
  );
  const [reportDate, setReportDate] = useState(
    editingReport?.reportDate ?? initialReportMeta?.reportDate ?? todayISO(),
  );
  const [reportType, setReportType] = useState(
    editingReport?.reportType ?? initialReportMeta?.reportType ?? '',
  );
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
  const [detailsOpen, setDetailsOpen] = useState(editingReport ? false : true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // 用户自定义报告类型（持久化，识别/AI 不自动新增）
  const [customTypes, setCustomTypes] = useState<CustomReportType[]>([]);
  const [customTypesLoaded, setCustomTypesLoaded] = useState(false);
  // 未匹配检验目的的三种操作状态：pending（待选择）/ saved（已存为新类型）/ existing / skip
  const [purposeChoice, setPurposeChoice] = useState<'pending' | 'saved' | 'existing' | 'skip'>(
    'pending',
  );
  const [newTypeInput, setNewTypeInput] = useState('');
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
  useEffect(() => {
    if (!editingReport) return;
    const load = async () => {
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
      setAttachments(atts);
    };
    void load();
  }, [editingReport]);

  // 识别出的旧版自由文本报告类型保留展示，避免保存时静默丢失。
  const allTypes = mergeReportTypes(customTypes);
  const legacyType =
    customTypesLoaded && reportType && reportType !== '' && !allTypes.includes(reportType)
      ? reportType
      : '';

  // 检验目的未匹配任何报告类型（内置 + 自定义 + 已确认别名）时，提示“发现新的检验类别”并提供三选一。
  const purposeMatched =
    testPurpose.trim() !== '' ? matchTestPurposeToType(testPurpose, customTypes) : '';
  const showPurposePrompt =
    testPurpose.trim() !== '' && purposeMatched === '' && purposeChoice === 'pending';

  // 出现提示时默认以检验目的原文作为新类型名称（可编辑）
  useEffect(() => {
    if (showPurposePrompt) setNewTypeInput((v) => (v === '' ? testPurpose : v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPurposePrompt]);

  const handleSaveAsNewType = async () => {
    const name = newTypeInput.trim() !== '' ? newTypeInput : testPurpose;
    const v = validateCustomReportTypeName(name, allTypes);
    if (!v.ok) {
      setNewTypeError(v.error);
      return;
    }
    const rec = await addCustomReportType(v.normalized, testPurpose ? [testPurpose] : []);
    if (rec) {
      setCustomTypes((prev) => [...prev, rec]);
      setReportType(rec.name); // 确认新增后当前类型立即选中
      setNewTypeInput('');
      setNewTypeError('');
      setPurposeChoice('saved');
    } else {
      setNewTypeError('保存失败：名称为空、过长或已存在');
    }
  };

  const handleAddCustomType = async () => {
    const v = validateCustomReportTypeName(newTypeInput, allTypes);
    if (!v.ok) {
      setNewTypeError(v.error);
      return;
    }
    const rec = await addCustomReportType(v.normalized);
    if (rec) {
      setCustomTypes((prev) => [...prev, rec]);
      setNewTypeInput('');
      setNewTypeError('');
    } else {
      setNewTypeError('保存失败：名称为空、过长或已存在');
    }
  };

  const handleDeleteCustomType = async (id: string) => {
    await deleteCustomReportType(id);
    setCustomTypes((prev) => {
      const next = prev.filter((c) => c.id !== id);
      // 若当前报告类型正是被删除的自定义类型，则清空（回到未选择）
      setReportType((rt) => (rt !== '' && !mergeReportTypes(next).includes(rt) ? '' : rt));
      return next;
    });
  };

  const canSave = memberId !== '' && hospital.trim() !== '' && reportDate !== '';

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
        // 报告类型/检查类别：严格受控选项；检验目的无法匹配时保持为空。
        reportType: reportType.trim(),
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
            title="新增/编辑报告仅可从以下选项中选择；检验目的无法匹配时不自动填入"
          >
            <option value="">（不选择）</option>
            {legacyType && <option value={legacyType}>（保留原类型：{legacyType}）</option>}
            {allTypes.map((t) => (
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

      {showPurposePrompt && (
        <div className="purpose-suggestion" role="note">
          <p>
            发现新的检验类别「{testPurpose}」，未匹配任何报告类型（内置或「我的报告类型」）。 AI
            仅作建议，你可选择：<b>作为新的报告类型保存</b>、<b>手动选择已有类型</b>，或
            <b>暂不设置</b>。保存为新类型只是新增一个分类选项，不会把条目强行归类（例如不会把
            「血红蛋白」自动分成「血常规」）。
          </p>
          <div className="btn-row purpose-actions">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => void handleSaveAsNewType()}
            >
              作为新的报告类型保存
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setPurposeChoice('existing')}
            >
              手动选择已有类型
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setPurposeChoice('skip')}
            >
              暂不设置
            </button>
          </div>
          <label className="purpose-new-name">
            新类型名称：
            <input
              value={newTypeInput}
              onChange={(e) => setNewTypeInput(e.target.value)}
              placeholder={testPurpose.trim() || '自定义类型名称'}
            />
          </label>
          {newTypeError && <p className="error-text">{newTypeError}</p>}
          <p className="dim">
            名称会自动去掉空白；为空、过长（最多 20 字）或与已有类型重复时将无法保存。
            检验目的（testPurpose）仍作为独立字段保留并可编辑。
          </p>
        </div>
      )}

      <div className="custom-types-manage">
        <div className="att-head">
          <strong>我的报告类型（自定义）</strong>
          <small>内置类型不可删除；自定义类型可删除；可手动新增</small>
        </div>
        <div className="custom-types-add">
          <input
            value={newTypeInput}
            onChange={(e) => {
              setNewTypeInput(e.target.value);
              setNewTypeError('');
            }}
            placeholder="新增自定义报告类型名称"
          />
          <button type="button" className="btn btn-sm" onClick={() => void handleAddCustomType()}>
            添加
          </button>
        </div>
        {newTypeError && <p className="error-text">{newTypeError}</p>}
        {customTypes.length === 0 ? (
          <p className="dim">
            暂无自定义报告类型；可在上方“新增自定义报告类型名称”手动添加，或在检验目的匹配不到时
            选择「作为新的报告类型保存」。
          </p>
        ) : (
          <div className="att-row">
            {customTypes.map((c) => (
              <span key={c.id} className="att-chip-row">
                <span
                  className="att-chip"
                  title={c.aliases.length > 0 ? `已确认别名：${c.aliases.join('、')}` : c.name}
                >
                  {c.name}
                </span>
                <ConfirmButton
                  label="删除"
                  confirmText={`删除自定义报告类型「${c.name}」？`}
                  danger
                  small
                  onConfirm={() => void handleDeleteCustomType(c.id)}
                />
              </span>
            ))}
          </div>
        )}
      </div>

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

      {editingReport && (
        <div className="att-section">
          <div className="att-head">
            <strong>原始附件（图片 / PDF）</strong>
            <small>可移除或添加；仅保存到本机</small>
          </div>
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
        </div>
      )}

      <div className="item-editor">
        <div className="att-head">
          <strong>检查项目（{items.length}）</strong>
          <small>项目名保留报告原文，标准标签仅供显式填写，不做自动推断。</small>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setItems((l) => l.map((it) => ({ ...it, confirmed: true })))}
              disabled={items.length === 0}
            >
              全部标记已确认
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setItems((l) => [...l, emptyDraft()])}
            >
              + 添加项目
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="dim" style={{ padding: '8px 0' }}>
            尚无检查项目，可点击「+ 添加项目」手动录入，或返回上一步识别整张报告。
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
                      <input
                        value={it.standardLabel}
                        onChange={(e) => setItem(i, { standardLabel: e.target.value })}
                        placeholder="可选，如：TSH"
                        style={{ width: 120 }}
                        title="标准标签：仅由你显式填写，跨报告趋势按此标签 + 单位严格匹配"
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
                        className={`status-toggle ${it.confirmed ? 'st-ok' : 'st-warn'}`}
                        onClick={() => setItem(i, { confirmed: !it.confirmed })}
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

      <div className="review-note dim">
        {editingReport
          ? `保存时将更新 ${attachments.length} 个原始附件。`
          : attachments.length > 0
            ? `将保存 ${attachments.length} 个原始附件（含已编辑图片）。`
            : '本次未添加附件。'}
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
        {onBack && (
          <button type="button" className="btn btn-ghost" onClick={onBack} disabled={busy}>
            ← 返回修改附件
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
