import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 首页概览 / 成员管理 / 报告列表三个 Dexie 异步加载视图的 loading/error/retry 源码契约。
 *
 * 覆盖本轮范围：
 * - 三个视图首次加载都有明确 loading 态（ViewState，spinner + 文案，role="status" aria-live="polite"）；
 * - 加载失败有 error 态与单一「重试」主操作（role="alert"，44px 触控）；
 * - 重试重新触发加载（reload/load/refreshKey），并先清除错误再重新 loading，可恢复、不是静默白屏；
 * - loading/error 统一包裹在 .card 内容容器（.view-state）内，不落到外层灰背景；
 * - 复用现有 EmptyState 与颜色 token（Kit.ViewState），未引入新框架；
 * - 趋势页已有 loading/error 实现在 trendViewContract.test.ts 覆盖，此处不重复。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, 'src', p), 'utf-8');

const kit = read('components/Kit.tsx');
const app = read('App.tsx');
const member = read('components/MemberManager.tsx');
const report = read('components/ReportManager.tsx');
const styles = readFileSync(join(root, 'src', 'styles.css'), 'utf-8');

describe('统一 ViewState 组件（Kit）', () => {
  it('loading 态在卡片内容容器内，带 role="status" 与 aria-live="polite"（无障碍不静默）', () => {
    expect(kit).toContain('className="card view-state" role="status" aria-live="polite"');
    expect(kit).toContain('view-state-spinner');
  });

  it('error 态带 role="alert"，单一「重试」主操作按钮点击触发 onRetry', () => {
    expect(kit).toContain('className="card view-state" role="alert"');
    expect(kit).toContain('<EmptyState');
    expect(kit).toContain('onClick={onRetry}');
    expect(kit).toContain('重试');
  });

  it('复用现有 EmptyState 组件与配色 token，不引入新框架', () => {
    expect(kit).toContain('<EmptyState');
    expect(styles).toContain('var(--teal)');
    expect(kit).not.toContain('import { styled');
  });
});

describe('首页概览（App.tsx）', () => {
  it('有 loading / error 状态，加载时显示 loading 态、失败时显示错误', () => {
    expect(app).toContain('const [overviewLoading, setOverviewLoading] = useState(true);');
    expect(app).toContain(
      'const [overviewError, setOverviewError] = useState<string | null>(null);',
    );
    expect(app).toContain('loadingTitle="正在加载概览…"');
    expect(app).toContain('errorTitle="加载概览失败"');
  });

  it('异步加载包在 try/catch/finally 中：失败置错误，成功/结束清除 loading，非静默白屏', () => {
    expect(app).toContain('setOverviewLoading(true);');
    expect(app).toContain('setOverviewError(null);');
    expect(app).toContain("setOverviewError('概览数据加载失败，请重试。');");
    expect(app).toContain('setOverviewLoading(false);');
  });

  it('提供重试回调（onRetry=bump，重跑加载 effect）且可恢复', () => {
    expect(app).toContain('onRetry={bump}');
  });
});

describe('成员管理（MemberManager.tsx）', () => {
  it('有 loading / error 状态，加载时显示 loading 态、失败时显示错误', () => {
    expect(member).toContain('const [loading, setLoading] = useState(true);');
    expect(member).toContain('const [loadError, setLoadError] = useState<string | null>(null);');
    expect(member).toContain('loadingTitle="正在加载成员…"');
    expect(member).toContain('errorTitle="加载成员失败"');
  });

  it('重新加载会先清错误再进入 loading，失败置错误并结束 loading，可恢复', () => {
    expect(member).toContain('setLoading(true);');
    expect(member).toContain('setLoadError(null);');
    expect(member).toContain("setLoadError('成员数据加载失败，请重试。');");
    expect(member).toContain('setLoading(false);');
  });

  it('重试回调调用 reload（重新触发加载）', () => {
    expect(member).toContain('const retry = () => {');
    expect(member).toContain('void reload();');
    expect(member).toContain('onRetry={retry}');
  });
});

describe('报告列表（ReportManager.tsx）', () => {
  it('有 loading / error 状态，加载时显示 loading 态、失败时显示错误', () => {
    expect(report).toContain('const [loading, setLoading] = useState(true);');
    expect(report).toContain('const [loadError, setLoadError] = useState<string | null>(null);');
    expect(report).toContain('loadingTitle="正在加载报告…"');
    expect(report).toContain('errorTitle="加载报告失败"');
  });

  it('加载逻辑抽为可重试的 useCallback：先清错误再 loading，失败置错误，结束 loading', () => {
    expect(report).toContain('const load = useCallback(async () => {');
    expect(report).toContain('setLoading(true);');
    expect(report).toContain('setLoadError(null);');
    expect(report).toContain("setLoadError('报告数据加载失败，请重试。');");
    expect(report).toContain('setLoading(false);');
  });

  it('重试回调直接重跑 load（可恢复，非静默白屏）', () => {
    expect(report).toContain('onRetry={() => void load()}');
  });
});

describe('loading/error 内容容器样式（移动端优先）', () => {
  it('ViewState 卡片容器 .view-state 存在于样式，loader 带 spinner 动画', () => {
    expect(styles).toContain('.view-state {');
    expect(styles).toContain('.view-state-spinner');
    expect(styles).toContain('@keyframes recog-spin');
  });

  it('重试按钮触摸目标至少 44px（.view-state .empty-action .btn）', () => {
    expect(styles).toContain('.view-state .empty-action .btn {');
    expect(styles).toContain('min-height: 44px;');
  });
});
