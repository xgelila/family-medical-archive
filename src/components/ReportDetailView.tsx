import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  FileText,
  Image as ImageIcon,
  Paperclip,
} from 'lucide-react';
import { db } from '../db';
import {
  normalizeImagingReport,
  normalizeReportTypes,
  type AttachmentRecord,
  type Report,
  type ReportItem,
} from '../types';
import { getImagingSummaryExams } from './ReportManager';
import { toDisplayDate } from '../utils/dates';

/**
 * 生产报告的只读详情视图。
 *
 * 从趋势界面「查看报告」进入；展示报告基础信息 → 检查项目 → 报告详情（默认折叠），
 * 保留 lab/imaging/other、reportTypes、imaging.exams、附件、testPurpose 的完整展示，
 * 但**不含任何编辑控件 / 保存 / 删除 / 修改入口**；提供返回趋势的明确返回操作。
 * 只读视图不修改数据模型，也不改变任何已保存数据。
 */
export function ReportDetailView({
  report,
  memberName,
  onClose,
}: {
  report: Report;
  memberName: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<ReportItem[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      db.items.where('reportId').equals(report.id).toArray(),
      db.attachments.where('reportId').equals(report.id).toArray(),
    ])
      .then(([its, ats]) => {
        if (!alive) return;
        setItems(its.sort((a, b) => a.index - b.index));
        setAttachments(ats);
      })
      .catch(() => {
        /* 只读视图加载失败不阻塞整体展示，附件/项目留空显示 */
      });
    return () => {
      alive = false;
    };
  }, [report.id]);

  const reportTypes = normalizeReportTypes(report);
  const kindLabel =
    report.reportKind === 'imaging' ? '检查' : report.reportKind === 'other' ? '其他' : '检验';
  const imaging = report.imaging ? normalizeImagingReport(report.imaging) : undefined;
  const imagingExams = imaging ? getImagingSummaryExams(imaging) : [];
  const pendingCount = items.filter((it) => !it.confirmed).length;
  const nonEmptyDetails = useMemo(
    () => (report.details ?? []).filter((d) => d.value.trim() !== ''),
    [report.details],
  );

  return (
    <div className="card form-card report-readonly">
      <div className="readonly-head">
        <div>
          <h4>报告详情（只读）</h4>
          <p className="dim">
            {toDisplayDate(report.reportDate)} · {report.hospital}
            {report.title ? ` · ${report.title}` : ''}
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" /> 返回
        </button>
      </div>

      {/* 报告基础信息 */}
      <div className="readonly-basic form-grid">
        <div className="ro-field">
          <dt>成员</dt>
          <dd>{memberName || '未知成员'}</dd>
        </div>
        <div className="ro-field">
          <dt>报告大类</dt>
          <dd>{kindLabel}</dd>
        </div>
        <div className="ro-field">
          <dt>医院 / 体检机构</dt>
          <dd>{report.hospital || '—'}</dd>
        </div>
        <div className="ro-field">
          <dt>报告日期</dt>
          <dd>{toDisplayDate(report.reportDate)}</dd>
        </div>
        <div className="ro-field">
          <dt>报告类型 / 检查类别</dt>
          <dd>
            {reportTypes.length > 0 ? (
              <span className="chip-row">
                {reportTypes.map((t) => (
                  <span key={t} className="chip chip-info">
                    {t}
                  </span>
                ))}
              </span>
            ) : (
              <span className="dim">未分类</span>
            )}
          </dd>
        </div>
        {report.testPurpose ? (
          <div className="ro-field">
            <dt>{report.reportKind === 'imaging' ? '检查目的' : '检验目的'}</dt>
            <dd>{report.testPurpose}</dd>
          </div>
        ) : null}
      </div>

      {attachments.length > 0 && (
        <div className="ro-section">
          <strong className="ro-section-title">附件（{attachments.length}）</strong>
          <div className="att-row">
            {attachments.map((a) => (
              <AttachmentDisplay key={a.id} att={a} />
            ))}
          </div>
        </div>
      )}

      {reportKindHasImaging(report) && imagingExams.length > 0 && (
        <div className="ro-section">
          <strong className="ro-section-title">影像所见</strong>
          <div className="report-imaging-summary">
            {imagingExams.map((exam, index) => (
              <div className="report-imaging-exam" key={`${report.id}-imaging-${index}`}>
                {imagingExams.length > 1 && (
                  <strong>
                    子检查 {index + 1}
                    <br />
                  </strong>
                )}
                <strong>检查部位：</strong>
                {exam.examPart || '—'}
                <br />
                <strong>检查方法：</strong>
                {exam.examMethod || '—'}
                <br />
                <strong>测量值：</strong>
                {exam.measurements.trim() || '—'}
                <br />
                <strong>影像所见：</strong>
                {exam.findings || '—'}
                <br />
                <strong>结论：</strong>
                {exam.impression || '—'}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 检查项目（只读） */}
      <div className="ro-section">
        <strong className="ro-section-title">
          检查项目（{items.length} 项）
          {pendingCount > 0 && <span className="chip chip-warn">{pendingCount} 项待确认</span>}
        </strong>
        {items.length === 0 ? (
          <div className="dim">该报告没有检查项目。</div>
        ) : (
          <>
            <div className="table-wrap item-table-desktop">
              <table className="data-table item-edit-table">
                <thead>
                  <tr>
                    <th>状态</th>
                    <th>检查项目</th>
                    <th>结果</th>
                    <th>单位</th>
                    <th>参考区间</th>
                    <th>检验方法</th>
                    <th>备注</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className={it.confirmed ? '' : 'row-pending'}>
                      <td>
                        <span className={`ro-status ${it.confirmed ? 'st-ok' : 'st-warn'}`}>
                          {it.confirmed ? (
                            <>
                              <Check size={14} strokeWidth={2} aria-hidden="true" /> 已确认
                            </>
                          ) : (
                            <span className="st-warn">待确认</span>
                          )}
                        </span>
                      </td>
                      <td>{it.name}</td>
                      <td>{it.value}</td>
                      <td>{it.unit || <span className="dim">缺失</span>}</td>
                      <td>{it.refRange || '—'}</td>
                      <td>{it.testMethod || '—'}</td>
                      <td className="dim">{it.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="item-cards-mobile ro-item-cards">
              {items.map((it) => (
                <li key={it.id} className={`ro-item-card ${it.confirmed ? '' : 'row-pending'}`}>
                  <div className="ro-item-card-head">
                    <strong>{it.name}</strong>
                    <span className={`ro-status ${it.confirmed ? 'st-ok' : 'st-warn'}`}>
                      {it.confirmed ? '已确认' : '待确认'}
                    </span>
                  </div>
                  <dl className="trend-record-fields">
                    <div>
                      <dt>结果</dt>
                      <dd>{it.value || '—'}</dd>
                    </div>
                    <div>
                      <dt>单位</dt>
                      <dd>{it.unit || '缺失'}</dd>
                    </div>
                    <div>
                      <dt>参考区间</dt>
                      <dd>{it.refRange || '—'}</dd>
                    </div>
                    <div>
                      <dt>检验方法</dt>
                      <dd>{it.testMethod || '—'}</dd>
                    </div>
                    <div>
                      <dt>备注</dt>
                      <dd>{it.notes || '—'}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {report.notes ? (
        <div className="ro-section">
          <strong className="ro-section-title">报告备注</strong>
          <p className="ro-text">{report.notes}</p>
        </div>
      ) : null}

      {/* 报告详情（默认折叠） */}
      <div className="details-section">
        <button
          type="button"
          className="details-toggle"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((v) => !v)}
        >
          <span className="details-linear">
            <ClipboardList size={16} strokeWidth={1.8} aria-hidden="true" /> 报告详情（
            {nonEmptyDetails.length} 项：送检医生 / 检验者 / 审核者等附加信息）
          </span>
          <span className="dim">
            {detailsOpen ? (
              <ChevronUp size={15} strokeWidth={2} aria-hidden="true" />
            ) : (
              <ChevronDown size={15} strokeWidth={2} aria-hidden="true" />
            )}
          </span>
        </button>
        {detailsOpen && (
          <div className="details-editor ro-details">
            {nonEmptyDetails.length === 0 ? (
              <div className="dim">无附加信息。</div>
            ) : (
              nonEmptyDetails.map((d, i) => (
                <div key={i} className="details-row">
                  <span className="details-label">{d.label}</span>
                  <span className="details-value">{d.value}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function reportKindHasImaging(report: Report): boolean {
  return (report.reportKind ?? 'lab') === 'imaging';
}

function AttachmentDisplay({ att }: { att: AttachmentRecord }) {
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

  const kindIcon =
    att.kind === 'image' ? (
      <ImageIcon size={15} strokeWidth={1.8} aria-hidden="true" />
    ) : att.kind === 'pdf' ? (
      <FileText size={15} strokeWidth={1.8} aria-hidden="true" />
    ) : (
      <Paperclip size={15} strokeWidth={1.8} aria-hidden="true" />
    );
  return (
    <button
      type="button"
      className="att-chip"
      onClick={() => {
        if (url) window.open(url, '_blank');
      }}
      title={`打开附件 ${att.name}（新窗口）`}
    >
      {kindIcon} {att.name}
      {(att.size / 1024).toFixed(0)}KB
    </button>
  );
}
