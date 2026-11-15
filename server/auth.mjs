import {randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {hash,id,transaction,audit} from './db.mjs';
import {fail,text} from './validation.mjs';
const scrypt=promisify(scryptCallback);
const random=()=>randomBytes(32).toString('base64url');
export async function passwordHash(password){const salt=randomBytes(16).toString('hex');return salt+':'+(await scrypt(password,salt,64)).toString('hex');}
async function verify(password,encoded){const [salt,key]=encoded.split(':');const actual=await scrypt(password,salt,64),expected=Buffer.from(key,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);}
let dummyHash;
export async function bootstrap(pool){await transaction(pool,async c=>{
 await c.query('SELECT pg_advisory_xact_lock(75623813)');
 if((await c.query("SELECT id FROM users WHERE role='admin' AND active=true LIMIT 1")).rowCount)return;
 const email=process.env.ADMIN_EMAIL?.trim().toLowerCase(),password=process.env.ADMIN_PASSWORD;
 if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!password||password.length<12||password.length>256)throw Error('Primeiro início: configure ADMIN_EMAIL e ADMIN_PASSWORD (12 a 256 caracteres).');
 await c.query("INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$2,'Administrador',$3,'admin')",[id(),email,await passwordHash(password)]);
 console.log(JSON.stringify({event:'admin_bootstrapped'}));
 });dummyHash=await passwordHash(random());}
export function authRoutes(app,pool,options){
 const cookie=(token,maxAge)=>`vetestoque_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${options.secure?'; Secure':''}`;
 app.post('/api/auth/login',async(req,res)=>{
  const email=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'';
  const password=typeof req.body?.password==='string'?req.body.password:'';
  if(email.length>254||password.length>256)fail('E-mail ou senha inválidos.',401);
  const key=hash(req.ip+'|'+email),ipkey=hash('ip|'+req.ip);
  const result=await transaction(pool,async c=>{
   // Serialize counters, including accounts that do not exist.
   await c.query('SELECT pg_advisory_xact_lock(75623814)');
   await c.query("DELETE FROM login_attempts WHERE window_start<now()-interval '15 minutes'");
   const blocked=(await c.query('SELECT key,failures FROM login_attempts WHERE key=ANY($1::text[])',[[key,ipkey]])).rows.some(r=>r.failures>=(r.key===ipkey?60:10));
   if(blocked)return {blocked:true};
   const user=(await c.query('SELECT * FROM users WHERE email=$1 AND active=true',[email])).rows[0];
   const valid=await verify(password,user?.password_hash||dummyHash);
   if(!user||!valid){for(const k of [key,ipkey])await c.query('INSERT INTO login_attempts(key,failures) VALUES($1,1) ON CONFLICT(key) DO UPDATE SET failures=login_attempts.failures+1',[k]);return {denied:true};}
   await c.query('DELETE FROM login_attempts WHERE key=$1',[key]);
   await c.query('DELETE FROM sessions WHERE expires<now()');
   const token=random(),csrf=random(),hours=options.hours;
   await c.query("INSERT INTO sessions(token_hash,user_id,csrf,expires) VALUES($1,$2,$3,now()+($4 * interval '1 hour'))",[hash(token),user.id,csrf,hours]);
   await audit(c,{id:user.id},'login',user.id);
   return {token,csrf,user:{id:user.id,name:user.name,email:user.email,role:user.role}};
  });
  if(result.blocked)fail('Muitas tentativas. Aguarde 15 minutos.',429);
  if(result.denied)fail('E-mail ou senha inválidos.',401);
  res.setHeader('Set-Cookie',cookie(result.token,options.hours*3600));res.json({user:result.user,csrf:result.csrf});
 });
 app.use('/api',async(req,res,next)=>{
  if(req.path==='/health')return next();
  const token=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization||'')?.[1];
  if(token){const link=(await pool.query('SELECT id,name FROM replenisher_links WHERE token_hash=$1 AND active=true AND expires>now()',[hash(token)])).rows[0];if(!link)fail('Link expirado ou revogado. Solicite um novo link.',401);req.actor={...link,role:'replenisher',id:'link:'+link.id};return next();}
  const sessionToken=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('vetestoque_session='))?.slice(19);
  if(!sessionToken||!/^[A-Za-z0-9_-]{43}$/.test(sessionToken))fail('Entre para acessar o sistema.',401);
  const row=(await pool.query('SELECT s.csrf,s.token_hash,u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires>now() AND u.active=true',[hash(sessionToken)])).rows[0];
  if(!row)fail('Sessão expirada. Entre novamente.',401);
  req.actor={id:row.id,name:row.name,email:row.email,role:row.role};req.session=row;
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers['x-csrf-token']!==row.csrf)fail('Sessão de segurança inválida. Atualize a página.',403);
  next();
 });
 app.get('/api/auth/me',(req,res)=>res.json({user:req.actor,csrf:req.session?.csrf||null}));
 app.post('/api/auth/logout',admin,async(req,res)=>{await pool.query('DELETE FROM sessions WHERE token_hash=$1',[req.session.token_hash]);res.setHeader('Set-Cookie',cookie('',0));res.json({ok:true});});
 app.post('/api/auth/password',admin,async(req,res)=>{
  const password=text(req.body?.password,256);if(password.length<12)fail('Use pelo menos 12 caracteres.');
  const current=text(req.body?.currentPassword,256);
  const user=(await pool.query('SELECT password_hash FROM users WHERE id=$1',[req.actor.id])).rows[0];
  if(!await verify(current,user.password_hash))fail('Senha atual incorreta.',403);
  await transaction(pool,async c=>{await c.query('UPDATE users SET password_hash=$1 WHERE id=$2',[await passwordHash(password),req.actor.id]);await c.query('DELETE FROM sessions WHERE user_id=$1',[req.actor.id]);await audit(c,req.actor,'password_changed',req.actor.id);});
  res.setHeader('Set-Cookie',cookie('',0));res.json({ok:true});
 });
 app.get('/api/links',admin,async(req,res)=>res.json({links:(await pool.query('SELECT id,name,active,expires,created FROM replenisher_links ORDER BY created DESC')).rows}));
 app.post('/api/links',admin,async(req,res)=>{
  const action=req.body?.action;
  if(action==='create'){
   const name=text(req.body?.name,100),days=Number(req.body?.days??30);if(!Number.isInteger(days)||days<1||days>365)fail('Validade entre 1 e 365 dias.');
   const token=random(),linkId=id();await transaction(pool,async c=>{await c.query("INSERT INTO replenisher_links(id,token_hash,name,expires,created_by) VALUES($1,$2,$3,now()+($4 * interval '1 day'),$5)",[linkId,hash(token),name,days,req.actor.id]);await audit(c,req.actor,'link_created',linkId,{name,days});});res.json({id:linkId,token});
  }else if(action==='revoke'){
   await transaction(pool,async c=>{const r=await c.query('UPDATE replenisher_links SET active=false WHERE id=$1 RETURNING id',[text(req.body?.id)]);if(!r.rowCount)fail('Link não encontrado.',404);await audit(c,req.actor,'link_revoked',req.body.id);});res.json({ok:true});
  }else fail('Ação inválida.');
 });
}
export function admin(req,res,next){if(req.actor?.role!=='admin')return next(Object.assign(Error('Permissão insuficiente.'),{status:403}));next();}
