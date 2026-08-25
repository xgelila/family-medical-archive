import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 趋势页源码契约（只读源校验，非行为/截图测试）。
 *
 * 覆盖本轮范围：
 * - 移除趋势候选/连线解释辅助文本（同名同单位才连线、检查项可用数量占位等），
 *   仅影响辅助文字，不误删趋势标题、筛选控件与必要空态；
 * - 趋势未显示时，空态文字统一放入「卡片内容容器」（.card .trend-empty 包裹 .empty-state），
 *   避免落到外层灰色背景；文字左对齐、正常流布局、不靠绝对定位/负 margin 掩盖。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const trend = readFileSync(join(root, 'src', 'components', 'TrendView.tsx'), 'utf-8');
const styles = readFileSync(join(root, 'src', 'styles.css'), 'utf-8');

describe('趋势页移除候选/连线解释辅助文本（保留标题、筛选控件与必要空态）', () => {
  it.each([
    '同名同单位才连线；不同名称独立展示',
    '有 13 个检查项可用于趋势',
    '有 ${candidates.length} 个检查项可用于趋势',
    '该成员暂无数值型检查项目可用于趋势',
    '仅同一成员、同名同类别同单位的已确认数值会连线',
    '同名同类别同单位的已确认记录可比较；连线使用原始数值',
    '趋势严格按「同一成员、同一检查项名称 + 检查类别 + 单位」连线',
  ])('TrendView 不再包含辅助文字片段: %s', (fragment) => {
    expect(trend).not.toContain(fragment);
  });

  it('保留趋势页标题与筛选控件（成员、报告类型、检查项目）', () => {
    expect(trend).toContain('选择成员与检查项目');
    expect(trend).toContain('请选择成员');
    expect(trend).toContain('报告类型');
    expect(trend).toContain('检查项目 *');
    expect(trend).toContain('请选择检查项目');
  });

  it('保留四种必备空态标题（加载 / 加载失败 / 未选择成员 / 无数据）', () => {
    expect(trend).toContain('title="正在加载趋势数据…"');
    expect(trend).toContain('title="加载趋势数据失败"');
    expect(trend).toContain('title="选择成员与检查项目"');
    expect(trend).toContain('title="暂无趋势数据"');
  });
});

describe('趋势空态统一放入卡片内容容器（不落到外层灰色背景）', () => {
  it('所有趋势空态均通过 TrendEmptyCard 包裹为 .card.trend-empty > .empty-state', () => {
    // 未选择成员的空态
    expect(trend).toContain('<div className="card trend-empty">');
    expect(trend).toContain('<EmptyState icon={icon} title={title} desc={desc} />');
    // 未选择成员与无趋势数据两处都使用同一容器组件
    const occurrences = trend.split('card trend-empty').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(1);
    expect(trend).toContain('<TrendEmptyCard');
  });

  it('空态卡片容器样式：卡片内左对齐、正常流、不溢出，且不用绝对定位/负 margin 掩盖', () => {
    expect(styles).toContain('.trend-empty.card');
    expect(styles).toContain('.trend-empty .empty-state');
    expect(styles).toContain('.trend-empty .empty-desc');
    expect(styles.match(/\.trend-empty \.empty-state \{[^}]*text-align: left;/)).not.toBeNull();
    expect(styles).not.toMatch(
      /\.trend-empty \{[^}]*?(position: absolute|margin-left: -|margin-right: -)/,
    );
  });
});
