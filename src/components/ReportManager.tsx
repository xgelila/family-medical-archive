import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, FileText } from 'lucide-react';
import { db, deleteReportCascade } from '../db';
import {
  IMAGING_REPORT_TYPES,
  LAB_REPORT_TYPES,
  normalizeReportTypes,
  type AttachmentRecord,
  type ImagingExam,
  type ImagingReport,
  type Member,
  type Report,
  type ReportItem,
} from '../types';
import { mergeReportTypes, loadCustomReportTypes } from '../utils/customReportTypes';
import { Chip, ConfirmButton, EmptyState, Field, ViewState } from './Kit';
import { toDisplayDate } from '../utils/dates';

export interface ReportFilters {
  memberId: string;
  keyword: string;
  reportType: string;
  reportKind: '' | 'lab' | 'imaging' | 'other';
  dateFrom: string;
  dateTo: string;
}

/** Return distinct imaging sub-exams for the list summary, including legacy data. */
export function getImagingSummaryExams(imaging: ImagingReport): ImagingExam[] {
  if (imaging.exams && imaging.exams.length > 0) return imaging.exams;
  return [
    {
      examPart: imaging.examPart,
      examMethod: imaging.examMethod,
      findings: imaging.findings,
      impression: imaging.impression,
      measurements: imaging.measurements,
    },
  ];
}

