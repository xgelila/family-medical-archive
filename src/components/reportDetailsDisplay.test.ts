import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 需求 5：保存后的报告详情/列表必须直接展示「报告详情」摘要或可展开入口，
 * 无需点击编辑即可发现（含检验目的 / 送检医生 / 检验者 / 审核者等附加信息）。
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, 'src', 'components', p), 'utf-8');

const manager = read('ReportManager.tsx');

describe('报告详情在保存后列表直接可见（可展开，无需进编辑）', () => {
  it('报告卡片渲染「报告详情」可展开入口，并展示检验目的/送检医生/检验者/审核者等', () => {
    expect(manager).toContain('📋 报告详情');
    expect(manager).toContain('检验目的');
    expect(manager).toContain('送检医生');
    expect(manager).toContain('检验者');
    expect(manager).toContain('审核者');
  });

  it('详情区默认折叠但可展开，并逐行展示 label/value（不泄露/不臆造）', () => {
    expect(manager).toContain('const [open, setOpen] = useState(false)');
    expect(manager).toContain('aria-expanded={open}');
    expect(manager).toContain('report-details-row');
    // 仅展示已保存的 details，空白值不展示
    expect(manager).toContain("details.filter((d) => d.value.trim() !== '')");
  });
});
