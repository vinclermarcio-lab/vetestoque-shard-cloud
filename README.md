Node.js 24.22.1 (JavaScript/TypeScript) | Express 5.3.0 + React 19.2.6 | Entrypoint: scripts/start.mjs → server/index.mjs | START: npm start | Frontend: npm run build → dist/ | Workers/cron/WebSockets separados: nenhum.

# VetEstoque — Shard Cloud via GitHub

Sistema web para o estoque central da Clínica-Escola de Medicina Veterinária, adaptado da versão 14 do VetEstoque para PostgreSQL gerenciado e hospedagem containerizada. Precisa de URL pública HTTPS. O Site original e seu banco permanecem independentes.

## Implantação

| Item | Configuração |
|---|---|
| Runtime | Node.js 24.22.1; aceita a linha 24 a partir dessa versão |
| Backend | Express 5.3.0; driver pg 8.23.1 |
| Frontend | React 19.2.6; Vite 8.3.8 |
| Instalação | npm ci --omit=dev |
| Build | npm run build |
| Saída do frontend | dist/ |
| Start em produção | npm start |
| Comando equivalente | node scripts/start.mjs |
| Entrada | scripts/start.mjs; carrega server/index.mjs |
| Interface e porta | 0.0.0.0:80, fixas |
| Banco | PostgreSQL 15 ou superior, somente via DATABASE_URL |
| Healthcheck | GET /api/health |
| Processos adicionais | Nenhum worker, cron ou WebSocket |

O repositório e o ZIP contêm fonte, manifesto, lockfile, migrations, testes e assets necessários, incluindo o modelo Excel vazio. Não incluem dependências instaladas, ambientes virtuais, build, dist, banco local, snapshots, dados de teste ou credenciais. O ZIP não inclui .git; o histórico do repositório é mantido normalmente pelo GitHub.

As dependências diretas têm versões exatas no package.json. O lockfile fixa a resolução completa. Ferramentas de build são dependências de produção para permitir a compilação após a instalação padrão da plataforma. Não são necessárias instalações globais além de Node/npm.

1. Importe este repositório no branch **main**.
2. Crie **um PostgreSQL novo** na Shard e configure sua conexão completa em DATABASE_URL. O usuário precisa poder criar tabelas, índices e constraints no schema de destino.
3. Configure ADMIN_EMAIL e ADMIN_PASSWORD no painel para criar o primeiro administrador. Use uma senha própria com pelo menos 12 caracteres.
4. Configure CORS, cookies e proxy conforme ENV_VARS.md. .env.example contém somente nomes, sem valores.
5. Instalação: `npm ci --omit=dev`. Build: `npm run build`. Start: `npm start`.
6. Se a plataforma executar somente instalação e start, scripts/start.mjs gera o frontend quando dist/index.html estiver ausente. O build e a preparação do banco terminam antes da abertura do servidor.
7. Para implantação por Docker, use o Dockerfile incluído. Ele instala pelo lockfile, compila e inicia a aplicação, sem criar um banco local.
8. O processo deve poder abrir a porta **80 dentro do container**. O Dockerfile usa o usuário padrão da imagem para isso. Se a plataforma impuser usuário sem essa permissão, deverá liberar a capacidade de bind; não altere a aplicação para outra porta.
9. Acesse a URL HTTPS e confira os módulos. Configure backup do PostgreSQL antes de operar com dados reais.

Não há variável PORT. A produção sempre escuta **0.0.0.0:80**. Os testes usam porta temporária exclusivamente no ambiente de teste.

## Variáveis

| Nome | Propósito |
|---|---|
| DATABASE_URL | Única conexão ao PostgreSQL gerenciado, incluindo credenciais e parâmetros TLS. |
| ADMIN_EMAIL | E-mail do administrador criado no primeiro boot. |
| ADMIN_PASSWORD | Senha para criar esse administrador inicial. |
| CORS_ORIGINS | Origens externas exatas autorizadas para CORS. |
| COOKIE_SECURE | Determina a exigência de HTTPS no cookie da sessão. |
| TRUST_PROXY | Quantidade de proxies reversos confiáveis. |
| SESSION_TTL_HOURS | Prazo máximo das sessões administrativas. |

ENV_VARS.md detalha limites e comportamento. Nenhum segredo entra no frontend ou nos logs. Não há conexão alternativa ao banco, fallback SQLite, arquivo de persistência local ou Cloudflare D1 no runtime.

## Primeiro boot e reinício

Antes de abrir a porta HTTP, server/index.mjs valida o PostgreSQL, aplica automaticamente server/migrations/ e cria o administrador quando necessário. Não é preciso comando manual de migration.

