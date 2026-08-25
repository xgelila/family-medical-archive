import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ImagingReport } from '../types';
import { getImagingSummaryExams } from './ReportManager';

/**
 * 阶段 4：报告列表移动端。
 * - 筛选区移动端默认折叠为「筛选」按钮，展开（.report-filters.open）后显示字段与条件数量；
 * - 已有报告筛选无结果仍可清除；无报告时仍不显示筛选（另见 reportManagerEmptyFilter.test）；
 * - 状态触摸目标至少 44px，并带 aria-pressed 可读状态；
 * - 完整项目通过「检查项目」折叠（report-items-toggle）查看。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, 'src', 'components', p), 'utf-8');
const styles = readFileSync(join(root, 'src', 'styles.css'), 'utf-8');

const manager = read('ReportManager.tsx');

describe('影像摘要：多部位与旧单项兼容', () => {
  it('多部位逐项保留，不把所见和结论混成单段', () => {
    const imaging: ImagingReport = {
      examPart: '', examMethod: '', findings: '', impression: '', measurements: '',
      exams: [
        { examPart: '甲状腺', examMethod: '超声', findings: '左叶结节', impression: '建议复查', measurements: '5mm' },
        { examPart: '乳腺', examMethod: '超声', findings: '囊肿', impression: '良性', measurements: '3mm' },
      ],
    };
    expect(getImagingSummaryExams(imaging)).toHaveLength(2);
    expect(getImagingSummaryExams(imaging)[0].findings).toBe('左叶结节');
    expect(getImagingSummaryExams(imaging)[1].impression).toBe('良性');
  });

  it('旧版单项字段归一化为一个摘要子检查', () => {
    const imaging: ImagingReport = {
      examPart: '腹部', examMethod: '超声', findings: '未见异常', impression: '正常', measurements: '',
    };
    expect(getImagingSummaryExams(imaging)).toEqual([imaging]);
  });
});

describe('阶段 4：报告列表移动端', () => {
  it('筛选区折叠为「筛选」按钮，带 aria-expanded 与条件数量', () => {
    expect(manager).toContain('className="btn report-filter-toggle"');
    expect(manager).toContain('aria-expanded={filtersOpen}');
    expect(manager).toContain('筛选{activeFilterCount > 0');
    expect(manager).toContain('className={`report-filters ${filtersOpen ? \'open\' : \'\'}`}');
  });

  it('移动端筛选字段默认隐藏，展开后显示（CSS 控制）', () => {
    expect(styles).toContain('.report-filters {');
    expect(styles).toContain('.report-filters.open');
  });

  it('已有报告筛选无结果仍可清除筛选（activeFilterCount > 0）', () => {
    expect(manager).toContain('清除筛选（{activeFilterCount}）');
  });

  it('列表卡片为可点击摘要入口（日期/医院/报告类型/检查项数/附件数），点击进入只读详情，不再展开全字段', () => {
    expect(manager).toContain('className="report-card-open"');
    expect(manager).toContain('onClick={() => onView(r)}');
    expect(manager).toContain('查看详情');
    expect(manager).toContain('{its.length} 项检查 · {atts.length} 个附件');
    // 摘要卡片不再内嵌检查项目表 / 附件区 / 影像 / 报告备注 / 报告详情
    expect(manager).not.toContain('report-items-toggle');
    expect(manager).not.toContain('<th>检查项目</th>');
    expect(manager).not.toContain('className="att-row"');
    expect(manager).not.toContain('report-imaging-summary');
    expect(manager).not.toContain('<div className="report-details">');
  });

  it('摘要入口触摸目标至少 44px（移动端优先）', () => {
    expect(styles).toContain('.report-card-open {');
    expect(styles).toContain('min-height: 44px;');
  });
});
