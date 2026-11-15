# Validação da entrega para GitHub / Shard Cloud

Referência: 14/11/2026, horário do Brasil. Base funcional: VetEstoque versão 14. A adaptação foi feita em uma cópia; nenhum deploy ou alteração de dados do Site original foi executado.

## Resultados

| Verificação | Resultado |
|---|---|
| Instalação limpa com npm ci --omit=dev | Aprovada; ferramentas de build disponíveis sem dependências de desenvolvimento |
| Build React/Vite | Aprovado com Vite 8.3.8 |
| Start real por scripts/start.mjs sem dist preexistente | Aprovado: compilou automaticamente, aplicou migration, criou administrador e respondeu health/login |
| Segundo start no mesmo banco | Aprovado: um administrador, uma migration aplicada e zero cadastros operacionais; nenhuma duplicação |
| Suíte de integração com PostgreSQL real | 15 testes aprovados, zero falhas |
| Configuração do bind de produção | Confirmada: o entrypoint solicita 0.0.0.0:80; não utiliza PORT |
| Bind efetivo na porta privilegiada 80 neste ambiente | Não verificado: o sandbox retornou EACCES; os testes HTTP usaram porta temporária por instrumentação externa ao pacote |
| PostgreSQL utilizado nos testes | PostgreSQL 18.6 real, isolado e descartável; o projeto exige PostgreSQL 15+ |
| npm audit | Zero vulnerabilidades reportadas na consulta desta entrega |
| Modelo Excel | Arquivo válido, abas Produtos e Orientações; somente o cabeçalho preenchido na aba de produtos |
| Leitura real de arquivo XLSX | Verificada com a mesma versão da biblioteca usada pelo frontend |
| Navegador | Tela de login renderizada; fluxo completo pela interface permanece para homologação |
| Implantação na Shard / build da imagem Docker | Não executados nesta entrega |

O teste do start utilizou o entrypoint real e interceptou somente a chamada de bind para confirmar host/porta e substituí-los por loopback efêmero no processo de teste. Essa instrumentação não integra o código publicado. A permissão para abrir a porta 80 deve ser validada no container da Shard.

## Cobertura dos 15 testes de integração

1. Configuração fixa do servidor, healthcheck, frontend compilado e download do modelo Excel.
2. API privada, login, cookie HttpOnly, CSRF e CORS.
3. Cadastro manual, validação de CPF/CNPJ, duplicidade de documento e conflito de revisão.
4. Entrada de estoque atômica, reenvio idempotente, datas e precisão das quantidades.
5. Duas retiradas concorrentes sem saldo negativo e sem criar estoque de setor.
6. Rollback integral de reposição com múltiplos itens e reenvio sem baixa duplicada.
7. Bloqueio de mudança de unidade e de exclusão de produto com histórico.
8. Importação de planilha: validação de lote e tratamento de duplicados.
9. Importação XML: metadados, deduplicação e ausência de entrada física automática.
10. Link do repositor: catálogo restrito, envio idempotente, identidade controlada pelo servidor e protocolo próprio.
11. Confirmações concorrentes do mesmo pedido com baixa única.
12. Seleção FEFO do lote válido com vencimento mais próximo.
13. Recusa preservando saldo e revogação bloqueando o link.
14. Migrations simultâneas e bootstrap idempotente sem redefinir a senha.
15. Exportação operacional consistente sem hashes de senha ou sessões.

## Conferência dos requisitos da plataforma

| Requisito | Evidência no projeto |
|---|---|
| Fonte limpa | Repositório/ZIP sem dependências, build, dist, banco, snapshots ou credenciais; .gitignore protege esses itens |
| Dependências completas e fixadas | package.json e package-lock.json na raiz |
| 0.0.0.0:80 | server/index.mjs: app.listen com host e porta literais; Dockerfile: EXPOSE 80 |
| Segredos fora do código | .env.example somente com nomes; ENV_VARS.md; bootstrap e conexão leem variáveis do ambiente |
| Uma única conexão de banco | server/db.mjs: database() usa apenas DATABASE_URL com driver pg |
| Boot automático | server/db.mjs: migrate(); server/auth.mjs: bootstrap(); scripts/start.mjs prepara frontend ausente |
| Caminhos portáveis | Imports relativos e caminhos resolvidos a partir dos arquivos do projeto, sem diretórios específicos de máquina |
| CORS e logs | server/index.mjs: CORS_ORIGINS; console.log/console.error somente stdout/stderr |
| Informações técnicas na primeira linha | README.md |
| Histórico de publicação | Commit completo no branch main, conferido após atualização da referência do GitHub |

## Homologação pendente no destino

Configurar as variáveis na Shard, conectar o PostgreSQL novo, conferir TLS/proxy e permissão da porta 80, testar o fluxo completo pela interface em computador/celular e habilitar backup gerenciado. Publicar o código no GitHub não implanta automaticamente o serviço nem migra os dados do Site antigo.
