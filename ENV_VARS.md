# Variáveis do VetEstoque na Shard Cloud

Configure as variáveis no painel da plataforma. O arquivo `.env.example` contém somente os nomes, sem valores; configure os valores diretamente no painel. Não há arquivo `.env` com credenciais no pacote.

| Nome | Propósito |
|---|---|
| DATABASE_URL | Única configuração de conexão com o PostgreSQL gerenciado pela Shard. Credenciais, banco, host, porta e parâmetros TLS pertencem a essa URL. |
| ADMIN_EMAIL | E-mail para criar o administrador no primeiro início. |
| ADMIN_PASSWORD | Senha inicial do administrador, com 12 a 256 caracteres. Nunca é impressa nem incorporada ao frontend. |
| CORS_ORIGINS | Origens externas exatas autorizadas, separadas por vírgula. Não use wildcard, caminhos ou barra final. |
| COOKIE_SECURE | Determina se o cookie de sessão exige HTTPS. |
| TRUST_PROXY | Quantidade de proxies confiáveis entre o navegador e o servidor. |
| SESSION_TTL_HOURS | Duração máxima de uma sessão administrativa. |

## Configuração inicial

- `DATABASE_URL` é sempre obrigatória. Deve usar protocolo PostgreSQL. Não há fallback local nem outras variáveis de banco. O usuário do banco precisa poder criar tabelas, índices e constraints no schema de destino.
- `ADMIN_EMAIL` e `ADMIN_PASSWORD` são obrigatórias somente quando ainda não há administrador ativo. Após a criação, o sistema mantém a senha do banco: reiniciar ou trocar essas variáveis não redefine a conta. Use **Alterar senha** no sistema para trocar a senha; essa ação encerra as sessões existentes. As variáveis iniciais podem ser removidas do painel depois de verificar o primeiro acesso.
- `CORS_ORIGINS` vazia permite apenas a própria origem. Se o frontend e a API estiverem em subdomínios diferentes, autorize a origem do frontend; navegadores também podem exigir configuração de cookies conforme a relação entre os domínios. A entrega padrão serve frontend e API juntos, na mesma origem.
- `COOKIE_SECURE` assume `true`. Mantenha esse valor em produção e use a URL HTTPS da plataforma. `false` serve exclusivamente para teste HTTP local.
- `TRUST_PROXY` assume `0`. Se a Shard colocar exatamente um proxy reverso confiável à frente do container, configure `1`. Confirme a topologia com a plataforma: esse valor afeta a identificação do IP e do protocolo original.
- `SESSION_TTL_HOURS` assume `8`; aceita inteiros entre `1` e `168`.
- Quando o provedor exigir TLS, inclua os parâmetros de SSL apropriados na própria `DATABASE_URL`. O código usa a configuração TLS do driver `pg`; não desativa a verificação de certificado.

O processo também reconhece as variáveis padrão do Node/npm, mas não depende de nenhuma delas para configurar a aplicação. Não existe variável `PORT`: a porta de produção é fixa em **80**.
