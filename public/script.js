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

// ---------- syntax highlighting (highlight.js via CDN) ----------
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
  return `há ${m}min`;
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
    summary.innerHTML = `<span class="tool-name">${a.tool}</span><span style="color:var(--muted)">${argsStr}</span>`;
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
function renderTree(nodes) {
  if (!nodes || nodes.length === 0) return "<div class='tree-empty'>workspace vazio</div>";
  let html = "<ul>";
  for (const node of nodes) {
    if (node.type === "dir") {
      html += `<li><div class="tree-dir">${node.name}/</div>${renderTree(node.children)}</li>`;
    } else {
      const touchedAt = touchedFiles.get(node.path);
      const touchedHtml = touchedAt
        ? `<span class="touched-dot" title="editado nesta sessão"></span><span class="touched-label">${relTime(touchedAt)}</span>`
        : "";
      html += `<li><div class="tree-file" data-path="${node.path}">${touchedHtml}<span class="fname">${node.name}</span></div></li>`;
    }
  }
  html += "</ul>";
  return html;
}

async function loadTree() {
  try {
    const res = await fetch("/api/files");
    const data = await res.json();
    tree.innerHTML = renderTree(data.tree);
    tree.querySelectorAll(".tree-file").forEach((el) => {
      el.addEventListener("click", () => openPreview(el.dataset.path));
    });
  } catch (err) {
    tree.innerHTML = `<div class="tree-empty">erro ao carregar: ${err.message}</div>`;
  }
}

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