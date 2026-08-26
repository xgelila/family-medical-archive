import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 新建报告向导信息架构重构（源级校验，不是行为测试）。
 *
 * 覆盖本轮需求 C/E：
 * - 不再显示带序号圆圈的旧四步导航，改用轻量当前步骤文字（第 x/3 步 · 步骤名）；
 * - 流程：1 选成员（无成员仍有成员页入口）→ 2 扫描/手动（有图自动进识别）→ 3 核对保存；
 * - 图片编辑器（ImageCropModal / tui-image-editor）已移除：选图后原图直接进入附件预览与识别，
 *   不再有逐张编辑、编辑队列或全屏编辑浮窗；
 * - 识别页「识别整张报告」为唯一醒目主 CTA（reportModeOnly + autoReportScan），不挂任何编辑器；
 * - 识别成功（autoReportScan）自动带结果进入核对页，无「确认识别/下一步」二次确认；
 * - 识别失败重试、识别进行中禁用返回/取消/冲突操作；
 * - 核对页仅提供返回上一步与保存，返回恢复完整识别摘要与草稿。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, 'src', p), 'utf-8');

const wizard = read('components/NewReportWizard.tsx');
const sheet = read('components/ScanSourceSheet.tsx');
const review = read('components/ReportReview.tsx');
const panel = read('components/ReportRecognitionPanel.tsx');
const styles = readFileSync(join(root, 'src', 'styles.css'), 'utf-8');

// 识别面板主按钮在识别进行中（reading/structuring）必须禁用，避免并发 run()
describe('ReportRecognitionPanel：识别进行中禁用主按钮', () => {
  it('「🧾 识别整张报告」主按钮在 busy（reading/structuring）时也禁用', () => {
    expect(panel).toContain('识别整张报告');
    expect(panel).toContain('disabled={!memberSelected || busy}');
    expect(panel).toContain("const busy = phase === 'reading' || phase === 'structuring';");
  });

  it('「仅识别检查项目」按钮在 busy 时同样禁用', () => {
    expect(panel).toContain('仅识别检查项目');
    expect(panel).toContain('disabled={busy}');
  });
});

describe('新建报告向导：轻量当前步骤文字，不显示带序号圆圈的全步骤导航', () => {
  it('用「第 x/3 步 · 步骤名」轻量指示，不再渲染带数字圆圈的旧四步栏', () => {
    expect(wizard).toContain('第 {step}/3 步');
    expect(wizard).toContain('wizard-progress-text');
    // 旧四步导航（带圆圈 step-dot / 全步骤数组）已移除
    expect(wizard).not.toContain('wizard-step-dot');
    expect(wizard).not.toContain('const STEPS');
    expect(wizard).not.toContain('wizardStep3Nav');
  });

  it('步骤标签覆盖：选成员 / 添加报告 / 识别报告 / 核对并保存', () => {
    expect(wizard).toContain('选成员');
    expect(wizard).toContain('添加报告');
    expect(wizard).toContain('识别报告');
    expect(wizard).toContain('核对并保存');
  });
});

describe('新建报告向导：无成员提示与创建成员入口', () => {
  it('成员为空时显示明确提示，并提供去「成员」页添加的入口（不卡死）', () => {
    expect(wizard).toContain('还没有家庭成员，请先在「成员」页添加后再新建报告');
    expect(wizard).toContain('onGoToMembers');
    expect(wizard).toContain('去「成员」页添加');
  });
});

describe('新建报告向导：合并为「扫描报告」主按钮 + 来源 bottom-sheet', () => {
  it('提供「扫描报告」主按钮，点击弹出来源浮层（拍摄报告 / 从相册选择）', () => {
    expect(wizard).toContain('扫描报告');
    expect(wizard).toContain('ScanSourceSheet');
    expect(sheet).toContain('拍摄报告');
    expect(sheet).toContain('从相册选择');
    expect(sheet).toContain('onCamera');
    expect(sheet).toContain('onGallery');
  });

  it('复用既有 file input / 相机能力（capture），保持移动端', () => {
    expect(wizard).toContain('capture="environment"');
    expect(wizard).toContain('accept="image/*"');
    expect(wizard).toContain('accept="image/*,.pdf"');
  });
});

