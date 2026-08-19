import { useEffect, useMemo, useState } from 'react';
import { db } from '../db';
import type { Member, Report, ReportItem } from '../types';
import { analyzeTrend, buildTrendPoint, numericItemNames, type TrendPoint } from '../utils/trend';
import { EmptyState, Field, Chip } from './Kit';
import { MiniLineChart } from './MiniLineChart';

export function TrendView({
  refreshKey,
  bump,
  gotoReport,
}: {
  refreshKey: number;
  bump: () => void;
  gotoReport: (r: Report) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [items, setItems] = useState<ReportItem[]>([]);
  const [memberId, setMemberId] = useState('');
  const [name, setName] = useState('');

  useEffect(() => {
    const load = async () => {
      const [ms, rs, its] = await Promise.all([
        db.members.toArray(),
        db.reports.toArray(),
        db.items.toArray(),
      ]);
      setMembers(ms);
      setReports(rs);
      setItems(its);
    };
    void load();
  }, [refreshKey]);

  const memberItems = useMemo(
    () => (memberId ? items.filter((i) => i.memberId === memberId) : []),
    [memberId, items],
  );
  // 趋势候选 = 数值型条目的检查项名称（含待确认，便于逐条核对）
  const candidates = useMemo(() => numericItemNames(memberItems), [memberItems]);
  const reportsById = useMemo(() => new Map(reports.map((r) => [r.id, r])), [reports]);

  // 选定名称下的条目（同成员、同检查项名称）
  const namedItems = name ? memberItems.filter((i) => (i.name ?? '').trim() === name) : [];
  // 待确认（confirmed=false）条目不参与趋势统计/连线；仍单独列表展示，可随时确认。
  const confirmedItems = namedItems.filter((i) => i.confirmed !== false);
  const pendingItems = namedItems.filter((i) => i.confirmed === false);
  const pendingPoints: TrendPoint[] = pendingItems
    .map((it) => buildTrendPoint(it, reportsById.get(it.reportId)))
    .filter((p): p is TrendPoint => p !== null);
  const analysis = useMemo(
    () => analyzeTrend(confirmedItems, reportsById),
    [confirmedItems, reportsById],
  );

  const member = members.find((m) => m.id === memberId);

  return (
    <div className="trend-view">
      <div className="toolbar card">
        <Field label="成员 *">
          <select
            value={memberId}
            onChange={(e) => {
              setMemberId(e.target.value);
              setName('');
            }}
          >
            <option value="">请选择成员</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="检查项目 *"
          hint="按检查项名称分组；同名称、同单位才合并为一条曲线，不同名称（如 Al / Alc）始终为独立曲线"
        >
          <select
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!memberId}
            title="趋势严格按「同一成员、同一检查项名称 + 检查类别 + 单位」连线；不同名称（如 糖化血红蛋白Al 与 糖化血红蛋白Alc）始终为独立曲线，不合并"
          >
            <option value="">{memberId ? '请选择检查项目' : '先选择成员'}</option>
            {candidates.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        {memberId && (
          <span className="toolbar-note">
            {candidates.length === 0
              ? '该成员暂无数值型检查项目可用于趋势'
              : `${member?.name ?? ''} 有 ${candidates.length} 个检查项可用于趋势`}
          </span>
        )}
      </div>

      <div className="toolbar card" role="note">
        ℹ️ 趋势曲线以「检查项名称」为主键。 不同名称（如 糖化血红蛋白Al 与
        糖化血红蛋白Alc）始终为独立曲线并排展示，绝不强行合并连线；只有「同一检查项名称 + 检查类别 +
        单位」完全一致的记录才连成一条曲线。
      </div>

      {!memberId || !name ? (
        <EmptyState
          icon="📈"
          title="选择成员与检查项目"
          desc="趋势曲线以检查项名称为主键：同一成员、同一检查项名称 + 检查类别 + 单位完全一致的记录才连成一条曲线。不同名称（如 糖化血红蛋白Al 与 糖化血红蛋白Alc）始终为独立曲线，绝不强行合并；曲线主键不同或单位缺失时仅并排展示并提示不可比较，绝不做自动换算。"
        />
      ) : (
        <>
          {pendingPoints.length > 0 && (
            <div className="card series-card">
              <h4>
                <Chip tone="warn">待确认</Chip> {pendingPoints.length}{' '}
                条待确认记录（不参与趋势统计与连线，确认后自动计入）
              </h4>
              <SeriesTable
                points={pendingPoints}
                reportsById={reportsById}
                bump={bump}
                gotoReport={gotoReport}
              />
            </div>
          )}
          {renderAnalysis(analysis, reportsById, bump, gotoReport)}
        </>
      )}
    </div>
  );
}

function renderAnalysis(
  analysis: ReturnType<typeof analyzeTrend>,
  reportsById: Map<string, Report>,
  bump: () => void,
  gotoReport: (r: Report) => void,
) {
  if (analysis.kind === 'no-data') {
    return <EmptyState icon="📭" title="暂无趋势数据" desc={analysis.message} />;
  }

  if (analysis.kind === 'mixed-units') {
    return (
      <div className="single-series">
        <Notice warning={analysis.warning} tone="danger" />
        <div className="side-by-side">
          {analysis.series.map((s, i) => (
            <div key={s.curveKey} className="card series-card">
              <h4>
                组 {i + 1}：检查项「{s.originalName || <em className="dim">未知</em>}」· 单位「
                {s.unit || <em className="dim">缺失</em>}」共 {s.points.length} 条
              </h4>
              <SeriesTable
                points={s.points}
                reportsById={reportsById}
                bump={bump}
                gotoReport={gotoReport}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (analysis.kind === 'single-series-no-unit') {
    return (
      <div className="single-series">
        <Notice warning={analysis.warning} tone="warn" />
        <div className="card series-card">
          <h4>检查项「{analysis.series.originalName}」单位缺失：仅并排展示原始数值（不连线）</h4>
          <SeriesTable
            points={analysis.series.points}
            reportsById={reportsById}
            bump={bump}
            gotoReport={gotoReport}
          />
        </div>
      </div>
    );
  }

  // numeric-single-unit：同一成员、同一检查项名称、单位一致 → 可连线
  const chartData = analysis.series.points
    .filter((p) => p.numeric !== null)
    .map((p) => ({ date: p.date, value: p.numeric as number }));
  return (
    <div className="single-series">
      <Notice
        warning={`同一成员、同一已确认曲线主键（检查项「${analysis.series.originalName}」· 单位「${analysis.series.unit}」）完全一致，可以比较。以下连线仅连接该曲线主键下的原始数值，未做任何换算。`}
        tone="ok"
      />
      <div className="card series-card">
        <h4>
          <Chip tone="ok">
            检查项：{analysis.series.originalName} · 单位：{analysis.series.unit}
          </Chip>{' '}
          共 {analysis.series.points.length} 条记录
        </h4>
        {chartData.length >= 2 ? (
          <MiniLineChart data={chartData} unit={analysis.series.unit} />
        ) : (
          <div className="dim">
            只有 {chartData.length} 条可解析数值记录，暂不足以连线，下方表格展示原始值。
          </div>
        )}
        {analysis.warning && <div className="notice notice-warn">{analysis.warning}</div>}
        <SeriesTable
          points={analysis.series.points}
          reportsById={reportsById}
          bump={bump}
          gotoReport={gotoReport}
        />
      </div>
    </div>
  );
}

function Notice({ warning, tone }: { warning: string; tone: 'ok' | 'warn' | 'danger' }) {
  return (
    <div className={`notice notice-${tone}`} role="note">
      {tone === 'danger' ? '⚠️ ' : tone === 'warn' ? '❗ ' : 'ℹ️ '}
      {warning}
    </div>
  );
}

function SeriesTable({
  points,
  reportsById,
  bump,
  gotoReport,
}: {
  points: TrendPoint[];
  reportsById: Map<string, Report>;
  bump: () => void;
  gotoReport: (r: Report) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>报告日期</th>
            <th>医院</th>
            <th>原始值</th>
            <th>单位</th>
            <th>参考区间</th>
            <th>状态</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => {
            const report = reportsById.get(p.reportId);
            return (
              <tr key={p.itemId} className={p.confirmed ? '' : 'row-pending'}>
                <td>{p.date}</td>
                <td>{p.hospital}</td>
                <td>{p.rawValue}</td>
                <td>{p.unit || <span className="dim">缺失</span>}</td>
                <td>{p.refRange || '—'}</td>
                <td>
                  <button
                    type="button"
                    className={`status-toggle ${p.confirmed ? 'st-ok' : 'st-warn'}`}
                    onClick={async () => {
                      await db.items.update(p.itemId, { confirmed: !p.confirmed });
                      bump();
                    }}
                  >
                    {p.confirmed ? '✓ 已确认' : '！待确认'}
                  </button>
                </td>
                <td>
                  {report && (
                    <button type="button" className="btn btn-sm" onClick={() => gotoReport(report)}>
                      查看报告
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
