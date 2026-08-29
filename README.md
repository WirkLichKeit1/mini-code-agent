# mini-code-agent

Um agente com tool use que lista, lê, cria/edita, apaga, busca e roda arquivos
dentro de uma pasta `workspace/` isolada — sua "casca de testes" segura.
Roda inteiramente de graça, usando a API do Gemini (Google AI Studio) e um
backend Node.js simples.

## Estrutura do projeto

```
index.js                  → servidor Express + loop do agente
system-instructions.md    → instruções fixas do agente (ambiente, regras de segurança)
.env.example               → modelo do arquivo de variáveis de ambiente
replit.nix                 → dependências de sistema extras (só usado no Replit)
package.json
public/
  index.html               → estrutura da interface
  style.css                → tema visual (terminal âmbar)
  script.js                → lógica do chat, workspace e preview
workspace/                 → sandbox onde o agente cria/edita/roda arquivos
```

## Requisitos

- [Node.js](https://nodejs.org) 18 ou mais recente (o projeto usa `fetch` nativo, sem biblioteca extra pra chamadas HTTP)
- Uma chave gratuita da API do Gemini — obtida em https://aistudio.google.com/apikey (não pede cartão de crédito)

> **Sobre o Python:** o `system-instructions.md` diz ao agente que Python3 está disponível. Isso é garantido automaticamente no Replit (via `replit.nix`). Rodando localmente ou em outro servidor, isso depende de você já ter Python3 instalado na máquina — se não tiver, o agente vai tentar rodar scripts `.py` e falhar. Nesse caso, edite o `system-instructions.md` removendo a menção a Python, ou instale o Python3 no seu ambiente.

## Como rodar

Funciona em qualquer sistema operacional (Windows, macOS, Linux) e em qualquer lugar que rode Node.js — sua máquina, um servidor, ou um ambiente de nuvem como Replit, CodeSandbox, Gitpod, etc. Abaixo estão os dois caminhos mais comuns.

### Rodando localmente (ou em qualquer VPS/servidor próprio)

1. Clone o repositório e entre na pasta:
   ```
   git clone <url-do-seu-repositório>
   cd mini-code-agent
   ```
2. Instale as dependências:
   ```
   npm install
   ```
3. Copie o arquivo de exemplo de variáveis de ambiente e cole sua chave:
   ```
   cp .env.example .env
   ```
   Depois edite o `.env` e substitua `sua-chave-aqui` pela chave que você pegou no Google AI Studio.
4. Rode o servidor:
   ```
   npm start
   ```
5. Abra `http://localhost:3000` no navegador.

O `.env` nunca deve ser enviado ao GitHub — confirme que ele está listado no seu `.gitignore` (o `.env.example`, sem a chave real, é o que fica público).

### Rodando no Replit (ou serviços de nuvem parecidos)

1. Crie um Repl novo importando este repositório diretamente do GitHub (ou faça upload manual dos arquivos), escolhendo o template **Node.js**.
2. No Shell do Repl, rode `npm install`.
3. Em vez de `.env` (que não é seguro deixar num Repl público), use o painel de **Secrets** do próprio Replit: crie uma entrada com key `GEMINI_API_KEY` e value igual à sua chave. O código já lê a variável de ambiente do sistema operacional de qualquer forma, então funciona sem mudar nada.
4. Aperte **Run**.

## Ferramentas disponíveis pro agente

| Ferramenta | O que faz |
|---|---|
| `list_files` | Lista arquivos e pastas de um diretório do workspace |
| `read_file` | Lê o conteúdo de um arquivo |
| `write_file` | Cria ou sobrescreve um arquivo (a UI mostra o diff quando já existia) |
| `run_command` | Executa um comando de shell dentro do workspace (Node.js e Python3 disponíveis) |
| `delete_file` | Remove um arquivo ou pasta — o agente **confirma com você antes**, por instrução em `system-instructions.md` |
| `create_folder` | Cria uma pasta vazia (ou com subpastas) mesmo sem arquivos dentro ainda |
| `search_in_files` | Busca um texto em todos os arquivos do workspace, retornando arquivo + linha + trecho |

Todas são restritas à pasta `workspace/` — o agente nunca alcança o próprio
código do servidor.

## Interface

- **Chat** com log de ações expansível: cada chamada de ferramenta vira uma
  linha que você abre pra ver o resultado completo.
- **Diff visual** nas edições de arquivo (`write_file`): linhas verdes
  (adicionadas) e vermelhas (removidas) quando o arquivo já existia.
- **Saída em estilo terminal** pro `run_command`, com stdout e stderr
  separados e coloridos.
- **Realce de sintaxe** (via highlight.js) no preview de arquivos e em blocos
  de código que o agente manda no chat.
- **Painel de workspace** ao vivo: árvore de arquivos com ícone por tipo,
  pastas dobráveis, contagem de itens, tamanho e data de modificação por
  arquivo, campo de busca, e um indicador pulsante nos arquivos/pastas
  tocados na sessão atual.
- **Barra de estatísticas**: quantas chamadas de API foram feitas na sessão e
  na última mensagem (contagem local, não é a cota oficial do Google).
- **Aviso automático de limite de taxa**: se a API responder com erro 429, o
  servidor espera e tenta de novo sozinho, e isso aparece como uma nota
  visível no log em vez de simplesmente falhar.

## Como funciona (resumo da arquitetura)

`server.js` expõe `POST /api/chat`. A cada mensagem:

1. O histórico da conversa + a mensagem nova são enviados ao Gemini, junto
   com o schema das 7 ferramentas e o conteúdo de `system-instructions.md`
   como instrução de sistema.
2. Se o modelo pedir uma ou mais ferramentas, o servidor executa as funções
   correspondentes e devolve o resultado pro modelo.
3. Isso se repete em loop (até 6 passos por mensagem) até o modelo responder
   só com texto, sem pedir mais ferramentas.
4. Cada passo é registrado num log de ações que volta pro frontend, incluindo
   dados extras (diff de arquivo, stdout/stderr) usados só pela interface —
   sem poluir o que é enviado de volta ao modelo.

Duas rotas auxiliares (`GET /api/files` e `GET /api/file`) alimentam o painel
de workspace, permitindo ver a árvore de arquivos e o conteúdo de qualquer
arquivo sem precisar perguntar ao agente.

## Segurança

- Todo acesso a arquivo passa por uma validação (`safePath`) que impede sair
  da pasta `workspace/`.
- `delete_file` é uma ação destrutiva — a confirmação antes de apagar é uma
  instrução de comportamento (em `system-instructions.md`), não uma trava de
  código. Ainda é possível o modelo pular essa etapa em casos raros.
- `run_command` executa comandos de shell de verdade. Seguro pro seu próprio
  Repl de testes, mas nunca exponha esse agente publicamente sem travar
  melhor o que ele pode executar.

## Testando os limites da API gratuita

O modelo em uso é `gemini-3.1-flash-lite` (camada gratuita do Google AI
Studio). A barra de estatísticas mostra quantas chamadas cada mensagem
consome — tarefas que encadeiam várias ferramentas (ex: criar pasta + criar
arquivo + rodar) gastam várias chamadas numa mensagem só. Se você atingir o
limite de requisições por minuto, o servidor tenta de novo automaticamente
após uma pausa, e isso aparece como aviso no chat.

## Ideias pra evoluir

- Persistência do histórico de conversa entre sessões (hoje ele vive só na
  memória do navegador).
- Botão de "desfazer" numa edição específica, usando o `before`/`after` que
  o `write_file` já guarda.
- Editar o conteúdo de um arquivo direto no preview, em vez de só visualizar.
- Alternar entre modelos diferentes pela própria interface, sem editar código.