import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Activity,
  Database,
  FileText,
  FlaskConical,
  Home,
  Image as ImageIcon,
  TrendingUp,
  Users,
} from 'lucide-react';
import { db } from './db';
import type { Member, Report } from './types';
import type { LucideIcon } from 'lucide-react';
import { Disclaimer, ViewState } from './components/Kit';
import { MemberManager } from './components/MemberManager';
import { ReportManager } from './components/ReportManager';
import { NewReportWizard } from './components/NewReportWizard';
import { ReportReview } from './components/ReportReview';
import { ReportDetailView } from './components/ReportDetailView';
import { TrendView } from './components/TrendView';
import { DataManager } from './components/DataManager';
import { PrivacyModal } from './components/PrivacyModal';
import { toDisplayDate } from './utils/dates';

type Tab = 'overview' | 'members' | 'reports' | 'trend' | 'data';

/**
 * 统一的页面导航栈。
 *
 * 顶层 Tab（overview/members/reports/trend/data）作为栈根；报告详情/编辑/新建为栈上层。
 * 所有「返回」统一为 pop()，天然回到上一页，避免平铺 state 导致的“返回不到上一页”。
 */
type Route =
  | { name: 'overview' }
  | { name: 'members' }
  | { name: 'reports' }
  | { name: 'reportDetail'; report: Report }
  | { name: 'reportEdit'; report: Report | null }
  | { name: 'trend' }
  | { name: 'data' };

const TABS: { key: Tab; label: string; icon: LucideIcon }[] = [
  { key: 'overview', label: '概览', icon: Home },
  { key: 'members', label: '成员', icon: Users },
  { key: 'reports', label: '报告', icon: FileText },
  { key: 'trend', label: '趋势', icon: TrendingUp },
  { key: 'data', label: '数据', icon: Database },
];

export default function App() {
  const [stack, setStack] = useState<Route[]>([{ name: 'overview' }]);
  const current = stack[stack.length - 1];
  const push = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const switchTab = useCallback((t: Tab) => setStack([{ name: t } as Route]), []);

  // 趋势筛选状态提升到 App 层：从趋势进入报告详情再返回，筛选/图表状态不丢失。
  const [trendFilter, setTrendFilter] = useState<{ memberId: string; name: string }>({
    memberId: '',
    name: '',
  });

  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  const [members, setMembers] = useState<Member[]>([]);
  const [stats, setStats] = useState<{
    members: number;
    reports: number;
    items: number;
    attachments: number;
  }>({
    members: 0,
    reports: 0,
    items: 0,
    attachments: 0,
  });
  const [latestReports, setLatestReports] = useState<Report[]>([]);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  // 首页概览数据（统计 + 最近报告）异步加载状态
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setOverviewLoading(true);
      setOverviewError(null);
      try {
        const [ms, rsCount, itsCount, atsCount, rs] = await Promise.all([
          db.members.toArray(),
          db.reports.count(),
          db.items.count(),
          db.attachments.count(),
          db.reports.orderBy('reportDate').reverse().limit(5).toArray(),
        ]);
        setMembers(ms);
        setStats({ members: ms.length, reports: rsCount, items: itsCount, attachments: atsCount });
        setLatestReports(rs);
      } catch {
        setOverviewError('概览数据加载失败，请重试。');
      } finally {
        setOverviewLoading(false);
      }
    };
    void load();
  }, [refreshKey]);

  const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? '未知成员';

  /** 关闭报告编辑/新建表单：返回上一页（pop）。保存成功时刷新数据与返回目标（若为详情页）。 */
  const closeReportForm = async (saved: boolean) => {
    const target = stack[stack.length - 2];
    if (saved) {
      bump();
      if (target?.name === 'reportDetail') {
        // 从详情进入编辑：保存后重载最新报告，避免详情页展示保存前的旧字段。
        try {
          const fresh = await db.reports.get(target.report.id);
          if (fresh) {
            setStack((s) =>
              s.map((r, i) =>
                i === s.length - 2 && r.name === 'reportDetail'
                  ? { name: 'reportDetail', report: fresh }
                  : r,
              ),
            );
          }
        } catch {
          /* 重载失败则保留原详情 */
        }
      }
    }
    pop();
  };

  const activeTab: Tab =
    current.name === 'reportDetail' || current.name === 'reportEdit'
      ? 'reports'
      : (current.name as Tab);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <span className="logo">
            <Activity size={26} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <div>
            <h1>家庭体检档案</h1>
            <span className="local-badge">本地存储 · 无账号 · 离线可用</span>
          </div>
        </div>
        <nav className="tab-nav" aria-label="主导航">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                className={`tab-btn ${activeTab === t.key ? 'tab-active' : ''}`}
                aria-current={activeTab === t.key ? 'page' : undefined}
                onClick={() => switchTab(t.key)}
              >
                <span className="tab-icon">
                  <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <span>{t.label}</span>
              </button>
            );
          })}
        </nav>
      </header>

      <Disclaimer />

      <main className="app-main">
        {current.name === 'overview' && (
          <Overview
            stats={stats}
            latestReports={latestReports}
            memberName={memberName}
            loading={overviewLoading}
            error={overviewError}
            onRetry={bump}
            onCreate={() => {
              setStack([{ name: 'reports' }, { name: 'reportEdit', report: null }]);
            }}
            onGoto={(t: Tab) => switchTab(t)}
          />
        )}

        {current.name === 'members' && <MemberManager refreshKey={refreshKey} bump={bump} />}

        {current.name === 'reports' && (
          <>
            <div className="page-head">
              <h2>体检报告</h2>
            </div>
            <ReportManager
              refreshKey={refreshKey}
              bump={bump}
              onCreate={() => push({ name: 'reportEdit', report: null })}
              onEdit={(r) => push({ name: 'reportEdit', report: r })}
              onView={(r) => push({ name: 'reportDetail', report: r })}
            />
          </>
        )}

        {current.name === 'reportDetail' && (
          <ReportDetailView
            report={current.report}
            memberName={memberName(current.report.memberId)}
            onClose={pop}
            onEdit={(r) => push({ name: 'reportEdit', report: r })}
          />
        )}

        {current.name === 'reportEdit' &&
          (current.report === null ? (
            <NewReportWizard
              members={members}
              onCancel={() => pop()}
              onDone={closeReportForm}
              onGoToMembers={() => switchTab('members')}
            />
          ) : (
            <ReportReview
              members={members}
              editingReport={current.report}
              initialMemberId={current.report.memberId}
              onDone={closeReportForm}
            />
          ))}

        {current.name === 'trend' && (
          <>
            <div className="page-head">
              <h2>指标趋势对比</h2>
            </div>
            <TrendView
              refreshKey={refreshKey}
              bump={bump}
              gotoReport={(r) => push({ name: 'reportDetail', report: r })}
              memberId={trendFilter.memberId}
              name={trendFilter.name}
              onFilterChange={(patch) => setTrendFilter((f) => ({ ...f, ...patch }))}
            />
          </>
        )}

        {current.name === 'data' && (
          <>
            <div className="page-head">
              <h2>数据管理</h2>
            </div>
            <DataManager bump={bump} />
          </>
        )}
      </main>

      <footer className="app-footer">
        家庭体检档案 v0.1 · 数据仅存储于本设备浏览器 · 仅供参考，不构成医疗诊断或治疗建议 · 请遵医嘱
        <button
          type="button"
          className="btn btn-xs footer-link"
          onClick={() => setPrivacyOpen(true)}
        >
          关于与隐私说明
        </button>
      </footer>

      {privacyOpen && <PrivacyModal onClose={() => setPrivacyOpen(false)} />}
    </div>
  );
}

