export function fail(message,status=400){const e=Error(message);e.status=status;throw e;}
export function text(value,max=150,required=true){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail('Campo de texto ausente ou inválido.');return value.trim();}
export function uuid(value){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))fail('Identificador inválido.');return value;}
export function quantity(value){if(!['string','number'].includes(typeof value)||value==='')fail('Quantidade inválida.');const n=Number(value),m=Math.round(n*1000);if(!Number.isFinite(n)||n<=0||!Number.isSafeInteger(m)||m>999999999999||Math.abs(m/1000-n)>1e-8)fail('Quantidade positiva com até 3 casas decimais obrigatória.');return m/1000;}
export const milli=n=>Math.round(Number(n)*1000);
export const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());
export function expiry(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)fail('Validade inválida.');return value;}
export function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
export const stringify=value=>JSON.stringify(canonical(value));
