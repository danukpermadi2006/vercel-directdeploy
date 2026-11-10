/* ==========================================================
   Vercel DirectDeploy - script.js (semua interaksi)
   Dimuat dengan defer di index.html (setelah Tailwind).
   ========================================================== */

// ---- Helper keamanan: escape teks tak tepercaya (nama project/repo/branch, pesan API) sebelum masuk innerHTML ----
function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const DOM = {
    token: document.getElementById('v-token'),
    toggleToken: document.getElementById('toggle-token'),
    rememberToken: document.getElementById('remember-token'),
    dropdownTokenHistory: document.getElementById('dropdown-token-history'),
    btnLoadAccount: document.getElementById('btn-load-account'),
    btnDisconnect: document.getElementById('btn-disconnect'),
    alertBox: document.getElementById('alert-box'),

    navTabs: document.querySelectorAll('.nav-tab'),
    tabContents: document.querySelectorAll('.tab-content'),

    owner: document.getElementById('v-owner'),
    repo: document.getElementById('v-repo'),
    dropdownRepo: document.getElementById('dropdown-repo'),
    branch: document.getElementById('v-branch'),
    dropdownBranch: document.getElementById('dropdown-branch'),
    project: document.getElementById('v-project'),
    framework: document.getElementById('v-framework'),
    rootdir: document.getElementById('v-rootdir'),
    env: document.getElementById('v-env'),
    envLines: document.getElementById('env-lines'),
    btnTest: document.getElementById('btn-test'),
    btnDeploy: document.getElementById('btn-deploy'),
    btnCancelDeploy: document.getElementById('btn-cancel-deploy'),
    logContainer: document.getElementById('log-container'),
    logs: document.getElementById('logs'),

    deleteSelect: document.getElementById('v-delete-select'),
    btnTriggerDelete: document.getElementById('btn-trigger-delete'),
    modalDelete: document.getElementById('modal-delete'),
    modalContent: document.getElementById('modal-delete-content'),
    modalTarget: document.getElementById('modal-project-target'),
    btnCancelDel: document.getElementById('btn-cancel-delete'),
    btnConfirmDel: document.getElementById('btn-confirm-delete')
};

let vercelProjects = [];
let ghPublicReposCache = [];
let ghBranchesCache = [];
let tokenHistoryList = JSON.parse(localStorage.getItem('vercelDeployerTokens') || '[]');
let deployAbortController = null;

// Obfuscator definition to prevent SyntaxError
const obfuscator = {
    encode: (str) => {
        if (!str) return '';
        return btoa(encodeURIComponent(str)).split('').reverse().join('');
    },
    decode: (hash) => {
        if (!hash) return '';
        try {
            return decodeURIComponent(atob(hash.split('').reverse().join('')));
        } catch (e) { return ''; }
    }
};

// UI & History Functions
function renderTokenHistory() {
    if (tokenHistoryList.length === 0) return DOM.dropdownTokenHistory.classList.add('hidden');
    DOM.dropdownTokenHistory.innerHTML = '<div class="px-3 py-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-wider">Saved Tokens</div>';

    tokenHistoryList.forEach(item => {
        const div = document.createElement('div');
        div.className = 'px-3 md:px-4 py-2 text-[10px] md:text-sm font-mono text-slate-300 hover:bg-cyan-500/20 hover:text-white cursor-pointer transition-colors flex justify-between items-center';
        div.innerHTML = `<span><i class="fas fa-user-circle mr-1.5 text-cyan-400"></i>${escapeHtml(item.username)}</span> <span class="text-[9px] opacity-50">Token</span>`;
        div.addEventListener('mousedown', (e) => { 
            e.preventDefault(); 
            DOM.token.value = obfuscator.decode(item.token);
            DOM.dropdownTokenHistory.classList.add('hidden');
            checkTokenLength();
            loadProjects();
        });
        DOM.dropdownTokenHistory.appendChild(div);
    });
    DOM.dropdownTokenHistory.classList.remove('hidden');
}

function saveTokenToHistory(token, username) {
    const encoded = obfuscator.encode(token);
    tokenHistoryList = tokenHistoryList.filter(t => t.token !== encoded);
    tokenHistoryList.unshift({ token: encoded, username, date: new Date().toISOString() });
    if (tokenHistoryList.length > 5) tokenHistoryList.pop(); // Keep last 5
    localStorage.setItem('vercelDeployerTokens', JSON.stringify(tokenHistoryList));
}

