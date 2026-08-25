import { useMemo, useRef, useState } from 'react';
import type { AttachmentRecord, Member, ReportDetail } from '../types';
import { now, uid } from '../db';
import { ageByBirthDate } from '../utils/dates';
import type { ItemDraft } from '../utils/labels';
import { ocrCandidateToDraft, type ReportScanMeta } from '../utils/ocrCandidate';
import { ReportRecognitionPanel } from './ReportRecognitionPanel';
import { ScanSourceSheet } from './ScanSourceSheet';
import { ReportReview } from './ReportReview';

/**
 * 移动端友好的「新建报告」分步向导。
 *
 * 信息架构（本次重构：移除带序号圆圈的旧四步导航）：
 * - 自动识别是**扫描后的后台任务**，不是独立用户步骤，因此不再作为独立带圈步骤；
 * - 顶部只显示**轻量当前步骤文字**（第 x/3 步 · 步骤名），不做数字圆圈全步骤导航；
 * - 流程为：1 选成员 → 2 扫描报告/手动录入（扫描编辑完成后，如有图片自动进入识别；
 *   手动则直接进入核对）→ 3 识别/核对并保存。
 *
 * 步骤 2（添加报告）内有两个子界面：
 * - 来源选择：一个「扫描报告」主按钮（弹出 bottom-sheet：拍摄/相册）+ 「手动录入」；
 * - 识别子界面：有图片且非手动时自动进入，**「识别整张报告」为唯一醒目主 CTA**；
 *   识别成功（autoReportScan）时保留结果并留在识别页，由用户点击下一步进入核对页。
 *
 * 步骤 3：ReportReview 核对并保存；仅提供「返回上一步」与「保存」；
 * 返回直接恢复进入核对前的识别摘要与完整草稿。
 *
 * 设计边界：
 * - 不挂载旧版识别面板之外的旧 ReportForm，不重新挂载旧识别面板；
 * - 识别结果恒为待确认候选，不自动设置标准标签、不进入趋势；
 * - 编辑后的图片才进入识别/附件（通过 File 包装编辑结果 Blob）；
 * - 识别进行中禁用返回/取消/冲突操作。
 */

type Step = 1 | 2 | 3;
type AddPhase = 'source' | 'recognition';

