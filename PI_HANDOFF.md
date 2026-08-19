# PI 交接摘要（Project Handoff）

> 生成时间：2026-08-18 09:51 CST ｜ 项目：family-medical-archive（本地优先家庭体检档案 PWA）
> 范围：仅为本交接摘要；未修改其他文件，未做 Git 提交。本文件不含密钥与真实健康数据。
> 产品形态：**本地优先 PWA / 网页应用，不是浏览器插件**。

## 完成了什么

- **识别上游治理（本轮）**：定位并修复整张报告识别 25s 超时——根因是 `deepseek-v4-flash` 为推理模型，默认先生成超长思维链（复杂固定 schema 下 >90s），撞上备上游超时预算；修复为请求体显式 `thinking: {type:"disabled"}`（实测全文约 5–7s 完成）。随后将主备上游对调：**主上游 = 直连 DeepSeek（DEEPSEEK_*），备上游 = OpenCode Go（OPENCODE_GO_*，仅在 DeepSeek 额度类失败时回退）**；编排层泛化（上游标签取自 config.name），超时预算随之调整（主 25s / 备 20s）。opencode-go 当前每周额度已用尽（429 `GoUsageLimitError`，约 4 天后重置），但不再影响识别（DeepSeek 直连兜底）。

- **整张报告扫描（report 模式）**：识别流程新增「识别整张报告」路径——`src/shared/recognizeProtocol.ts` 的 `RecognizeMode` 含 `'report'`；`src/shared/structurePrompt.ts` 提供 `REPORT_STRUCTURE_SYSTEM_PROMPT`，一次结构化返回报告信息候选（医院/报告日期/报告类型/标题/备注）与检查项目候选，全部待确认、成员必须由用户选择、点击「创建报告并添加已选项目」后才填入表单。`ReportRecognitionPanel.tsx` 承载该 UI。
- **OCR 原样保留与显示清理**：识别项目名 `originalName` 逐字保留原文（`Al`/`A1`/`AI`/`HbA1c` 等绝不静默纠正/合并）；仅另生成低风险清理后的「识别名称」（去首尾空白、折叠空白、去不可见控制字符，不删中文内部空格），由 `src/utils/ocrPreprocess.ts`、`src/utils/ocrCandidate.ts`、`src/utils/displayName.ts` 实现，清理只用于显示，不改存储原文。
- **受控候选目录与标签确认映射**：本地受控候选目录 `src/data/controlledLabCatalog.ts` 当前 32 条，其中 `CATALOG_RECOMMENDABLE` 31 条，`reviewState = 'human_review_required'`，`nationalCode` 一律为 `null`；`evidenceStatus` 分为 `verified_candidate`、`pending_review`、`withheld`，其中 withheld 不参与任何推荐。当前状态计数：`verified_candidate` 31 条、`pending_review` 0 条、`withheld` 1 条。前一小批次提升 4 项为 `verified_candidate`：中性粒细胞百分比（lab-neut-pct）、淋巴细胞百分比（lab-lymph-pct）、空腹血糖（lab-fpg，已明确为**空腹**语义，普通血糖/血糖/GLU/葡萄糖 绝不并入空腹血糖）、促甲状腺激素（lab-tsh）；随后小批次提升 3 项为 `verified_candidate`：高密度脂蛋白胆固醇（lab-hdl）、低密度脂蛋白胆固醇（lab-ldl）、总蛋白（lab-tp）——高/低密度脂蛋白各自独立、绝不混成单一项目，总蛋白与白蛋白（lab-alb）绝不混同；最后小批次提升 3 项为 `verified_candidate`：游离三碘甲状腺原氨酸（lab-ft3）、游离甲状腺素（lab-ft4）、甲状腺过氧化物酶抗体（lab-tpoab）——FT3/FT4/TPOAb 各自独立、绝不混成单一项目，也不与促甲状腺激素（lab-tsh）混同，三者未逐项核验的标准数据元/LOINC/国家代码保持为空。剩余待复核清单：无（`pending_review` 条目已清零）。当前标准为 WS/T 363.9—2023（2023-10-07 发布、2024-04-01 实施），官方 PDF URL 保留在代码；WS/T 886—2026 于 2026-05-25 发布、2026-11-01 实施，标记 future/not current。LOINC 仅以现有候选字段出现，按官方当前许可证使用并保留 https://loinc.org/license/ 来源声明，不构成最终映射。配套说明 `docs/controlled-lab-catalog.md`。`lab-urea` 明确对应 **血尿素氮**（LOINC 3094-0 / 国家数据元血尿素氮检测值），不是普通“尿素”；当前只保留与证据一致的别名边界，保留 `BUN`、`血尿素氮`，不把“尿素”自动合并进该条目。推荐流程（`labelDirectory.ts`/`labels.ts`）：目录命中或用户已确认的 `LabelMapping`（`labelMappings.ts`，家庭级本地映射：source 为 directory-match / user-alias / ai-recommendation）仅生成**候选推荐**，须用户逐项「采用」后才写入 `standardLabel`；无自动映射、猜测或合并。`getCatalogBriefForProxy` 只随代理发送可推荐目录简表（id+名称），不含历史健康数值。
- **隐私/代理边界**：密钥仅存 `.env.local` 的 Vite Node 侧（`OPENCODE_GO_*`，兼容旧的 `VITE_OPENCODE_GO_*`），不进入浏览器与构建产物；`/api/recognize-report` 为 dev 同源代理，生产静态部署不可用（README 已说明）；`sourceText` 必须逐字命中发送文本、目录外 ID 一律不通过。
- **UI 响应式调整（本轮）**：产品定位明确为**本地优先 PWA/网页应用（非浏览器插件）**。界面按断点适配：**桌面保留高密度**布局（紧凑行高、多列表格、更全信息密度）；**移动端单列**排布、更大触控目标（按钮/行/选中区）、数据表改为**横向滚动**（横向 overflow，行内不换行挤缩）、弹窗与图片裁剪器在窄屏下采用**全屏式**呈现以最大化可用区域。实现不依赖浏览器扩展 API，全部基于标准 Web（PWA/响应式 CSS/移动端视口）。
- **验证全绿（本次复核）**：
  - 测试：`npx vitest run` → **14 个文件 / 218 个用例全部通过**（含 viteConfigHelpers 52、labelDirectory 31、aiStructure 25、recognizeApi 23、trend 17、architectureConstraints 11、exportImport 11、labels 10、ocr 9、displayName 8、ocrCandidate/ocrPreprocess 各 7、ocrEngine 4、labelMappings 3）。
  - `npm run typecheck`（tsc -b --noEmit）通过。
  - `npm run build`（tsc -b && vite build）通过，产物 dist/ 正常生成。
  - `npm run format:check` 通过（Prettier 无差异）。

