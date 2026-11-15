import {id,hash,transaction,inventoryLock,audit} from './db.mjs';
import {admin} from './auth.mjs';
import {fail,text,uuid,quantity,milli,today,expiry,stringify} from './validation.mjs';
import {validDocument,normalizeDocument} from '../lib/supplier-document.ts';
import {importCategories,importUnits} from '../lib/nfe-import.ts';
import {sheetErrors,sheetText,matchingProduct,productIdentity} from '../lib/sheet-import.ts';
export const central="EXISTS(SELECT 1 FROM movements m WHERE m.lot=lots.id AND m.type='Entrada')";
const number=(prefix,key)=>prefix+'-'+today().replaceAll('-','')+'-'+key.slice(0,8).toUpperCase();
const numeric=rows=>rows.map(r=>({...r,...('qty'in r?{qty:Number(r.qty)}:{}),...('cost'in r?{cost:Number(r.cost)}:{})}));
const product=async(c,key)=>{const r=(await c.query("SELECT * FROM records WHERE id=$1 AND kind='product'",[key])).rows[0];if(!r||r.data.active===false)fail('Selecione um produto ativo.',409);return r;};
export const sector=async(c,key)=>{if(!(await c.query("SELECT id FROM records WHERE id=$1 AND kind='sector'",[key])).rowCount)fail('Selecione um setor cadastrado.');};
export async function mobileList(c){return (await c.query('SELECT id,number,destination,responsible,note,items,status,created,processed,processed_by,rejection_reason FROM mobile_requests ORDER BY created DESC')).rows;}
export async function snapshot(c){
 const records=(await c.query('SELECT * FROM records ORDER BY kind,id')).rows.map(r=>({...r.data,id:r.id,kind:r.kind,revision:r.revision}));
 return {canDelete:true,records,lots:numeric((await c.query(`SELECT id,product,code,to_char(expiry,'YYYY-MM-DD') AS expiry,sector,qty,cost FROM lots WHERE ${central} ORDER BY expiry,id`)).rows),lotCodes:(await c.query('SELECT id,code FROM lots')).rows,movements:numeric((await c.query('SELECT * FROM movements ORDER BY created DESC,id')).rows),requests:(await c.query('SELECT * FROM replenishments ORDER BY created DESC,id')).rows,mobileRequests:await mobileList(c)};
}
export async function stockMutation(pool,actor,b){return transaction(pool,async c=>{
 await inventoryLock(c);
 const requestId=uuid(b.operationId||b.requestId);const key='stock:'+requestId,fingerprint=hash(stringify(b));
 const prior=(await c.query('SELECT * FROM idempotency WHERE key=$1',[key])).rows[0];
 if(prior){if(prior.actor!==actor.id||prior.fingerprint!==fingerprint)fail('Identificador já utilizado com outros dados.',409);return {...prior.result,replayed:true};}
 let result;
 if(b.action==='record')result=await record(c,b);
 else if(['import-sheet-products','import-products'].includes(b.action))result=await importProducts(c,b);
 else if(b.action==='move')result=await move(c,b,actor);
 else if(b.action==='replenish')result=await replenish(c,b,actor);
 else if(b.action==='delete-record')result=await remove(c,b);
 else fail('Ação inválida.');
 await c.query('INSERT INTO idempotency(key,actor,fingerprint,result) VALUES($1,$2,$3,$4)',[key,actor.id,fingerprint,JSON.stringify(result)]);
 await audit(c,actor,b.action,b.id||b.product||b.requestId||requestId,{kind:b.kind,number:result.number,created:result.created});
 return result;
 });}
