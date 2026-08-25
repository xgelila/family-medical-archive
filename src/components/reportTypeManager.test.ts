import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../db';
import {
  addCustomReportType,
  deleteCustomReportType,
  loadCustomReportTypes,
  mergeReportTypes,
} from '../utils/customReportTypes';

/**
 * 报告类型管理：共享面板（ReportTypeManagerPanel）+ 当前页内弹层（ReportTypeManagerModal）。
 *
 * 需求：
 * 1) 新增/删除/展示复用同一套持久化逻辑（utils/customReportTypes），不复制第二份存储代码；
 * 2) 核对页「管理报告类型…」改为当前页内弹层打开（不跳转 DataManager，不关闭向导/丢草稿）；
 * 3) 按 reportKind 隔离：lab/imaging 自定义类型不串类；新增即持久化并出现在当前选择；
 * 4) 移动端优先：弹层不超出视口、底部安全区、关闭按钮 ≥44px、焦点/aria、遮罩点击关闭。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, 'src', p), 'utf-8');

const mgr = read('components/ReportTypeManager.tsx');
const review = read('components/ReportReview.tsx');
const styles = readFileSync(join(root, 'src', 'styles.css'), 'utf-8');
const util = read('utils/customReportTypes.ts');

const s = (src: string, fragment: string) =>
  src.replace(/\s+/g, '').includes(fragment.replace(/\s+/g, ''));

describe('共享面板复用同一套持久化逻辑（不复制第二套增删改存储）', () => {
  it('报告类型管理组件复用 customReportTypes 工具（读取/新增/删除），不复制 db 写入', () => {
    expect(mgr).toContain(
      'import {\n  addCustomReportType,\n  deleteCustomReportType,\n  loadCustomReportTypes,\n  mergeReportTypes,\n  validateCustomReportTypeName,',
    );
    expect(s(mgr, 'addCustomReportType(')).toBe(true);
    expect(s(mgr, 'deleteCustomReportType(')).toBe(true);
    expect(s(mgr, 'loadCustomReportTypes()')).toBe(true);
    expect(s(mgr, 'mergeReportTypes(')).toBe(true);
    // 不在组件内复制存储实现（唯一存储入口在 utils/customReportTypes）
    expect(mgr).not.toContain('await db.customReportTypes.put(');
    expect(util).toContain('await db.customReportTypes.put(rec)');
  });
});

describe('核对页「管理报告类型…」打开当前页内弹层，不跳转 DataManager / 不丢草稿', () => {
  it('ReportReview 弹层为兄弟节点（仅切换显隐），不重置 reportTypes/items/details/attachments 草稿', () => {
    // 打开弹层仅设置 typesManagerOpen；不存在「开弹层即清空草稿」的清理路径
    expect(review).toContain('setTypesManagerOpen(true)');
    expect(review).toContain('onClose={() => setTypesManagerOpen(false)}');
    // 弹层内嵌共享面板，且弹层在页面内渲染（非跳页）
    expect(s(review, '<ReportTypeManagerModal')).toBe(true);
    expect(review).toContain("import { ReportTypeManagerModal } from './ReportTypeManager'");
    // 当 reportKind 变更 / 弹层开关时，不会清空已选 reportTypes / items / details / attachments
    expect(review).not.toContain('setTypesManagerOpen(true); setReportTypes(');
    expect(s(review, 'reportKind={reportKind}')).toBe(true);
    // 不再通过 onManageTypes 跳转 DataManager
    expect(review).not.toContain('onManageTypes');
  });

  it('App 不再为了管理类型切 tab（onManageTypes 已移除）', () => {
    const app = read('App.tsx');
    expect(app).not.toContain('onManageTypes');
    expect(app).not.toContain("setTab('data')");
  });
});

describe('弹层移动端优先（不超出视口 / 底部安全区 / 关闭按钮≥44px / 遮罩点击关闭）', () => {
  it('共享组件提供弹层外壳（ReportTypeManagerModal）与 daialog/aria/focus/遮罩点击关闭', () => {
    expect(mgr).toContain('export function ReportTypeManagerModal(');
    expect(mgr).toContain('role="dialog"');
    expect(mgr).toContain('aria-modal="true"');
    expect(mgr).toContain('aria-label={title ?? defaultTitle}');
    expect(mgr).toContain('tabIndex={-1}');
    expect(mgr).toContain("if (event.key === 'Escape') onClose();");
    expect(mgr).toContain('if (e.target === e.currentTarget) onClose();'); // 遮罩点击关闭
  });

  it('样式：弹层不超出视口、底部安全区、关闭按钮/主 CTA 触控目标 ≥44px', () => {
    expect(styles).toContain('.report-type-modal {');
    expect(s(styles, 'max-height: 86vh')).toBe(true); // 不超出视口
    expect(styles).toContain('env(safe-area-inset-bottom, 0px)'); // 底部安全区
    expect(styles).toContain('.report-type-modal-close {');
    expect(s(styles, 'min-width: 44px')).toBe(true); // 关闭按钮 ≥44px
    expect(s(styles, 'min-height: 44px')).toBe(true);
    expect(styles).toContain('.report-type-modal-done {'); // 单一主 CTA
    expect(s(styles, 'width: 100%')).toBe(true);
  });
});

describe('新增自定义类型持久化 + 出现在当前选择 + reportKind 隔离（行为级）', () => {
  afterAll(async () => {
    await db.customReportTypes.clear();
  });

  it('确认新增一种 lab 自定义类型后：持久化、出现在 lab 当前选择、不进 imaging（隔离）', async () => {
    const rec = await addCustomReportType('心脏超声', [], 'imaging');
    expect(rec).not.toBeNull();
    const lab = await addCustomReportType('眼科', [], 'lab');
    expect(lab).not.toBeNull();

    const all = await loadCustomReportTypes();
    expect(all.some((c) => c.name === '心脏超声' && c.reportKind === 'imaging')).toBe(true);
    expect(all.some((c) => c.name === '眼科' && c.reportKind === 'lab')).toBe(true);

    // 新增后出现在「当前选择」（mergeReportTypes）→ 关闭弹层后下拉即见
    const labSelect = mergeReportTypes(all, 'lab');
    expect(labSelect).toContain('眼科');
    expect(labSelect).not.toContain('心脏超声'); // lab 名单不含 imaging 自定义类型

    const imgSelect = mergeReportTypes(all, 'imaging');
    expect(imgSelect).toContain('心脏超声');
    expect(imgSelect).not.toContain('眼科'); // imaging 名单不含 lab 自定义类型

    // 删除即时生效（持久化删除）
    if (lab) await deleteCustomReportType(lab.id);
    expect((await loadCustomReportTypes()).some((c) => c.id === lab?.id)).toBe(false);
    expect(mergeReportTypes(await loadCustomReportTypes(), 'lab')).not.toContain('眼科');
  });
});
