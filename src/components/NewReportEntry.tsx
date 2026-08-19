import { useRef } from 'react';

/**
 * 「新建报告」入口：一级「拍摄 / 从相册选择」，次级「手动录入」。
 * 拍摄/相册选完文件后回传；手动录入则直接进入空表单（表单内仍保留拍摄/图片入口）。
 */
export function NewReportEntry({
  onFiles,
  onManual,
  onCancel,
}: {
  onFiles: (files: File[]) => void;
  onManual: () => void;
  onCancel: () => void;
}) {
  const captureRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const take = (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (list.length > 0) onFiles(list);
  };

  return (
    <div className="card new-report-entry">
      <div className="entry-hero">
        <div className="entry-logo">🩺</div>
        <h2>新建体检报告</h2>
        <p>拍摄或选择报告图片，自动识别医院、日期与检查项目</p>
      </div>

      <div className="entry-actions">
        <button type="button" className="entry-primary" onClick={() => captureRef.current?.click()}>
          <span className="entry-icon">📷</span>
          <span className="entry-text">
            <strong>拍摄报告</strong>
            <small>调用相机直接拍照</small>
          </span>
        </button>
        <button type="button" className="entry-primary" onClick={() => galleryRef.current?.click()}>
          <span className="entry-icon">🖼️</span>
          <span className="entry-text">
            <strong>从相册选择</strong>
            <small>选择照片或 PDF</small>
          </span>
        </button>
        <button type="button" className="entry-secondary" onClick={onManual}>
          <span className="entry-icon">⌨️</span>
          <span className="entry-text">
            <strong>手动录入</strong>
            <small>不拍照，直接填写</small>
          </span>
        </button>
      </div>

      <input
        ref={captureRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          take(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*,.pdf"
        multiple
        hidden
        onChange={(e) => {
          take(e.target.files);
          e.target.value = '';
        }}
      />

      <button type="button" className="entry-cancel" onClick={onCancel}>
        取消
      </button>
    </div>
  );
}