function executeDisconnect() {
    localStorage.removeItem('vercelDeployerSettingsUltra');
    location.reload();
}

async function fetchGitHubPublicRepos(forceRefresh = false) {
    const owner = DOM.owner.value.trim();
    if(!owner) return;

    const cacheKey = `gh_repo_cache_${owner}`;
    if (!forceRefresh) {
        const cachedData = sessionStorage.getItem(cacheKey);
        if (cachedData) {
            ghPublicReposCache = JSON.parse(cachedData);
            return;
        }
    }

    try {
        // Fetch to Github API (up to 100 per page). Unauthenticated limit is 60 req/hr.
        const res = await fetch(`https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=100&sort=updated`);
        if(res.ok) {
            const data = await res.json();
            ghPublicReposCache = data.map(r => r.name);
            sessionStorage.setItem(cacheKey, JSON.stringify(ghPublicReposCache));
        }
    } catch(e) { console.error("Failed loading Github repos", e); }
}

async function fetchGitHubBranches(owner, repo) {
    if(!owner || !repo) return;
    try {
        const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`);
        if(res.ok) {
            const data = await res.json();
            ghBranchesCache = data.map(b => b.name);
        }
    } catch(e) { console.error("Failed loading branches", e); }
}

function setupAutocomplete(inputEl, dropdownEl, getItemsFn, onSelectCb) {
    const render = () => {
        const items = typeof getItemsFn === 'function' ? getItemsFn() : getItemsFn;
        if (!items || items.length === 0) return dropdownEl.classList.add('hidden');

        const query = inputEl.value.toLowerCase();
        const filtered = items.filter(item => item.toLowerCase().includes(query));

        dropdownEl.innerHTML = '';
        if (filtered.length === 0) return dropdownEl.classList.add('hidden');

        filtered.forEach(item => {
            const div = document.createElement('div');
            div.className = 'px-3 md:px-4 py-2 text-[10px] md:text-sm font-mono text-slate-300 hover:bg-cyan-500/20 hover:text-white cursor-pointer transition-colors';
            div.innerHTML = `<i class="fas fa-book mr-1.5 opacity-50 text-[10px]"></i>${escapeHtml(item)}`;

            div.addEventListener('mousedown', (e) => { 
                e.preventDefault(); e.stopPropagation();
                inputEl.value = item;
                dropdownEl.classList.add('hidden');
                saveSettings();
                if(onSelectCb) onSelectCb(item);
            });
            dropdownEl.appendChild(div);
        });
        dropdownEl.classList.remove('hidden');
    };

    inputEl.addEventListener('focus', render);
    inputEl.addEventListener('input', render);
    inputEl.addEventListener('blur', () => setTimeout(() => dropdownEl.classList.add('hidden'), 250));
}

window.addEventListener('DOMContentLoaded', () => {
    const saved = JSON.parse(localStorage.getItem('vercelDeployerSettingsUltra') || '{}');
    if (saved.rememberToken && saved.token) {
        DOM.token.value = obfuscator.decode(saved.token);
        DOM.rememberToken.checked = true;
        checkTokenLength();
        DOM.btnDisconnect.classList.remove('hidden');
    }
    if (saved.owner) { DOM.owner.value = saved.owner; DOM.btnDisconnect.classList.remove('hidden'); }
    if (saved.repo) DOM.repo.value = saved.repo;
    if (saved.branch) DOM.branch.value = saved.branch;
    if (saved.framework) DOM.framework.value = saved.framework;
    if (saved.rootdir) DOM.rootdir.value = saved.rootdir;
    if (saved.env) DOM.env.value = saved.env;

    if(saved.cachedProjects) {
        vercelProjects = saved.cachedProjects;
        renderProjectDropdown();
    }

    setTimeout(updateEnvTextarea, 50); 

    // Autocomplete settings
    setupAutocomplete(DOM.repo, DOM.dropdownRepo, () => ghPublicReposCache, (repoName) => {
        const owner = DOM.owner.value.trim();
        fetchGitHubBranches(owner, repoName);
    });
    setupAutocomplete(DOM.branch, DOM.dropdownBranch, () => ghBranchesCache);

    // Fetch branches proactively if repo is already filled
    if (saved.owner && saved.repo) {
        fetchGitHubPublicRepos();
        fetchGitHubBranches(saved.owner, saved.repo);
    }

    // UI Events
    DOM.token.addEventListener('input', checkTokenLength);
    DOM.token.addEventListener('focus', renderTokenHistory);
    DOM.token.addEventListener('blur', () => setTimeout(() => DOM.dropdownTokenHistory.classList.add('hidden'), 200));
    DOM.btnLoadAccount.addEventListener('click', loadProjects);
    DOM.btnDisconnect.addEventListener('click', executeDisconnect);

    DOM.toggleToken.addEventListener('click', () => {
        const isPass = DOM.token.type === 'password';
        DOM.token.type = isPass ? 'text' : 'password';
        DOM.toggleToken.innerHTML = isPass ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
        DOM.toggleToken.classList.toggle('text-cyan-400', isPass);
    });

    // Owner explicit change should refetch repos
    DOM.owner.addEventListener('change', () => {
        saveSettings();
        fetchGitHubPublicRepos(true);
    });

    const toggleAdvancedBtn = document.getElementById('toggle-advanced');
    if (toggleAdvancedBtn) {
        toggleAdvancedBtn.addEventListener('click', () => {
            const isExpanded = toggleAdvancedBtn.getAttribute('aria-expanded') === 'true';
            toggleAdvancedBtn.setAttribute('aria-expanded', !isExpanded);
            document.getElementById('advanced-settings').classList.toggle('hidden');
            document.getElementById('advanced-icon').classList.toggle('rotate-180');
        });
    }

    DOM.env.addEventListener('input', updateEnvTextarea);
    window.addEventListener('resize', updateEnvTextarea);

    // Tabs
    DOM.navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            DOM.navTabs.forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
            DOM.tabContents.forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
            document.getElementById(tab.dataset.target).classList.add('active');
            hideAlert();
        });
        tab.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tab.click(); }
        });
    });

    // Save Inputs
    const inputs = [DOM.token, DOM.rememberToken, DOM.owner, DOM.repo, DOM.branch, DOM.framework, DOM.rootdir, DOM.env];
    inputs.forEach(el => el.addEventListener('change', saveSettings));

    // Core Action Buttons
    DOM.btnTest.addEventListener('click', testConnection);
    DOM.btnDeploy.addEventListener('click', startDeployment);
    DOM.btnCancelDeploy.addEventListener('click', () => {
        if(deployAbortController) deployAbortController.abort();
    });

    // Delete UI Events
    DOM.deleteSelect.addEventListener('change', () => {
        DOM.btnTriggerDelete.disabled = !DOM.deleteSelect.value;
    });
    DOM.btnTriggerDelete.addEventListener('click', () => {
        const selectedId = DOM.deleteSelect.value;
        const selectedProj = vercelProjects.find(p => String(p.id) === String(selectedId));
        if (!selectedProj) { showAlert("Silakan pilih Project yang valid terlebih dahulu.", "error"); return; }
        DOM.modalTarget.textContent = selectedProj.name;
        DOM.modalDelete.classList.add('active');
        DOM.modalContent.classList.replace('scale-95', 'scale-100');
    });
    DOM.btnCancelDel.addEventListener('click', () => {
        DOM.modalContent.classList.replace('scale-100', 'scale-95');
        setTimeout(() => DOM.modalDelete.classList.remove('active'), 200);
    });
    DOM.btnConfirmDel.addEventListener('click', deleteProject);
});

function checkTokenLength() {
    DOM.btnLoadAccount.classList.toggle('hidden', DOM.token.value.trim().length <= 15);
}

function updateEnvTextarea() {
    DOM.env.style.height = 'auto';
    DOM.env.style.height = DOM.env.scrollHeight + 'px';
    const linesCount = DOM.env.value.split('\n').length;
    const minLines = Math.max(3, linesCount);
    let linesHtml = '';
    for(let i = 1; i <= minLines; i++) linesHtml += `<span>${escapeHtml(i)}</span>`;
    DOM.envLines.innerHTML = linesHtml;
}

function saveSettings() {
    const settings = {
        rememberToken: DOM.rememberToken.checked,
        token: DOM.rememberToken.checked ? obfuscator.encode(DOM.token.value.trim()) : '',
        owner: DOM.owner.value.trim(),
        repo: DOM.repo.value.trim(),
        branch: DOM.branch.value.trim(),
        framework: DOM.framework.value,
        rootdir: DOM.rootdir.value.trim(),
        env: DOM.env.value,
        cachedProjects: vercelProjects
    };
    localStorage.setItem('vercelDeployerSettingsUltra', JSON.stringify(settings));
}

function showAlert(message, type = 'error') {
    const bg = type === 'error' ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400';
    const icon = type === 'error' ? 'fa-times-circle' : 'fa-check-circle';
    DOM.alertBox.className = `mt-1 mb-4 p-2.5 md:p-3 rounded-lg md:rounded-xl text-[10px] md:text-xs font-medium border flex items-start gap-2 shadow-inner relative z-10 ${bg}`;
    DOM.alertBox.innerHTML = `<i class="fas ${icon} mt-0.5 text-sm"></i> <div class="flex-1">${message}</div>`;
    DOM.alertBox.classList.remove('hidden');
    if (type === 'success') setTimeout(hideAlert, 6000);
}
function hideAlert() { DOM.alertBox.classList.add('hidden'); }

function log(message, type = 'info') {
    const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });
    const time = `<span class="text-slate-600 select-none" aria-hidden="true">[${timeStr}]</span>`;
    let prefix = `<span class="text-cyan-400 select-none" aria-hidden="true">❯</span>`;
    let colorClass = 'text-slate-300';

    if (type === 'success') { prefix = `<span class="text-emerald-400 select-none" aria-hidden="true">✔</span>`; colorClass = 'text-emerald-300 font-medium'; } 
    else if (type === 'error') { prefix = `<span class="text-rose-500 select-none" aria-hidden="true">✖</span>`; colorClass = 'text-rose-400 font-medium'; } 
    else if (type === 'warn') { prefix = `<span class="text-amber-400 select-none" aria-hidden="true">⚠</span>`; colorClass = 'text-amber-300'; }

    if (type === 'raw') {
        const div = document.createElement('div'); div.className = 'w-full mt-1 mb-1'; div.innerHTML = message; DOM.logs.appendChild(div);
    } else {
        const div = document.createElement('div'); div.className = `${colorClass} flex gap-1.5 md:gap-2 items-start`;
        div.innerHTML = `${time} ${prefix} <div class="flex-1 break-words">${message}</div>`; DOM.logs.appendChild(div);
    }
    DOM.logContainer.scrollTo({ top: DOM.logContainer.scrollHeight, behavior: 'smooth' });
}

function renderProjectDropdown() {
    if(vercelProjects.length === 0) {
        DOM.deleteSelect.innerHTML = '<option value="">No projects found</option>';
        return;
    }
    DOM.deleteSelect.innerHTML = '<option value="">-- Select Project to Delete --</option>';
    vercelProjects.sort((a,b) => a.name.localeCompare(b.name)).forEach(p => {
        const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.name;
        DOM.deleteSelect.appendChild(opt);
    });
}

async function loadProjects() {
    const token = DOM.token.value.trim();
    if (!token) return showAlert("Please enter Vercel Token.", "error");

    hideAlert();
    const ogHtml = DOM.btnLoadAccount.innerHTML;
    DOM.btnLoadAccount.innerHTML = `<div class="spinner" aria-hidden="true"></div><span class="sr-only">Loading...</span>`;
    DOM.btnLoadAccount.disabled = true;

    try {
        // 1. Get Vercel User Info
        let vercelUsername = "Vercel User";
        try {
            const userRes = await fetch("https://api.vercel.com/v2/user", { headers: { "Authorization": `Bearer ${token}` } });
            if (userRes.ok) {
                const userData = await userRes.json();
                if (userData.user) {
                    vercelUsername = userData.user.username || vercelUsername;
                    if(userData.user.uid) {
                        const avatarImg = document.getElementById('user-avatar');
                        avatarImg.src = `https://vercel.com/api/www/avatar/${userData.user.uid}?s=120`;
                        avatarImg.style.display = 'block';
                        avatarImg.nextElementSibling.style.display = 'none';
                    }
                }
            }
        } catch(e) { }

        // 2. Load Projects (with Pagination for > 100 projects)
        let allProjects = [];
        let nextParam = null;
        do {
            let url = `https://api.vercel.com/v9/projects?limit=100`;
            if (nextParam) url += `&until=${nextParam}`;

            const res = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
            if (!res.ok) throw new Error("Failed to load projects. Check token.");
            const data = await res.json();

            if (data.projects) allProjects.push(...data.projects);
            nextParam = (data.pagination && data.pagination.next) ? data.pagination.next : null;
        } while (nextParam);

        vercelProjects = allProjects.map(p => ({ id: p.id, name: p.name }));

        // 3. SMART AUTO-DETECT GITHUB OWNER
        let githubNamespace = null;
        for (const p of allProjects) {
            if (p.link && p.link.type === 'github') {
                if (p.link.org) { githubNamespace = p.link.org; break; } 
                else if (p.link.repo) { githubNamespace = p.link.repo.split('/')[0]; break; }
            }
        }

        // Set auto-detected owner (if input is empty)
        if (githubNamespace && !DOM.owner.value.trim()) {
            DOM.owner.value = githubNamespace;
            fetchGitHubPublicRepos(true);
        }

        DOM.btnDisconnect.classList.remove('hidden');
        saveTokenToHistory(token, vercelUsername);
        renderProjectDropdown();
        DOM.btnTriggerDelete.disabled = true;
        saveSettings();

        showAlert(`Successfully loaded ${vercelProjects.length} projects.`, "success");
    } catch (err) { showAlert(escapeHtml(err.message), "error"); } 
    finally { DOM.btnLoadAccount.innerHTML = ogHtml; DOM.btnLoadAccount.disabled = false; }
}

