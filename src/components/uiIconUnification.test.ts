import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * UI 图标与移动端视觉统一（源级契约校验，非行为/截图测试）。
 *
 * 覆盖本轮范围：
 * - 剩余页面的 emoji/字符图标统一替换为 lucide-react，保留必要文字与 aria-label；
 * - 状态徽章（status-toggle）改用 lucide Check/AlertCircle，不再残留 ✓/！字符字形；
 * - 全局样式克制化：不使用渐变背景、移动端触控目标至少 44px、无横向滚动（overflow-x clip）、
 *   底部操作区安全区（safe-area-inset-bottom）、focus-visible 高对比焦点；
 * - 保留核心业务文字（导出/导入/载入示例/添加/删除等）。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, 'src', 'components', p), 'utf-8');
const styles = readFileSync(join(root, 'src', 'styles.css'), 'utf-8');

const sheet = read('ScanSourceSheet.tsx');
const dataManager = read('DataManager.tsx');
const review = read('ReportReview.tsx');
const trend = read('TrendView.tsx');
const privacy = read('PrivacyModal.tsx');

describe('剩余页面图标统一为 lucide-react（移除此前的 emoji/字符图标）', () => {
  it.each([
    ['ScanSourceSheet.tsx', sheet],
    ['DataManager.tsx', dataManager],
    ['ReportReview.tsx', review],
    ['TrendView.tsx', trend],
    ['PrivacyModal.tsx', privacy],
  ])('%s 导入 lucide-react 且不再残留旧 emoji 字形', (_name, source) => {
    expect(source).toContain("from 'lucide-react'");
    // 旧 emoji / 字符图标（非业务文字）不应再出现
    expect(source).not.toContain('✕');
    expect(source).not.toContain('✖');
    expect(source).not.toContain('← ');
    expect(source).not.toContain('›');
  });

  it('扫描来源浮层：相机/相册用 lucide 图标，关闭带 aria-label，保留入口文字', () => {
    expect(sheet).toContain('<Camera');
    expect(sheet).toContain('<ImageIcon');
    expect(sheet).toContain('<ChevronRight');
    expect(sheet).toContain('aria-label="关闭"');
    expect(sheet).toContain('拍摄报告');
    expect(sheet).toContain('从相册选择');
  });

  it('数据管理：导出/导入/载入示例用 lucide 图标并保留文字', () => {
    expect(dataManager).toContain('<Download');
    expect(dataManager).toContain('普通导出（JSON）');
    expect(dataManager).toContain('密码保护导出');
    expect(dataManager).toContain('<Upload');
    expect(dataManager).toContain('导入 JSON（覆盖）');
    expect(dataManager).toContain('<FlaskConical');
    expect(dataManager).toContain('载入示例数据');
  });

  it('隐私弹窗：关闭按钮用 lucide X 图标并保留「关闭」/aria-label', () => {
    expect(privacy).toContain('<X size={16}');
    expect(privacy).toContain('aria-label="关闭"');
    expect(privacy).toContain('关闭');
  });
});

describe('状态徽章统一为 lucide（此前为 ✓/！字符字形）', () => {
  it('ReportReview 状态切换使用 lucide Check / AlertCircle', () => {
    expect(review).toContain('<Check size={14}');
    expect(review).toContain('<AlertCircle size={14}');
    expect(review).not.toContain('✓ 已确认');
    expect(review).not.toContain('！待确认');
  });

  it('TrendView 状态切换使用 lucide Check / AlertCircle', () => {
    expect(trend).toContain('<Check size={14}');
    expect(trend).toContain('<AlertCircle size={14}');
  });
});

describe('报告核对页关键动作均带必要文字/lucide 图标', () => {
  it('返回上一步、添加项目、删除行、展开箭头均改用 lucide 图标并保留文字', () => {
    expect(review).toContain('<ArrowLeft size={16}');
    expect(review).toContain('返回上一步');
    expect(review).toContain('<Plus size={15}');
    expect(review).toContain('添加项目');
    expect(review).toContain('<X size={15}');
    expect(review).toContain('aria-label="删除该行"');
    expect(review).toContain('<ChevronDown');
    expect(review).toContain('<ChevronUp');
  });
});

describe('全局样式克制化（无渐变、触控目标、横向溢出、安全区、焦点）', () => {
  it('不使用渐变背景', () => {
    expect(styles).not.toContain('linear-gradient');
    expect(styles).not.toContain('radial-gradient');
  });

  it('移动端触控目标至少 44px（按钮与状态切换）', () => {
    expect(styles).toContain('min-height: 44px');
    expect(styles).toContain('.status-toggle {\n    min-height: 44px;\n    min-width: 44px;');
  });

  it('html/body 用 overflow-x: clip 防止横向滚动', () => {
    expect(styles).toContain('overflow-x: clip');
  });

  it('底部操作区提供 safe-area 安全区', () => {
    expect(styles).toContain('env(safe-area-inset-bottom');
  });

  it('保留统一的高对比 focus-visible 焦点', () => {
    expect(styles).toContain('button:focus-visible');
    expect(styles).toContain('select:focus-visible');
    expect(styles).toContain('input:focus-visible');
  });
});
