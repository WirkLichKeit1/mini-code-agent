const log = document.getElementById("log");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const drawer = document.getElementById("drawer");
const tree = document.getElementById("tree");
const preview = document.getElementById("preview");
const previewName = document.getElementById("previewName");
const previewContent = document.getElementById("previewContent");
const modelBadge = document.getElementById("modelBadge");

let history = [];

const touchedFiles = new Map();
// path -> timestamp (ms)


// ---------- helpers ----------

function timeNow() {
    return new Date().toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function relTime(ms) {
    const s = Math.floor((Date.now() - ms) / 1000);

    if (s < 5) {
        return "agora";
    }

    if (s < 60) {
        return `há ${s}s`;
    }

    const m = Math.floor(s / 60);

    return `há ${m}min`;
}


function addMessage(role, text) {
    const row = document.createElement("div");

    row.className = "row " + role;

    const roleLabel = {
        user: "você",
        agent: "agente",
        error: "erro"
    }[role];

    row.innerHTML = `
        <div class="meta">
            <span class="role">${roleLabel}</span>
            <span class="time">${timeNow()}</span>
        </div>
    `;

    const bubble = document.createElement("div");

    bubble.className = "bubble";
    bubble.textContent = text;

    row.appendChild(bubble);

    log.appendChild(row);

    log.scrollTop = log.scrollHeight;

    return row;
}


function addActions(actions) {
    if (!actions || actions.length === 0) {
        return;
    }

    const box = document.createElement("div");

    box.className = "actions";

    for (const a of actions) {
        const det = document.createElement("details");

        det.className = "action";

        const summary = document.createElement("summary");

        const argsStr = JSON.stringify(a.args || {});

        summary.innerHTML = `
            <span class="tool-name">${a.tool}</span>
            <span style="color:var(--muted)">
                ${argsStr}
            </span>
        `;

        det.appendChild(summary);

        const result = document.createElement("div");

        result.className = "result";
        result.textContent = a.result || "(sem retorno)";

        det.appendChild(result);

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

    row.innerHTML = `
        <div class="meta">
            <span class="role">agente</span>
        </div>

        <div class="typing">
            <span></span>
            <span></span>
            <span></span>
        </div>
    `;

    log.appendChild(row);

    log.scrollTop = log.scrollHeight;
}


function removeTyping() {
    document.getElementById("typingRow")?.remove();
}


// ---------- chat ----------

async function send() {
    const text = input.value.trim();

    if (!text) {
        return;
    }

    input.value = "";

    sendBtn.disabled = true;

    addMessage("user", text);

    addTyping();

    try {
        const res = await fetch("/api/chat", {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                message: text,
                history
            })
        });

        const data = await res.json();

        removeTyping();

        addActions(data.actions);

        if (data.error) {
            addMessage("error", data.error);
        } else {
            addMessage(
                "agent",
                data.reply || "(sem resposta de texto)"
            );

            history = data.history;
        }

        if (data.actions?.length) {
            loadTree(true);
        }

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


document
    .getElementById("clearBtn")
    .addEventListener("click", () => {
        history = [];

        log.innerHTML = "";

        addMessage(
            "agent",
            "Conversa limpa. Os arquivos no workspace continuam como estavam."
        );
    });


// ---------- workspace drawer ----------

function renderTree(nodes) {
    if (!nodes || nodes.length === 0) {
        return `
            <div class="tree-empty">
                workspace vazio
            </div>
        `;
    }

    let html = "<ul>";

    for (const node of nodes) {
        if (node.type === "dir") {
            html += `
                <li>
                    <div class="tree-dir">
                        ${node.name}/
                    </div>

                    ${renderTree(node.children)}
                </li>
            `;

        } else {
            const touchedAt = touchedFiles.get(node.path);

            const touchedHtml = touchedAt
                ? `
                    <span
                        class="touched-dot"
                        title="editado nesta sessão"
                    ></span>

                    <span class="touched-label">
                        ${relTime(touchedAt)}
                    </span>
                `
                : "";

            html += `
                <li>
                    <div
                        class="tree-file"
                        data-path="${node.path}"
                    >
                        ${touchedHtml}

                        <span class="fname">
                            ${node.name}
                        </span>
                    </div>
                </li>
            `;
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

        tree
            .querySelectorAll(".tree-file")
            .forEach((el) => {
                el.addEventListener("click", () => {
                    openPreview(el.dataset.path);
                });
            });

    } catch (err) {
        tree.innerHTML = `
            <div class="tree-empty">
                erro ao carregar: ${err.message}
            </div>
        `;
    }
}


async function openPreview(filePath) {
    previewName.textContent = filePath;

    previewContent.textContent = "carregando…";

    preview.classList.add("open");

    try {
        const res = await fetch(
            "/api/file?path=" + encodeURIComponent(filePath)
        );

        const data = await res.json();

        previewContent.textContent =
            data.content ??
            data.error ??
            "(vazio)";

    } catch (err) {
        previewContent.textContent =
            "Erro: " + err.message;
    }
}


// ---------- workspace events ----------

document
    .getElementById("filesToggle")
    .addEventListener("click", () => {
        drawer.classList.add("open");

        loadTree();
    });


document
    .getElementById("closeDrawer")
    .addEventListener("click", () => {
        drawer.classList.remove("open");
    });


document
    .getElementById("refreshTree")
    .addEventListener("click", () => {
        loadTree();
    });


document
    .getElementById("closePreview")
    .addEventListener("click", () => {
        preview.classList.remove("open");
    });


// ---------- init ----------

fetch("/api/info")
    .then((r) => r.json())
    .then((d) => {
        modelBadge.textContent = d.model;
    })
    .catch(() => {
        modelBadge.textContent = "offline";
    });


if (window.matchMedia("(min-width: 860px)").matches) {
    drawer.classList.add("open");

    loadTree();
}


addMessage(
    "agent",
    "Pronto. Posso listar, ler, criar/editar e rodar arquivos dentro de workspace/. Toque no ícone de pasta pra ver o workspace ao vivo."
);