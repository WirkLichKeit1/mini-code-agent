# mini-code-agent

Um agente de programação web minimalista que usa o **Google Gemini** para conversar com o usuário e executar operações controladas dentro de um diretório `workspace/`.

A interface permite conversar com o agente, acompanhar as ferramentas utilizadas e navegar pelos arquivos do workspace em tempo real.

> **Status:** protótipo funcional / projeto experimental. Antes de usar em produção, revise principalmente a execução de comandos do sistema e o gerenciamento da chave da API.

## Visão geral

O projeto é composto por um servidor Node.js com Express e uma interface HTML/CSS/JavaScript sem framework.

O fluxo principal é:

1. O usuário envia uma mensagem pela interface.
2. O navegador faz `POST /api/chat`.
3. O servidor envia a conversa ao Gemini junto com as ferramentas disponíveis.
4. O Gemini pode solicitar chamadas de ferramentas.
5. O servidor executa as ferramentas no `workspace/` e devolve os resultados ao modelo.
6. O processo continua por até **6 passos** por mensagem.
7. Quando o modelo produz uma resposta final, ela é exibida no chat.
8. A interface pode atualizar a árvore de arquivos e visualizar o conteúdo dos arquivos.

### Ferramentas disponíveis para o agente

| Ferramenta | Função |
| --- | --- |
| `list_files` | Lista arquivos e diretórios do workspace. |
| `read_file` | Lê o conteúdo de um arquivo. |
| `write_file` | Cria ou sobrescreve um arquivo. |
| `run_command` | Executa um comando de shell dentro do workspace. |

O agente é instruído a priorizar **Python 3** e **Node.js**, pois esses são os ambientes de execução considerados disponíveis pelo projeto.

## Estrutura

```text
mini-code-agent/
├── index.js             # servidor Express, integração Gemini e ferramentas
├── package.json         # metadados e dependências Node.js
├── public/
│   ├── index.html       # interface
│   ├── script.js        # chat, workspace e chamadas à API
│   └── style.css        # estilos da interface
├── workspace/           # criado automaticamente na inicialização
└── README.md
```

O diretório `workspace/` é criado automaticamente pelo servidor se ainda não existir.

## Requisitos

- **Node.js** com suporte a ES Modules e `fetch` nativo.
- **npm**.
- Uma chave de API do **Google Gemini**.
- Python 3, caso você queira que o agente execute scripts Python.

O projeto usa atualmente o modelo:

```text
gemini-3.1-flash-lite
```

## Instalação

Clone ou extraia o projeto e instale as dependências:

```bash
npm install
```

Configure a variável de ambiente com sua chave do Gemini.

### Linux / macOS

```bash
export GEMINI_API_KEY="sua-chave-aqui"
```

### Windows PowerShell

```powershell
$env:GEMINI_API_KEY="sua-chave-aqui"
```

Depois inicie o servidor:

```bash
node index.js
```

A aplicação ficará disponível, por padrão, em:

```text
http://localhost:3000
```

Você também pode definir outra porta:

```bash
PORT=8080 node index.js
```

## Configuração da API

A chave é lida exclusivamente da variável:

```text
GEMINI_API_KEY
```

O servidor monta a URL da API do Gemini a partir do modelo definido em `index.js`.

**Não coloque a chave diretamente no código nem a envie para o frontend.**

## Como usar

Abra a aplicação no navegador e envie comandos em linguagem natural, por exemplo:

```text
Liste os arquivos do workspace.
```

```text
Crie um script hello.py que imprime Hello World e execute-o.
```

```text
Leia o arquivo app.js e explique o que ele faz.
```

```text
Crie um arquivo README.txt com instruções para executar o projeto.
```

O painel **workspace** permite:

- listar diretórios e arquivos;
- atualizar a árvore manualmente;
- abrir um arquivo para visualizar seu conteúdo;
- identificar arquivos modificados durante a sessão do chat.

O botão de limpar conversa apaga apenas o histórico mantido no navegador; **os arquivos do workspace permanecem intactos**.

## API HTTP

### `POST /api/chat`

Envia uma mensagem ao agente.

Exemplo de corpo:

```json
{
  "message": "Liste os arquivos do workspace",
  "history": []
}
```

A resposta pode conter:

- `reply`: resposta textual do agente;
- `history`: histórico atualizado usado na próxima interação;
- `actions`: chamadas de ferramentas realizadas;
- `error`: mensagem de erro, quando aplicável.

### `GET /api/info`

Retorna informações básicas da aplicação, atualmente incluindo o modelo utilizado:

```json
{
  "model": "gemini-3.1-flash-lite"
}
```

### `GET /api/files`

Retorna a árvore de arquivos do `workspace/`.

Arquivos e diretórios cujo nome começa com `.` são omitidos da árvore exibida pela interface.

### `GET /api/file?path=<caminho>`

Lê um arquivo do workspace e retorna seu conteúdo.

## Segurança

Este projeto foi construído como um **protótipo local**. O fato de as ferramentas operarem dentro de `workspace/` não transforma o sistema em um sandbox de segurança completo.

Pontos importantes:

- `run_command` executa comandos de shell com as permissões do processo Node.js.
- Um modelo pode solicitar comandos destrutivos ou demorados; não existe uma política de autorização humana antes da execução.
- O timeout de `run_command` é de **15 segundos**.
- Não há autenticação ou autorização nas rotas HTTP.
- A chave do Gemini é usada no servidor, mas a API externa recebe a chave como parte da URL da requisição.
- O histórico da conversa é mantido no cliente e enviado novamente a cada chamada.
- O controle de caminho existe para impedir acesso fora do workspace, mas a implementação deve ser endurecida antes de exposição a usuários não confiáveis.

**Não exponha este servidor diretamente à internet sem adicionar autenticação, isolamento de processos, limites de recursos e uma política de execução de comandos.**

## Limitações atuais

- Apenas Node.js e Python 3 são considerados ambientes executáveis pelo agente.
- O número máximo de ciclos de ferramentas por mensagem é `6`.
- Comandos possuem timeout de 15 segundos.
- Não há streaming da resposta do Gemini.
- Não há persistência de conversas no servidor.
- Não há testes automatizados no repositório atual.
- A interface é propositalmente simples e não usa framework frontend.

## Desenvolvimento

Uma forma simples de trabalhar no projeto é:

```bash
npm install
export GEMINI_API_KEY="sua-chave-aqui"
node index.js
```

Após alterações no servidor, reinicie o processo Node.js.

As alterações feitas pelo agente aparecem no diretório:

```text
workspace/
```

O código da aplicação em si fica fora desse diretório.