schema_migrations guarda nome e checksum. As migrations executam em transação, protegidas por advisory lock do PostgreSQL para partidas simultâneas. Divergência de checksum interrompe o início. Alterações futuras devem usar um novo arquivo numerado, sem editar migrations já aplicadas.

O bootstrap administrativo é idempotente: não duplica contas nem redefine senha no reinício. ADMIN_EMAIL e ADMIN_PASSWORD só são exigidas quando não há administrador ativo e podem ser removidas do painel após confirmar o primeiro acesso. Para trocar senha, use **Alterar senha** no sistema; todas as sessões serão encerradas.

O sistema inicia **sem produtos, fornecedores, setores, lotes ou movimentações**. Não há seed de inventário fictício nem carga automática do Site antigo. Um inventário existente pode entrar pelas importações ou por migração de dados separada e conferida. Não há sincronização entre o Site antigo e a Shard.

## Acesso administrativo e repositor

O login do ChatGPT Sites não acompanha a exportação. Este pacote utiliza administrador próprio, senha derivada por scrypt e sessões no PostgreSQL. Não há senha padrão nem cadastro público.

Em **Reposições → Acesso do repositor**, informe nome e validade para gerar um link individual. Copie o endereço e envie à pessoa autorizada. O segredo só é exibido na criação; o banco guarda apenas seu hash. Se perder o link, revogue e gere outro.

O link abre /repor no celular ou computador. Permite ver o catálogo necessário, enviar pedidos e consultar os próprios protocolos. Não permite acessar custos/fornecedores, editar cadastros, confirmar pedidos ou consultar a fila de outras pessoas. Quem possuir o link poderá usá-lo até revogação ou vencimento: compartilhe individualmente.

O token chega no fragmento da URL, retirado da barra após leitura; não é enviado em query string. O navegador conserva esse acesso na sessão da aba. Rascunhos móveis usam sessionStorage, separados por identidade; pedidos salvos ficam no PostgreSQL. Não há inventário em localStorage ou IndexedDB.

Pedidos pendentes não reservam nem reduzem saldo. O administrador confirma ou recusa no painel. A confirmação valida todos os itens e escolhe primeiro os lotes válidos de menor validade (FEFO). Se faltar qualquer item, nenhuma baixa é efetivada. O conferente autenticado fica na auditoria.

## Cadastros e estoque

- Cadastro manual de produtos, fornecedores com CPF/CNPJ e setores.
- Importação de produtos por Excel/CSV ou XML NF-e, com revisão e tratamento de duplicados. O modelo Excel vazio em public/modelos/ pode ser baixado pela tela.
- Importações de catálogo não lançam saldo físico automaticamente. Entradas exigem lote, validade, quantidade e custo.
- Reposição manual com até 30 itens. Só o estoque central tem saldo; setores são destinos rastreados no histórico.
- Transações, locks compartilhados entre réplicas e idempotência persistida impedem baixa parcial e repetição do mesmo envio. Quantidades usam NUMERIC e até três casas decimais.
- Cadastros usam revisão para evitar sobrescrita silenciosa. Produto com histórico não pode mudar de unidade. Exclusão de cadastro vinculado é bloqueada; produtos podem ser arquivados.
- Fila móvel atualizada a cada 15 segundos enquanto visível. A tela de estoque atualiza após operações locais; para visualizar alterações de outro administrador, atualize a página. Não há WebSocket.

Escritas de estoque são serializadas por um lock no PostgreSQL. Em alto volume, acompanhe filas e tempo de resposta.

## Arquivos, logs e recuperação

Registros operacionais, usuários, sessões, links, auditoria e idempotência ficam no PostgreSQL de DATABASE_URL. Não é necessário volume de banco ou uploads no disco do container.

Excel/XML são lidos no navegador e enviados como dados estruturados; os originais não são arquivados no servidor. public/ contém assets estáticos; dist/ é gerada no build.

Logs vão somente para stdout/stderr, nunca para arquivos.

O download no cabeçalho administrativo gera uma exportação operacional JSON consistente, sem senhas ou segredos de sessão/links. Ela não substitui backup completo do banco nem possui restauração automática por upload.

Configure backup, retenção e recuperação no PostgreSQL gerenciado da Shard. Esses serviços não são ativados pelo código. Para recuperação completa, restaure um backup PostgreSQL em banco separado, valide e altere DATABASE_URL. Contas, sessões e links dependem desse backup.

## Verificação

Consulte VALIDACAO.md. Para testar: instale também dependências de desenvolvimento, configure DATABASE_URL para PostgreSQL de teste cujo nome termine em _test e execute `npm test`. A suíte cria e remove somente seus próprios schemas aleatórios. Nunca use produção.

A implantação real na Shard, as permissões da porta 80, o proxy/TLS e o backup gerenciado precisam ser validados no destino.
