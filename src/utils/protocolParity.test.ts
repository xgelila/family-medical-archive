import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPORT_FIELD_KEYS, IMAGING_FIELD_KEYS, ITEM_FIELD_KEYS } from '../shared/structureSchema';
import { REPORT_STRUCTURE_SYSTEM_PROMPT, STRUCTURE_SYSTEM_PROMPT } from '../shared/structurePrompt';

describe('本机与 Vercel 结构化协议一致', () => {
  it('Vercel 配置保留 api 函数路由，不把 /api 重写回自身', () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')) as {
      rewrites?: unknown;
      outputDirectory?: string;
    };
    expect(config.outputDirectory).toBe('dist');
    expect(config.rewrites).toBeUndefined();
    const api = readFileSync(resolve(process.cwd(), 'api/recognize-report.ts'), 'utf8');
    expect(api).toContain('export default async function handler');
    expect(api).toContain('readRecognizeServiceConfig(process.env)');
    expect(api).not.toContain('import.meta.env');
  });

  it('Vercel API 使用共享完整 system prompt，而不是另写精简协议', () => {
    const api = readFileSync(resolve(process.cwd(), 'api/recognize-report.ts'), 'utf8');
    expect(api).toContain("from '../recognizeServer'");
    expect(api).toContain('buildRecognizePayload(config.model, body.text, body.mode)');
    const shared = readFileSync(resolve(process.cwd(), 'recognizeServer.ts'), 'utf8');
    expect(shared).toContain("from './src/shared/structurePrompt'");
    expect(shared).toContain('systemPromptForMode(selectedMode)');
    expect(api).not.toContain('严格 JSON。只输出 JSON');
  });

  it('共享 prompt 覆盖 report、lab/imaging/other、reportTypes、testPurpose 和 imaging.exams 协议', () => {
    const combined = `${STRUCTURE_SYSTEM_PROMPT}\n${REPORT_STRUCTURE_SYSTEM_PROMPT}`;
    for (const key of [...REPORT_FIELD_KEYS, ...IMAGING_FIELD_KEYS, ...ITEM_FIELD_KEYS]) {
      expect(combined).toContain(`"${String(key)}"`);
    }
    expect(combined).toContain('lab、imaging、other');
    expect(combined).toContain('reportTypes');
    expect(combined).toContain('testPurpose');
    expect(combined).toContain('imaging.exams');
    expect(combined).toContain('不得换算');
    expect(combined).toContain('JSON');
  });
});