async function deleteProject() {
    const token = DOM.token.value.trim();
    const selectedId = DOM.deleteSelect.value;
    const selectedProj = vercelProjects.find(p => String(p.id) === String(selectedId));

    if (!token || !selectedProj) return;

    const ogHtml = DOM.btnConfirmDel.innerHTML;
    DOM.btnConfirmDel.innerHTML = `<div class="spinner" aria-hidden="true"></div><span class="sr-only">Deleting...</span>`;
    DOM.btnConfirmDel.disabled = true;
    DOM.btnCancelDel.disabled = true;

    try {
        const res = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(selectedId)}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error?.message || "Failed to delete project on Vercel.");
        }

        vercelProjects = vercelProjects.filter(p => String(p.id) !== String(selectedId));
        renderProjectDropdown();
        DOM.btnTriggerDelete.disabled = true;
        saveSettings();

        DOM.modalContent.classList.replace('scale-100', 'scale-95');
        setTimeout(() => DOM.modalDelete.classList.remove('active'), 200);
        showAlert(`Project <strong class="text-white">${escapeHtml(selectedProj.name)}</strong> deleted successfully.`, "success");

    } catch (err) {
        DOM.modalContent.classList.replace('scale-100', 'scale-95');
        setTimeout(() => DOM.modalDelete.classList.remove('active'), 200);
        showAlert(escapeHtml(err.message), "error");
    } finally {
        DOM.btnConfirmDel.innerHTML = 'Yes, Delete!';
        DOM.btnConfirmDel.disabled = false;
        DOM.btnCancelDel.disabled = false;
    }
}

