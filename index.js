import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.join(__dirname, "workspace");

const app = express();
app.use(express.json());
app.use(express.static("public"));

await fs.mkdir(WORKSPACE, { recursive: true });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-3.1-flash-lite";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const SYSTEM_INSTRUCTION = "Este ambiente só tem Python3 e Node.js instalados. Prefira escrever scripts nessas linguagens, e caso o usuário peça por outra diga que você pode apenas entregar o código fonte mas que a opção de executar nessa linguagem está indisponível por ter apenas Node.js e Python3 no seu ambiente."

// ---------- Tool schema (o que o modelo "enxerga") ----------
const tools = [
    {
        functionDeclarations: [
            {
                name: "list_files",
                description: "Lista arquivos e pastas dentro do workspace.",
                parameters: {
                    type: "object",
                    properties: {
                        subpath: { type: "string", description: "Subpasta a listar (padrao: raiz do workspace)"}
                    }
                }
            },
            {
                name: "read_file",
                description: "Le o conteudo de um arquivo do workspace.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Caminho relativo dentro do workspace."}
                    },
                    required: ["path"]
                }
            },
            {
                name: "write_file",
                description: "Cria ou sobrescreve um arquivo no workspace com o conteudo dado.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Caminho relativo dentro do workspace."},
                        content: { type: "string", description: "Conteudo completo do arquivo."}
                    },
                    required: ["path", "content"]
                }
            },
            {
                name: "run_command",
                description: "Executa um comando de shell dentro do workspace (ex.: rodar um script Python/Node). use com cautela",
                parameters: {
                    type: "object",
                    properties: {
                        command: { type: "string", description: "Comando a executar"}
                    },
                    required: ["command"]
                }
            },
            {
                name: "delete_file",
                description: "Remove um arquivo ou pasta (e seu conteudo) do workspace. Acao destrutiva e irreversivel.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Caminho relativo dentro do workspace a ser removido" }
                    },
                    required: ["path"]
                }
            },
            {
                name: "create_folder",
                description: "Cria uma pasta (e subpastas necessarias) dentro do workspace, mesmo sem nenhum arquivo dentro dela ainda.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Caminho relativo da pasta a criar dentro do workspace" }
                    },
                    required: ["path"]
                }
            },
            {
                name: "search_in_files",
                description: "Busca um texto em todos os arquivos do workspace (recursivamente), retornando arquivo, numero da linha e trecho de cada ocorrencia.",
                parameters: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "Texto a ser buscado" },
                        case_sensitive: { type: "boolean", description: "Se a busca deve diferenciar maiusculas/minusculas (padrao: false)" }
                    },
                    required: ["query"]
                }
            }
        ]
    }
];

// --------- Implementacao das ferramentas ---------
function safePath(p) {
    const resolved = path.resolve(WORKSPACE, p || ".");
    if (!resolved.startsWith(WORKSPACE)) {
        throw new Error("Caminho fora do workspace nao é permitido.");
    }
    return resolved;
}

async function listFiles(args) {
    const dir = safePath(args.subpath || ".");
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const lines = entries.map((e) => (e.isDirectory() ? e.name + "/" : e.name));
    return lines.length ? lines.join("\n") : "(pasta vazia)";
}

async function readFile(args) {
    const filePath = safePath(args.path);
    return await fs.readFile(filePath, "utf-8");
}

async function writeFile(args) {
    const filePath = safePath(args.path);
    let before = null;
    try {
        before = await fs.readFile(filePath, "utf-8");
    } catch {
        before = null; // arquivo novo
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, args.content, "utf-8");
    return { message: `Arquivo salvo: ${args.path}`, before, after: args.content };
}

async function runCommand(args) {
    try {
        const { stdout, stderr } = await execAsync(args.command, {
            cwd: WORKSPACE,
            timeout: 15000
        });
        return {
            message: `stdout:\n${stdout || "(vazio)"}\n${stderr || "(vazio)"}`,
            stdout: stdout || "",
            stderr: stderr || ""
        };
    } catch (err) {
        return {
            message: `Erro ao executar comando: ${err.message}`,
            stdout: "",
            stderr: err.message
        };
    }
}

async function deleteFile(args) {
    const filePath = safePath(args.path);
    let stat;
    try {
        stat = await fs.stat(filePath);
    } catch {
        return { message: `Não encontrado: ${args.path}`};
    }
    if (stat.isDirectory()) {
        await fs.rm(filePath, { recursive: true, force: true });
        return { message: `Pasta removida: ${args.path}`};
    }
    await fs.unlink(filePath);
    return { message: `Arquivo removido: ${args.path}`};
}

async function createFolder(args) {
    const dirPath = safePath(args.path);
    await fs.mkdir(dirPath, { recursive: true });
    return { message: `Pasta criada: ${args.path}` };
}

