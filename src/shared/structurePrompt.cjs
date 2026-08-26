'use strict';
const FIXED_SCHEMA_JSON = `{
  "report": {"reportKind":"","hospital":"","branch":"","reportNo":"","personName":"","gender":"","age":"","patientId":"","clinicalDiagnosis":"","testPurpose":"","reportDate":"","reportTypes":[],"reportType":"","title":"","sampleDate":"","receiveDate":"","printDate":"","senderDoctor":"","inspector":"","reviewer":""},
  "imaging": {"examPart":"","examMethod":"","findings":"","impression":"","measurements":"","exams":[{"examPart":"","examMethod":"","findings":"","impression":"","measurements":""}]},
  "items": [{"name":"","result":"","referenceRange":"","unit":"","method":"","sourceText":""}],
  "extraFields": [{"section":"header|footer|other","key":"","value":"","sourceText":""}],
  "notes": [{"text":"","sourceText":""}],
  "unresolvedText": ""
}`;
const STRUCTURE_SYSTEM_PROMPT = `Extract all test items and field values from the report text and return structured data.

Perform structure extraction only. Do not make medical judgments, convert units, diagnose, explain abnormalities, or provide treatment advice.
Only output one JSON object. Do not output Markdown or any extra text. Do not add or remove keys.

Fixed schema:
${FIXED_SCHEMA_JSON}

Field instructions:
- report.reportKind must be lab、imaging、other. For imaging reports use the imaging object and never put findings or impressions into items. testPurpose is a shared field; reportTypes is an array used for category matching; reportType is a legacy compatibility field. Infer the report kind, report types, and test items from the full text, not from fixed headings. If uncertain, use an empty string and do not invent information.
- An imaging report may contain multiple examinations. Put each examination in imaging.exams with examPart, examMethod, findings, impression, and measurements. Keep missing fields empty. Use items only for lab reports.
- Keep sourceText and report details in the original language and wording. Preserve numbers, symbols, decimal places, units, and reference ranges from the input.
- Missing report and item fields must be empty strings.
- items are test items: name is the item name exactly as written; result is the original result text; referenceRange is the original reference range; unit is the original unit; method is the original test method; sourceText is the exact source fragment. If a value cannot be read reliably, leave it empty and put the unreadable original text in unresolvedText.
- Put other information that cannot be reliably assigned to report or items in extraFields or notes.
- Put unclassified original lines in unresolvedText, separated by newlines. Never guess or discard source text.`;;;;;;
const REPORT_STRUCTURE_SYSTEM_PROMPT = `Extract the complete report information, all test items, and all field values from the report text and return structured data.

Perform structure extraction only. Do not make medical judgments, convert units, diagnose, explain abnormalities, or provide treatment advice.
Only output one JSON object. Do not output Markdown or any extra text. Do not add or remove keys.

Fixed schema:
${FIXED_SCHEMA_JSON}

Field instructions:
- report.reportKind must be lab、imaging、other. For imaging reports use the imaging object and never put findings or impressions into items. testPurpose is a shared field; reportTypes is an array used for category matching; reportType is a legacy compatibility field. Infer these from the full report text, not fixed headings. If uncertain, leave the value empty.
- An imaging report may contain multiple examinations. Put each examination in imaging.exams with all five fields: examPart, examMethod, findings, impression, and measurements. Keep missing fields empty. Use items only for lab reports.
- report contains report header candidates such as hospital, branch, reportNo, personName, gender, age, patientId, clinicalDiagnosis, testPurpose (检验目的), reportDate (YYYY-MM-DD), reportType, title, sampleDate, receiveDate, printDate, senderDoctor, inspector, and reviewer. testPurpose is required in the schema; extract the examination/test purpose from the original text when present, otherwise leave it empty. Never invent it.
- Keep sourceText and report details in the original language and wording. Preserve numbers, symbols, decimal places, units, and reference ranges from the input.
- items are test items: name, result, referenceRange, unit, method, and sourceText must be extracted from the original text. If an item or value cannot be read reliably, leave it empty and put the original uncertain text in unresolvedText.
- Put other information in extraFields or notes, and put unclassified original lines in unresolvedText. Never guess or discard source text.`;;;;;;
function systemPromptForMode(mode) { return mode === 'report' ? REPORT_STRUCTURE_SYSTEM_PROMPT : STRUCTURE_SYSTEM_PROMPT; }
module.exports = { STRUCTURE_SYSTEM_PROMPT, REPORT_STRUCTURE_SYSTEM_PROMPT, systemPromptForMode };
