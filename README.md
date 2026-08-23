# mini-code-agent

Um agente com tool use que pode listar, ler, criar/editar e rodar arquivos
dentro de uma pasta `workspace/` isolada — sua "casca de testes" segura.
Usa a API gratuita do Gemini (Google AI Studio).

## Como rodar no Replit (pelo celular)

1. Crie um novo Repl do tipo **Node.js**.
2. Suba (ou cole) estes arquivos na raiz do projeto, mantendo a estrutura:
   - `server.js`
   - `package.json`
   - `public/index.html`
   - a pasta `workspace/` (pode ficar vazia, ela é criada automaticamente)
3. Pegue uma chave gratuita em https://aistudio.google.com/apikey (não pede cartão).
4. No Replit, abra o painel **Secrets** (ícone de cadeado) e crie:
   - key: `GEMINI_API_KEY`
   - value: sua chave copiada
5. No painel de comandos/Shell, rode:
   ```
   npm install
   ```
6. Aperte **Run**. O Replit vai abrir a webview com o chat.

## Como usar

Digite pedidos em linguagem natural, por exemplo:

- "Liste os arquivos no workspace"
- "Crie um script hello.py que imprime Olá mundo"
- "Rode o hello.py e me mostre o resultado"
- "Leia o hello.py e adicione um comentário explicando o código"

Cada ação que o agente executa (qual ferramenta, com quais argumentos) aparece
como uma linha de log acima da resposta em texto, então você sempre vê o que
ele fez antes de ler a explicação.

## Como funciona (resumo)

- `server.js` expõe `/api/chat`. A cada mensagem, ele chama a API do Gemini
  passando o histórico da conversa e a lista de ferramentas disponíveis
  (`list_files`, `read_file`, `write_file`, `run_command`).
- Se o modelo pedir para usar uma ferramenta, o servidor executa a função
  correspondente (sempre restrita à pasta `workspace/`) e devolve o resultado
  pro modelo, que decide se chama outra ferramenta ou já responde em texto.
- Esse ciclo se repete até no máximo 6 passos por mensagem, pra evitar loop
  infinito.

## Ideias pra evoluir

- Adicionar uma ferramenta `delete_file` (com confirmação antes de rodar).
- Guardar o histórico de conversa mesmo depois de fechar a aba (hoje ele vive
  só na memória do navegador).
- Trocar `gemini-2.5-flash` por outro modelo gratuito (ex: via Groq) se quiser
  comparar velocidade/qualidade.
- Adicionar um botão "limpar workspace" na interface.

## Aviso de segurança

A ferramenta `run_command` executa comandos de shell de verdade dentro da
pasta `workspace/`. Isso é seguro pro seu próprio Repl de testes, mas nunca
exponha esse agente publicamente sem antes travar melhor o que ele pode
executar.
