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

const TABS: { key: Tab; label: string; icon: LucideIcon }[] = [
  { key: 'overview', label: '概览', icon: Home },
  { key: 'members', label: '成员', icon: Users },
  { key: 'reports', label: '报告', icon: FileText },
  { key: 'trend', label: '趋势', icon: TrendingUp },
  { key: 'data', label: '数据', icon: Database },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  // 报告编辑状态（编辑时占据整个报告视图）
  const [editingReport, setEditingReport] = useState<Report | null>(null);
  const [creatingReport, setCreatingReport] = useState(false);
  // 趋势「查看报告」进入的只读详情（不提供编辑/保存/删除入口）
  const [readOnlyReport, setReadOnlyReport] = useState<Report | null>(null);
  // 编辑入口来源：'list'=报告列表直接编辑，'detail'=从只读详情进入编辑。
  // 用于关闭表单后决定返回目的页（报告详情 or 报告列表）。
  const [editOrigin, setEditOrigin] = useState<'list' | 'detail'>('list');

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

  const closeForm = async (saved: boolean) => {
    // 记录编辑来源与只读详情目标报告 id，来源决定关闭表单后返回目的页。
    const origin = editOrigin;
    const roId = readOnlyReport?.id;
    setEditingReport(null);
    setCreatingReport(false);
    setEditOrigin('list');
    if (saved) bump();
    if (origin === 'detail' && roId) {
      // 从详情进入编辑：返回详情页（readOnlyReport 编辑期间保留、未清空）。
      // 保存成功后重新加载最新报告，避免详情展示保存前的旧字段。
      if (saved) {
        try {
          const fresh = await db.reports.get(roId);
          if (fresh) setReadOnlyReport(fresh);
        } catch {
          /* 重新加载失败则保留现有详情 */
        }
      }
    } else {
      // 从列表直接编辑 / 新建：返回报告列表。
      setReadOnlyReport(null);
    }
  };

  /** 从只读详情页进入编辑：保留 readOnlyReport 作为返回目标（详情页），仅打开编辑表单。 */
  const openEditFromDetail = (r: Report) => {
    setEditOrigin('detail');
    setEditingReport(r);
  };

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
                className={`tab-btn ${tab === t.key ? 'tab-active' : ''}`}
                aria-current={tab === t.key ? 'page' : undefined}
                onClick={() => {
                  setTab(t.key);
                  setEditingReport(null);
                  setCreatingReport(false);
                  setReadOnlyReport(null);
                }}
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
        {tab === 'overview' && (
          <Overview
            stats={stats}
            latestReports={latestReports}
            memberName={memberName}
            loading={overviewLoading}
            error={overviewError}
            onRetry={bump}
            onCreate={() => {
              setCreatingReport(true);
              setTab('reports');
            }}
            onGoto={(t: Tab) => setTab(t)}
          />
        )}

        {tab === 'members' && <MemberManager refreshKey={refreshKey} bump={bump} />}

        {tab === 'reports' &&
          (creatingReport || editingReport ? (
            creatingReport && !editingReport ? (
              <NewReportWizard
                members={members}
                onCancel={() => closeForm(false)}
                onDone={closeForm}
                onGoToMembers={() => {
                  setCreatingReport(false);
                  setEditingReport(null);
                  setTab('members');
                }}
              />
            ) : (
              <ReportReview
                members={members}
                editingReport={editingReport}
                initialMemberId={editingReport?.memberId ?? ''}
                onDone={closeForm}
              />
            )
          ) : readOnlyReport ? (
            <ReportDetailView
              report={readOnlyReport}
              memberName={memberName(readOnlyReport.memberId)}
              onClose={() => setReadOnlyReport(null)}
              onEdit={openEditFromDetail}
            />
          ) : (
            <>
              <div className="page-head">
                <h2>体检报告</h2>
              </div>
              <ReportManager
                refreshKey={refreshKey}
                bump={bump}
                onCreate={() => {
                  setCreatingReport(true);
                }}
                onEdit={(r) => {
                  setEditOrigin('list');
                  setEditingReport(r);
                }}
                onView={(r) => setReadOnlyReport(r)}
              />
            </>
          ))}

        {tab === 'trend' && (
          <>
            <div className="page-head">
              <h2>指标趋势对比</h2>
            </div>
            {/* 保持 TrendView 挂载（display:none 隐藏），查看报告返回后筛选/图表状态不丢失 */}
            <div style={{ display: readOnlyReport ? 'none' : undefined }}>
              <TrendView
                refreshKey={refreshKey}
                bump={bump}
                gotoReport={(r) => setReadOnlyReport(r)}
              />
            </div>
            {readOnlyReport && (
              <ReportDetailView
                report={readOnlyReport}
                memberName={memberName(readOnlyReport.memberId)}
                onClose={() => setReadOnlyReport(null)}
                onEdit={openEditFromDetail}
              />
            )}
          </>
        )}

        {tab === 'data' && (
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
