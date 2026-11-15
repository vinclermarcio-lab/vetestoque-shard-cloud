export const importCategories=['Medicamentos','Materiais de consumo','Vacinas','Laboratório','Higiene e limpeza','Alimentos','Outros'];
export const importUnits=['unidade','frasco','ampola','comprimido','mL','g','kg','caixa','pacote','dose','litro','par'];
const child=(node:Element,name:string)=>Array.from(node.children).find(e=>e.localName===name);
const val=(node:Element,name:string)=>child(node,name)?.textContent?.trim()||'';
export function parseNfe(text:string,parser:Pick<DOMParser,'parseFromString'>=new DOMParser()){
if(text.length>5*1024*1024)throw Error('O XML deve ter no máximo 5 MB.');
if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('XML com declarações de entidades não é aceito.');
const doc=parser.parseFromString(text,'application/xml');if(doc.getElementsByTagName('parsererror').length)throw Error('O arquivo XML está malformado.');
const root=doc.documentElement;const nfe=root.localName==='NFe'?root:root.localName==='nfeProc'?child(root,'NFe'):undefined;const info=nfe&&child(nfe,'infNFe');
if(!info)throw Error('Selecione o XML completo de uma NF-e, com os itens da nota.');
const key=(info.getAttribute('Id')||'').replace(/^NFe/,'');if(!/^\d{44}$/.test(key))throw Error('A chave de acesso da NF-e não foi encontrada ou é inválida.');
const emit=child(info,'emit'),ide=child(info,'ide');const document=(emit&&(val(emit,'CNPJ')||val(emit,'CPF'))||'').replace(/[.\/\-\s]/g,'').toUpperCase();
if(!/^(?:\d{11}|[A-Z0-9]{12}\d{2})$/.test(document))throw Error('O documento do emitente não foi encontrado.');
const units:Record<string,string>={UN:'unidade',UND:'unidade',UNID:'unidade',FR:'frasco',AMP:'ampola',CP:'comprimido',COMP:'comprimido',ML:'mL',G:'g',KG:'kg',CX:'caixa',PCT:'pacote',PC:'pacote',DOSE:'dose',L:'litro',LT:'litro',PAR:'par'};
const details=Array.from(info.children).filter(e=>e.localName==='det');if(!details.length||details.length>990)throw Error('A nota deve conter entre 1 e 990 itens.');
const items=details.map((det,index)=>{const prod=child(det,'prod');if(!prod)throw Error('Há um item da nota sem os dados do produto.');const xmlCode=val(prod,'cProd'),name=val(prod,'xProd'),xmlUnit=val(prod,'uCom'),gtin=val(prod,'cEAN');if(!xmlCode||!name||!xmlUnit)throw Error('Há um produto sem código, descrição ou unidade comercial.');return {key:String(index),line:det.getAttribute('nItem')||String(index+1),xmlCode,name,code:xmlCode,xmlUnit,unit:units[xmlUnit.toUpperCase()]||'',category:'Outros',min:'0',gtin:/^(?:\d{8}|\d{12,14})$/.test(gtin)&&!/^0+$/.test(gtin)?gtin:'',ncm:val(prod,'NCM'),xmlQty:val(prod,'qCom'),xmlCost:val(prod,'vUnCom'),selected:true};});
return {key,number:ide?val(ide,'nNF'):'',series:ide?val(ide,'serie'):'',issued:ide?(val(ide,'dhEmi')||val(ide,'dEmi')):'',emitter:emit?val(emit,'xNome'):'',document,items};
}
