'use strict';
const FIXED_SCHEMA_JSON = `{
  "report": {"reportKind":"","hospital":"","branch":"","reportNo":"","personName":"","gender":"","age":"","patientId":"","clinicalDiagnosis":"","testPurpose":"","reportDate":"","reportTypes":[],"reportType":"","title":"","sampleDate":"","receiveDate":"","printDate":"","senderDoctor":"","inspector":"","reviewer":""},
  "imaging": {"examPart":"","examMethod":"","findings":"","impression":"","measurements":"","exams":[{"examPart":"","examMethod":"","findings":"","impression":"","measurements":""}]},
  "items": [{"name":"","result":"","referenceRange":"","unit":"","method":"","sourceText":""}],
  "extraFields": [{"section":"header|footer|other","key":"","value":"","sourceText":""}],
  "notes": [{"text":"","sourceText":""}],
  "unresolvedText": ""
}`;
const STRUCTURE_SYSTEM_PROMPT = `从文字中识别出检查单的所有检查项目和各个字段值，生成结构化数据。

只做结构整理，不做任何医学判断、不做单位换算、不做诊断或异常解释、不给治疗建议。
只输出一个 JSON 对象，不要输出 Markdown 代码块，不要输出任何多余说明；不要新增或删除任何 key。

固定 schema：
${FIXED_SCHEMA_JSON}

字段说明：
- report.reportKind 只能是 lab、imaging、other；影像报告必须使用 imaging 字段，不得把所见/结论伪装为 items；testPurpose 是公共字段，reportTypes 是报告类型数组（用于匹配预设），reportType 是旧版兼容字段；从 OCR 全文语义识别报告大类、报告类型与检查项目，不依赖「检验目的」「检查项目」等固定中文标题；不确定时留空，不编造；检验将送检/检验目的语义归入 testPurpose，影像将检查项目/检查目的/检查名称等语义归入 testPurpose（系统 UI 标签为检查项目）；
- 影像一份报告可包含多个检查部位/子检查，必须输出 imaging.exams 数组；每个 exams 项必须同时包含 examPart、examMethod、findings、impression、measurements（可为空但不能省略），并列项目拆成多个，缺失内容留空，不得编造或挪用；测量值逐字保留数字、单位和上下文；旧版单项 imaging 字段仍兼容；lab 报告才使用 items；
- report 与 items 的字段值缺失一律填空字符串 ""；
- items 是检查项目列表：name=项目名（只逐字摘录 OCR 原文；不得纠正、猜测或用医学常识改写；无法确定时保留原文并放入 unresolvedText）、
  result=结果值原文（逐字保留数字、符号与小数位，如 "1.1" 不得变成 "1.05"；含 < > ≤ ≥ 前缀时保留；不得换算、四舍五入或医学推断），
  referenceRange=参考区间原文（逐字保留数字、小数位、连接符与单位，如 "1.2-2.4" 不得变成 "1.2-2.5"）、unit=单位原文、method=检验方法原文（缺失填空）、sourceText=该项目来源的原文片段（须与输入逐字一致，用于溯源，不得改动）；
- report 为报告头部信息候选（医院/编号/姓名/日期/送检医生等），无法判断的字段填空 ""；
- 无法归入 report/items 的其它信息（如页眉页脚、机构地址、非项目备注）放到 extraFields 或 notes；
- unresolvedText 放无法可靠对应到任何结构项的原文行（多行用换行分隔），不要猜测、不要丢弃。`;
const REPORT_STRUCTURE_SYSTEM_PROMPT = `从文字中识别出整张报告的信息与检查单的所有检查项目和各个字段值，生成结构化数据。

只做结构整理，不做任何医学判断、不做单位换算、不做诊断或异常解释、不给治疗建议。
只输出一个 JSON 对象，不要输出 Markdown 代码块，不要输出任何多余说明；不要新增或删除任何 key。

固定 schema：
${FIXED_SCHEMA_JSON}

字段说明：
- report.reportKind 只能是 lab、imaging、other；影像报告必须使用 imaging 字段，不得把所见/结论伪装为 items；testPurpose 是公共字段，reportTypes 是报告类型数组（用于匹配预设），reportType 是旧版兼容字段；从 OCR 全文语义识别报告大类、报告类型与检查项目，不依赖「检验目的」「检查项目」等固定中文标题；不确定时留空，不编造；检验将送检/检验目的语义归入 testPurpose，影像将检查项目/检查目的/检查名称等语义归入 testPurpose（系统 UI 标签为检查项目）；
- 影像一份报告可包含多个检查部位/子检查，必须输出 imaging.exams 数组；每个 exams 项必须同时包含 examPart、examMethod、findings、impression、measurements（可为空但不能省略），并列项目拆成多个，缺失内容留空，不得编造或挪用；测量值逐字保留数字、单位和上下文；旧版单项 imaging 字段仍兼容；lab 报告才使用 items；
- report 为整张报告头部信息候选（全部由用户最终决定）：hospital=医院/体检机构、branch=分院、
  reportNo=报告编号、personName=姓名、gender=性别、age=年龄、patientId=病历号、clinicalDiagnosis=临床诊断、
  testPurpose=检验目的、reportDate=报告日期(YYYY-MM-DD)、reportType=报告类型、title=标题、sampleDate=采样日期、receiveDate=接收日期、
  printDate=打印日期、senderDoctor=送检医生、inspector=检验者、reviewer=审核者；无法可靠判断的字段填空 ""（禁止猜测性补全）；
- testPurpose 是公共字段：检验从原文送检/检验目的语义提取；影像从检查项目、检查目的、检查名称等语义提取（系统 UI 标签为检查项目）；从 OCR 全文语义理解，不要求固定标题，原文没有或无法判读时填空；该字段仍为 schema 中的必填字段（值可为空）；reportTypes 用于匹配预设，无法确定时留空，严禁编造；
- items 是检查项目列表：name=项目名（只逐字摘录 OCR 原文；不得纠正、猜测或用医学常识改写；无法确定时保留原文并放入 unresolvedText）、result=结果值原文（逐字保留数字、符号与小数位；不得换算、四舍五入或医学推断），referenceRange=参考区间原文（逐字保留数字、小数位、连接符与单位；不得修正端点）、unit=单位原文、method=检验方法原文（缺失填空）、sourceText=该项目来源的原文片段（须与输入逐字一致，用于溯源，不得改动）；
- 无法归入 report/items 的其它信息放到 extraFields 或 notes；
- unresolvedText 放无法可靠对应到任何结构项的原文行（多行用换行分隔），不要猜测、不要丢弃。`;
function systemPromptForMode(mode) { return mode === 'report' ? REPORT_STRUCTURE_SYSTEM_PROMPT : STRUCTURE_SYSTEM_PROMPT; }
module.exports = { STRUCTURE_SYSTEM_PROMPT, REPORT_STRUCTURE_SYSTEM_PROMPT, systemPromptForMode };
