# 家庭体检档案（Family Medical Archive）

本地优先（Local-first）的中文家庭体检档案管理工具。React + TypeScript + Vite，数据默认仅保存在本机浏览器（IndexedDB），无账号、无云服务器，离线可用（PWA）。

> ⚠️ 本应用仅供个人整理与回顾体检资料，**不构成医疗诊断、异常判断或治疗建议**；所有界面与导出均标注「仅供参考，请遵医嘱」。

## 功能（MVP）

- **家庭成员管理**：姓名、性别、出生日期、关系；级联删除（成员 → 报告 → 条目 → 附件）。
- **体检报告**：成员 / 医院 / 报告日期 / 标题 / 备注；**图片或 PDF 附件**（仅存本机，点击原图/原件在新窗口打开）。
- **报告类型 / 检查类别（严格选项）**：仅从固定清单选择；不做模糊匹配、不做自动分类。
- **报告级批量项目编辑**：同一界面连续添加 / 修改 / 删除多条检查项；每项包含：项目名（报告原文）、数值或定性结果、单位、参考区间、标准标签（可选）、备注、已确认/待确认状态。
- **标准标签**：可选项，仅由用户显式选择/填写；绝不按项目名自动映射、猜测或自动合并；未设置标准标签的条目不参与跨报告趋势。
- **「识别数据」（黑盒流程）**：报告有图片后显示一个「📷 识别数据」按钮 → 打开裁剪器（成熟第三方库 react-easy-crop：拖动、滚轮/双指缩放、缩放滑块、旋转、裁剪区域、重置、取消、确认）→ 确认后自动在本机读取图片 → 自动把读出的文字交给配置的第三方服务整理成检查项目 → 进度只显示「正在读取图片 / 正在整理检查项目」→ 成功后显示识别出的项目供检查/编辑（全部待确认、无标准标签、不会自动进入趋势），由你点击「添加到报告」。失败只给自然语言错误与「重试」。
- **「识别整张报告」（新建报告时，可选）**：添加报告图片后可直接「识别整张报告」，一次返回报告信息候选（医院/报告日期/报告类型/标题/备注）与检查项目候选——全部待确认，成员必须由你选择，点击明确的「创建报告并添加已选项目」后才填入表单（最终保存仍由你触发）。
- **识别名称与推荐标签**：识别出的项目名保留原文（`Al`/`A1`/`AI` 等相似字绝不静默纠正）；另显示低风险清理后的「识别名称」（去首尾空白/折叠空白/去不可见控制字符，不删中文内部空格）；「推荐标签」来自本地受控目录或你已确认的别名映射（或识别服务候选），全部为未确认候选，需逐项「采用」后才写入。
- **标准标签（可选项）**：仅由用户显式选择/填写；绝不按项目名自动映射、猜测或自动合并；未设置标准标签的条目不参与跨报告趋势。用户「采用」的推荐标签保存为家庭级/本地映射（LabelMapping），可在下次识别复用。
- **筛选 / 搜索**：成员、报告类型、日期范围、关键词组合筛选。
- **趋势图**：只对「同一成员 + 同一已确认标准标签 + 单位完全一致」的数值型记录连线；不做换算、合并、猜测或诊断。
- **完整导出 / 导入**：单个 JSON 包含全部数据与附件，可在其他浏览器完整还原。
- **甲功/血糖常用项目快速添加（可选）**：仅在对应严格报告类型下出现，只生成明确候选，绝不自动触发。

## 「识别数据」：隐私与边界

- **默认全部在本机**：健康数据与附件（图片/PDF）只保存在本设备浏览器；图片仅在本机读取与裁剪，**图片不会被发送**。
- **只有少数必要信息会发送**：当你点击「识别数据」并完成裁剪后，从图片中读出的文字会通过**同源代理**（Vite dev server 的 `/api/recognize-report`）发送给你配置的第三方服务，用于整理成检查项目；随附的内容仅有：识别用途标记、受控目录简表（id+名称）与你已确认的别名映射（仅名称到 ID，**不含任何历史健康数值**）。图片、密钥、报告全文、健康数值历史一律不发送。第三方服务的数据处理政策以其条款为准（详见界面右下角「关于与隐私说明」）。
- **密钥仅在本机代理中使用**：服务地址、模型、鉴权方式与 API Key 全部在 **Vite Node 侧**读取（`.env.local`），**不会注入浏览器，也不会进入构建产物**。浏览器端不持有、不显示任何密钥。
- **结构化安全**：返回结果做本地 JSON/schema 校验（`sourceText` 必须逐字命中发送文本；推荐标签 ID 必须在受控目录内，目录外一律不通过）；识别结果恒为**待确认（confirmed=false）、无标准标签（standardLabel=''）**，推荐标签恒为候选（需逐项「采用」）；不自动判断异常、不做诊断/治疗建议、不换算单位、不自动进入趋势；由你逐项核对后点击「添加到报告」/「创建报告并添加已选项目」才会追加，且绝不覆盖既有项目。
- **PDF 暂不支持自动识别**：界面会提示「请上传报告图片」。
- **界面黑盒**：主流程不出现 OCR、AI、模型名、原始文本、二次发送确认、离线解析等技术说明；只保留「识别结果请核对」这类简短必要提示。医疗免责声明保留。