async function testConnection() {
    const token = DOM.token.value.trim();
    const owner = DOM.owner.value.trim();
    const repo = DOM.repo.value.trim();

    if (!token || !owner || !repo) return log("Token, Owner, and Repo are required!", "error");
    saveSettings();

    log(`<div class="border-t border-slate-800/80 w-full my-1"></div>`, 'raw');
    log("Starting Access Test...", "info");

    const ogHtml = DOM.btnTest.innerHTML;
    DOM.btnTest.innerHTML = `<div class="spinner" aria-hidden="true"></div><span class="sr-only">Testing...</span>`;
    DOM.btnTest.disabled = true;

    try {
        const vRes = await fetch("https://api.vercel.com/v2/user", { headers: { "Authorization": `Bearer ${token}` } });
        if (!vRes.ok) throw new Error("Invalid Vercel Token.");
        log("Vercel token valid.", "success");

        const ghRes = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
        if (!ghRes.ok) {
            if (ghRes.status === 404) log("GitHub Repo returned 404 (Likely Private). Relying on Vercel linkage.", "warn");
            else log(`GitHub API returned: ${escapeHtml(ghRes.statusText)}`, "warn");
        } else {
            const ghData = await ghRes.json();
            log(`GitHub Repo public/accessible. [ID: ${ghData.id}]`, "success");
        }
    } catch (err) { log(escapeHtml(err.message), "error"); } 
    finally { DOM.btnTest.innerHTML = ogHtml; DOM.btnTest.disabled = false; }
}

