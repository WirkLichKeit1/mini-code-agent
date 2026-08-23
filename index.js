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
const MODEL = "gemini-3.6-flash";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

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
                        subpath: { type: "string", description: "Subpasta a listar (padrao: raiz do workspace."}
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
                description: "Executa um comando de shell dentro do workspace (ex.: rodar um script Python/Node).",
                parameters: {
                    type: "object",
                    properties: {
                        command: { type: "string", description: "Comando a executar"}
                    },
                    required: ["command"]
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
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, args.content, "utf-8");
    return `Arquivo salvo: ${args.path}`;
}

async function runCommand(args) {
    try {
        const { stdout, stderr } = await execAsync(args.command, {
            cwd: WORKSPACE,
            timeout: 15000
        });
        return `stdout:\n${stdout || "(vazio)"}\n${stderr || "(vazio)"}`;
    } catch (err) {
        return `Erro ao executar comando: ${err.message}`;
    }
}

const toolImplementations = {
    list_files: listFiles,
    read_file: readFile,
    write_file: writeFile,
    run_command: runCommand
};

// --------- Loop do agente ---------
async function callGemini(contents) {
    const res = await fetch(API_URL, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ contents, tools})
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data;
}

const MAX_STEPS = 6;

app.post("/api/chat", async (req, res) => {
    try {
        if (!GEMINI_API_KEY) {
            return res.status(500).json({
                error: "GEMINI_API_KEY nao configurada."
            });
        }

        const { message, history = [] } = req.body;
        let contents = [...history, { role: "user", parts: [{ text: message }] }];
        const actionLog = [];

        for (let step = 0; step < MAX_STEPS; step++) {
            const data = await callGemini(contents);
            const candidate = data.candidates?.[0];
            const parts = candidate?.content?.parts || [];
            const functionCalls = parts.filter((p) => p.functionCall);

            if (functionCalls.length === 0) {
                const text = parts.map((p) => p.text || "").join("");
                contents.push({ role: "model", parts });
                return res.json({ reply: text, history: contents, actions: actionLog });
            }

            contents.push({ role: "model", parts });

            const functionResponses = [];
            for (const fc of functionCalls) {
                const { name, args } = fc.functionCall;
                let result;
                try {
                    result = await toolImplementations[name](args || {});
                } catch (err) {
                    result = `Erro: ${err.message}`;
                }
                actionLog.push({ tool: name, args, result });
                functionResponses.push({
                    functionResponse: { name, response: { result } }
                });
            }
            contents.push({ role: "user", parts: functionResponses });
        }

        res.json({
            reply: "Atingi o limite de passos nessa rodada. pode pedir para eu continuar.",
            history: contents,
            actions: actionLog
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`servidor rodando na porta: ${PORT}`));