async function searchInFiles(args) {
    const query = args.query;
    const caseSensitive = !!args.case_sensitive;
    const needle = caseSensitive ? query : query.toLowerCase();
    const matches = [];

    async function walk(dir, base) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
            if (e.name.startsWith(".")) continue;
            const rel = base ? `${base}/${e.name}` : e.name;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                await walk(full, rel);
            } else {
                let content;
                try {
                    content = await fs.readFile(full, "utf-8");
                } catch {
                    continue; // provavelmente um arquivo binario, pula
                }
                content.split("\n").forEach((line, idx) => {
                    const haystack = caseSensitive ? line : line.toLowerCase();
                    if (haystack.includes(needle)) {
                        matches.push({ path: rel, line: idx + 1, text: line.trim().slice(0, 200) });
                    }
                });
            }
        }
    }

    await walk(WORKSPACE, "");

    if (matches.length === 0) {
        return { message: `Nenhuma ocorrência de "${query}" encontrada.`, matches: [] };
    }
    const preview = matches.slice(0, 50).map((m) => `${m.path}:${m.line}: ${m.text}`).join("\n");
    const suffix = matches.length > 50 ? `\n... e mais ${matches.length - 50} ocorrência(s)` : "";
    return {
        message: `${matches.length} ocorrência(s) de "${query}" encontrada(s):\n${preview}${suffix}`,
        matches
    };
}

const toolImplementations = {
    list_files: listFiles,
    read_file: readFile,
    write_file: writeFile,
    run_command: runCommand,
    delete_file: deleteFile,
    create_folder: createFolder,
    search_in_files: searchInFiles
};

// --------- Loop do agente (com retry em caso de limite de taxa) ---------
async function callGemini(contents, onRetry, retries = 2) {
    const res = await fetch(API_URL, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
            contents,
            tools,
            systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] }
        })
    });
    const data = await res.json();
    if (data.error) {
        if (data.error.code === 429 && retries > 0) {
            const waitMs = 15000;
            onRetry?.(waitMs);
            await new Promise((r) => setTimeout(r, waitMs)); // espera 15s e tenta de novo
            return callGemini(contents, onRetry, retries - 1);
        }
        throw new Error(data.error.message);
    }
    return data;
}

const MAX_STEPS = 6;

app.post("/api/chat", async (req, res) => {
    const actionLog = [];
    let apiCalls = 0;

    const onRetry = (waitMs) => {
        actionLog.push({
            tool: "_system",
            args: {},
            result: `Limite de requisições atingido. Aguardando ${Math.round(waitMs / 1000)}s antes de tentar de novo...`
        });
    };
    
    try {
        if (!GEMINI_API_KEY) {
            return res.status(500).json({
                error: "GEMINI_API_KEY nao configurada.",
                actions: actionLog,
                apiCalls
            });
        }

        const { message, history = [] } = req.body;
        let contents = [...history, { role: "user", parts: [{ text: message }] }];

        for (let step = 0; step < MAX_STEPS; step++) {
            apiCalls++;
            const data = await callGemini(contents, onRetry);
            
            const candidate = data.candidates?.[0];
            const parts = candidate?.content?.parts || [];
            
            const functionCalls = parts.filter((p) => p.functionCall);

            if (functionCalls.length === 0) {
                const text = parts.map((p) => p.text || "").join("");
                contents.push({ role: "model", parts });
                return res.json({ reply: text, history: contents, actions: actionLog, apiCalls });
            }

            contents.push({ role: "model", parts });

            const functionResponses = [];
            for (const fc of functionCalls) {
                const { name, args } = fc.functionCall;
                let resultText;
                let extra = {};
                try {
                    const raw = await toolImplementations[name](args || {});
                    if (raw && typeof raw === "object") {
                        resultText = raw.message;
                        extra = raw;
                    } else {
                        resultText = raw;
                    }
                } catch (err) {
                    resultText = `Erro: ${err.message}`;
                }
                actionLog.push({ tool: name, args, result: resultText, ...extra });
                functionResponses.push({
                    functionResponse: { name, response: { result: resultText } }
                });
            }
            contents.push({ role: "user", parts: functionResponses });
        }

        res.json({
            reply: "Atingi o limite de passos nessa rodada. pode pedir para eu continuar.",
            history: contents,
            actions: actionLog,
            apiCalls
        });
    } catch (err) {
        res.status(500).json({ error: err.message, actions: actionLog, apiCalls });
    }
});

// --------- Rotas de introspecção do workspace (para interface) ---------
app.get("/api/info", (req, res) => {
    res.json({ model: MODEL });
});

async function buildTree(dir, base = "") {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const result = [];
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (e.name.startsWith(".")) continue;
        const rel = base ? `${base}/${e.name}` : e.name;
        if (e.isDirectory()) {
            result.push({
                name: e.name,
                path: rel,
                type: "dir",
                children: await buildTree(path.join(dir, e.name), rel)
            });
        } else {
            const stat = await fs.stat(path.join(dir, e.name));
            result.push({ name: e.name, path: rel, type: "file", size: stat.size, mtime: stat.mtimeMs });
        }
    }
    return result;
}

app.get("/api/files", async (req, res) => {
    try {
        const treeData = await buildTree(WORKSPACE);
        res.json({ tree: treeData });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/api/file", async (req, res) => {
    try {
        const content = await readFile({ path: req.query.path || ""});
        res.json({ content });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`servidor rodando na porta: ${PORT}`));