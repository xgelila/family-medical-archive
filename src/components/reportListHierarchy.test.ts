import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 报告列表信息层级回归测试。
 *
 * 需求：列表卡片中「成员名字」「报告大类」「报告类型」不再全部做成相同青色胶囊，
 * 恢复清晰的信息层级：
 * - 成员名字是列表主信息 / 身份信息，使用无胶囊的正文强调层级（.report-member），
 *   不复用普通报告类型 chip（chip/chip-info）；
 * - 报告大类使用独立 plain class（.report-kind，不加胶囊），与详情「报告大类」一致；
 *    保持与报告类型 chip、状态标签明确区分；
 * - 报告类型保持青色 chip（Chip tone="info"），但**不**被渲染成成员标签（.member-tag）。
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, 'src', 'components', p), 'utf-8');

const manager = read('ReportManager.tsx');
const styles = readFileSync(join(root, 'src', 'styles.css'), 'utf-8');

describe('报告列表信息层级', () => {
  it('成员名字作为主信息使用独立身份 class（.report-member），不复用 member-tag 胶囊', () => {
    expect(manager).toContain('<span className="report-member">{member.name}</span>');
    // 负例：成员名不再通过 member-tag 胶囊渲染
    expect(manager).not.toContain('<span className="member-tag">{member.name}</span>');
    // ReportManager 内不再出现 member-tag 胶囊
    expect(manager).not.toContain('member-tag');
  });

  it('负例：成员名字不复用普通报告类型 chip（chip/chip-info）', () => {
    // 成员名渲染在 .report-member 中，而非 Chip tone="info"
    const memberLine = manager.split('\n').find((l) => l.includes('report-member'));
    expect(memberLine).toBeTruthy();
    expect(memberLine).not.toContain('<Chip');
    expect(memberLine).not.toContain('tone="info"');
  });

  it('报告大类使用独立 plain class .report-kind，不复用报告类型 chip', () => {
    expect(manager).toContain('<span className="report-kind">');
    expect(manager).toContain("{r.reportKind === 'imaging' ? '检查' : '检验'}");
    const kindLine = manager.split('\n').find((l) => l.includes('report-kind'));
    expect(kindLine).toBeTruthy();
    expect(kindLine).not.toContain('<Chip');
    expect(kindLine).not.toContain('tone="info"');
  });

  it('负例：报告类型不被渲染成成员标签（.member-tag），仍以 chip 呈现', () => {
    expect(manager).toContain('<Chip key={t} tone="info">');
    expect(manager).not.toContain('<Chip key={t} className="member-tag"');
  });

  it('CSS 定义 .report-member / .report-kind，报告大类为独立 plain meta 且无胶囊属性', () => {
    const block = styles.slice(styles.indexOf('.report-kind {'));
    expect(block).toContain('.report-kind {');
    // 报告大类为独立 plain class：无胶囊背景 / 圆角 / 内边距 / 白字
    const kindBlock = block.slice(block.indexOf('.report-kind {'), block.indexOf('.report-kind {') + 200);
    expect(kindBlock).not.toContain('background');
    expect(kindBlock).not.toContain('border-radius');
    expect(kindBlock).not.toContain('padding');
    expect(kindBlock).not.toContain('#fff');
    // 负例：报告大类复用次级文字 / muted，非青色 chip 胶囊
    expect(kindBlock).not.toContain('var(--blue-light)');
    // 负例：报告大类仍与 member-tag 胶囊视觉层级不同
    expect(styles).toContain('.report-member {');
    expect(styles).toContain('.report-member-missing {');
    // chip-info 仍为青色胶囊
    const chipInfo = styles.slice(styles.indexOf('.chip-info {'), styles.indexOf('.chip-info {') + 200);
    expect(chipInfo).toContain('var(--blue-light)');
  });

  it('列表摘要入口触摸目标仍至少 44px（移动端不受影响）', () => {
    expect(styles).toContain('.report-card-open {');
    expect(styles).toContain('min-height: 44px;');
  });
});