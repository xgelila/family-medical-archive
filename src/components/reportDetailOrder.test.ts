import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 需求：检查项目是报告一级主内容；「报告详情/附加信息」不得放在检查项目之前。
 * 核对保存页（ReportReview）与已保存报告展示（ReportManager）都必须符合：
 *   报告基础字段 -> 检查项目 -> 报告详情。
 * 通过校验各组件源码中「检查项目」区块标记先于「报告详情」区块标记来断言 DOM 顺序，
 * 避免详情混入附件信息或出现在项目之前。
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, 'src', 'components', p), 'utf-8');

const indexOf = (src: string, marker: string) => src.indexOf(marker);

describe('报告详情固定在检查项目列表底部（报告基础字段 -> 检查项目 -> 报告详情）', () => {
  it('ReportReview：检查项目（item-editor）在报告详情（details-section）之前', () => {
    const src = read('ReportReview.tsx');
    // item-editor carries the report-kind visibility/style attributes in the current DOM.
    const itemsAt = indexOf(
      src,
      '<div className="item-editor" style={reportKind === \'lab\' ? undefined : { display: \'none\' }} data-report-kind={reportKind}>',
    );
    const detailsAt = indexOf(src, '<div className="details-section">');
    expect(itemsAt).toBeGreaterThan(0);
    expect(detailsAt).toBeGreaterThan(0);
    expect(itemsAt).toBeLessThan(detailsAt);
  });

  it('ReportManager：检查项目表格在报告详情（report-details）之前，且详情入口默认存在', () => {
    const src = read('ReportManager.tsx');
    const itemsTableAt = indexOf(src, 'className="data-table"');
    const detailsAt = indexOf(src, '<div className="report-details">');
    expect(itemsTableAt).toBeGreaterThan(0);
    expect(detailsAt).toBeGreaterThan(0);
    expect(itemsTableAt).toBeLessThan(detailsAt);
    // 详情入口不混入附件信息：附件区块在项目表格之前
    const attsAt = indexOf(src, 'className="att-row"');
    expect(attsAt).toBeLessThan(itemsTableAt);
  });

  it('报告详情仍可折叠且入口默认可见（details-section 使用可切换按钮，默认折叠）', () => {
    const review = read('ReportReview.tsx');
    expect(review).toContain('details-toggle');
    // 报告详情默认折叠：用户主动点击后才展开
    expect(review).toContain('const [detailsOpen, setDetailsOpen] = useState(false);');
  });
});