describe('新建报告向导：选图后原图直接进入附件预览与识别（无图片编辑器）', () => {
  it('选图后不再打开图片编辑浮窗，原图直接转为附件（filesToAttachments），有图自动进识别', () => {
    // 不再有 ImageCropModal / 编辑队列 / 逐张编辑
    expect(wizard).not.toContain('ImageCropModal');
    expect(wizard).not.toContain('editQueue');
    expect(wizard).not.toContain('继续编辑下一张');
    expect(wizard).not.toContain('currentEditFile');
    expect(wizard).not.toContain('onEditConfirm');
    expect(wizard).not.toContain('openCrop');
    expect(wizard).not.toContain('setCropOpen');
    // 选中的文件直接落地为附件并自动进入识别
    expect(wizard).toContain('filesToAttachments(files)');
    expect(wizard).toContain('选图后直接作为附件，自动进入识别');
    expect(wizard).toContain("setAddPhase('recognition')");
    expect(wizard).toContain('自动进入识别');
  });

  it('识别 CTA 不挂编辑器：识别整张报告直接对已选附件 Blob 调 run，而非打开裁剪浮窗', () => {
    // 识别主按钮调用 runOnSelected('report')，面板内不再渲染任何 ImageCropModal / 裁剪浮窗
    expect(panel).toContain("runOnSelected('report')");
    expect(panel).toContain('识别整张报告');
    expect(panel).not.toContain('ImageCropModal');
    expect(panel).not.toContain('openCrop');
    expect(panel).not.toContain('setCropOpen');
  });

  it('识别阶段不再提供「跳过识别」竞争操作（唯一主 CTA），仅保留返回/取消低干扰操作', () => {
    expect(wizard).not.toContain('skipRecognition');
    expect(wizard).not.toContain('onClick={skipRecognition}');
    // 识别页主 CTA 为全宽居中（唯一主操作）
    expect(panel).toContain('recog-main-cta');
  });
});

describe('返回上一步：附件修改与识别草稿恢复边界', () => {
  it('第三步「返回上一步」回到识别摘要页（backToRecognition → addPhase recognition），而非重新识别', () => {
    expect(wizard).toContain('const backToRecognition = (draft?: {');
    expect(wizard).toContain("setAddPhase('recognition')");
    expect(wizard).toContain('onBack={backToRecognition}');
    expect(wizard).toContain('initialReportMeta={recognizedReportMeta ?? undefined}');
    expect(wizard).toContain('initialItems={recognizedItems}');
    expect(wizard).toContain('initialDetails={recognizedDetails}');
  });

  it('附件管理页显示已选附件并支持删除 / 添加 / 切手动', () => {
    expect(wizard).toContain('已选附件');
    expect(wizard).toContain('deleteAttachment');
    expect(wizard).toContain('添加附件');
  });

  it('只有附件实际变更（新增/替换/删除/切手动）才清除旧识别结果，未改附件保留识别结果', () => {
    expect(wizard).toContain('const clearRecognition = () => {');
    expect(wizard).toContain('只有新增 / 替换 / 删除附件或切手动录入才会清除已识别结果');
    expect(wizard).toContain('未改附件则保留识别结果');
  });

  it('「添加附件」append 新附件而保留已有附件（不再覆盖旧附件）', () => {
    expect(wizard).toContain('setAttachments((prev) => [...prev, ...filesToAttachments(files)])');
    expect(wizard).toContain('// 追加而非覆盖：保留已选附件，仅新增本次选择');
    expect(wizard).not.toContain('setAttachments(filesToAttachments(list));');
  });

  it('取消不变更不清空：追加到已有附件时取消保留旧附件与识别结果', () => {
    expect(wizard).toContain('hadExistingRef.current = attachments.length > 0');
    // addFiles 不再立即清空识别结果（推迟到 finishScan / 删除）
    expect(wizard).not.toContain('替换附件来源：清空上一份报告的识别候选');
  });

  it('多图选择直接统一转附件并自动进识别（不再逐张编辑队列）', () => {
    expect(wizard).not.toContain('editQueue');
    expect(wizard).not.toContain('nextIndex < editQueue.length');
    expect(wizard).not.toContain('const editedFile = new File([img.blob], img.name');
    expect(wizard).toContain('filesToAttachments(files)');
    expect(wizard).toContain("setAddPhase('recognition')");
  });
});