export function ReportManager({
  refreshKey,
  bump,
  onCreate,
  onEdit,
  onView,
}: {
  refreshKey: number;
  bump: () => void;
  onCreate: () => void;
  onEdit: (r: Report) => void;
  /** 点击列表卡片打开只读报告详情。 */
  onView: (r: Report) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [items, setItems] = useState<ReportItem[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [allReportTypes, setAllReportTypes] = useState<string[]>([]);
  const [filters, setFilters] = useState<ReportFilters>({
    memberId: '',
    keyword: '',
    reportType: '',
    reportKind: '',
    dateFrom: '',
    dateTo: '',
  });
  // 移动端筛选区默认折叠为「筛选」按钮；展开后展示各筛选字段。
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [ms, rs, its, ats] = await Promise.all([
        db.members.toArray(),
        db.reports.toArray(),
        db.items.toArray(),
        db.attachments.toArray(),
      ]);
      setMembers(ms);
      setReports(rs);
      setItems(its);
      setAttachments(ats);
    } catch {
      setLoadError('报告数据加载失败，请重试。');
    } finally {
      setLoading(false);
    }
    // 自定义报告类型为尽力而为：失败时保留默认类型，不阻塞列表
    try {
      const cts = await loadCustomReportTypes();
      setAllReportTypes(mergeReportTypes(cts));
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const itemsByReport = useMemo(() => {
    const map = new Map<string, ReportItem[]>();
    for (const it of items) {
      map.set(it.reportId, [...(map.get(it.reportId) ?? []), it]);
    }
    for (const list of map.values()) list.sort((a, b) => a.index - b.index);
    return map;
  }, [items]);
  const attsByReport = useMemo(() => {
    const map = new Map<string, AttachmentRecord[]>();
    for (const a of attachments) map.set(a.reportId, [...(map.get(a.reportId) ?? []), a]);
    return map;
  }, [attachments]);

  const kw = filters.keyword.trim().toLowerCase();
  const reportTypesForKind = useMemo(() => {
    const source =
      filters.reportKind === 'imaging'
        ? IMAGING_REPORT_TYPES
        : filters.reportKind === 'lab'
          ? LAB_REPORT_TYPES
          : allReportTypes;
    return [
      ...new Set([
        ...source,
        ...reports
          .filter((r) => !filters.reportKind || (r.reportKind ?? 'lab') === filters.reportKind)
          .flatMap(normalizeReportTypes),
      ]),
    ];
  }, [allReportTypes, filters.reportKind, reports]);

  const visibleReports = useMemo(() => {
    return reports
      .filter((r) => (filters.memberId ? r.memberId === filters.memberId : true))
      .filter((r) => (filters.reportKind ? (r.reportKind ?? 'lab') === filters.reportKind : true))
      .filter((r) =>
        filters.reportType ? normalizeReportTypes(r).includes(filters.reportType) : true,
      )
      .filter((r) => (filters.dateFrom ? r.reportDate >= filters.dateFrom : true))
      .filter((r) => (filters.dateTo ? r.reportDate <= filters.dateTo : true))
      .filter((r) => {
        if (!kw) return true;
        const hay = [
          r.hospital,
          r.reportType,
          ...normalizeReportTypes(r),
          r.title,
          r.notes,
          r.testPurpose ?? '',
          ...(r.details ?? []).flatMap((d) => [d.label, d.value]),
          ...(r.imaging
            ? getImagingSummaryExams(r.imaging).flatMap((exam) => [
                exam.examPart,
                exam.examMethod,
                exam.findings,
                exam.impression,
                exam.measurements,
              ])
            : []),
          ...(itemsByReport.get(r.id) ?? []).flatMap((it) => [
            it.name,
            it.standardLabel ?? '',
            it.value,
            it.refRange,
            it.notes,
          ]),
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(kw);
      })
      .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.createdAt - a.createdAt);
  }, [reports, filters, kw, itemsByReport]);

  const activeFilterCount =
    (filters.memberId ? 1 : 0) +
    (filters.keyword ? 1 : 0) +
    (filters.reportType ? 1 : 0) +
    (filters.reportKind ? 1 : 0) +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0);

  return (
    <>
      {loading ? (
        <ViewState
          loading
          loadingTitle="正在加载报告…"
          loadingIcon={<FileText size={22} strokeWidth={1.8} aria-hidden="true" />}
        />
      ) : loadError ? (
        <ViewState error={loadError} onRetry={() => void load()} errorTitle="加载报告失败" />
      ) : (
        <>
          {reports.length > 0 && (
            <div className="toolbar card">
              <button
                type="button"
                className="btn report-filter-toggle"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((v) => !v)}
              >
                筛选{activeFilterCount > 0 ? `（${activeFilterCount}）` : ''}{' '}
                {filtersOpen ? '▴' : '▾'}
              </button>
              <div className={`report-filters ${filtersOpen ? 'open' : ''}`}>
                <Field label="成员">
                  <select
                    value={filters.memberId}
                    onChange={(e) => setFilters((f) => ({ ...f, memberId: e.target.value }))}
                  >
                    <option value="">全部成员</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="报告大类">
                  <select
                    value={filters.reportKind}
                    onChange={(e) =>
                      setFilters((f) => ({
                        ...f,
                        reportKind: e.target.value as ReportFilters['reportKind'],
                        reportType: '',
                      }))
                    }
                  >
                    <option value="">全部大类</option>
                    <option value="lab">检验</option>
                    <option value="imaging">检查</option>
                    <option value="other">其他</option>
                  </select>
                </Field>
                <Field label="报告类型">
                  <select
                    value={filters.reportType}
                    onChange={(e) => setFilters((f) => ({ ...f, reportType: e.target.value }))}
                  >
                    <option value="">全部类型</option>
                    {reportTypesForKind.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="起始日期">
                  <input
                    type="date"
                    value={filters.dateFrom}
                    onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                  />
                </Field>
                <Field label="截止日期">
                  <input
                    type="date"
                    value={filters.dateTo}
                    onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
                  />
                </Field>
                <Field label="关键词" hint="医院 / 类型 / 项目名 / 数值">
                  <input
                    value={filters.keyword}
                    onChange={(e) => setFilters((f) => ({ ...f, keyword: e.target.value }))}
                    placeholder="如：血糖、甲状腺、5.2"
                  />
                </Field>
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ alignSelf: 'flex-end' }}
                    onClick={() =>
                      setFilters({
                        memberId: '',
                        keyword: '',
                        reportType: '',
                        reportKind: '',
                        dateFrom: '',
                        dateTo: '',
                      })
                    }
                  >
                    清除筛选（{activeFilterCount}）
                  </button>
                )}
              </div>
            </div>
          )}

          {reports.length > 0 && (
            <div className="list-head">
              <span>共 {visibleReports.length} 份报告</span>
              <button type="button" className="btn btn-primary" onClick={onCreate}>
                + 新建报告
              </button>
            </div>
          )}

          {visibleReports.length === 0 ? (
            <EmptyState
              icon={<FileText size={40} strokeWidth={1.5} aria-hidden="true" />}
              title={reports.length === 0 ? '还没有体检报告' : '没有符合筛选条件的报告'}
              desc={
                reports.length === 0
                  ? '为家庭成员创建第一份体检报告，可上传原始图片/PDF 附件并逐项录入检查结果。'
                  : '试试调整成员、日期或关键词筛选。'
              }
              action={
                reports.length === 0 ? (
                  <button type="button" className="btn btn-primary" onClick={onCreate}>
                    + 新建报告
                  </button>
                ) : (
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() =>
                        setFilters({
                          memberId: '',
                          keyword: '',
                          reportType: '',
                          reportKind: '',
                          dateFrom: '',
                          dateTo: '',
                        })
                      }
                    >
                      清除筛选
                    </button>
                    <button type="button" className="btn btn-primary" onClick={onCreate}>
                      + 新建报告
                    </button>
                  </div>
                )
              }
            />
          ) : (
            <div className="report-list">
              {visibleReports.map((r) => {
                const member = memberById.get(r.memberId);
                const its = itemsByReport.get(r.id) ?? [];
                const atts = attsByReport.get(r.id) ?? [];
                const pendingCount = its.filter((it) => !it.confirmed).length;
                return (
                  <div key={r.id} className="card report-card">
                    <div className="report-head">
                      <button
                        type="button"
                        className="report-card-open"
                        onClick={() => onView(r)}
                        aria-label="查看报告详情"
                      >
                        <div className="report-title">
                          {member ? (
                            <span className="member-tag">{member.name}</span>
                          ) : (
                            <span className="member-tag member-tag-missing">成员缺失</span>
                          )}
                          <Chip tone="info">{r.reportKind === 'imaging' ? '检查' : '检验'}</Chip>
                          {normalizeReportTypes(r).length > 0 ? (
                            normalizeReportTypes(r).map((t) => (
                              <Chip key={t} tone="info">
                                {t}
                              </Chip>
                            ))
                          ) : (
                            <Chip tone="info">未分类</Chip>
                          )}
                          {pendingCount > 0 && <Chip tone="warn">{pendingCount} 项待确认</Chip>}
                        </div>
                        <div className="member-meta">
                          {toDisplayDate(r.reportDate)} · {r.hospital}{' '}
                          {r.title ? `· ${r.title}` : ''}
                        </div>
                        <div className="member-meta">
                          {its.length} 项检查 · {atts.length} 个附件
                        </div>
                        <span className="report-open-hint">
                          <Eye size={14} strokeWidth={1.8} aria-hidden="true" /> 查看详情
                        </span>
                      </button>
                      <div className="card-actions">
                        <button type="button" className="btn btn-sm" onClick={() => onEdit(r)}>
                          编辑
                        </button>
                        <ConfirmButton
                          label="删除"
                          confirmText={`删除报告「${r.reportDate} ${r.hospital}」及其全部条目和附件`}
                          danger
                          small
                          onConfirm={() => void deleteReportCascade(r.id).then(bump)}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}
