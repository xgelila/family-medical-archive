import { useEffect, useMemo, useState } from 'react';
import { db, deleteReportCascade, now } from '../db';
import type { AttachmentRecord, Member, Report, ReportItem } from '../types';
import { REPORT_TYPES } from '../types';
import { Chip, ConfirmButton, EmptyState, Field } from './Kit';
import { toDisplayDate } from '../utils/dates';

export interface ReportFilters {
  memberId: string;
  keyword: string;
  reportType: string;
  dateFrom: string;
  dateTo: string;
}

export function ReportManager({
  refreshKey,
  bump,
  onCreate,
  onEdit,
}: {
  refreshKey: number;
  bump: () => void;
  onCreate: () => void;
  onEdit: (r: Report) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [items, setItems] = useState<ReportItem[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [filters, setFilters] = useState<ReportFilters>({
    memberId: '',
    keyword: '',
    reportType: '',
    dateFrom: '',
    dateTo: '',
  });

  useEffect(() => {
    const load = async () => {
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
    };
    void load();
  }, [refreshKey]);

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

  const visibleReports = useMemo(() => {
    return reports
      .filter((r) => (filters.memberId ? r.memberId === filters.memberId : true))
      .filter((r) => (filters.reportType ? r.reportType === filters.reportType : true))
      .filter((r) => (filters.dateFrom ? r.reportDate >= filters.dateFrom : true))
      .filter((r) => (filters.dateTo ? r.reportDate <= filters.dateTo : true))
      .filter((r) => {
        if (!kw) return true;
        const hay = [
          r.hospital,
          r.reportType,
          r.title,
          r.notes,
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

  const toggleConfirm = async (it: ReportItem) => {
    await db.items.update(it.id, { confirmed: !it.confirmed, updatedAt: now() });
    bump();
  };

  const activeFilterCount =
    (filters.memberId ? 1 : 0) +
    (filters.keyword ? 1 : 0) +
    (filters.reportType ? 1 : 0) +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0);

  return (
    <>
      <div className="toolbar card">
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
        <Field label="报告类型">
          <select
            value={filters.reportType}
            onChange={(e) => setFilters((f) => ({ ...f, reportType: e.target.value }))}
          >
            <option value="">全部类型</option>
            {REPORT_TYPES.map((t) => (
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
        <Field label="关键词" hint="医院 / 类型 / 项目名 / 标准标签 / 数值">
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
              setFilters({ memberId: '', keyword: '', reportType: '', dateFrom: '', dateTo: '' })
            }
          >
            清除筛选（{activeFilterCount}）
          </button>
        )}
      </div>

      <div className="list-head">
        <span>共 {visibleReports.length} 份报告</span>
        <button type="button" className="btn btn-primary" onClick={onCreate}>
          + 新建报告
        </button>
      </div>

      {visibleReports.length === 0 ? (
        <EmptyState
          icon="📄"
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
            ) : undefined
          }
        />
      ) : (
        <div className="report-list">
          {visibleReports.map((r) => {
            const member = memberById.get(r.memberId);
            const its = itemsByReport.get(r.id) ?? [];
            const matched = kw
              ? its.filter((it) =>
                  [it.name, it.standardLabel ?? '', it.value, it.refRange, it.notes]
                    .join(' ')
                    .toLowerCase()
                    .includes(kw),
                )
              : its;
            const atts = attsByReport.get(r.id) ?? [];
            const pendingCount = its.filter((it) => !it.confirmed).length;
            return (
              <div key={r.id} className="card report-card">
                <div className="report-head">
                  <div>
                    <div className="report-title">
                      {member ? (
                        <span className="member-tag">{member.name}</span>
                      ) : (
                        <span className="member-tag member-tag-missing">成员缺失</span>
                      )}
                      <Chip tone="info">{r.reportType || '未分类'}</Chip>
                      {pendingCount > 0 && <Chip tone="warn">{pendingCount} 项待确认</Chip>}
                    </div>
                    <div className="member-meta">
                      {toDisplayDate(r.reportDate)} · {r.hospital} {r.title ? `· ${r.title}` : ''}
                    </div>
                    <div className="member-meta">
                      {its.length} 项检查 · {atts.length} 个附件
                    </div>
                  </div>
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

                {atts.length > 0 && (
                  <div className="att-row">
                    <span className="att-label">附件：</span>
                    {atts.map((a) => (
                      <AttachmentChip key={a.id} att={a} />
                    ))}
                  </div>
                )}

                {its.length > 0 && (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>检查项目</th>
                          <th>结果</th>
                          <th>单位</th>
                          <th>参考区间</th>
                          <th>状态</th>
                          <th>备注</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(kw ? matched : its).map((it) => (
                          <tr key={it.id} className={it.confirmed ? '' : 'row-pending'}>
                            <td>
                              {it.name}
                              {it.standardLabel ? (
                                <Chip tone="neutral">标签：{it.standardLabel}</Chip>
                              ) : null}
                            </td>
                            <td>
                              {it.value}
                              {it.resultKind === 'qualitative' && <Chip tone="neutral">定性</Chip>}
                            </td>
                            <td>{it.unit || <span className="dim">缺失</span>}</td>
                            <td>{it.refRange || '—'}</td>
                            <td>
                              <button
                                type="button"
                                className={`status-toggle ${it.confirmed ? 'st-ok' : 'st-warn'}`}
                                onClick={() => void toggleConfirm(it)}
                                title="点击切换已确认/待确认"
                              >
                                {it.confirmed ? '✓ 已确认' : '！待确认'}
                              </button>
                            </td>
                            <td className="dim">{it.notes || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {kw && matched.length === 0 && (
                  <div className="dim" style={{ padding: '6px 0' }}>
                    该报告内无匹配“{kw}”的项目
                  </div>
                )}
                {r.notes ? (
                  <div className="report-notes">
                    <strong>报告备注：</strong>
                    {r.notes}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function AttachmentChip({ att }: { att: AttachmentRecord }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked = false;
    const u = URL.createObjectURL(att.blob);
    if (!revoked) setUrl(u);
    return () => {
      revoked = true;
      URL.revokeObjectURL(u);
    };
  }, [att]);

  const open = () => {
    if (url) window.open(url, att.kind === 'image' ? '_blank' : '_blank');
  };

  const label = att.kind === 'image' ? '🖼️' : att.kind === 'pdf' ? '📄' : '📎';
  return (
    <button
      type="button"
      className="att-chip"
      onClick={open}
      title={`打开附件 ${att.name}（新窗口）`}
    >
      {label} {att.name}
      {(att.size / 1024).toFixed(0)}KB
    </button>
  );
}