describe('新建报告向导：识别 CTA 唯一醒目 + 成功后停留识别页', () => {
  it('识别子界面以「识别整张报告」为唯一主 CTA（reportModeOnly），隐藏「仅识别检查项目」', () => {
    expect(wizard).toContain('reportModeOnly');
    // 识别完成后停留识别页；「进入核对并保存」由向导统一底部操作栏提供（见下方专用用例）
    expect(panel).toContain('识别整张报告');
  });

  it('ReportRecognitionPanel 提供用户确认 CTA（autoReportScan），成功时才 onReportScan', () => {
    expect(panel).toContain('autoReportScan = false');
    expect(panel).toContain('autoReportScan?: boolean');
    expect(panel).toContain("phase === 'done'");
    expect(panel).toContain('const enterReview');
  });

  it('向导把 onReportScan 与 autoReportScan 传给面板，识别成功后 CTA 推进到核对页', () => {
    expect(wizard).toContain('autoReportScan');
    expect(wizard).toContain('onReportScan={onReportScan}');
    expect(wizard).toContain("setRecogPhase('done')");
    // CTA 调用 onReportScan 后必须推进父向导，否则按钮点击无可见效果。
    expect(wizard).toContain('setStep(3);\n  };');
    expect(wizard).toContain('进入核对并保存');
    expect(wizard).not.toContain('创建报告并添加已选项目');
  });

  it('整张报告仅保留自动完成与下一步草稿传递，不显示合并项目 CTA', () => {
    expect(panel).not.toContain('使用已选项目继续');
    expect(panel).not.toContain('创建报告并添加已选项目');
    expect(wizard).toContain('initialItems={recognizedItems}');
    expect(review).toContain('useState<ItemDraft[]>(editingReport ? [] : (initialItems ?? []))');
  });

  it('合并已选项目按完整草稿去重，未选项目不会由按钮额外注入', () => {
    expect(wizard).toContain('setRecognizedItems((prev) => {');
    expect(wizard).toContain('incoming.filter((item) => {');
    expect(wizard).toContain('const seen = new Set(prev.map((item) => JSON.stringify(item)))');
    expect(panel).toContain('items: rows.map(rowToCandidate),');
  });

  it('影像报告不显示检验项目 CTA，扫描结果仍保留 exams', () => {
    expect(panel).toContain("reportMeta.reportKind === 'lab'");
    expect(panel).toContain("mode !== 'report' ? (");
    expect(panel).toContain('...(reportMeta.exams ? { exams: reportMeta.exams } : {}),');
  });

  it('识别失败保留重试主 CTA 与清晰错误；识别进行中禁用返回/取消/跳过', () => {
    // 面板保留「重试」；自动识别路线（autoReportScan）不再提供「重新裁剪」
    expect(panel).toContain('重试');
    // 向导在识别进行中禁用返回/取消/跳过
    expect(wizard).toContain('recognitionBusy');
    expect(wizard).toContain('disabled={recognitionBusy}');
    expect(wizard).toContain(
      "const recognitionBusy = recogPhase === 'reading' || recogPhase === 'structuring';",
    );
  });
});

describe('新建报告向导：第 3 步重新设计的「核对并保存」页（不挂载旧识别面板、识别结果保留）', () => {
  it('第 3 步渲染 ReportReview 而非旧 ReportForm（不再挂载旧识别面板）', () => {
    expect(wizard).toContain("import { ReportReview } from './ReportReview'");
    expect(wizard).toContain('<ReportReview');
    expect(wizard).not.toContain("from './ReportForm'");
  });

  it('ReportReview 直接展示并编辑识别出的字段/项目/详情，且不引入旧识别面板', () => {
    expect(review).toContain('核对并保存');
    expect(review).toContain('initialItems');
    expect(review).toContain('initialDetails');
    expect(review).toContain('initialReportMeta');
    expect(review).toContain('attachments');
    expect(review).not.toContain("from './ReportRecognitionPanel'");
    expect(review).not.toContain('<ReportRecognitionPanel');
  });

  it('核对页提供「返回上一步」；返回识别摘要页且已识别结果不丢失', () => {
    expect(wizard).toContain('onBack={backToRecognition}');
    expect(review).toContain('返回上一步');
    expect(wizard).toContain('setRecognizedItems(draft.items)');
    expect(wizard).toContain('setRecognizedDetails(draft.details)');
    expect(wizard).toContain('setRecognizedReportMeta(draft.reportMeta)');
    expect(wizard).toContain('未改附件则保留识别结果');
  });
});

