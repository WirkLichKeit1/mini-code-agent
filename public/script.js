// ---------- element refs ----------
const log = document.getElementById("log");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const drawer = document.getElementById("drawer");
const tree = document.getElementById("tree");
const preview = document.getElementById("preview");
const previewName = document.getElementById("previewName");
const previewContent = document.getElementById("previewContent");
const modelBadge = document.getElementById("modelBadge");
const totalCallsEl = document.getElementById("totalCalls");
const lastCallsEl = document.getElementById("lastCalls");

let history = [];
const touchedFiles = new Map(); // path -> timestamp (ms)
let totalApiCalls = 0;

// ---------- ícones inline (mesmo estilo dos botões do header) ----------
const ICON_FOLDER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>`;
const ICON_CHEVRON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="m9 18 6-6-6-6"/></svg>`;
const ICON_FOLDER_BIG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>`;

// ---------- ícone por tipo de arquivo ----------
const FILE_TYPES = {
    js: { label: "JS", color: "amber" }, mjs: { label: "JS", color: "amber" },
    cjs: { label: "JS", color: "amber" }, jsx: { label: "JSX", color: "amber" },
    ts: { label: "TS", color: "blue" }, py: { label: "PY", color: "blue" },
    json: { label: "{ }", color: "teal" }, md: { label: "MD", color: "purple" },
    css: { label: "CSS", color: "pink" }, html: { label: "< >", color: "pink" },
    txt: { label: "TXT", color: "gray" }, sh: { label: "SH", color: "gray" }
};
function fileBadge(name) {
    const ext = (name.split(".").pop() || "").toLowerCase();
    return FILE_TYPES[ext] || { label: ext ? ext.slice(0, 3).toUpperCase() : "•", color: "gray" };
}

function formatSize(bytes) {
    if (bytes === undefined || bytes === null) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
// Mapeia extensão de arquivo -> nome de linguagem que o highlight.js reconhece.
function langFromPath(p) {
    const ext = (p.split(".").pop() || "").toLowerCase();
    const map = {
        js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
        ts: "typescript", py: "python", json: "json", md: "markdown",
        html: "xml", css: "css", sh: "bash", yml: "yaml", yaml: "yaml", txt: "plaintext"
    };
    return map[ext] || "";
}

// Aplica highlight.js a um <code>, com linguagem explícita quando sabemos qual é
// (mais preciso), ou deixando a detecção automática decidir.
function applyHighlight(codeEl, lang) {
    if (lang) codeEl.classList.add("language-" + lang);
    delete codeEl.dataset.highlighted; // permite re-destacar um elemento reutilizado (ex: preview trocando de arquivo)
    if (window.hljs) hljs.highlightElement(codeEl);
}

// Renderiza texto do agente destacando blocos ```code``` como código.
function renderAgentText(container, text) {
    const parts = text.split(/```(\w*)\n?([\s\S]*?)```/g);
    // split intercala: [texto, lang, code, texto, lang, code, ...]
    for (let i = 0; i < parts.length; i++) {
        if (i % 3 === 0) {
            if (parts[i]) {
                const span = document.createElement("span");
                span.textContent = parts[i];
                container.appendChild(span);
            }
        } else if (i % 3 === 2) {
            const lang = parts[i - 1];
            const pre = document.createElement("pre");
            pre.className = "code-block";
            const codeEl = document.createElement("code");
            codeEl.textContent = parts[i].replace(/\n$/, "");
            pre.appendChild(codeEl);
            container.appendChild(pre);
            applyHighlight(codeEl, lang);
        }
    }
}

// ---------- diff de linhas (LCS simples) ----------
function diffLines(before, after) {
    const a = (before ?? "").split("\n");
    const b = (after ?? "").split("\n");
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const result = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) { result.push({ type: "same", text: a[i] }); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { result.push({ type: "removed", text: a[i] }); i++; }
        else { result.push({ type: "added", text: b[j] }); j++; }
    }
    while (i < n) { result.push({ type: "removed", text: a[i] }); i++; }
    while (j < m) { result.push({ type: "added", text: b[j] }); j++; }
    return result;
}

function renderDiff(before, after) {
    const box = document.createElement("div");
    box.className = "diff-view";
    const lines = diffLines(before, after);
    // arquivo pequeno: mostra tudo. Arquivo grande: só as linhas alteradas + 1 de contexto.
    const relevant = lines.length <= 60
        ? lines
        : lines.filter((l, idx) => l.type !== "same" || lines[idx - 1]?.type !== "same" || lines[idx + 1]?.type !== "same");
    for (const l of relevant) {
        const div = document.createElement("div");
        div.className = "diff-line " + l.type;
        div.textContent = l.text;
        box.appendChild(div);
    }
    return box;
}

// ---------- terminal chrome pra run_command ----------
function renderTerminal(stdout, stderr) {
    const wrap = document.createElement("div");
    wrap.className = "terminal";
    wrap.innerHTML = `<div class="term-bar"><span></span><span></span><span></span></div>`;
    const body = document.createElement("div");
    body.className = "term-body";
    if (stdout) {
        body.innerHTML += `<div class="term-label">stdout</div><div class="term-stdout"></div>`;
    }
    if (stderr) {
        body.innerHTML += `<div class="term-label">stderr</div><div class="term-stderr"></div>`;
    }
    wrap.appendChild(body);
    const stdoutEl = body.querySelector(".term-stdout");
    if (stdoutEl) stdoutEl.textContent = stdout;
    const stderrEl = body.querySelector(".term-stderr");
    if (stderrEl) stderrEl.textContent = stderr;
    if (!stdout && !stderr) body.innerHTML = `<div class="term-stdout">(sem saída)</div>`;
    return wrap;
}

// ---------- helpers ----------
function timeNow() {
    return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function relTime(ms) {
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 5) return "agora";
    if (s < 60) return `há ${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `há ${m}min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `há ${h}h`;
    const d = Math.floor(h / 24);
    return `há ${d}d`;
}

function addMessage(role, text) {
    const row = document.createElement("div");
    row.className = "row " + role;
    const roleLabel = { user: "você", agent: "agente", error: "erro" }[role];
    row.innerHTML = `<div class="meta"><span class="role">${roleLabel}</span><span class="time">${timeNow()}</span></div>`;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    if (role === "agent") {
        renderAgentText(bubble, text);
    } else {
        bubble.textContent = text;
    }
    row.appendChild(bubble);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    return row;
}

function addActions(actions) {
    if (!actions || actions.length === 0) return;
    const box = document.createElement("div");
    box.className = "actions";
    for (const a of actions) {
        if (a.tool === "_system") {
            const note = document.createElement("div");
            note.className = "system-note";
            note.textContent = a.result;
            box.appendChild(note);
            continue;
        }

        const det = document.createElement("details");
        det.className = "action";
        const summary = document.createElement("summary");
        const argsStr = JSON.stringify(a.args || {});
        const toolClass = a.tool === "delete_file" ? "tool-name destructive" : "tool-name";
        summary.innerHTML = `<span class="${toolClass}">${a.tool}</span><span style="color:var(--muted)">${argsStr}</span>`;
        det.appendChild(summary);

        if (a.tool === "run_command") {
            det.appendChild(renderTerminal(a.stdout || "", a.stderr || ""));
        } else if (a.tool === "write_file" && (a.before !== undefined)) {
            det.appendChild(renderDiff(a.before, a.after));
        } else {
            const result = document.createElement("div");
            result.className = "result";
            result.textContent = a.result || "(sem retorno)";
            det.appendChild(result);
        }
        box.appendChild(det);

        if (a.tool === "write_file" && a.args?.path) {
            touchedFiles.set(a.args.path, Date.now());
        }
        if (a.tool === "create_folder" && a.args?.path) {
            touchedFiles.set(a.args.path, Date.now());
        }
    }
    log.appendChild(box);
    log.scrollTop = log.scrollHeight;
}

function addTyping() {
    const row = document.createElement("div");
    row.className = "row agent";
    row.id = "typingRow";
    row.innerHTML = `<div class="meta"><span class="role">agente</span></div><div class="typing"><span></span><span></span><span></span></div>`;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
}

function removeTyping() {
    document.getElementById("typingRow")?.remove();
}

function updateStats(turnCalls) {
    totalApiCalls += turnCalls || 0;
    totalCallsEl.textContent = totalApiCalls;
    lastCallsEl.textContent = turnCalls || 0;
}

// ---------- chat ----------
async function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    sendBtn.disabled = true;
    addMessage("user", text);
    addTyping();

    try {
        const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: text, history })
        });
        const data = await res.json();
        removeTyping();

        addActions(data.actions);
        updateStats(data.apiCalls);

        if (data.error) {
            addMessage("error", data.error);
        } else {
            addMessage("agent", data.reply || "(sem resposta de texto)");
            history = data.history;
        }
        if (data.actions?.length) loadTree();
    } catch (err) {
        removeTyping();
        addMessage("error", err.message);
    } finally {
        sendBtn.disabled = false;
        input.focus();
    }
}

sendBtn.addEventListener("click", send);
input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
    }
});

document.getElementById("clearBtn").addEventListener("click", () => {
    history = [];
    log.innerHTML = "";
    addMessage("agent", "Conversa limpa. Os arquivos no workspace continuam como estavam.");
});

// ---------- workspace drawer ----------
const collapsedFolders = new Set();
let lastTreeData = null;
const treeFilterInput = document.getElementById("treeFilter");
const treeSummary = document.getElementById("treeSummary");

function countAllFiles(nodes) {
    let count = 0;
    for (const n of nodes) {
        if (n.type === "dir") count += countAllFiles(n.children);
        else count++;
    }
    return count;
}

function buildTreeDOM(nodes, filterQuery) {
    const ul = document.createElement("ul");
    let anyVisible = false;

    for (const node of nodes) {
        if (node.type === "dir") {
            const childResult = buildTreeDOM(node.children, filterQuery);
            if (filterQuery && !childResult.anyVisible) continue;
            anyVisible = true;

            const li = document.createElement("li");
            const row = document.createElement("div");
            row.className = "tree-dir";
            const collapsed = collapsedFolders.has(node.path) && !filterQuery;
            const touchedAt = touchedFiles.get(node.path);
            const itemCount = node.children.length;
            row.innerHTML =
                `<span class="chevron${collapsed ? "" : " open"}">${ICON_CHEVRON}</span>` +
                `<span class="dir-icon">${ICON_FOLDER}</span>` +
                `<span class="fname">${node.name}</span>` +
                (touchedAt ? `<span class="touched-dot" title="criada nesta sessão"></span>` : "") +
                `<span class="item-count">${itemCount} ${itemCount === 1 ? "item" : "itens"}</span>`;
            row.addEventListener("click", () => {
                if (collapsedFolders.has(node.path)) collapsedFolders.delete(node.path);
                else collapsedFolders.add(node.path);
                renderTreeUI();
            });
            li.appendChild(row);
            if (!collapsed) li.appendChild(childResult.ul);
            ul.appendChild(li);
        } else {
            if (filterQuery && !node.name.toLowerCase().includes(filterQuery)) continue;
            anyVisible = true;

            const li = document.createElement("li");
            const row = document.createElement("div");
            row.className = "tree-file";
            const badge = fileBadge(node.name);
            const touchedAt = touchedFiles.get(node.path);
            row.innerHTML =
                `<span class="file-badge badge-${badge.color}">${badge.label}</span>` +
                `<span class="fname">${node.name}</span>` +
                (touchedAt ? `<span class="touched-dot" title="editado nesta sessão"></span>` : "") +
                `<span class="fmeta">${formatSize(node.size)} · ${relTime(node.mtime)}</span>`;
            row.addEventListener("click", () => openPreview(node.path));
            li.appendChild(row);
            ul.appendChild(li);
        }
    }
    return { ul, anyVisible };
}

function renderTreeUI() {
    const filterQuery = (treeFilterInput.value || "").trim().toLowerCase();
    tree.innerHTML = "";

    if (!lastTreeData || lastTreeData.length === 0) {
        tree.innerHTML = `<div class="tree-empty">${ICON_FOLDER_BIG}<div>workspace vazio</div></div>`;
        treeSummary.textContent = "vazio";
        return;
    }

    treeSummary.textContent = `${countAllFiles(lastTreeData)} arquivo(s)`;

    const { ul, anyVisible } = buildTreeDOM(lastTreeData, filterQuery);
    if (filterQuery && !anyVisible) {
        tree.innerHTML = `<div class="tree-empty">nenhum arquivo bate com "${filterQuery}"</div>`;
        return;
    }
    tree.appendChild(ul);
}

async function loadTree() {
    try {
        const res = await fetch("/api/files");
        const data = await res.json();
        lastTreeData = data.tree;
        renderTreeUI();
    } catch (err) {
        tree.innerHTML = `<div class="tree-empty">erro ao carregar: ${err.message}</div>`;
    }
}

treeFilterInput.addEventListener("input", () => renderTreeUI());

const previewCode = document.getElementById("previewCode");

async function openPreview(filePath) {
    previewName.textContent = filePath;
    previewCode.className = "";
    previewCode.textContent = "carregando…";
    preview.classList.add("open");
    try {
        const res = await fetch("/api/file?path=" + encodeURIComponent(filePath));
        const data = await res.json();
        if (data.error) {
            previewCode.textContent = "Erro: " + data.error;
        } else {
            previewCode.textContent = data.content ?? "(vazio)";
            applyHighlight(previewCode, langFromPath(filePath));
        }
    } catch (err) {
        previewCode.textContent = "Erro: " + err.message;
    }
}

document.getElementById("filesToggle").addEventListener("click", () => {
    drawer.classList.add("open");
    loadTree();
});
document.getElementById("closeDrawer").addEventListener("click", () => drawer.classList.remove("open"));
document.getElementById("refreshTree").addEventListener("click", () => loadTree());
document.getElementById("closePreview").addEventListener("click", () => preview.classList.remove("open"));

// ---------- init ----------
fetch("/api/info").then((r) => r.json()).then((d) => { modelBadge.textContent = d.model; }).catch(() => { modelBadge.textContent = "offline"; });
if (window.matchMedia("(min-width: 860px)").matches) {
    drawer.classList.add("open");
    loadTree();
}
addMessage("agent", "Pronto. Posso listar, ler, criar/editar e rodar arquivos dentro de workspace/. Toque no ícone de pasta pra ver o workspace ao vivo.");