/** File[] → 附件记录（reportId 先置空，保存时才写入） */
function filesToAttachments(files: File[]): AttachmentRecord[] {
  const t = now();
  return files.map((file) => ({
    id: uid(),
    reportId: '',
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
}

export function NewReportWizard({
  members,
  onCancel,
  onDone,
  onGoToMembers,
}: {
  members: Member[];
  onCancel: () => void;
  onDone: (saved: boolean) => void;
  /** 无成员时「去成员页添加」入口：跳转到「成员」页并关闭向导。 */
  onGoToMembers?: () => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [addPhase, setAddPhase] = useState<AddPhase>('source');
  const [memberId, setMemberId] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  // 自动识别产生的候选（识别成功即注入 ReportReview，仍为待确认）
  const [recognizedItems, setRecognizedItems] = useState<ItemDraft[]>([]);
  const [recognizedDetails, setRecognizedDetails] = useState<ReportDetail[]>([]);
  const [recognizedReportMeta, setRecognizedReportMeta] = useState<ReportScanMeta | null>(null);
  const [error, setError] = useState('');

  // 来源选择浮层
  const [sheetOpen, setSheetOpen] = useState(false);

  // 识别阶段（用于识别进行中禁用冲突操作）
  const [recogPhase, setRecogPhase] = useState<
    'idle' | 'reading' | 'structuring' | 'done' | 'error'
  >('idle');

  // 「＋ 添加附件」开始时是否已存在附件：用于区分首次添加与追加，取消时只清首次添加。
  const hadExistingRef = useRef(false);

  const captureRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const images = useMemo(() => attachments.filter((a) => a.kind === 'image'), [attachments]);
  const recognitionBusy = recogPhase === 'reading' || recogPhase === 'structuring';

  /** 附件实际变更时清除旧识别结果并要求重新识别（新增/替换/删除/重新编辑/切手动）。 */
  const clearRecognition = () => {
    setRecognizedItems([]);
    setRecognizedDetails([]);
    setRecognizedReportMeta(null);
    setRecogPhase('idle');
  };

  const stepLabel =
    step === 1
      ? '选成员'
      : step === 2
        ? addPhase === 'recognition'
          ? '识别报告'
          : '添加报告'
        : '核对并保存';

  /** 收集文件后的最终落地：把文件直接转为附件。有图片则进入识别子界面，否则直接进核对。
   *  注意：这里是「追加」语义——保留已有附件，仅把本次新选的文件 append 到末尾；
   *  附件实际变更后清除旧识别结果并要求重新识别。 */
  const finishScan = (files: File[]) => {
    // 追加而非覆盖：保留已选附件，仅新增本次选择
    setAttachments((prev) => [...prev, ...filesToAttachments(files)]);
    const hasImg = files.some((f) => f.type.startsWith('image/'));
    setStep(2);
    if (hasImg) {
      setAddPhase('recognition'); // 自动进入识别
    } else {
      setStep(3); // 仅 PDF / 无图片 → 直接核对
    }
    // 附件实际变更：新增附件 → 清除旧识别结果并要求重新识别
    clearRecognition();
  };

  /** 文件选择回调：把选中的 File 直接转换为附件记录，不再经过图片编辑。
   *  注意：这里不清除识别结果——清空推迟到附件真正变更的 finishScan / deleteAttachment；
   *  若用户随后取消本次选择，旧附件与识别结果保持不变。 */
  const addFiles = (list: File[] | null) => {
    if (!list || list.length === 0) return;
    setError('');
    setManualMode(false);
    hadExistingRef.current = attachments.length > 0;
    setAddPhase('source');
    finishScan(list);
  };

  /**
   * 第三步返回第二步：恢复进入核对前的识别摘要与完整草稿。
   * 这里不能重新识别，也不能清理任何候选；附件没有变化，识别结果就必须原样保留。
   */
  const backToRecognition = (draft?: {
    memberId: string;
    reportMeta: ReportScanMeta;
    items: ItemDraft[];
    details: ReportDetail[];
  }) => {
    if (recognitionBusy) return;
    if (draft) {
      setMemberId(draft.memberId);
      setRecognizedReportMeta(draft.reportMeta);
      setRecognizedItems(draft.items);
      setRecognizedDetails(draft.details);
    }
    setStep(2);
    setAddPhase('recognition');
  };

  /** 第二步返回第一步：按现有流程清理识别结果；第三步返回第二步不走这里。 */
  const backToMember = () => {
    if (recognitionBusy) return;
    clearRecognition();
    setStep(1);
  };

  /** 删除某张附件（附件变更 → 清除旧识别结果并要求重新识别）。 */
  const deleteAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    clearRecognition();
  };

  const chooseManual = () => {
    setError('');
    setAttachments([]);
    setManualMode(true);
    setRecognizedItems([]);
    setRecognizedDetails([]);
    setRecognizedReportMeta(null);
    setRecogPhase('idle');
    setStep(3); // 手动直接进入核对
  };

  /** 识别成功（自动回调）：把结果带入核对页，不要求额外点击。
   * 使用函数式合并避免识别面板按钮与自动回调的旧 state updater 互相覆盖，
   * 并按完整项目字段去重，避免「使用已选项目继续」重复添加。 */
  const onReportScan = (scan: {
    report: ReportScanMeta;
    details: ReportDetail[];
    items: import('../utils/ocrCandidate').OcrCandidate[];
  }) => {
    const incoming = scan.items.map(ocrCandidateToDraft);
    setRecognizedItems((prev) => {
      const seen = new Set(prev.map((item) => JSON.stringify(item)));
      return [...prev, ...incoming.filter((item) => {
        const key = JSON.stringify(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })];
    });
    setRecognizedDetails((prev) => {
      const seen = new Set(prev.map((detail) => JSON.stringify(detail)));
      return [...prev, ...scan.details.filter((detail) => {
        const key = JSON.stringify(detail);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })];
    });
    setRecognizedReportMeta(scan.report);
    setError('');
    setRecogPhase('done');
    // 识别完成页的 CTA 明确确认后才进入核对页；这里必须推进向导步骤，
    // 否则父 state 虽已收到结果，界面仍停留在识别页，点击看起来没有反应。
    setStep(3);
  };

  return (
    <div className="card wizard-card">
      <div className="wizard-progress-text" role="status" aria-label="新建报告进度">
        第 {step}/3 步 · {stepLabel}
      </div>

      {step === 1 && (
        <section className="wizard-pane" aria-label="步骤1：选择成员">
          <h3>选择报告归属的成员</h3>
          {members.length === 0 ? (
            <div className="wizard-empty" role="alert">
              <p>还没有家庭成员，请先在「成员」页添加后再新建报告。</p>
              {onGoToMembers && (
                <button type="button" className="btn btn-primary" onClick={onGoToMembers}>
                  ＋ 去「成员」页添加
                </button>
              )}
              <p className="dim">添加成员后即可返回此处为其新建报告。</p>
            </div>
          ) : (
            <>
              <p className="dim">请选择本份体检报告的成员；自动识别需要先选定成员。</p>
              <div className="member-pick-grid">
                {members.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`member-pick ${memberId === m.id ? 'selected' : ''}`}
                    onClick={() => setMemberId(m.id)}
                    aria-pressed={memberId === m.id}
                  >
                    <span className="member-avatar">{m.name.slice(0, 1)}</span>
                    <span className="member-pick-body">
                      <span className="member-pick-name">{m.name}</span>
                      <span className="member-pick-meta">
                        {[m.relation, m.gender].filter(Boolean).join(' · ') || '—'}
                        {m.birthDate ? ` · ${ageByBirthDate(m.birthDate) ?? '?'}岁` : ''}
                      </span>
                    </span>
                    {memberId === m.id && <span className="member-pick-check">✓</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {step === 2 && addPhase === 'source' && (
        <section className="wizard-pane" aria-label="步骤2：扫描或手动录入">
          <h3>拍摄 / 选择报告，或手动录入</h3>
          <p className="dim">
            点击「扫描报告」选择拍摄或相册；选图后直接作为附件，自动进入识别。「手动录入」则跳过识别，直接填写。
          </p>
          <div className="entry-actions wizard-capture">
            <button
              type="button"
              className="entry-primary entry-primary-main"
              onClick={() => setSheetOpen(true)}
            >
              <span className="entry-icon">📷</span>
              <span className="entry-text">
                <strong>扫描报告</strong>
                <small>拍摄或从相册选择报告图片 / PDF</small>
              </span>
              <span className="entry-chevron" aria-hidden="true">
                ›
              </span>
            </button>
            <button type="button" className="entry-secondary" onClick={chooseManual}>
              <span className="entry-icon">⌨️</span>
              <span className="entry-text">
                <strong>手动录入</strong>
                <small>不拍照，直接填写（跳过识别）</small>
              </span>
            </button>
          </div>

          <input
            ref={captureRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              addFiles(e.target.files ? Array.from(e.target.files) : null);
              e.target.value = '';
            }}
          />
          <input
            ref={galleryRef}
            type="file"
            accept="image/*,.pdf"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files ? Array.from(e.target.files) : null);
              e.target.value = '';
            }}
          />

          {sheetOpen && (
            <ScanSourceSheet
              onCamera={() => {
                setSheetOpen(false);
                captureRef.current?.click();
              }}
              onGallery={() => {
                setSheetOpen(false);
                galleryRef.current?.click();
              }}
              onClose={() => setSheetOpen(false)}
            />
          )}

          {/* 附件管理：从第二步来源页展示已选附件，支持删除 / 添加 / 切手动 */}
          {attachments.length > 0 && (
            <div className="att-manage">
              <div className="att-head">
                <strong>已选附件（{attachments.length}）</strong>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => galleryRef.current?.click()}
                >
                  ＋ 添加附件
                </button>
              </div>
              <ul className="att-manage-list">
                {attachments.map((a) => (
                  <li key={a.id} className="att-manage-item">
                    <span className="att-manage-name" title={a.name}>
                      {a.kind === 'image' ? '🖼️' : a.kind === 'pdf' ? '📄' : '📎'} {a.name}
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => deleteAttachment(a.id)}
                    >
                      删除
                    </button>
                  </li>
                ))}
              </ul>
              <p className="dim">
                只有新增 / 替换 / 删除附件或切手动录入才会清除已识别结果；未改附件则保留识别结果。
              </p>
              {images.length > 0 && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setAddPhase('recognition')}
                >
                  → 继续识别整张报告
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {step === 2 && addPhase === 'recognition' && (
        <section className="wizard-pane" aria-label="步骤2b：自动识别">
          <h3>识别整张报告</h3>
          <p className="dim">
            已选择 {attachments.length} 个附件（含 {images.length} 张图片）。当前链路只识别所选图片，不会合并多张图片；结果全部为
            <b>待确认候选</b>，不会自动写入标准标签或进入趋势。
          </p>
          {manualMode ? (
            <div className="wizard-summary">
              <p className="dim">当前为「手动录入」模式，已跳过自动识别。</p>
              <p>将直接进入核对页面，手动填写报告信息与检查项目。</p>
            </div>
          ) : (
            <ReportRecognitionPanel
              attachments={attachments}
              memberSelected={memberId !== ''}
              reportModeOnly
              autoReportScan
              // 把向导父 state 的既有识别结果传入面板：返回识别页时无需重新识别即可查看
              initialItems={recognizedItems}
              initialDetails={recognizedDetails}
              initialReportMeta={recognizedReportMeta ?? undefined}
              onPhaseChange={setRecogPhase}
              onImport={() => {
                /* 整张报告路线隐藏了「仅识别检查项目」入口，逐项导入不可达 */
              }}
              onReportScan={onReportScan}
            />
          )}
        </section>
      )}

      {/* 非核对页导航：返回 / 取消（识别进行中禁用） */}
      {step !== 3 && (
        <div className="wizard-nav">
          <div className="wizard-nav-left">
            {step === 1 ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onCancel}
                disabled={recognitionBusy}
              >
                取消
              </button>
            ) : step === 2 && addPhase === 'source' ? (
              <button type="button" className="btn btn-ghost" onClick={backToMember}>
                ← 返回上一步
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => backToRecognition()}
                disabled={recognitionBusy}
              >
                ← 返回上一步
              </button>
            )}
          </div>
          <div className="wizard-nav-right">
            {error && (
              <span className="wizard-error" role="alert">
                {error}
              </span>
            )}
            {step === 1 && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!memberId}
                onClick={() => setStep(2)}
              >
                下一步 →
              </button>
            )}
            {step === 2 && addPhase === 'recognition' && !manualMode && recognitionBusy && (
              <span className="wizard-busy dim">识别进行中…</span>
            )}
          </div>
        </div>
      )}

      {/* 取消（向导任意非保存步骤均可退出；识别进行中禁用） */}
      {step !== 3 && (
        <div className="wizard-cancel">
          <button
            type="button"
            className="entry-cancel"
            onClick={onCancel}
            disabled={recognitionBusy}
          >
            取消新建
          </button>
        </div>
      )}

      {step === 3 && (
        <ReportReview
          members={members}
          initialMemberId={memberId}
          initialReportMeta={recognizedReportMeta ?? undefined}
          initialItems={recognizedItems}
          initialDetails={recognizedDetails}
          attachments={attachments}
          onBack={backToRecognition}
          onDone={onDone}
        />
      )}
    </div>
  );
}