describe('新建报告向导：返回识别页保留既有识别结果（受控数据流）', () => {
  it('向导把父 state 的既有识别结果作为 initial/controlled 传入识别面板，返回时不要求重新识别', () => {
    expect(wizard).toContain('initialItems={recognizedItems}');
    expect(wizard).toContain('initialDetails={recognizedDetails}');
    expect(wizard).toContain('initialReportMeta={recognizedReportMeta ?? undefined}');
  });

  it('面板从 initialItems/initialReportMeta/initialDetails 初始化 rows/reportMeta/scanExtras', () => {
    expect(panel).toContain('(initialItems ?? []).map(draftToRow)');
    expect(panel).toContain("initialReportMeta?.hospital ?? ''");
    expect(panel).toContain('detailsToExtraFields(initialDetails ?? [])');
  });

  it('既有候选在非 done 阶段也可查看（showResults 不要求重新识别才能看到）', () => {
    expect(panel).toContain(
      "phase === 'done' || rows.length > 0 || hasSeededMeta || hasExtrasContent",
    );
  });

  it('新识别从空开始，识别出的新结果覆盖旧候选（不保留旧 reportMeta）', () => {
    expect(panel).toContain('// 新识别一律从空开始，识别出的新结果覆盖旧候选');
  });

  it('附件实际变更时才清理旧识别结果（finishScan/删除 调用 clearRecognition，addFiles 不清）', () => {
    // 清空集中在 clearRecognition（在附件真正变更的 finishScan/删除时调用）
    expect(wizard).toContain('const clearRecognition = () => {');
    expect(wizard).toContain('setRecognizedItems([])');
    expect(wizard).toContain('setRecognizedDetails([])');
    expect(wizard).toContain('setRecognizedReportMeta(null)');
    // finishScan（新增附件落地）会清除旧识别结果并要求重新识别
    expect(wizard).toContain('// 附件实际变更：新增附件 → 清除旧识别结果并要求重新识别');
    expect(wizard).toContain('clearRecognition();');
    // addFiles 不再立即清空：取消不变更则保留旧附件与识别结果
    expect(wizard).not.toContain('替换附件来源：清空上一份报告的识别候选');
  });
});

describe('步骤2识别完成：统一底部操作栏（返回左、进入核对并保存右；无返回时主CTA右对齐）', () => {
  it('返回上一步与进入核对并保存位于同一底部操作栏，返回(左)在 CTA(右)之前', () => {
    // 向导统一底部 wizard-nav 同时承载「返回上一步」(left) 与「进入核对并保存」(right)
    expect(wizard).toContain('aria-hidden="true" /> 返回上一步');
    const back = wizard.indexOf('返回上一步');
    const cta = wizard.indexOf('进入核对并保存');
    expect(back).toBeGreaterThan(-1);
    expect(cta).toBeGreaterThan(-1);
    // 同一段导航：返回（左侧）必须先于核对 CTA（右侧）出现
    expect(back).toBeLessThan(cta);
    // 识别面板不再自带底部操作区，避免出现第二处操作栏
    expect(panel).not.toContain('recog-summary-actions');
    expect(styles).not.toContain('recog-summary-actions');
  });

  it('向导通过 ref 调用面板 enterReview；从核对页返回后 recogPhase=done 仍可点 CTA', () => {
    // 面板暴露 enterReview 句柄供向导统一操作栏调用
    expect(panel).toContain('ReportRecognitionPanelHandle');
    expect(panel).toContain('useImperativeHandle');
    // 向导持有面板 ref，CTA 点击委派给面板的 enterReview
    expect(wizard).toContain('reviewPanelRef');
    expect(wizard).toContain('ref={reviewPanelRef}');
    expect(wizard).toContain('reviewPanelRef.current?.enterReview()');
    // 仅识别完成即可点：recogPhase==='done'（从核对页返回后 onReportScan 置 done，CTA 仍可点）
    expect(wizard).toContain("recogPhase === 'done'");
    expect(wizard).toContain("setRecogPhase('done')");
  });

  it('步骤1无返回按钮：主 CTA「下一步」仍右对齐（导航右区），左侧为取消', () => {
    expect(wizard).toContain('<div className="wizard-nav-left">');
    expect(wizard).toContain('<div className="wizard-nav-right">');
    // 步骤1左侧是「取消」，「下一步」主 CTA 位于右区
    expect(wizard).toContain('取消');
    expect(wizard).toContain('下一步');
  });

  it('回归：从第三步返回第二步后面板重挂载把 recogPhase 重置为 idle，CTA 仍因存在识别草稿而显示', () => {
    const src = wizard.replace(/\s+/g, '');
    // 面板初始 phase='idle'（重挂载后 onPhaseChange('idle') 会把父级 recogPhase 重置为 idle）
    expect(panel).toContain("useState<Phase>('idle')");
    // 父级 CTA 条件：recogPhase==='done' 或存在识别草稿（recognizedReportMeta/recognizedItems）
    expect(src).toContain("recogPhase==='done'||recognizedReportMeta!=null||recognizedItems.length>0");
  });
});

