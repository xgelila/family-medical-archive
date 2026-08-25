import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 需求：编辑页（ReportReview）与只读详情页（ReportDetailView）点击附件都应在当前页
 * 浮窗查看，不新开浏览器标签页。
 *
 * 实现：新建共享组件 AttachmentViewer（modal 浮窗，内部 createObjectURL/revokeObjectURL，
 * 图片 <img> / PDF <iframe> / 其他下载链接，Esc/遮罩/关闭按钮关闭，role=dialog）。
 * ReportDetailView 与 ReportReview 均改为点击设置 preview 附件并以浮窗查看，移除 window.open。
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, 'src', p), 'utf-8');
const s = (src: string, fragment: string) =>
  src.replace(/\s+/g, '').includes(fragment.replace(/\s+/g, ''));

const viewer = read('components/AttachmentViewer.tsx');
const detail = read('components/ReportDetailView.tsx');
const review = read('components/ReportReview.tsx');

describe('AttachmentViewer 组件契约', () => {
  it('attachment 为 null 时不渲染任何内容', () => {
    expect(viewer).toContain('if (!attachment) return null;');
  });

  it('用 URL.createObjectURL(attachment.blob) 生成 objectURL，卸载/变化时 revokeObjectURL', () => {
    expect(viewer).toContain('URL.createObjectURL(attachment.blob)');
    expect(viewer).toContain('URL.revokeObjectURL(url)');
  });

  it('图片用 <img>、PDF 用 <iframe> 分支，其他显示下载链接/文件信息', () => {
    expect(s(viewer, 'isImage && objectUrl ? (<img')).toBe(true);
    expect(s(viewer, 'isPdf && objectUrl ? (<iframe')).toBe(true);
    expect(viewer).toContain('attachment-viewer-fallback');
    expect(viewer).toContain('download={attachment.name}');
  });

  it('按 kind 区分图片/PDF', () => {
    expect(viewer).toContain("attachment.kind === 'image'");
    expect(viewer).toContain("attachment.kind === 'pdf'");
  });

  it('遮罩点击、关闭按钮、Esc 键关闭；关闭按钮 >=44px', () => {
    expect(viewer).toContain("event.key === 'Escape'");
    expect(viewer).toContain('onClose()');
    expect(viewer).toContain('onPointerDown');
    expect(viewer).toContain('attachment-viewer-close');
  });

  it('语义 role="dialog" aria-modal="true"，且不调用 window.open', () => {
    expect(viewer).toContain('role="dialog"');
    expect(viewer).toContain('aria-modal="true"');
    expect(viewer).not.toContain('window.open');
  });

  it('附件 prop 契约：{ attachment, onClose }，类型为 AttachmentRecord | null', () => {
    expect(viewer).toContain('attachment: AttachmentRecord | null;');
    expect(viewer).toContain('onClose: () => void;');
  });
});

describe('ReportDetailView 浮窗查看附件（不再 window.open 新开 tab）', () => {
  it('渲染 AttachmentViewer 并维护 preview 状态', () => {
    expect(detail).toContain("import { AttachmentViewer } from './AttachmentViewer'");
    expect(detail).toContain('<AttachmentViewer');
    expect(detail).toContain('useState<AttachmentRecord | null>(null)');
  });

  it('附件 chip 点击 -> 设置 preview（不 window.open）', () => {
    expect(detail).toContain('onOpen={setPreview}');
    expect(detail).not.toContain('window.open');
  });

  it('附件关闭回调清空 preview', () => {
    expect(s(detail, 'onClose={() => setPreview(null)}')).toBe(true);
  });
});

describe('ReportReview 浮窗查看附件（不再 window.open 新开 tab）', () => {
  it('渲染 AttachmentViewer 并维护 preview 状态', () => {
    expect(review).toContain("import { AttachmentViewer } from './AttachmentViewer'");
    expect(review).toContain('<AttachmentViewer');
    expect(review).toContain('useState<AttachmentRecord | null>(null)');
  });

  it('编辑模式附件 chip 为可点击按钮（点击打开浮窗），保留旁边「移除」ConfirmButton', () => {
    expect(
      review.match(/<button[^>]*className="att-chip"[^>]*onClick=\{\(\) => setPreview\(a\)\}/g),
    ).toBeTruthy();
    expect(review).toContain('<ConfirmButton');
    expect(review).toContain('removeAttachment(a.id)');
  });

  it('附件摘要列表项可点击查看（att-summary-open -> setPreview）', () => {
    expect(review).toContain('att-summary-open');
    expect(s(review, 'onClick={() => setPreview(a)}')).toBe(true);
  });

  it('不调用 window.open，附件保存/移除逻辑不变', () => {
    expect(review).not.toContain('window.open');
    expect(review).toContain('removeAttachment');
    expect(review).toContain('addFiles');
  });
});
