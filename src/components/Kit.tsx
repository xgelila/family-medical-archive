import type { ReactNode } from 'react';
import { FileText } from 'lucide-react';

/** 全局提示条：本地存储 + 识别结果核对 + 非医疗诊断边界 */
export function Disclaimer() {
  return (
    <div className="disclaimer" role="note">
      <strong>本地存储 · 仅供参考</strong>
      <span>
        所有数据仅保存在<em>本设备浏览器</em>中，无需账号；识别结果请核对后确认。
        本应用仅供个人整理与回顾体检资料，<em>不构成医疗诊断、异常判断或治疗建议</em>
        ；如有健康疑问请咨询医生。
      </span>
    </div>
  );
}

export function EmptyState({
  icon = <FileText size={40} strokeWidth={1.5} aria-hidden="true" />,
  title,
  desc,
  action,
}: {
  icon?: ReactNode;
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {desc && <div className="empty-desc">{desc}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

/**
 * 统一的下拉框空值反馈（辅助文本，非 toast）：
 * 当「未选择」分支（when 为真）命中时，在原生下选框下方渲染一条 role="status" 的
 * 明确说明，避免用户点开/清空下拉后静默无反馈。优先原生 select 的 change/onBlur 语义与辅助文本。
 */
export function SelectEmptyHint({ when, message }: { when: boolean; message: string }) {
  if (!when) return null;
  return (
    <small className="select-empty-hint" role="status">
      {message}
    </small>
  );
}

export function Chip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'ok' | 'warn' | 'neutral' | 'info';
}) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function ConfirmButton({
  label,
  onConfirm,
  confirmText = '确定',
  danger = false,
  small = false,
}: {
  label: string;
  onConfirm: () => void;
  confirmText?: string;
  danger?: boolean;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      className={`btn ${danger ? 'btn-danger' : 'btn-ghost'} ${small ? 'btn-sm' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        if (window.confirm(`${confirmText}？此操作不可撤销。`)) onConfirm();
      }}
    >
      {label}
    </button>
  );
}

export function Section({
  title,
  right,
  children,
}: {
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-head">
        <h3>{title}</h3>
        {right && <div className="section-right">{right}</div>}
      </div>
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {hint && <em>{hint}</em>}
      </span>
      {children}
    </label>
  );
}
