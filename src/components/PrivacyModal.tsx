import { useEffect } from 'react';
import { X } from 'lucide-react';

/**
 * 「隐私说明」弹窗：集中说明数据的存储、识别、第三方处理、密钥与删除/导出方式。
 * 不涉及任何技术栈名称（不出现 OCR / AI / OpenCode / DeepSeek 等字眼）。
 */
export function PrivacyModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div
      className="modal-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="privacy-modal" role="dialog" aria-modal="true" aria-labelledby="privacy-modal-title">
        <header className="img-editor-head">
          <strong id="privacy-modal-title">隐私说明</strong>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="关闭">
            <X size={16} strokeWidth={2} aria-hidden="true" /> 关闭
          </button>
        </header>

        <div className="privacy-body">
          <section>
            <h4>数据存储</h4>
            <p>
              健康数据和附件（图片/PDF）默认只保存在<strong>本机浏览器的本地数据库中</strong>
              ，无需账号，不会自动上传到任何服务器。离线也能查看。
            </p>
          </section>

          <section>
            <h4>图片识别</h4>
            <p>
              「识别数据」功能会<strong>在本机读取</strong>你选择的报告图片；图片本身
              <strong>不会发送出去</strong>。从图片中读出的文字会发送到你配置的
              第三方模型服务，用于整理成检查项目。
            </p>
          </section>

          <section>
            <h4>第三方服务</h4>
            <p>
              识别出的文字会离开本机、交由你自行配置的第三方服务处理，其保存与使用政策以该服务的
              条款为准。请勿在报告中保留不必要的个人信息。该服务仅当你点击「识别数据」
              后才会被调用。
            </p>
          </section>

          <section>
            <h4>服务密钥</h4>
            <p>
              访问第三方服务所需的密钥只在<strong>本机开发代理</strong>中使用：不会写入健康数据、
              不会显示在界面提示中，也不会进入构建产物。请妥善保管本机配置文件，不要对外分享。
            </p>
          </section>

          <section>
            <h4>非诊断声明</h4>
            <p>
              本应用仅用于个人整理与回顾体检资料，
              <strong>不构成医疗诊断、异常判断或治疗建议</strong>
              ；如有健康疑问请咨询医生。
            </p>
          </section>

          <section>
            <h4>删除与导出</h4>
            <p>
              在「数据」页可随时<strong>导出完整 JSON 备份</strong>（含附件），也可导入恢复；
              删除成员或报告会连同其条目与附件一并删除；如需彻底清除，可在浏览器设置中清除本站点的
              全部数据。
            </p>
          </section>
        </div>

        <footer className="img-editor-foot">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            知道了
          </button>
        </footer>
      </div>
    </div>
  );
}