## 进行中

- **医学审核**：受控目录及全部推荐标签仍处于「待人工审核」（`human_review_required`）状态，未做任何诊断/异常判断（应用仅做结构化整理与展示，界面保留免责声明「仅供参考，请遵医嘱」）。
- **标准版本/许可边界**：当前标准证据为 WS/T 363.9—2023；WS/T 886—2026 尚未实施，标记 future/not current。目录仅保留代码中已有的逐项候选证据和边界，`nationalCode` 刻意留空。LOINC 候选不是最终映射，使用时按官方当前许可证并保留官方来源声明。
- 已初始化 Git 仓库并完成首次提交（`2a72d8a`）。本项目未定义 `security-scan` 脚本（README 已注明）；提交前以 `git grep --cached` 手工扫描暂存内容未发现硬编码密钥，且 `.gitignore` 已排除 `.env.local` / `node_modules` / `dist` / `*.tsbuildinfo`。

## 阻塞

- 无功能性阻塞（测试、类型检查、构建、格式全部通过）。
- 风险项（非阻塞但须人工处理）：受控目录仍需逐项医学审核，**不得在未审核前对外部署或视为已完成正式映射**；LOINC 内容使用须按官方当前许可证并随附保留来源声明。

## 下一步

1. 对 `src/data/controlledLabCatalog.ts` 的 32 条候选（名称/别名/单位提示/来源版本）逐项医学审核，审核完成后更新 `evidenceStatus`、`reviewState` 与 `docs/controlled-lab-catalog.md` 状态。当前 `pending_review` 条目已清零（lab-ft3/lab-ft4/lab-tpoab 已提升为 `verified_candidate`）；后续复核聚焦已提升项目的逐项数据元/LOINC 边界与最终医学签核。
2. 取得并逐项核验国家代码表后补充 `nationalCode`（当前一律 `null`，不伪造）。
3. 在不扩大现有结论的前提下，继续逐项核验 WS/T 363.9—2023 数据元引用、WS/T 886—2026 实施状态及现有 LOINC 候选边界（含官方许可来源声明），再决定发布形态。
4. 如需对外使用识别功能，自建后端网关持有密钥并转发（仓库未包含该后端）；生产静态部署下 `/api/recognize-report` 不可用。
5. 已初始化 Git 并完成首次提交；后续改动按阶段提交即可（本项目无 `security-scan` 脚本，提交前手工确认不含 `.env.local`/密钥/构建产物，或自行补充安全扫描脚本）。