async function record(c,b){
 if(!['product','supplier','sector'].includes(b.kind)||!b.data||Array.isArray(b.data))fail('Cadastro inválido.');
 const d={...b.data,name:text(b.data.name,150)};delete d.id;delete d.kind;delete d.revision;
 if(b.kind==='product'){
  if(!importUnits.includes(d.unit)||!importCategories.includes(d.category)||!['string','number'].includes(typeof d.min)||String(d.min).trim()===''||!Number.isFinite(+d.min)||+d.min<0||+d.min>999999999)fail('Confira unidade, categoria e estoque mínimo.');
  d.min=Number(d.min);d.code=text(d.code??'',60,false);d.description=text(d.description??'',2000,false);d.active=d.active!==false;
 }
 if(b.kind==='supplier'){
  if(!['PF','PJ'].includes(d.personType)||!validDocument(d.document,d.personType))fail('CPF ou CNPJ inválido.');d.document=normalizeDocument(d.document);
  if(d.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email))fail('E-mail inválido.');
  if(d.cep&&!/^\d{5}-?\d{3}$/.test(d.cep))fail('CEP inválido.');
  if(d.state&&!['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].includes(d.state))fail('UF inválida.');
 }
 const key=b.id||id();
 if(b.id){
  const old=(await c.query('SELECT * FROM records WHERE id=$1 AND kind=$2',[key,b.kind])).rows[0];if(!old)fail('Cadastro não encontrado.',404);
  if(Number(b.revision??b.data.revision)!==old.revision)fail('Cadastro atualizado por outra pessoa. Feche e atualize antes de editar.',409);
  if(b.kind==='product'&&old.data.unit!==d.unit){const used=await c.query('SELECT id FROM lots WHERE product=$1 LIMIT 1',[key]);const pending=await c.query('SELECT id FROM mobile_requests WHERE items @> $1::jsonb LIMIT 1',[JSON.stringify([{product:key}])]);if(used.rowCount||pending.rowCount)fail('Produto com histórico: mantenha a unidade e cadastre outro produto para usar uma unidade diferente.',409);}
  await c.query('UPDATE records SET data=$1,document=$2,revision=revision+1 WHERE id=$3',[JSON.stringify(d),b.kind==='supplier'?d.document:null,key]);
 }else await c.query('INSERT INTO records(id,kind,data,document) VALUES($1,$2,$3,$4)',[key,b.kind,JSON.stringify(d),b.kind==='supplier'?d.document:null]);
 return {ok:true,id:key};
}
async function importProducts(c,b){
 const isXml=b.action==='import-products',limit=isXml?990:1000;
 if(!Array.isArray(b.items)||!b.items.length||b.items.length>limit)fail('Selecione de 1 a '+limit+' produtos.');
 const n=b.invoice;
 if(isXml&&(!n||!/^\d{44}$/.test(n.key||'')||!validDocument(n.document,String(n.document||'').length===11?'PF':'PJ')))fail('Confira os dados da NF-e.');
 const items=b.items.map(p=>({ ...p,name:sheetText(p?.name),code:sheetText(p?.code),unit:sheetText(p?.unit),category:sheetText(p?.category),min:p?.min,gtin:sheetText(p?.gtin),description:sheetText(p?.description)}));
 if(items.some(p=>sheetErrors(p).length||(isXml&&(typeof p.xmlCode!=='string'||!p.xmlCode.trim()||p.xmlCode.length>60))))fail('Há campos inválidos nos itens. Nenhum produto foi importado.');
 const existing=(await c.query("SELECT data FROM records WHERE kind='product'")).rows.map(r=>r.data);let created=0;
 for(const p of items){
  const key=isXml?normalizeDocument(n.document)+':'+p.xmlCode.trim():productIdentity(p);
  if((await c.query('SELECT id FROM records WHERE product_key=$1',[key])).rowCount||matchingProduct(p,existing))continue;
  const d={...p,min:+p.min,active:true,importSource:isXml?'xml':'planilha',importedAt:new Date().toISOString(),...(isXml?{code:p.code||p.xmlCode,xmlSupplierDocument:normalizeDocument(n.document),sourceInvoiceKey:n.key,sourceInvoiceNumber:String(n.number||''),sourceInvoiceSeries:String(n.series||''),sourceEmitter:String(n.emitter||'').slice(0,150),sourceLine:String(p.line||''),sourceQty:String(p.xmlQty||''),sourceUnitCost:String(p.xmlCost||''),description:'Importado de XML NF-e '+String(n.number||'')}: {importFile:sheetText(b.fileName).slice(0,200)})};
  await c.query("INSERT INTO records(id,kind,data,product_key) VALUES($1,'product',$2,$3)",[id(),JSON.stringify(d),key]);existing.push(d);created++;
 }
 return {ok:true,created,skipped:items.length-created};
}
async function movement(c,actor,type,p,l,qty,destination,responsible,note,requestId=null){
 await c.query('INSERT INTO movements(id,type,product,lot,qty,origin,destination,responsible,note,request_id,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id(),type,p,l,qty,type==='Entrada'?'':'__central__',destination,responsible,note,requestId,actor.id]);
}
async function move(c,b,actor){
 if(!['Entrada','Saída','Perda'].includes(b.type))fail('Tipo de movimentação inválido.');
 const qty=quantity(b.qty),responsible=text(b.responsible,100),note=text(b.note??'',2000,false);await product(c,b.product);
 if(b.type==='Entrada'){
  const code=text(b.code,100),date=expiry(b.expiry);if(date<today())fail('Entrada exige validade vigente.');
  if(!['string','number'].includes(typeof b.cost)||String(b.cost).trim()===''||!Number.isFinite(+b.cost)||+b.cost<0||+b.cost>999999999)fail('Custo inválido.');
  const lot=id();await c.query("INSERT INTO lots(id,product,code,expiry,sector,qty,cost) VALUES($1,$2,$3,$4,'__central__',$5,$6)",[lot,b.product,code,date,qty,+b.cost]);
  await movement(c,actor,'Entrada',b.product,lot,qty,'__central__',responsible,note);return {ok:true,lot};
 }
 const l=(await c.query(`SELECT *,to_char(expiry,'YYYY-MM-DD') AS valid_date FROM lots WHERE id=$1 AND product=$2 AND ${central} FOR UPDATE`,[b.lot,b.product])).rows[0];
 if(!l||milli(l.qty)<milli(qty))fail('Saldo insuficiente para este lote.',409);
 if(b.type!=='Perda'&&l.valid_date<today())fail('Lote vencido: permitida apenas a baixa por perda.');
 if(b.type==='Saída')await sector(c,b.destination);if(!note)fail('Descreva o motivo e a destinação.');
 await c.query('UPDATE lots SET qty=qty-$1 WHERE id=$2',[qty,l.id]);await movement(c,actor,b.type,b.product,l.id,qty,b.type==='Saída'?b.destination:'',responsible,note);return {ok:true};
}
async function replenish(c,b,actor){
 uuid(b.requestId);await sector(c,b.destination);const responsible=text(b.responsible,100),note=text(b.note??'',2000,false);
 if(!Array.isArray(b.items)||!b.items.length||b.items.length>30)fail('Informe de 1 a 30 itens.');
 if((await c.query('SELECT id FROM replenishments WHERE id=$1',[b.requestId])).rowCount)fail('Solicitação já confirmada. Atualize o histórico.',409);
 const sums=new Map();for(const i of b.items){const qty=quantity(i.qty);const old=sums.get(i.lot);if(old&&old.product!==i.product)fail('Lote incompatível com o produto.');sums.set(i.lot,{product:text(i.product),lot:text(i.lot),qty:quantity(((old?milli(old.qty):0)+milli(qty))/1000)});}
 const items=[...sums.values()].sort((a,b)=>a.lot.localeCompare(b.lot));
 for(const i of items){await product(c,i.product);const l=(await c.query(`SELECT *,to_char(expiry,'YYYY-MM-DD') AS valid_date FROM lots WHERE id=$1 AND product=$2 AND ${central} FOR UPDATE`,[i.lot,i.product])).rows[0];if(!l||l.valid_date<today()||milli(l.qty)<milli(i.qty))fail('Lote vencido, indisponível ou sem saldo. Nenhum item foi baixado.',409);}
 return confirmItems(c,actor,{id:b.requestId,number:number('REP',b.requestId),destination:b.destination,responsible,note},items);
}
export async function confirmItems(c,actor,r,items){
 await sector(c,r.destination);
 await c.query('INSERT INTO replenishments(id,number,destination,responsible,note,items) VALUES($1,$2,$3,$4,$5,$6)',[r.id,r.number,r.destination,r.responsible,r.note,JSON.stringify(items)]);
 for(const i of items){const changed=await c.query('UPDATE lots SET qty=qty-$1 WHERE id=$2 AND qty>=$1',[i.qty,i.lot]);if(!changed.rowCount)fail('Saldo insuficiente. Nenhum item foi baixado.',409);await movement(c,actor,'Saída',i.product,i.lot,i.qty,r.destination,r.responsible,r.note,r.id);}
 return {ok:true,number:r.number};
}
async function remove(c,b){
 if(b.confirm!==b.id||!['product','supplier','sector'].includes(b.kind))fail('Confirmação de exclusão inválida.');
 const key=text(b.id),old=(await c.query('SELECT * FROM records WHERE id=$1 AND kind=$2',[key,b.kind])).rows[0];if(!old)fail('Cadastro não encontrado.',404);
 if((await c.query('SELECT id FROM lots WHERE product=$1 LIMIT 1',[key])).rowCount||(await c.query('SELECT id FROM movements WHERE product=$1 OR destination=$1 OR origin=$1 LIMIT 1',[key])).rowCount||(await c.query('SELECT id FROM mobile_requests WHERE destination=$1 OR items @> $2::jsonb LIMIT 1',[key,JSON.stringify([{product:key}])])).rowCount||(await c.query('SELECT id FROM replenishments WHERE destination=$1 OR items @> $2::jsonb LIMIT 1',[key,JSON.stringify([{product:key}])])).rowCount)fail('Cadastro possui histórico. Arquive o produto em vez de excluir.',409);
 if(b.kind==='supplier'&&(await c.query("SELECT id FROM records WHERE kind='product' AND data->>'xmlSupplierDocument'=$1 LIMIT 1",[old.document])).rowCount)fail('Fornecedor vinculado a produtos importados.',409);
 await c.query('DELETE FROM records WHERE id=$1',[key]);return {ok:true};
}
export function stockRoutes(app,pool){
 app.get('/api/stock',admin,async(req,res)=>res.json(await transaction(pool,async c=>{await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return snapshot(c);})));
 app.post('/api/stock',admin,async(req,res)=>res.json(await stockMutation(pool,req.actor,req.body)));
}
export async function mobileCatalog(c){
 const rows=(await c.query("SELECT id,kind,data FROM records WHERE kind IN('product','sector')")).rows;
 const lots=(await c.query(`SELECT product,SUM(qty) AS available FROM lots WHERE qty>0 AND expiry>=$1 AND ${central} GROUP BY product`,[today()])).rows;
 return {sectors:rows.filter(r=>r.kind==='sector').map(r=>({id:r.id,name:r.data.name})).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')),products:rows.filter(r=>r.kind==='product'&&r.data.active!==false).map(r=>({id:r.id,name:r.data.name,code:r.data.code||'',unit:r.data.unit,available:Number(lots.find(l=>l.product===r.id)?.available||0)})).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'))};
}
export async function mobileMutation(pool,actor,b){return transaction(pool,async c=>{
 await inventoryLock(c);
 if(b.action==='submit'){
  const key=uuid(b.requestId),destination=text(b.destination),responsible=actor.role==='replenisher'?actor.name:text(b.responsible,100),note=text(b.note??'',2000,false);
  if(!Array.isArray(b.items)||!b.items.length||b.items.length>30)fail('Informe de 1 a 30 itens.');
  const sums=new Map();for(const item of b.items){const p=text(item.product),qty=quantity(item.qty);sums.set(p,quantity(((sums.has(p)?milli(sums.get(p)):0)+milli(qty))/1000));}
  const requested=[...sums].sort(([a],[b])=>a.localeCompare(b)).map(([product,qty])=>({product,qty}));const payload={destination,responsible,note,items:requested};
  const old=(await c.query('SELECT * FROM mobile_requests WHERE id=$1',[key])).rows[0];
  if(old){if(old.submitted_account!==actor.id||stringify(old.payload)!==stringify(payload))fail('Identificador já utilizado com outros dados.',409);return {ok:true,id:key,number:old.number,status:old.status,replayed:true};}
  if((await c.query('SELECT id FROM replenishments WHERE id=$1',[key])).rowCount)fail('Identificador já utilizado.',409);
  await sector(c,destination);const items=[];
  for(const i of requested){const p=await product(c,i.product);const available=Number((await c.query(`SELECT COALESCE(SUM(qty),0) AS available FROM lots WHERE product=$1 AND expiry>=$2 AND ${central}`,[i.product,today()])).rows[0].available);if(milli(available)<milli(i.qty))fail('Saldo insuficiente de '+p.data.name+'. Atualize a lista.',409);items.push({...i,name:p.data.name,unit:p.data.unit});}
  const num=number('MOB',key);await c.query("INSERT INTO mobile_requests(id,number,destination,responsible,note,items,payload,submitted_account) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[key,num,destination,responsible,note,JSON.stringify(items),JSON.stringify(payload),actor.id]);
  await audit(c,actor,'mobile_submitted',key);return {ok:true,id:key,number:num,status:'pending'};
 }
 if(actor.role!=='admin')fail('Permissão insuficiente.',403);
 if(!['confirm','reject'].includes(b.action))fail('Ação inválida.');
 const key=uuid(b.id),r=(await c.query('SELECT * FROM mobile_requests WHERE id=$1 FOR UPDATE',[key])).rows[0];if(!r)fail('Solicitação não encontrada.',404);
 const wanted=b.action==='confirm'?'confirmed':'rejected';if(r.status!=='pending'){if(r.status===wanted)return {ok:true,number:r.number,status:r.status,replayed:true};fail('Solicitação já processada.',409);}
 let reason=null;
 if(b.action==='reject')reason=text(b.reason,1000);
 else {
  const allocations=[];
  for(const item of r.items){const p=await product(c,item.product);if(p.data.unit!==item.unit)fail('Unidade alterada. Recuse e solicite um novo pedido.',409);let left=milli(item.qty);
   const lots=(await c.query(`SELECT * FROM lots WHERE product=$1 AND qty>0 AND expiry>=$2 AND ${central} ORDER BY expiry,id FOR UPDATE`,[item.product,today()])).rows;
   for(const l of lots){const take=Math.min(milli(l.qty),left);if(take>0){allocations.push({product:item.product,lot:l.id,qty:take/1000,unit:item.unit});left-=take;}if(!left)break;}
   if(left)fail('Saldo insuficiente de '+item.name+'. Nenhum item foi baixado.',409);
  }
  await confirmItems(c,actor,r,allocations);
 }
 await c.query('UPDATE mobile_requests SET status=$1,processed=now(),processed_by=$2,processed_account=$3,rejection_reason=$4 WHERE id=$5',[wanted,actor.name,actor.id,reason,key]);
 await audit(c,actor,'mobile_'+wanted,key);return {ok:true,number:r.number,status:wanted};
 });}
export function mobileRoutes(app,pool){
 app.get('/api/replenishment',async(req,res)=>{
  if(req.query.queue!==undefined){if(req.actor.role!=='admin')fail('Permissão insuficiente.',403);return res.json({requests:await mobileList(pool)});}
  if(req.query.id!==undefined){const r=(await pool.query('SELECT id,number,status,created,processed,rejection_reason,submitted_account FROM mobile_requests WHERE id=$1',[uuid(req.query.id)])).rows[0];if(!r||(req.actor.role!=='admin'&&r.submitted_account!==req.actor.id))fail('Solicitação não encontrada.',404);delete r.submitted_account;return res.json(r);}
  res.json(await transaction(pool,async c=>{await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return mobileCatalog(c);}));
 });
 app.post('/api/replenishment',async(req,res)=>res.json(await mobileMutation(pool,req.actor,req.body)));
}
