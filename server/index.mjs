import express from 'express';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {database,migrate,transaction} from './db.mjs';
import {bootstrap,authRoutes,admin} from './auth.mjs';
import {stockRoutes,mobileRoutes} from './stock.mjs';
import {fail} from './validation.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
function configuration(){
 const origins=(process.env.CORS_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
 for(const origin of origins){let parsed;try{parsed=new URL(origin);}catch{throw Error('CORS_ORIGINS: origem inválida.');}if(!['http:','https:'].includes(parsed.protocol)||parsed.origin!==origin)throw Error('CORS_ORIGINS exige origens exatas, sem caminho ou wildcard.');}
 const proxy=process.env.TRUST_PROXY??'0';if(!/^\d+$/.test(proxy)||+proxy>10)throw Error('TRUST_PROXY deve ser um número entre 0 e 10.');
 const secure=process.env.COOKIE_SECURE??'true';if(!['true','false'].includes(secure))throw Error('COOKIE_SECURE deve ser true ou false.');
 const hours=Number(process.env.SESSION_TTL_HOURS??8);if(!Number.isInteger(hours)||hours<1||hours>168)throw Error('SESSION_TTL_HOURS deve estar entre 1 e 168.');
 return {origins,proxy:+proxy,secure:secure==='true',hours};
}
export async function createApplication(){
 const options=configuration(),pool=database();
 try{await migrate(pool);await bootstrap(pool);}catch(e){await pool.end();throw e;}
 const app=express();app.disable('x-powered-by');app.set('trust proxy',options.proxy);
 app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  if(req.path.startsWith('/api/'))res.setHeader('Cache-Control','no-store');
  const origin=req.headers.origin;
  if(origin){const own=`${req.protocol}://${req.get('host')}`;if(origin!==own&&!options.origins.includes(origin))return next(Object.assign(Error('Origem não autorizada.'),{status:403}));res.vary('Origin');res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Access-Control-Allow-Headers','Content-Type, X-CSRF-Token, Authorization');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');}
  if(req.method==='OPTIONS')return res.sendStatus(204);
  next();
 });
 app.use(express.json({limit:'2mb',strict:true}));
 app.get('/api/health',async(req,res)=>{await pool.query('SELECT 1');res.json({status:'ok',service:'vetestoque',version:'1.0.0'});});
 authRoutes(app,pool,options);stockRoutes(app,pool);mobileRoutes(app,pool);
 app.get('/api/export',admin,async(req,res)=>{
  const data=await transaction(pool,async c=>{await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');const result={};for(const table of ['records','lots','movements','replenishments','mobile_requests','audit','schema_migrations'])result[table]=(await c.query('SELECT * FROM '+table)).rows;return result;});
  res.setHeader('Content-Disposition','attachment; filename="vetestoque-exportacao-operacional.json"');res.json({format:'vetestoque-postgres-export-v1',exportedAt:new Date().toISOString(),data});
 });
 app.use('/api',(req,res)=>res.status(404).json({error:'Endpoint não encontrado.'}));
 app.use(express.static(resolve(root,'dist'),{index:false,maxAge:'1h'}));
 app.get(['/', '/repor'],(req,res)=>{res.setHeader('Cache-Control','no-cache');res.sendFile(resolve(root,'dist/index.html'));});
 app.use((req,res)=>res.status(404).send('Página não encontrada.'));
 app.use((error,req,res,next)=>{
  if(res.headersSent)return next(error);
  let status=Number(error.status)||500,message=error.status?error.message:'Não foi possível concluir a operação. Tente novamente.';
  if(error.code==='23505'){status=409;message='Registro ou identificador já cadastrado.';}
  if(error.code==='23503'){status=409;message='Cadastro vinculado a outros registros. A operação foi cancelada.';}
  if(['55P03','57014','40P01','40001'].includes(error.code)){status=409;message='Operação concorrente. Atualize e tente novamente com o mesmo envio.';}
  if(error.type==='entity.too.large'){status=413;message='Arquivo ou solicitação excede o limite permitido.';}
  if(error.type==='entity.parse.failed'){status=400;message='JSON inválido.';}
  if(status>=500)console.error(JSON.stringify({event:'request_error',method:req.method,path:req.path,code:error.code||'INTERNAL'}));
  res.status(status).json({error:message});
 });
 return {app,pool};
}
const isMain=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
// scripts/start.mjs imports this module, so it also starts the production server.
if(isMain||process.argv[1]?.endsWith('scripts/start.mjs')){
 try{const {app,pool}=await createApplication();
  const server=app.listen(80,'0.0.0.0',()=>console.log(JSON.stringify({event:'server_listening',host:'0.0.0.0',port:80})));
  server.requestTimeout=30000;server.headersTimeout=15000;
  server.on('error',async()=>{console.error(JSON.stringify({event:'server_start_failed',message:'Não foi possível escutar em 0.0.0.0:80.'}));await pool.end();process.exitCode=1;});
  let closing=false;const close=()=>{if(closing)return;closing=true;console.log(JSON.stringify({event:'server_stopping'}));server.close(async()=>{await pool.end();});const timer=setTimeout(()=>{server.closeAllConnections();},10000);timer.unref();};process.on('SIGTERM',close);process.on('SIGINT',close);
 }catch(error){console.error(JSON.stringify({event:'startup_failed',message:error.message?.includes('password authentication')?'Falha de autenticação no PostgreSQL.':(/^(DATABASE_URL|Primeiro início|PostgreSQL|CORS_ORIGINS|TRUST_PROXY|COOKIE_SECURE|SESSION_TTL_HOURS|Checksum)/.test(error.message)?error.message:'Falha ao inicializar banco ou aplicação. Verifique DATABASE_URL e as permissões de criação de tabelas.')}));process.exitCode=1;}
}
