// Compatibility exports. Recognition implementation lives exclusively in recognize-core.cjs.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const core: any = require('./recognize-core.cjs');
export const DEFAULT_RECOGNIZE_ENDPOINT = core.DEFAULT_ENDPOINT;
export const DEFAULT_RECOGNIZE_MODEL = core.DEFAULT_MODEL;
export const DEFAULT_RECOGNIZE_AUTH_HEADER = 'Authorization';
export const DEFAULT_RECOGNIZE_AUTH_SCHEME = 'Bearer';
export const normalizeRecognizeEndpoint = core.normalizeEndpoint;
export function readRecognizeServiceConfig(env: Record<string, string | undefined>) { const c=core.config(env); const {authScheme,...rest}=c; return {...rest, authValue:`${authScheme?authScheme+' ':''}${c.apiKey}`}; }
export function buildRecognizePayload(model:string,text:string,mode?:unknown) { const c=core.config({DEEPSEEK_MODEL:model}); return JSON.stringify(core.buildPayload(text,mode==='report'?'report':'items',c)); }
export const extractRecognizeContent = core.extractContent;
export const recognizeErrorMessage = (status:number) => status===401||status===403 ? '识别服务校验未通过：请检查服务端 DEEPSEEK_API_KEY 配置后重试。' : core.errorMessage(status);