async function startDeployment() {
    const token = DOM.token.value.trim();
    const owner = DOM.owner.value.trim();
    const repo = DOM.repo.value.trim();
    const branch = DOM.branch.value.trim() || 'main';

    if (!token || !owner || !repo) return log("Token, Owner, and Repo are required!", "error");

    let projectName = DOM.project.value.trim();
    if (!projectName) {
        projectName = repo.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
        DOM.project.value = projectName;
    }

    saveSettings();

    log(`<div class="border-t border-slate-800/80 w-full my-2"></div>`, 'raw');
    log(`[START] Deploying: <span class="text-white font-bold">${escapeHtml(projectName)}</span>`, "info");

    const ogHtml = DOM.btnDeploy.innerHTML;
    DOM.btnDeploy.innerHTML = `<div class="spinner" aria-hidden="true"></div> <span class="ml-2 font-bold tracking-widest uppercase text-[10px] md:text-xs">Building...</span>`;
    DOM.btnDeploy.disabled = true;
    DOM.btnCancelDeploy.classList.remove('hidden');

    deployAbortController = new AbortController();

    try {
        const envStr = DOM.env.value.trim();
        const envObj = {};
        if (envStr) {
            const lines = envStr.split(/\r?\n/);
            lines.forEach(line => {
                const separatorIndex = line.indexOf('=');
                if (separatorIndex !== -1) {
                    const key = line.substring(0, separatorIndex).trim();
                    let val = line.substring(separatorIndex + 1).trim();
                    if (!key) return;
                    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                        val = val.substring(1, val.length - 1);
                    }
                    envObj[key] = val;
                }
            });
        }

        // STEP 1: Link Project to GitHub via Vercel Connect
        if (deployAbortController.signal.aborted) throw new Error("Canceled");
        log("Linking Project config in Vercel...", "info");

        const projectPayload = {
            name: projectName,
            framework: DOM.framework.value || null,
            rootDirectory: DOM.rootdir.value || null,
            gitRepository: { type: "github", repo: `${owner}/${repo}` }
        };

        const projRes = await fetch("https://api.vercel.com/v9/projects", {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(projectPayload)
        });

        const projData = await projRes.json();
        if (!projRes.ok && projRes.status !== 409) {
             throw new Error(`Failed to create/link project: ${projData.error?.message}`);
        }

        if(projRes.ok) {
            vercelProjects.push({ id: projData.id, name: projData.name });
            renderProjectDropdown();
            saveSettings();
        }

        // STEP 2: Fetch Repo ID directly from Vercel
        if (deployAbortController.signal.aborted) throw new Error("Canceled");
        let repoId = null;
        try {
            const fetchProjRes = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(projectName)}`, { headers: { "Authorization": `Bearer ${token}` } });
            if (fetchProjRes.ok) {
                const fetchProjData = await fetchProjRes.json();
                if (fetchProjData.link && fetchProjData.link.repoId) {
                    repoId = String(fetchProjData.link.repoId);
                    log(`Repository verified directly via Vercel Connect.`, "success");
                }
            }
        } catch(e) {}

        if (!repoId) {
            log("Fetching GitHub Repo ID via API...", "info");
            const ghRes = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
            if (!ghRes.ok) throw new Error(`Cannot access GitHub Repo. Ensure Vercel Connect is properly linked or Repo is Public.`);
            const ghData = await ghRes.json();
            repoId = String(ghData.id);
        }

        // STEP 3: Trigger Deployment API v13
        if (deployAbortController.signal.aborted) throw new Error("Canceled");
        log(`Triggering Deployment...`, "info");

        const deployPayload = {
            name: projectName,
            target: "production",
            gitSource: { type: "github", repoId: repoId, ref: branch },
            projectSettings: {}
        };

        if (DOM.framework.value) deployPayload.projectSettings.framework = DOM.framework.value;
        if (DOM.rootdir.value) deployPayload.projectSettings.rootDirectory = DOM.rootdir.value;
        if (Object.keys(envObj).length > 0) deployPayload.env = envObj;

        const deployRes = await fetch("https://api.vercel.com/v13/deployments?skipAutoDetectionConfirmation=1", {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(deployPayload)
        });

        const deployData = await deployRes.json();
        if (!deployRes.ok) throw new Error(`Vercel Deploy Error: ${deployData.error?.message}`);

        const deploymentId = deployData.id;
        log(`Deployment active. ID: <span class="text-purple-400">${escapeHtml(deploymentId)}</span>`, "success");

        // STEP 4: Smart Polling Status
        let status = deployData.readyState || "QUEUED";
        let attempts = 0;
        let finalStatData = null;

        while (status !== "READY" && status !== "ERROR" && status !== "CANCELED" && attempts < 150) {
            if (deployAbortController.signal.aborted) throw new Error("Canceled");

            attempts++;
            // Delay 4s inside polling
            await new Promise(r => setTimeout(r, 4000)); 
            if (deployAbortController.signal.aborted) throw new Error("Canceled");

            const statRes = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
                headers: { "Authorization": `Bearer ${token}` }
            });

            if (!statRes.ok) continue; 
            const statData = await statRes.json();
            finalStatData = statData;

            if (statData.readyState !== status) {
                status = statData.readyState;
                if (status === 'BUILDING') log(`Status: <span class="text-amber-400 font-bold animate-pulse">⚙ BUILDING...</span>`);
                else log(`Status: <span class="text-slate-300 uppercase">${escapeHtml(status)}</span>`);
            }
        }

        if (status === "READY") {
            let url = `https://${deployData.url}`;
            if (finalStatData && finalStatData.alias && finalStatData.alias.length > 0) {
                const shortestAlias = finalStatData.alias.reduce((a, b) => a.length <= b.length ? a : b);
                url = `https://${shortestAlias}`;
            }
            log("DEPLOYMENT SUCCESSFUL", "success");
            log(`
                <div class="mt-2 mb-1 p-3 border border-cyan-500/30 bg-cyan-950/20 rounded-lg shadow-inner">
                    <div class="mb-2 border-b border-cyan-900/50 pb-2 text-cyan-400 font-bold flex items-center gap-1.5 text-[11px] md:text-sm">
                        <i class="fas fa-check-circle"></i> App is Live
                    </div>
                    <div class="space-y-2 font-sans">
                        <a href="${url}" target="_blank" rel="noopener noreferrer" class="text-white hover:text-cyan-300 font-medium break-all flex items-center gap-1.5 group w-max transition-colors text-[11px] md:text-sm">
                            <i class="fas fa-globe text-cyan-500"></i> <span class="border-b border-transparent group-hover:border-cyan-300 pb-0.5">${escapeHtml(url)}</span> 
                        </a>
                    </div>
                </div>
            `, "raw");
        } 
        else if (status === "ERROR") {
            let errorMsg = `Deployment failed (Status: ERROR).`;
            if (finalStatData && finalStatData.error && finalStatData.error.message) {
                log(`<span class="text-rose-400 font-mono text-[10px] break-all">Reason: ${escapeHtml(finalStatData.error.message)}</span>`, "raw");
            }
            if (finalStatData && finalStatData.inspectorUrl) {
                log(`
                    <div class="mt-1 mb-1 p-2 border border-rose-500/30 bg-rose-950/20 rounded-lg">
                        <a href="${finalStatData.inspectorUrl}" target="_blank" rel="noopener noreferrer" class="text-rose-300 underline hover:text-rose-200 text-[10px] md:text-xs">
                            <i class="fas fa-external-link-alt mr-1"></i> View Full Logs
                        </a>
                    </div>
                `, "raw");
            }
            throw new Error(errorMsg);
        } 
        else if (attempts >= 150) throw new Error("Timeout: Build exceeded 10 minutes limit.");
        else if (status !== "CANCELED") throw new Error(`Deployment failed (Status: ${status})`);

    } catch (err) {
        if (err.message === "Canceled") {
            log("Deployment wait canceled by user.", "warn");
        } else {
            log(escapeHtml(err.message), "error");
        }
    } finally {
        DOM.btnDeploy.innerHTML = `<i class="fas fa-rocket" aria-hidden="true"></i> <span>Deploy to Vercel</span>`;
        DOM.btnDeploy.disabled = false;
        DOM.btnCancelDeploy.classList.add('hidden');
        deployAbortController = null;
    }
}
