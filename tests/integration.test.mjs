import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createApplication} from '../server/index.mjs';
import {migrate} from '../server/db.mjs';
import {bootstrap} from '../server/auth.mjs';
import {parseCsv,parseProductRows} from '../lib/sheet-import.ts';
import {validDocument} from '../lib/supplier-document.ts';
let base;
let pool,server,adminCookie,csrf,productId,sectorId,lotId,token,linkId,submitted;
const password=randomBytes(24).toString('base64url'),email='admin@example.test';
const fixture=()=>({name:'Seringa teste',unit:'unidade',category:'Materiais de consumo',min:2,code:'SERINGA',description:'Teste isolado',active:true});
async function request(path,{method='GET',data,admin=false,bearer,origin,csrfOverride}={}){
 const headers={};if(data!==undefined)headers['Content-Type']='application/json';if(admin){headers.Cookie=adminCookie;headers['X-CSRF-Token']=csrfOverride??csrf;}if(bearer)headers.Authorization='Bearer '+bearer;if(origin)headers.Origin=origin;
 const r=await fetch(base+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),body=await r.json();return {status:r.status,body,headers:r.headers};
}
const stock=data=>request('/api/stock',{method:'POST',admin:true,data:{operationId:randomUUID(),...data}});
async function balance(lot=lotId){return Number((await pool.query('SELECT qty FROM lots WHERE id=$1',[lot])).rows[0].qty);}
before(async()=>{
 if(!process.env.DATABASE_URL||!new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))throw Error('Testes exigem DATABASE_URL de um banco cujo nome termine em _test. Nunca use produção.');
 const original=process.env.DATABASE_URL,url=new URL(original),schema='vettest_'+randomBytes(8).toString('hex');
 const setup=new pg.Pool({connectionString:original});await setup.query('CREATE SCHEMA '+schema);await setup.end();
 url.searchParams.set('options','-c search_path='+schema);process.env.DATABASE_URL=url.href;
 process.env.ADMIN_EMAIL=email;process.env.ADMIN_PASSWORD=password;process.env.COOKIE_SECURE='false';process.env.CORS_ORIGINS='https://autorizado.example.test';process.env.TRUST_PROXY='0';
 const runtime=await createApplication();pool=runtime.pool;
 server=runtime.app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 base='http://127.0.0.1:'+server.address().port;
 const source=await readFile(new URL('../server/index.mjs',import.meta.url),'utf8');assert.match(source,/app\.listen\(80,'0\.0\.0\.0'/);assert.doesNotMatch(source,/process\.env\.PORT/);
});
after(async()=>{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}if(pool){const schema=(await pool.query('SELECT current_schema() AS name')).rows[0].name;await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}});
test('configuração fixa de produção, health e frontend',async()=>{const r=await request('/api/health');assert.equal(r.status,200);const html=await fetch(base+'/');assert.equal(html.status,200);assert.match(await html.text(),/VetEstoque/);const model=await fetch(base+'/modelos/Modelo_Produtos_VetEstoque.xlsx');assert.equal(model.status,200);assert.ok((await model.arrayBuffer()).byteLength>1000);});
test('API privada, autenticação e proteção CSRF/CORS',async()=>{
 assert.equal((await request('/api/stock')).status,401);
 assert.equal((await request('/api/auth/login',{method:'POST',data:{email,password:'errada'}})).status,401);
 const r=await request('/api/auth/login',{method:'POST',data:{email,password}});assert.equal(r.status,200);adminCookie=r.headers.get('set-cookie').split(';')[0];csrf=r.body.csrf;assert.match(r.headers.get('set-cookie'),/HttpOnly/);
 assert.equal((await request('/api/auth/me',{admin:true})).body.user.email,email);
 assert.equal((await request('/api/stock',{method:'POST',admin:true,csrfOverride:'errado',data:{}})).status,403);
 assert.equal((await request('/api/stock',{admin:true,origin:'https://bloqueado.example.test'})).status,403);
 assert.equal((await request('/api/stock',{admin:true,origin:'https://autorizado.example.test'})).headers.get('access-control-allow-origin'),'https://autorizado.example.test');
});
test('cadastros manuais, CPF/CNPJ e revisão concorrente',async()=>{
 let r=await stock({action:'record',kind:'product',data:fixture()});assert.equal(r.status,200);productId=r.body.id;
 r=await stock({action:'record',kind:'sector',data:{name:'Consultório 1'}});assert.equal(r.status,200);sectorId=r.body.id;
 assert.equal((await stock({action:'record',kind:'supplier',data:{name:'Inválido',personType:'PJ',document:'123'}})).status,400);
 assert.equal(validDocument('52998224725','PF'),true);
 r=await stock({action:'record',kind:'supplier',data:{name:'Fornecedor teste',personType:'PF',document:'52998224725'}});assert.equal(r.status,200);
 assert.equal((await stock({action:'record',kind:'supplier',data:{name:'Duplicado',personType:'PF',document:'52998224725'}})).status,409);
 assert.equal((await stock({action:'record',id:productId,revision:1,kind:'product',data:{...fixture(),name:'Seringa revisada'}})).status,200);
 assert.equal((await stock({action:'record',id:productId,revision:1,kind:'product',data:fixture()})).status,409);
});
test('entrada atômica, idempotência e persistência',async()=>{
 const payload={operationId:randomUUID(),action:'move',type:'Entrada',product:productId,code:'LOTE-1',expiry:'2098-01-01',qty:10,cost:2.5,responsible:'Teste',note:''};
 const results=await Promise.all([stock(payload),stock(payload)]);assert.deepEqual(results.map(r=>r.status),[200,200]);lotId=results[0].body.lot;assert.equal(await balance(),10);
 assert.equal(Number((await pool.query("SELECT COUNT(*) AS n FROM movements WHERE lot=$1 AND type='Entrada'",[lotId])).rows[0].n),1);
 assert.equal((await stock({...payload,qty:11})).status,409);
 const bad=await stock({...payload,operationId:randomUUID(),expiry:'2098-02-31'});assert.equal(bad.status,400);
 assert.equal((await stock({...payload,operationId:randomUUID(),qty:0.00001})).status,400);
 const data=(await request('/api/stock',{admin:true})).body;assert.equal(data.lots[0].qty,10);assert.equal(data.lots[0].cost,2.5);assert.equal(data.lots[0].expiry,'2098-01-01');
});
test('retiradas simultâneas impedem saldo negativo',async()=>{
 const payload={action:'move',type:'Saída',product:productId,lot:lotId,qty:7,destination:sectorId,responsible:'Teste',note:'Reposição'};
 const results=await Promise.all([stock(payload),stock(payload)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(await balance(),3);
 assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM lots')).rows[0].n),1,'setor não recebe estoque próprio');
});
test('reposição múltipla faz rollback completo diante de item inválido',async()=>{
 const before=await balance();const r=await stock({action:'replenish',requestId:randomUUID(),destination:sectorId,responsible:'Teste',note:'',items:[{product:productId,lot:lotId,qty:1},{product:productId,lot:randomUUID(),qty:1}]});assert.equal(r.status,409);assert.equal(await balance(),before);
 const key=randomUUID(),body={action:'replenish',requestId:key,destination:sectorId,responsible:'Teste',note:'Teste em lote',items:[{product:productId,lot:lotId,qty:1}]};const r2=await stock({...body,operationId:key});assert.equal(r2.status,200);assert.equal((await stock({...body,operationId:key})).status,200);assert.equal(await balance(),2);
});
test('produto com histórico não muda unidade nem é excluído',async()=>{
 assert.equal((await stock({action:'record',id:productId,revision:2,kind:'product',data:{...fixture(),unit:'caixa'}})).status,409);
 assert.equal((await stock({action:'delete-record',id:productId,kind:'product',confirm:productId})).status,409);
 const r=await stock({action:'record',kind:'sector',data:{name:'Setor vazio'}});assert.equal((await stock({action:'delete-record',id:r.body.id,kind:'sector',confirm:r.body.id})).status,200);
});
test('importação por planilha, validação e deduplicação',async()=>{
 const rows=parseCsv('Nome;Código;Unidade;Categoria;Estoque mínimo\nGaze;GAZE;pacote;Materiais de consumo;5');assert.ok(rows.length>=2);assert.equal(typeof parseProductRows,'function');
 const p={name:'Gaze',code:'GAZE',unit:'pacote',category:'Materiais de consumo',min:'5',description:'Importação',gtin:''};
 let r=await stock({action:'import-sheet-products',fileName:'planilha.xlsx',items:[p]});assert.equal(r.status,200);assert.equal(r.body.created,1);
 r=await stock({action:'import-sheet-products',fileName:'planilha.xlsx',items:[p]});assert.equal(r.body.created,0);assert.equal(r.body.skipped,1);
 const count=Number((await pool.query("SELECT COUNT(*) AS n FROM records WHERE kind='product'")).rows[0].n);
 assert.equal((await stock({action:'import-sheet-products',items:[{...p,code:'OUTRO',name:'Outro'}, {...p,name:'',code:'ERRO'}]})).status,400);
 assert.equal(Number((await pool.query("SELECT COUNT(*) AS n FROM records WHERE kind='product'")).rows[0].n),count);
});
test('importação XML mantém metadados sem lançar saldo e sem duplicar',async()=>{
 const invoice={key:'1'.repeat(44),document:'11222333000181',number:'100',series:'1',emitter:'Fornecedor NF-e'};assert.equal(validDocument(invoice.document,'PJ'),true);
 const payload={action:'import-products',invoice,items:[{name:'Produto XML',xmlCode:'XML-1',code:'XML-1',unit:'frasco',category:'Medicamentos',min:0,description:'',gtin:'',xmlQty:'10',xmlCost:'20',xmlUnit:'FR'}]};
 let r=await stock(payload);assert.equal(r.status,200);assert.equal(r.body.created,1);r=await stock(payload);assert.equal(r.body.created,0);
 const p=(await pool.query("SELECT id,data FROM records WHERE data->>'code'='XML-1'")).rows[0];assert.equal(p.data.sourceInvoiceKey,invoice.key);assert.equal(p.data.sourceQty,'10');assert.equal((await pool.query('SELECT id FROM lots WHERE product=$1',[p.id])).rowCount,0);
});
test('link do repositor permite somente catálogo/envio/próprio protocolo',async()=>{
 let r=await request('/api/links',{method:'POST',admin:true,data:{action:'create',name:'Lorena teste',days:30}});assert.equal(r.status,200);token=r.body.token;linkId=r.body.id;
 assert.equal((await request('/api/stock',{bearer:token})).status,403);
 assert.equal((await request('/api/links',{bearer:token})).status,403);
 assert.equal((await request('/api/export',{bearer:token})).status,403);
 assert.equal((await request('/api/replenishment?queue=1',{bearer:token})).status,403);
 r=await request('/api/replenishment',{bearer:token});assert.equal(r.status,200);assert.ok(r.body.products.length);assert.equal(r.body.products[0].cost,undefined);assert.equal(r.body.suppliers,undefined);
 submitted=randomUUID();const payload={action:'submit',requestId:submitted,destination:sectorId,responsible:'Nome forjado',note:'Pedido',items:[{product:productId,qty:1}]};
 const responses=await Promise.all([request('/api/replenishment',{method:'POST',bearer:token,data:payload}),request('/api/replenishment',{method:'POST',bearer:token,data:payload})]);assert.deepEqual(responses.map(r=>r.status),[200,200]);assert.equal(await balance(),2);
 assert.equal((await pool.query('SELECT responsible FROM mobile_requests WHERE id=$1',[submitted])).rows[0].responsible,'Lorena teste');
 assert.equal((await request('/api/replenishment?id='+submitted,{bearer:token})).body.status,'pending');
 const other=await request('/api/links',{method:'POST',admin:true,data:{action:'create',name:'Outra pessoa',days:1}});
 assert.equal((await request('/api/replenishment?id='+submitted,{bearer:other.body.token})).status,404);
 assert.equal((await request('/api/replenishment',{method:'POST',bearer:token,data:{action:'confirm',id:submitted}})).status,403);
});
test('confirmação concorrente do pedido desconta uma única vez',async()=>{
 const b={action:'confirm',id:submitted,reviewer:'Teste'};const results=await Promise.all([request('/api/replenishment',{method:'POST',admin:true,data:b}),request('/api/replenishment',{method:'POST',admin:true,data:b})]);assert.deepEqual(results.map(r=>r.status),[200,200]);assert.equal(await balance(),1);
 assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM replenishments WHERE id=$1',[submitted])).rows[0].n),1);
 assert.equal((await request('/api/replenishment?id='+submitted,{bearer:token})).body.status,'confirmed');
});
test('FEFO utiliza primeiro o lote válido que vence antes',async()=>{
 const r=await stock({action:'move',type:'Entrada',product:productId,code:'VENCE-PRIMEIRO',expiry:'2097-01-01',qty:3,cost:1,responsible:'Teste',note:''});assert.equal(r.status,200);const earlyLot=r.body.lot;
 const key=randomUUID();assert.equal((await request('/api/replenishment',{method:'POST',bearer:token,data:{action:'submit',requestId:key,destination:sectorId,responsible:'Teste',note:'',items:[{product:productId,qty:2}]}})).status,200);
 assert.equal((await request('/api/replenishment',{method:'POST',admin:true,data:{action:'confirm',id:key}})).status,200);assert.equal(await balance(earlyLot),1);assert.equal(await balance(),1);
});
test('recusa mantém histórico e revogação bloqueia imediatamente',async()=>{
 const key=randomUUID();await request('/api/replenishment',{method:'POST',bearer:token,data:{action:'submit',requestId:key,destination:sectorId,responsible:'Teste',note:'',items:[{product:productId,qty:1}]}});
 const before=await balance();let r=await request('/api/replenishment',{method:'POST',admin:true,data:{action:'reject',id:key,reason:'Ajustar quantidade'}});assert.equal(r.status,200);assert.equal(await balance(),before);
 r=await request('/api/links',{method:'POST',admin:true,data:{action:'revoke',id:linkId}});assert.equal(r.status,200);assert.equal((await request('/api/replenishment',{bearer:token})).status,401);
});
test('migrações e bootstrap idempotentes em reinicialização',async()=>{
 const records=(await pool.query('SELECT COUNT(*) AS n FROM records')).rows[0].n;
 await Promise.all([migrate(pool),migrate(pool)]);process.env.ADMIN_PASSWORD=randomBytes(20).toString('hex');await bootstrap(pool);assert.equal((await pool.query('SELECT COUNT(*) AS n FROM users')).rows[0].n,'1');assert.equal((await pool.query('SELECT COUNT(*) AS n FROM records')).rows[0].n,records);
 const r=await request('/api/auth/login',{method:'POST',data:{email,password}});assert.equal(r.status,200,'reinício não redefine a senha');
});
test('exportação operacional consistente exclui hashes e sessões',async()=>{
 const r=await request('/api/export',{admin:true});assert.equal(r.status,200);assert.equal(r.body.data.users,undefined);assert.equal(r.body.data.sessions,undefined);assert.ok(r.body.data.audit.length>0);assert.match(r.headers.get('content-disposition'),/attachment/);
});
