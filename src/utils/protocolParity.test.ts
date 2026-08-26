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
    const api = readFileSync(resolve(process.cwd(), 'api/recognize-report.js'), 'utf8');
    expect(api).toContain('module.exports = async function handler');
    expect(api).toContain('DEEPSEEK_API_KEY');
    expect(api).not.toContain('import.meta.env');
  });

  it('Vercel API 使用无浏览器/Vite 依赖的纯 Node 服务模块', () => {
    const api = readFileSync(resolve(process.cwd(), 'api/recognize-report.js'), 'utf8');
    expect(api).toContain('dependency-free CommonJS entrypoint');
    expect(api).toContain('SYSTEM_PROMPT');
    expect(api).not.toContain("from '../recognizeServer'");
    const service = readFileSync(resolve(process.cwd(), 'api/recognize-service.ts'), 'utf8');
    expect(service).not.toContain("from '../src/");
    expect(service).not.toContain("from './src/");
    expect(service).toContain('DEEPSEEK_API_KEY');
    expect(service).toContain('systemPrompt');
  });

  it('唯一运行核心实际使用共享 prompt 产物，而非重复 prompt', () => {
    const core = require('../../recognize-core.cjs') as {
      STRUCTURE_SYSTEM_PROMPT: string;
      REPORT_STRUCTURE_SYSTEM_PROMPT: string;
      buildPayload: (text: string, mode: string) => { messages: Array<{ content: string }> };
    };
    expect(core.STRUCTURE_SYSTEM_PROMPT).toBe(STRUCTURE_SYSTEM_PROMPT);
    expect(core.REPORT_STRUCTURE_SYSTEM_PROMPT).toBe(REPORT_STRUCTURE_SYSTEM_PROMPT);
    expect(core.buildPayload('probe', 'items').messages[0].content).toBe(STRUCTURE_SYSTEM_PROMPT);
    expect(core.buildPayload('probe', 'report').messages[0].content).toBe(REPORT_STRUCTURE_SYSTEM_PROMPT);
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
    expect(combined).toContain('convert units');
    expect(combined).toContain('JSON');
  });
});
