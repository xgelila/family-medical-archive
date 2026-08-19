import { useCallback, useEffect, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';

/**
 * 图片裁剪编辑器（基于成熟第三方库 react-easy-crop）。
 *
 * 功能：拖动、滚轮/触控双指缩放、缩放滑块、旋转、裁剪区域、重置、取消、确认。
 *
 * 隐私/边界：
 * - 只处理本机 Blob 的 object URL，**不修改原附件**；
 * - 确认后把裁剪结果生成为**临时 Blob**（PNG，仅本机 Canvas），交给上层做本地识别；
 * - 不联网、无遥测、不写存储；图片不外发。
 */

export interface CroppedImage {
  /** 裁剪后的临时图片（PNG Blob，仅用于本次识别，不修改原附件） */
  blob: Blob;
}

const MAX_ZOOM = 10;

/** 把裁剪像素区域（含旋转）绘制到新画布并导出为本地 Blob（纯浏览器 Canvas，无任何外发）。 */
async function cropToBlob(imageSrc: string, area: Area, rotation: number): Promise<Blob | null> {
  const image: HTMLImageElement = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片读取失败，请重试'));
    img.src = imageSrc;
  });

  const rot = ((rotation % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const bboxW = swap ? image.height : image.width;
  const bboxH = swap ? image.width : image.height;

  const canvas = document.createElement('canvas');
  canvas.width = bboxW;
  canvas.height = bboxH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.translate(bboxW / 2, bboxH / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(image, -image.width / 2, -image.height / 2);

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = Math.max(1, Math.round(area.width));
  cropCanvas.height = Math.max(1, Math.round(area.height));
  const cctx = cropCanvas.getContext('2d');
  if (!cctx) return null;
  cctx.drawImage(
    canvas,
    Math.round(area.x),
    Math.round(area.y),
    cropCanvas.width,
    cropCanvas.height,
    0,
    0,
    cropCanvas.width,
    cropCanvas.height,
  );

  return new Promise((resolve) => cropCanvas.toBlob((b) => resolve(b), 'image/png'));
}

/** 裁剪弹窗：确认后输出临时 Blob（只在本机处理，绝不上传图片）。 */
export function ImageCropModal({
  blob,
  onConfirm,
  onCancel,
}: {
  blob: Blob;
  onConfirm: (cropped: CroppedImage) => void;
  onCancel: () => void;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [aspect, setAspect] = useState(4 / 3);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // 仅生成本机临时 object URL，卸载即释放
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  // 弹窗打开期间锁定页面滚动
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const handleMediaLoaded = useCallback((mediaSize: { width: number; height: number }) => {
    if (mediaSize.width > 0 && mediaSize.height > 0) {
      setAspect(mediaSize.width / mediaSize.height);
    }
  }, []);

  const rotate90 = () => {
    setRotation((r) => (r + 90) % 360);
    setAspect((a) => 1 / a); // 裁剪框随画面同步旋转
  };

  const resetAll = () => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setError('');
  };

  const confirm = async () => {
    if (!imageUrl || !croppedAreaPixels || busy) return;
    setBusy(true);
    setError('');
    try {
      const out = await cropToBlob(imageUrl, croppedAreaPixels, rotation);
      if (!out) throw new Error('裁剪失败，请重试');
      onConfirm({ blob: out });
    } catch (e) {
      setError(e instanceof Error ? e.message : '裁剪失败，请重试');
      setBusy(false);
    }
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      className="modal-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="img-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-label="裁剪报告图片"
        onClick={stop}
      >
        <header className="img-editor-head">
          <strong>裁剪图片</strong>
          <button type="button" className="btn btn-ghost" onClick={onCancel} aria-label="取消">
            ✖ 取消
          </button>
        </header>

        <div className="img-editor-toolbar">
          <button type="button" className="btn btn-sm btn-primary" onClick={rotate90}>
            ↻ 旋转 90°
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.2))}
            aria-label="放大"
          >
            ＋ 放大
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setZoom((z) => Math.max(1, z / 1.2))}
            aria-label="缩小"
          >
            － 缩小
          </button>
          <label className="crop-zoom-label">
            缩放
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              aria-label="缩放滑块"
            />
            <span>{Math.round(zoom * 100)}%</span>
          </label>
          <button type="button" className="btn btn-sm" onClick={resetAll}>
            重置
          </button>
        </div>

        <div className="crop-viewport">
          {imageUrl ? (
            <Cropper
              image={imageUrl}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={aspect}
              minZoom={1}
              maxZoom={MAX_ZOOM}
              zoomWithScroll
              showGrid
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onRotationChange={setRotation}
              onMediaLoaded={handleMediaLoaded}
              onCropComplete={(_area, pixels) => setCroppedAreaPixels(pixels)}
            />
          ) : (
            <p className="img-editor-loading">正在加载图片…</p>
          )}
        </div>

        <p className="img-editor-hint">
          拖动调整裁剪区域；滚轮 / 双指捏合缩放；可旋转。图片仅在本机处理，不会上传。
        </p>

        {error && <p className="error-text">{error}</p>}

        <footer className="img-editor-foot">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void confirm()}
            disabled={busy || !imageUrl}
          >
            {busy ? '处理中…' : '完成裁剪'}
          </button>
        </footer>
      </div>
    </div>
  );
}
