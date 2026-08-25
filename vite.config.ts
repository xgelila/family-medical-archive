/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { isRecognizeMode, type RecognizeMode } from './src/shared/recognizeProtocol';
import { announceMockEnabled, buildMockRecognizeContent, isMockRecognitionEnabled, MOCK_DEV_MODE, mockDelayMs } from './src/shared/mockRecognition';
const require = createRequire(import.meta.url);
const core: any = require('./recognize-core.cjs');
// Server-only compatibility names retained; OPENCODE_GO_API_KEY and VITE_OPENCODE_GO_API_KEY are legacy local fallback settings.
export const readDeepSeekConfig = (env:Record<string,string>) => { const c=core.config(env); return {...c,authValue:`${c.authScheme?c.authScheme+' ':''}${c.apiKey}`}; };
export const readServerConfig = (env:Record<string,string>) => { const pick=(names:string[])=>names.map(n=>env[n]?.trim()).find(Boolean)||''; const key=pick(['OPENCODE_GO_API_KEY','VITE_OPENCODE_GO_API_KEY']); const scheme=env.OPENCODE_GO_AUTH_SCHEME??env.VITE_OPENCODE_GO_AUTH_SCHEME??'Bearer'; const endpoint=pick(['OPENCODE_GO_ENDPOINT','VITE_OPENCODE_GO_ENDPOINT'])||'https://opencode.ai/zen/go/v1/chat/completions'; const model=pick(['OPENCODE_GO_MODEL','VITE_OPENCODE_GO_MODEL'])||core.DEFAULT_MODEL; const authHeader=pick(['OPENCODE_GO_AUTH_HEADER','VITE_OPENCODE_GO_AUTH_HEADER'])||'Authorization'; return {name:'opencode-go',apiKey:key,endpoint,model,authHeader,authValue:scheme.trim()?`${scheme.trim()} ${key}`:key}; };
export const buildUpstreamPayload = (model:string,text:string,req:{mode?:RecognizeMode}={}) => JSON.stringify(core.buildPayload(text,isRecognizeMode(req.mode)?req.mode:'items',core.config({DEEPSEEK_MODEL:model})));
export const extractUpstreamContent = core.extractContent;
export const upstreamErrorMessage = core.errorMessage;
export type RecognizeServerConfig = any;
export const isQuotaFailure = core.quotaFailure;
export const callUpstream = core.callUpstream;
export const recognizeWithFallback = core.recognizeWithFallback;
export const recognizeWithFallbackDebug = core.recognizeWithFallbackDebug;
export const jsonError = (status:number,message:string) => JSON.stringify({error:{message,status}});
export function readUpstreamTimeouts(env:Record<string,string>): {primaryTimeoutMs:number;fallbackTimeoutMs:number} { const n=(v:string|undefined,d:number)=>v&&Number(v)>0?Number(v):d; return {primaryTimeoutMs:n(env.DEEPSEEK_TIMEOUT_MS,25000),fallbackTimeoutMs:n(env.OPENCODE_GO_TIMEOUT_MS,20000)}; }
const MAX_BODY=512*1024;
function write(res:ServerResponse,status:number,body:unknown){res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.end(JSON.stringify(body));}
function readBody(req:IncomingMessage):Promise<any>{return new Promise(resolve=>{const chunks:Buffer[]=[];let n=0;req.on('data',(c:Buffer)=>{n+=c.length;if(n<=MAX_BODY)chunks.push(c);});req.on('end',()=>{if(n>MAX_BODY)return resolve({error:[413,'提交的内容过大，请裁剪图片后重试。']});try{const b=JSON.parse(Buffer.concat(chunks).toString());resolve(typeof b?.text==='string'&&b.text.trim()?b:{error:[400,'提交内容格式不正确，请重新识别后重试。']});}catch{resolve({error:[400,'提交内容格式不正确，请重新识别后重试。']});}});req.on('error',()=>resolve({error:[400,'提交内容读取失败，请重新识别后重试。']}));});}
function middleware(env:Record<string,string>,mock:boolean,delay:number):Plugin{return{name:'recognize-report-middleware',configureServer(server){server.middlewares.use(async(req,res,next)=>{if((req.url||'').split('?')[0]!=='/api/recognize-report')return next();if(req.method!=='POST')return write(res,405,{error:{message:'该接口仅支持 POST 请求。',status:405}});const b=await readBody(req);if(b.error)return write(res,b.error[0],{error:{message:b.error[1],status:b.error[0]}});if(mock){if(delay)await new Promise(r=>setTimeout(r,delay));return write(res,200,{content:buildMockRecognizeContent(isRecognizeMode(b.mode)?b.mode:'items')});}const result=await core.recognize(b.text,b.mode,env);return result.content?write(res,200,{content:result.content}):write(res,result.status,{error:{message:result.error.message,status:result.status}});});}};}
export default defineConfig(({mode})=>{const env=loadEnv(mode,process.cwd(),'');const mock=mode===MOCK_DEV_MODE&&isMockRecognitionEnabled(env);if(mock)announceMockEnabled();return{plugins:[react(),middleware(env,mock,mock?mockDelayMs(env):0)],base:'./',resolve:{dedupe:['react','react-dom']},optimizeDeps:{include:['react','react-dom']},build:{outDir:'dist',sourcemap:false},test:{environment:'node',include:['src/**/*.test.ts','api/**/*.test.ts','viteConfigHelpers.test.ts']}};});
