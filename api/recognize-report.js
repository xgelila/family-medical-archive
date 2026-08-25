// dependency-free CommonJS entrypoint; production reads only DEEPSEEK_API_KEY through the shared core. SYSTEM_PROMPT remains in recognize-core.cjs.
const core = require('../recognize-core.cjs');
const MAX_BODY = 512 * 1024;
module.exports = async function handler(req, res) {
  const id = (req.headers && (req.headers['x-vercel-id'] || req.headers['x-request-id'])) || null;
  if (req.method !== 'POST') { const e=core.safeError(405,'METHOD_NOT_ALLOWED',id,'method-check',false,''); return res.status(405).json({error:{...e,status:405,code:e.errorCode},...e}); }
  const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body==null?{}:req.body);
  if(Buffer.byteLength(raw,'utf8')>MAX_BODY){const e=core.safeError(413,'BODY_TOO_LARGE',id,'request-parse',false,'');return res.status(413).json({error:{...e,status:413,code:e.errorCode},...e});}
  let body; try { body=JSON.parse(raw); } catch { body=null; }
  if(!body||typeof body.text!=='string'||!body.text.trim()){const e=core.safeError(400,'INVALID_TEXT',id,'request-parse',false,'');return res.status(400).json({error:{...e,status:400,code:e.errorCode},...e});}
  const result=await core.recognize(body.text,body.mode,process.env);
  if(result.content) return res.status(200).json({content:result.content});
  const e={...result.error,status:result.status,code:result.error.errorCode}; return res.status(result.status).json({error:e,...result.error});
};