## 本地 OCR 引擎（Tesseract）

图片识别（读取图片中的文字）使用**本地 Tesseract 引擎**（tesseract.js，同源打包资源，离线可用）。

- 引擎与中文模型（chi_sim）随应用打包，从本应用同源加载（`public/ocr/`），首次使用即被浏览器/Service Worker 缓存；不调用任何云端 API、不发送遥测。
- **隐私边界**：图片只在**本机浏览器**内处理，**绝不发送到任何服务端**；结构化整理仍只发送读取出的文字 + 受控目录简表 + 用户别名映射（见上文「识别数据：隐私与边界」）。
- 无引擎切换开关：项目固定使用 Tesseract，界面不展示引擎标识。

## 配置第三方服务（首次使用必做）

旧版本通过 `VITE_OPENCODE_GO_*` 变量让浏览器直连服务，这会把 Key 注入构建产物且受 CORS 限制。现在改为**本地代理**：

```bash
# 1) 编辑项目根目录 .env.local，把现有旧行重命名：
#    VITE_OPENCODE_GO_API_KEY=xxx  →  OPENCODE_GO_API_KEY=xxx
#    其它旧 VITE_OPENCODE_GO_* 行（ENDPOINT/MODEL/AUTH_HEADER/AUTH_SCHEME）同理重命名
cp .env.example .env.local   # 新装用户直接复制模板即可
# 2) 重启 dev 服务后生效
npm run dev
```

- 变量（见 `.env.example`）：主上游 `DEEPSEEK_API_KEY`（必填）、`DEEPSEEK_ENDPOINT`（默认 `https://api.deepseek.com/chat/completions`）、`DEEPSEEK_MODEL`（默认 `deepseek-v4-flash`）、`DEEPSEEK_AUTH_HEADER` / `DEEPSEEK_AUTH_SCHEME`（默认 `Authorization` + `Bearer`，请按服务商控制台确认后再改）。
- **备上游（可选）OpenCode Go（fallback）**：`OPENCODE_GO_API_KEY`、`OPENCODE_GO_ENDPOINT`（默认 `https://opencode.ai/zen/go/v1/chat/completions`）、`OPENCODE_GO_MODEL`（默认 `deepseek-v4-flash`）、`OPENCODE_GO_AUTH_HEADER` / `OPENCODE_GO_AUTH_SCHEME`（默认 `Authorization` + `Bearer`）。**优先级与 fallback 规则**：每次识别总是先请求主上游直连 DeepSeek；**仅当** DeepSeek 返回 `429`/`402` 或响应体出现明显的额度/配额耗尽（额度不足 / quota exhausted 等）时才自动切到 OpenCode Go；其它错误（401/403/500/502/504/网络/超时）**不触发** fallback，仍返回原有清洗错误。未配置 `OPENCODE_GO_API_KEY` 则不启用 fallback。备上游失败同样返回其清洗错误（不再二次 fallback）。`DEEPSEEK_*` 与 `OPENCODE_GO_*` 一样只在本机 Node 侧读取，不注入浏览器/构建产物；识别时仍只发送 OCR 文本。
- **旧变量兼容**：若暂时没重命名，本地代理仍会兼容读取旧的 `VITE_OPENCODE_GO_*`，但前端源码已完全不引用它们；请尽快按上面重命名。
- 这些变量的值**只在 Vite dev 的 Node 侧**使用：不进入 bundle、不写入健康数据、不在界面显示。
- **生产构建（`npm run build` + `npm run preview` / 静态部署）说明**：Vite dev 的本地代理**只适合本机开发**。`dist/` 是纯静态产物，`/api/recognize-report` 在此类部署下**不可用**（「识别数据」会提示接口不可用）。如需对外/持续使用，请自建后端网关：浏览器只请求你自己的后端，由后端持有 Key 并转发（本仓库未包含该后端）。

## 开发

```bash
npm install        # 安装依赖
npm run dev        # 本地开发（默认 http://localhost:5173）
npm run typecheck  # 类型检查（tsc -b --noEmit）
npm test           # 单元测试（vitest）
npm run build      # 类型检查 + 生产构建（dist/）
npm run format     # Prettier 格式化
npm run format:check
npm run sync:ocr        # 重新生成 public/ocr/ 的 Tesseract 资源
npm run preview    # 预览构建产物（注意：无本地代理，识别接口不可用）
```

