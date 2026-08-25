import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 需求 5：报告完整内容集中在只读详情页（ReportDetailView）直接展示「报告详情」可展开入口，
 * 无需点击编辑即可发现（含检验目的 / 送检医生 / 检验者 / 审核者等附加信息）。
 * 列表卡片为摘要入口，不再展开这些字段（见 reportManagerEmptyFilter/reportManagerMobile 契约）。
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, 'src', 'components', p), 'utf-8');

const detail = read('ReportDetailView.tsx');

describe('报告详情在只读详情页直接可见（可展开，无需进编辑）', () => {
  it('只读详情页渲染「报告详情」可展开入口，并展示检验目的/送检医生/检验者/审核者等', () => {
    expect(detail).toContain('报告详情（');
    expect(detail).toContain('检验目的');
    expect(detail).toContain('送检医生');
    expect(detail).toContain('检验者');
    expect(detail).toContain('审核者');
  });

  it('详情区默认折叠但可展开，并逐行展示 label/value（不泄露/不臆造）', () => {
    expect(detail).toContain('const [detailsOpen, setDetailsOpen] = useState(false)');
    expect(detail).toContain('aria-expanded={detailsOpen}');
    expect(detail).toContain('details-row');
    // 仅展示已保存的 details，空白值不展示
    expect(detail).toContain("filter((d) => d.value.trim() !== '')");
  });
});