function Overview({
  stats,
  latestReports,
  memberName,
  loading,
  error,
  onRetry,
  onCreate,
  onGoto,
}: {
  stats: { members: number; reports: number; items: number; attachments: number };
  latestReports: Report[];
  memberName: (id: string) => string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onCreate: () => void;
  onGoto: (t: Tab) => void;
}) {
  if (loading) {
    return (
      <ViewState
        loading
        loadingTitle="正在加载概览…"
        loadingIcon={<Activity size={22} strokeWidth={1.8} aria-hidden="true" />}
      />
    );
  }
  if (error) {
    return <ViewState error={error} onRetry={onRetry} errorTitle="加载概览失败" />;
  }
  const isEmpty = stats.members === 0 && stats.reports === 0;
  return (
    <div className="overview">
      <div className="stat-grid">
        <StatCard
          label="家庭成员"
          value={stats.members}
          icon={<Users size={22} strokeWidth={1.8} aria-hidden="true" />}
          onClick={() => onGoto('members')}
        />
        <StatCard
          label="体检报告"
          value={stats.reports}
          icon={<FileText size={22} strokeWidth={1.8} aria-hidden="true" />}
          onClick={() => onGoto('reports')}
        />
        <StatCard
          label="检查条目"
          value={stats.items}
          icon={<FlaskConical size={22} strokeWidth={1.8} aria-hidden="true" />}
          onClick={() => onGoto('reports')}
        />
        <StatCard
          label="附件（图/PDF）"
          value={stats.attachments}
          icon={<ImageIcon size={22} strokeWidth={1.8} aria-hidden="true" />}
          onClick={() => onGoto('reports')}
        />
      </div>

      {isEmpty ? (
        <div className="card" style={{ padding: 16 }}>
          <h2>欢迎使用家庭体检档案</h2>
          <p className="dim">
            一个<b>本地优先</b>的家庭体检资料小工具：无需账号，健康数据默认保存在本设备；
            识别出的文字仅在整理时发送给可配置的第三方服务（详见「关于与隐私说明」）。你可以：
          </p>
          <ol className="steps">
            <li>在「成员」中添加家庭成员；</li>
            <li>
              在「报告」中为成员新建体检报告，上传原始图片/PDF 附件，点击「识别数据」自动录入，
              或在同一界面手动逐项添加/修改/删除检查项，并逐项核对确认；
            </li>
            <li>
              在「趋势」中查看同一成员、同名同类别且单位一致的已确认指标变化；标准标签仅作兼容保留，不影响趋势；
            </li>
            <li>在「数据」中随时导出/导入完整 JSON 备份（含附件），也可载入示例数据体验。</li>
          </ol>
          <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={onCreate}>
              + 新建第一份报告
            </button>
            <button type="button" className="btn" onClick={() => onGoto('data')}>
              <FlaskConical size={16} strokeWidth={1.8} aria-hidden="true" /> 载入示例数据
            </button>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 16 }}>
          <div className="att-head">
            <strong>最近报告</strong>
            <button type="button" className="btn btn-sm" onClick={() => onGoto('reports')}>
              查看全部
            </button>
          </div>
          {latestReports.length === 0 ? (
            <p className="dim">暂无报告</p>
          ) : (
            <ul className="latest-list">
              {latestReports.map((r) => (
                <li key={r.id}>
                  <span className="member-tag">{memberName(r.memberId)}</span>
                  <span>{toDisplayDate(r.reportDate)}</span>
                  <span className="dim">{r.hospital}</span>
                  <span className="dim">{r.reportType}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  onClick,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className="stat-card card" onClick={onClick}>
      <span className="stat-icon">{icon}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </button>
  );
}
