/**
 * 「扫描报告」来源选择浮层（现代 bottom-sheet/modal）。
 *
 * 点击「扫描报告」主按钮后弹出，提供两个明确选项：
 * - 拍摄报告（调用相机，capture）
 * - 从相册选择（相册/文件，可多选图片与 PDF）
 *
 * 边界：仅负责把用户选择转发给上层已有的 file input；复用既有相机/相册能力，保持移动端。
 */
import { useEffect } from 'react';
import { Camera, ChevronRight, Image as ImageIcon, X } from 'lucide-react';

export function ScanSourceSheet({
  onCamera,
  onGallery,
  onClose,
}: {
  onCamera: () => void;
  onGallery: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-overlay source-sheet-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="source-sheet" role="dialog" aria-modal="true" aria-labelledby="scan-source-title">
        <div className="source-sheet-grab" aria-hidden="true" />
        <div className="source-sheet-head">
          <strong id="scan-source-title">扫描报告</strong>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="关闭">
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <div className="source-sheet-body">
          <button type="button" className="source-sheet-option" onClick={onCamera}>
            <span className="entry-icon">
              <Camera size={22} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <span className="entry-text">
              <strong>拍摄报告</strong>
              <small>调用相机直接拍照</small>
            </span>
            <span className="source-sheet-chevron" aria-hidden="true">
              <ChevronRight size={20} strokeWidth={2} />
            </span>
          </button>
          <button type="button" className="source-sheet-option" onClick={onGallery}>
            <span className="entry-icon">
              <ImageIcon size={22} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <span className="entry-text">
              <strong>从相册选择</strong>
              <small>选择照片或 PDF（可多选）</small>
            </span>
            <span className="source-sheet-chevron" aria-hidden="true">
              <ChevronRight size={20} strokeWidth={2} />
            </span>
          </button>
          <p className="source-sheet-note dim">
            选图后将直接进行本机读取与识别。
          </p>
        </div>
      </div>
    </div>
  );
}