describe('新建报告向导：样式移除旧四步圆圈导航，保留三步当前进度', () => {
  it('styles.css 已移除旧四步圆圈导航样式（wizard-progress/step/dot/label）', () => {
    expect(styles).not.toContain('.wizard-progress {');
    expect(styles).not.toContain('.wizard-step-dot');
    expect(styles).not.toContain('.wizard-step-label');
    expect(styles).not.toContain('.wizard-step {');
  });

  it('保留轻量三步当前进度样式 wizard-progress-text', () => {
    expect(styles).toContain('.wizard-progress-text');
  });
});

describe('第三步拆成两个连续页面：报告信息页 → 核对检查项目页（移动端优先）', () => {
  it('ReportReview 引入 view 状态（info/items），默认进入报告信息页', () => {
    expect(review).toContain("useState<'info' | 'items'>('info')");
    expect(review).toContain('review-info-page');
    expect(review).toContain('review-items-page');
  });

  it('报告信息页只保留报告类型/日期/医疗机构/检验目的（检查项目）/附件摘要，成员只读', () => {
    // 关键编辑字段保留在报告信息页
    expect(review).toContain('<Field label="医院 / 体检机构 *">');
    expect(review).toContain('<Field label="报告日期 *">');
    expect(review.replace(/\s+/g, '')).toContain(
      'className="report-type-title">报告类型 / 检查类别'.replace(/\s+/g, ''),
    );
    expect(review).toContain('<Field label="检查项目">');
    expect(review).toContain('<Field label="检验目的">');
    // 成员改为只读展示（member-display），不再提供 select 切换
    expect(review).toContain('member-display');
    expect(review).toContain('memberName');
    // 附件摘要：计数 + 文件名列表
    expect(review).toContain('附件摘要（{attachments.length}）');
    expect(review).toContain('att-summary-list');
  });

  it('标题 / 备注不再出现在报告信息页（移动端简化的“只保留核心信息”）', () => {
    expect(review).not.toContain('<Field label="标题">');
    expect(review).not.toContain('<Field label="备注">');
  });

  it('报告信息页底部操作栏：左「返回上一步」、右「继续核对项目」', () => {
    expect(review).toContain('返回上一步');
    expect(review).toContain('继续核对项目');
    const back = review.indexOf('返回上一步');
    const cta = review.indexOf('继续核对项目');
    expect(back).toBeGreaterThan(-1);
    expect(cta).toBeGreaterThan(back);
  });

  it('核对检查项目页集中显示项目 / 影像 exams / 待确认状态，底部左返回报告信息、右保存报告', () => {
    // 待确认状态(chip-warn)、定位下一项、影像编辑、项目编辑、报告详情都在 items 页
    expect(review).toContain('chip-warn');
    expect(review).toContain('imaging-exam');
    expect(review).toContain('<div className="details-section">');
    // 底部切换：返回报告信息 ↔ 保存报告
    expect(review).toContain('返回报告信息');
    expect(review).toContain('保存报告');
    const backInfo = review.indexOf('返回报告信息');
    const save = review.indexOf('保存报告');
    expect(backInfo).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(backInfo);
  });

  it('报告信息页「返回上一步」通过 onBack 把完整草稿带回识别摘要页（不丢草稿）', () => {
    expect(review).toContain('const handleBack = () => {');
    expect(review).toContain('onBack?.({');
    // 核对检查项目页内部切换不涉及向导返回，直接 setView('info')
    expect(review).toContain("onClick={() => setView('info')}");
    expect(review).toContain("onClick={() => setView('items')}");
    expect(review).toContain('onClick={handleBack}');
  });

  it('保存门槛保持不变：待确认候选阻止保存；手动项目默认确认', () => {
    expect(review).toContain('pendingItemCount(items) === 0');
    expect(review).toContain('disabled={!canSave || busy}');
    expect(review).toContain('还有 {pendingCount} 项待确认');
  });
});
