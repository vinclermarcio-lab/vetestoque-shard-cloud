import {createRoot} from 'react-dom/client';
import {useState,useEffect} from 'react';
import Stock from './stock';
import Mobile from './mobile';
import {Login} from './session';
import './globals.css';
import './shard.css';
let csrf='';
let linkToken='';
if(location.pathname==='/repor'){
 const incoming=new URLSearchParams(location.hash.slice(1)).get('token');
 if(incoming&&/^[A-Za-z0-9_-]{43}$/.test(incoming)){
  linkToken=incoming;
  try{sessionStorage.setItem('vetestoque.link',incoming);}catch{}
  history.replaceState(null,'',location.pathname+location.search);
 }else try{linkToken=sessionStorage.getItem('vetestoque.link')||'';}catch{}
}
const nativeFetch=window.fetch.bind(window);
const pending=new Map<string,string>();
window.fetch=async(input,init={})=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.origin);
 if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return nativeFetch(input,init);
 const headers=new Headers(init.headers),method=(init.method||'GET').toUpperCase();
 if(linkToken)headers.set('Authorization','Bearer '+linkToken);
 if(csrf)headers.set('X-CSRF-Token',csrf);
 let body=init.body,key='';
 if(url.pathname==='/api/stock'&&method==='POST'&&typeof body==='string'){
  key=body;const data=JSON.parse(body);if(!data.operationId){if(!pending.has(key))pending.set(key,crypto.randomUUID());data.operationId=pending.get(key);}body=JSON.stringify(data);
 }
 const response=await nativeFetch(input,{...init,method,headers,body,credentials:'same-origin'});
 if(key&&response.ok)pending.delete(key);
 if(response.status===401&&!url.pathname.endsWith('/login')&&!url.pathname.endsWith('/me'))window.dispatchEvent(new Event('session-expired'));
 return response;
};
function Root(){
 const [user,U]=useState<any>(null),[loading,L]=useState(true),[error,E]=useState('');
 async function load(){try{const r=await fetch('/api/auth/me');const data=await r.json();if(r.ok){csrf=data.csrf||'';U(data.user);E('');}else{U(null);csrf='';if(linkToken)E(data.error);}}catch{E('Não foi possível conectar ao servidor. Verifique a conexão e tente novamente.');}finally{L(false);}}
 useEffect(()=>{load();const expire=()=>{U(null);csrf='';E('Sessão expirada. Entre novamente.');};window.addEventListener('session-expired',expire);return()=>window.removeEventListener('session-expired',expire);},[]);
 if(loading)return <div className="login-shell"><p>Carregando VetEstoque…</p></div>;
 if(!user&&linkToken)return <div className="login-shell"><section className="login-card"><h1>Acesso indisponível</h1><p className="error">{error}</p><p>Peça ao responsável pelo estoque um novo link.</p><button className="btn" onClick={()=>{sessionStorage.removeItem('vetestoque.link');linkToken='';load();}}>Usar acesso administrativo</button></section></div>;
 if(!user)return <Login error={error} onLogin={(d:any)=>{csrf=d.csrf;U(d.user);E('');}}/>;
 if(location.pathname==='/repor'||user.role==='replenisher')return <Mobile user={user}/>;
 return <Stock user={user}/>;
}
createRoot(document.getElementById('root')!).render(<Root/>);
