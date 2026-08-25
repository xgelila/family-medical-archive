import { useEffect, useState } from 'react';
import { FileText, X } from 'lucide-react';
import type { AttachmentRecord } from '../types';

/**
 * 附件查看浮窗：在当前页覆盖层内查看图片 / PDF / 其他附件，不新开浏览器标签页。
 *
 * 契约：
 * - attachment 为 null 时不渲染任何内容；
 * - 用 URL.createObjectURL(attachment.blob) 生成临时 objectURL，组件卸载或 attachment
 *   变化时 revokeObjectURL；
 * - 图片用 <img>、PDF 用 <iframe> 展示；非图片/PDF 显示下载链接（或文件信息）；
 * - 遮罩点击、关闭按钮、Esc 键均可关闭；关闭按钮 >=44px；
 * - 移动端浮窗占满/接近视口且可滚动；语义 role="dialog" aria-modal="true"。
 */
export function AttachmentViewer({
  attachment,
  onClose,
}: {
  attachment: AttachmentRecord | null;
  onClose: () => void;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  // 生成 objectURL；attachment 变化或卸载时撤销旧 URL。
  useEffect(() => {
    if (!attachment) {
      setObjectUrl(null);
      return;
    }
    let alive = true;
    const url = URL.createObjectURL(attachment.blob);
    if (alive) setObjectUrl(url);
    return () => {
      alive = false;
      URL.revokeObjectURL(url);
      setObjectUrl(null);
    };
  }, [attachment]);

  // 打开时锁定背景滚动；Esc 键关闭。
  useEffect(() => {
    if (!attachment) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [attachment, onClose]);

  if (!attachment) return null;

  const isImage = attachment.kind === 'image';
  const isPdf = attachment.kind === 'pdf';

  return (
    <div
      className="modal-overlay attachment-viewer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`查看附件 ${attachment.name}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="attachment-viewer">
        <header className="attachment-viewer-head">
          <strong title={attachment.name}>
            <FileText size={15} strokeWidth={2} aria-hidden="true" /> {attachment.name}
            <span className="dim">（{(attachment.size / 1024).toFixed(0)}KB）</span>
          </strong>
          <button
            type="button"
            className="btn btn-ghost attachment-viewer-close"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} strokeWidth={2} aria-hidden="true" /> 关闭
          </button>
        </header>
        <div className="attachment-viewer-body">
          {isImage && objectUrl ? (
            <img src={objectUrl} alt={attachment.name} className="attachment-viewer-image" />
          ) : isPdf && objectUrl ? (
            <iframe src={objectUrl} title={attachment.name} className="attachment-viewer-pdf" />
          ) : (
            <div className="attachment-viewer-fallback">
              <p className="dim">该附件无法在当前页面预览。</p>
              {objectUrl ? (
                <a className="btn btn-primary" href={objectUrl} download={attachment.name}>
                  下载 {attachment.name}
                </a>
              ) : (
                <p className="dim">
                  {attachment.name}（{(attachment.size / 1024).toFixed(0)}KB ·{' '}
                  {attachment.mimeType || '未知类型'}）
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