> **开发模式的 Service Worker**：`npm run dev` 下绝不注册 Service Worker，并会注销本 origin 上所有 SW。

## 目录结构

```
src/
  main.tsx                  # 入口 + Service Worker 注册
  App.tsx                   # 布局 / 标签页路由 / 页脚「关于与隐私说明」
  db.ts                     # Dexie 数据库与级联删除
  types.ts                  # 数据模型、报告类型/标签常量
  components/
    ReportRecognitionPanel.tsx  # 「识别数据」黑盒流程（裁剪 → 本机读取 → 同源代理整理 → 核对/添加）
    ImageCropModal.tsx          # 图片裁剪弹窗（react-easy-crop，纯本地）
    PrivacyModal.tsx            # 隐私说明弹窗
    MemberManager / ReportManager / ReportForm / TrendView / DataManager / Kit / MiniLineChart
  utils/
    ocr.ts                  # 本机文字识别会话（tesseract.js，只输出文字）
    ocrEngine.ts            # Tesseract 单一引擎工厂与统一接口
    ocrPreprocess.ts        # 本机图像预处理（缩放/灰度/裁剪，纯像素函数可单测）
    aiStructure.ts          # 返回结果本地校验与清洗（含推荐标签校验、整张报告识别清洗）
    displayName.ts          # 「识别名称」低风险展示清理（保留原文，仅展示层）
    recognizeApi.ts         # 同源代理客户端（仅发 { text, mode, catalog, labelMappings }，无密钥）
    ocrCandidate.ts         # 候选项共享类型与草稿映射（含推荐标签字段，恒为候选）
    labelDirectory.ts       # 受控目录确定性匹配（规范化仅用于定位）与模型推荐校验
    labelMappings.ts        # 家庭级/本地「名称→目录标签」映射（Dexie v2）读写
    labels.ts / trend.ts / dates.ts / exportImport.ts
  data/
    controlledLabCatalog.ts # 受控检验项目目录（本地首版 30 条候选，待人工审核；含 LOINC 许可声明）
  shared/
    structurePrompt.ts      # 服务端系统提示词（仅 Vite Node 侧与测试引用，不进 bundle）
    recognizeProtocol.ts    # 识别代理请求/响应结构与清洗（浏览器 ↔ Node 侧共享）
vite.config.ts              # 含 /api/recognize-report 本地代理（Node 侧读 env、加鉴权、清洗上游错误）
public/ocr/                 # 本机识别引擎/中文模型打包资源
scripts/sync-ocr-assets.mjs # 重新生成 public/ocr/ 资源

docs/controlled-lab-catalog.md  # 受控目录来源说明（候选清单、LOINC 许可、国家代码边界）
```

## 测试覆盖

- `aiStructure.test.ts`：schema 校验/清洗、推荐标签目录内/目录外校验、整张报告识别清洗、sourceText 逐字校验、候选恒为待确认无标签、提示词约束；
- `displayName.test.ts`：识别名称低风险清理（去首尾空白/折叠空白/去控制字符、Al/A1/AI 不静默纠正）；
- `labelDirectory.test.ts`：受控目录结构与数量、确定性匹配先于模型、目录外 AI ID 不通过、别名映射推荐；
- `labelMappings.test.ts`：标签映射规范化键与简表（仅名称到 ID，不含健康数值）；
- `recognizeApi.test.ts`：同源代理请求形状（{ text, mode, catalog?, labelMappings? }）、错误状态→自然语言映射、超时/网络失败、无 Key 泄露；
- `viteConfigHelpers.test.ts`（Node 侧）：主/备上游配置读取与默认值、429/402/额度关键词判定（`isQuotaFailure`）、**主上游 DeepSeek 429/额度错误自动 fallback 到 OpenCode Go、普通 500 不 fallback、fallback 后仍返回同样结构化内容**（`recognizeWithFallback`）；
- `ocrEngine.test.ts`：Tesseract 单一引擎工厂——工厂 `create` 路由到既有 `LocalOcrSession`、接口类型一致性（Tesseract 会话满足同一 `OcrEngine` 接口）；
- `architectureConstraints.test.ts`：源级约束——前端源码无 `VITE_*`/`OPENCODE_GO_*`/上游地址/鉴权头（旧 `VITE_OCR_ENGINE` / `VITE_OCR_PADDLE_*` 已随 Paddle 引擎一并移除，不再有白名单豁免），代理仅存在于 vite.config.ts（Node 侧），旧技术入口已删除，裁剪为纯本地，隐私入口存在；
- 其余：趋势/标准标签规则、导入清洗（含 LabelMapping）、OCR 预处理像素函数、候选项草稿映射。

> 本仓库未配置 `security-scan` 脚本：无 npm 级安全扫描任务可运行。提交前请自行确认不把 `.env.local`/密钥/构建产物纳入版本控制。
