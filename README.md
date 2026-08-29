# mini-code-agent

Um agente com tool use que lista, lê, cria/edita, apaga, busca e roda arquivos
dentro de uma pasta `workspace/` isolada — sua "casca de testes" segura.
Roda inteiramente de graça, usando a API do Gemini (Google AI Studio) e um
backend Node.js simples.

## Estrutura do projeto

```
index.js                  → servidor Express + loop do agente
system-instructions.md    → instruções fixas do agente (ambiente, regras de segurança)
replit.nix                → dependências de sistema (adiciona Python3 ao ambiente)
package.json
public/
  index.html               → estrutura da interface
  style.css                → tema visual (terminal âmbar)
  script.js                → lógica do chat, workspace e preview
workspace/                 → sandbox onde o agente cria/edita/roda arquivos
```

## Como rodar no Replit (pelo celular)

1. Crie um novo Repl do tipo **Node.js**.
2. Suba (ou cole) todos os arquivos listados acima, mantendo a estrutura de pastas.
3. Pegue uma chave gratuita em https://aistudio.google.com/apikey (não pede cartão).
4. No Replit, abra **Secrets** (ícone de cadeado) e crie:
   - key: `GEMINI_API_KEY`
   - value: sua chave copiada
5. No Shell, rode:
   ```
   npm install
   ```
6. Aperte **Run**.

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