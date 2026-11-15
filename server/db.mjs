import pg from 'pg';
import {readFile,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const id=()=>randomUUID();
export function database(){
 const connectionString=process.env.DATABASE_URL;
 if(!connectionString||!/^postgres(?:ql)?:\/\//.test(connectionString))throw Error('DATABASE_URL obrigatória: informe uma conexão PostgreSQL.');
 // No fallback database, no local files, no credentials logged.
 const pool=new pg.Pool({connectionString,max:10,connectionTimeoutMillis:10000,idleTimeoutMillis:30000,application_name:'vetestoque-shard'});
 pool.on('error',e=>console.error(JSON.stringify({event:'database_pool_error',code:e.code||'DB_ERROR'})));
 return pool;
}
export async function transaction(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='15s'");await c.query("SET LOCAL statement_timeout='30s'");const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
export const inventoryLock=c=>c.query('SELECT pg_advisory_xact_lock(75623812)');
export async function migrate(pool){
 await transaction(pool,async c=>{
  await c.query('SELECT pg_advisory_xact_lock(75623811)');
  const version=await c.query('SHOW server_version_num');if(+version.rows[0].server_version_num<150000)throw Error('PostgreSQL 15 ou superior é obrigatório.');
  await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  for(const name of (await readdir(new URL('./migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()){
   const sql=await readFile(new URL('./migrations/'+name,import.meta.url),'utf8'),checksum=hash(sql);
   const old=(await c.query('SELECT checksum FROM schema_migrations WHERE name=$1',[name])).rows[0];
   if(old){if(old.checksum!==checksum)throw Error('Checksum da migration divergente: '+name);continue;}
   await c.query(sql);await c.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);
   console.log(JSON.stringify({event:'migration_applied',name}));
  }
 });
}
export async function audit(c,actor,action,target,details={}){await c.query('INSERT INTO audit(id,actor,action,target,details) VALUES($1,$2,$3,$4,$5)',[id(),actor.id,action,target,JSON.stringify(details)]);}
