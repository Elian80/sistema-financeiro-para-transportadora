/* ===================================================
   GM7 Sistemas — Admin Panel Script
   =================================================== */

const API_BASE = '/gm7-api';
const TOKEN_KEY = 'gm7_admin_token';

let adminToken = localStorage.getItem(TOKEN_KEY) || '';
let siteContent = {};
let newLogoData = null;
let newSobreImgData = null;
let newDepFotoData = null;

// ── Auth check on load ──
window.addEventListener('DOMContentLoaded', () => {
  if (adminToken) {
    mostrarAdmin();
    carregarConteudo();
  }
  setupImageUploads();
  setupSidebarNav();
});

// ── Login ──
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const senha = document.getElementById('login-senha').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';

  try {
    const res = await fetch(`${API_BASE}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha }),
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.detail || 'Senha incorreta.';
      return;
    }
    adminToken = data.token;
    localStorage.setItem(TOKEN_KEY, adminToken);
    mostrarAdmin();
    carregarConteudo();
  } catch (err) {
    errEl.textContent = `Erro ao conectar com o servidor: ${err.message || 'falha de rede'}.`;
  }
});

// ── Logout ──
document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY);
  adminToken = '';
  document.getElementById('admin-panel').style.display = 'none';
  document.getElementById('login-page').style.display = 'flex';
  document.getElementById('login-senha').value = '';
});

function mostrarAdmin() {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('admin-panel').style.display = 'flex';
}

// ── Auth header ──
function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${adminToken}`,
  };
}

// ── Load content ──
async function carregarConteudo() {
  try {
    const res = await fetch(`${API_BASE}/content`);
    if (res.ok) {
      siteContent = await res.json();
      preencherFormularios();
    }
  } catch (e) {
    showToast('Erro ao carregar conteúdo', 'err');
  }
  carregarMensagens();
}

function preencherFormularios() {
  const c = siteContent;

  // Marca
  const marca = c.marca || {};
  setVal('marca-nome', marca.nome || '');
  setVal('marca-tagline', marca.tagline || '');
  if (marca.logo) {
    const prev = document.getElementById('logo-preview');
    if (prev) { prev.src = marca.logo; prev.classList.add('show'); }
  }

  // Hero
  const hero = c.hero || {};
  setVal('hero-title', hero.title || '');
  setVal('hero-subtitle', hero.subtitle || '');
  setVal('hero-cta1', hero.cta1 || '');
  setVal('hero-cta2', hero.cta2 || '');
  setVal('hero-stat-clients', hero.stat_clients || '50');
  setVal('hero-stat-clients-label', hero.stat_clients_label || '');
  setVal('hero-stat-projects', hero.stat_projects || '120');
  setVal('hero-stat-projects-label', hero.stat_projects_label || '');
  setVal('hero-stat-years', hero.stat_years || '5');
  setVal('hero-stat-years-label', hero.stat_years_label || '');

  // Services
  renderServiceEditors(c.servicos || []);

  // Sobre
  const sobre = c.sobre || {};
  setVal('sobre-title', sobre.title || '');
  setVal('sobre-subtitle', sobre.subtitle || '');
  setVal('sobre-texto', sobre.texto || '');
  if (sobre.imagem) {
    const prev = document.getElementById('sobre-img-preview');
    if (prev) { prev.src = sobre.imagem; prev.classList.add('show'); }
  }

  // Contato
  const contato = c.contato || {};
  setVal('contato-whatsapp', contato.whatsapp || '');
  setVal('contato-email', contato.email || '');
  setVal('contato-instagram', contato.instagram || '');
  setVal('contato-linkedin', contato.linkedin || '');
  setVal('contato-endereco', contato.endereco || '');

  // Depoimentos
  renderDepTable(c.depoimentos || []);
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

// ── Service editors ──
function renderServiceEditors(servicos) {
  const grid = document.getElementById('service-editor-grid');
  if (!grid) return;
  const defaultServicos = [
    { icone: '🚛', titulo: '', descricao: '', destaque: false },
    { icone: '⚡', titulo: '', descricao: '', destaque: false },
    { icone: '💻', titulo: '', descricao: '', destaque: false },
  ];
  const list = servicos.length >= 3 ? servicos : defaultServicos.map((d, i) => ({ ...d, ...(servicos[i] || {}) }));
  grid.innerHTML = list.slice(0, 3).map((s, i) => `
    <div class="service-editor-card">
      <div class="card-title">Serviço ${i + 1}</div>
      <div class="form-group" style="margin-bottom:10px">
        <label>Ícone (emoji)</label>
        <input type="text" id="svc-icone-${i}" value="${escAdmin(s.icone || '')}" placeholder="🚛" style="font-size:1.2rem" />
      </div>
      <div class="form-group" style="margin-bottom:10px">
        <label>Título</label>
        <input type="text" id="svc-titulo-${i}" value="${escAdmin(s.titulo || '')}" placeholder="Nome do serviço" />
      </div>
      <div class="form-group" style="margin-bottom:10px">
        <label>Descrição</label>
        <textarea id="svc-desc-${i}" rows="3" placeholder="Descreva o serviço...">${escAdmin(s.descricao || '')}</textarea>
      </div>
      <label class="form-toggle">
        <input type="checkbox" id="svc-destaque-${i}" ${s.destaque ? 'checked' : ''} />
        <div class="toggle-switch"></div>
        Destaque
      </label>
    </div>
  `).join('');
}

// ── Collect section data ──
function coletarMarca() {
  return {
    nome: getVal('marca-nome'),
    tagline: getVal('marca-tagline'),
    logo: newLogoData || (siteContent.marca || {}).logo || null,
  };
}

function coletarHero() {
  return {
    title: getVal('hero-title'),
    subtitle: getVal('hero-subtitle'),
    cta1: getVal('hero-cta1'),
    cta2: getVal('hero-cta2'),
    stat_clients: getVal('hero-stat-clients'),
    stat_clients_label: getVal('hero-stat-clients-label'),
    stat_projects: getVal('hero-stat-projects'),
    stat_projects_label: getVal('hero-stat-projects-label'),
    stat_years: getVal('hero-stat-years'),
    stat_years_label: getVal('hero-stat-years-label'),
  };
}

function coletarServicos() {
  return [0, 1, 2].map(i => ({
    icone: getVal(`svc-icone-${i}`),
    titulo: getVal(`svc-titulo-${i}`),
    descricao: getVal(`svc-desc-${i}`),
    destaque: document.getElementById(`svc-destaque-${i}`)?.checked || false,
  }));
}

function coletarSobre() {
  return {
    title: getVal('sobre-title'),
    subtitle: getVal('sobre-subtitle'),
    texto: getVal('sobre-texto'),
    imagem: newSobreImgData || (siteContent.sobre || {}).imagem || null,
  };
}

function coletarContato() {
  return {
    whatsapp: getVal('contato-whatsapp'),
    email: getVal('contato-email'),
    instagram: getVal('contato-instagram'),
    linkedin: getVal('contato-linkedin'),
    endereco: getVal('contato-endereco'),
  };
}

function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

// ── Save section ──
async function salvarSecao(secao) {
  const statusEl = document.getElementById(`save-status-${secao}`);
  if (statusEl) { statusEl.textContent = 'Salvando...'; statusEl.className = 'save-status'; }

  const updates = {};
  if (secao === 'marca') updates.marca = coletarMarca();
  else if (secao === 'hero') updates.hero = coletarHero();
  else if (secao === 'servicos') updates.servicos = coletarServicos();
  else if (secao === 'sobre') updates.sobre = coletarSobre();
  else if (secao === 'contato') updates.contato = coletarContato();

  // Merge with existing content
  const payload = { ...siteContent, ...updates };

  try {
    const res = await fetch(`${API_BASE}/content`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) {
      handleUnauth();
      return;
    }
    if (!res.ok) {
      const e = await res.json();
      throw new Error(e.detail || 'Erro ao salvar');
    }
    siteContent = payload;
    if (statusEl) { statusEl.textContent = 'Salvo com sucesso!'; statusEl.className = 'save-status'; }
    showToast('Salvo com sucesso!', 'ok');
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
  } catch (err) {
    if (statusEl) { statusEl.textContent = err.message; statusEl.className = 'save-status err'; }
    showToast(err.message, 'err');
  }
}

// ── Testimonials ──
function renderDepTable(deps) {
  const tbody = document.getElementById('dep-table-body');
  const countEl = document.getElementById('dep-count');
  if (countEl) countEl.textContent = `${deps.length} depoimento${deps.length !== 1 ? 's' : ''}`;
  if (!deps.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="table-empty">Nenhum depoimento cadastrado.</td></tr>';
    return;
  }
  tbody.innerHTML = deps.map((d, i) => `
    <tr>
      <td>${escAdmin(d.nome || '')}</td>
      <td>${escAdmin(d.empresa || '')}</td>
      <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escAdmin(d.texto || '')}</td>
      <td><button class="btn-delete btn-sm" onclick="excluirDepoimento(${i})">Excluir</button></td>
    </tr>
  `).join('');
}

function toggleAddTestimonial() {
  const form = document.getElementById('add-dep-form');
  if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

async function adicionarDepoimento() {
  const nome = document.getElementById('new-dep-nome').value.trim();
  const empresa = document.getElementById('new-dep-empresa').value.trim();
  const texto = document.getElementById('new-dep-texto').value.trim();
  const foto = newDepFotoData || null;

  if (!nome || !texto) {
    showToast('Nome e depoimento são obrigatórios.', 'err');
    return;
  }

  const depoimentos = [...(siteContent.depoimentos || []), { nome, empresa, texto, foto }];
  const payload = { ...siteContent, depoimentos };

  try {
    const res = await fetch(`${API_BASE}/content`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) throw new Error('Erro ao salvar');
    siteContent = payload;
    renderDepTable(depoimentos);
    document.getElementById('new-dep-nome').value = '';
    document.getElementById('new-dep-empresa').value = '';
    document.getElementById('new-dep-texto').value = '';
    const prev = document.getElementById('new-dep-foto-preview');
    if (prev) { prev.src = ''; prev.classList.remove('show'); }
    newDepFotoData = null;
    toggleAddTestimonial();
    showToast('Depoimento adicionado!', 'ok');
  } catch (err) {
    showToast(err.message, 'err');
  }
}

async function excluirDepoimento(index) {
  if (!confirm('Excluir este depoimento?')) return;
  const depoimentos = (siteContent.depoimentos || []).filter((_, i) => i !== index);
  const payload = { ...siteContent, depoimentos };

  try {
    const res = await fetch(`${API_BASE}/content`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) throw new Error('Erro ao excluir');
    siteContent = payload;
    renderDepTable(depoimentos);
    showToast('Depoimento excluído.', 'ok');
  } catch (err) {
    showToast(err.message, 'err');
  }
}

// ── Messages ──
async function carregarMensagens() {
  try {
    const res = await fetch(`${API_BASE}/mensagens`, { headers: authHeaders() });
    if (res.status === 401) return;
    if (!res.ok) return;
    const msgs = await res.json();
    renderMsgTable(msgs);
  } catch (_) { /* silently ignore */ }
}

function renderMsgTable(msgs) {
  const tbody = document.getElementById('msg-table-body');
  const countEl = document.getElementById('msg-count');
  if (countEl) countEl.textContent = `${msgs.length} mensagem${msgs.length !== 1 ? 's' : ''}`;
  if (!msgs.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Nenhuma mensagem recebida.</td></tr>';
    return;
  }
  tbody.innerHTML = msgs.map(m => `
    <tr>
      <td>${escAdmin(m.nome || '')}</td>
      <td>${escAdmin(m.empresa || '')}</td>
      <td>${escAdmin(m.telefone || '')}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escAdmin(m.mensagem || '')}</td>
      <td style="white-space:nowrap;font-size:0.78rem">${m.data || ''}</td>
      <td><button class="btn-delete btn-sm" onclick="excluirMensagem(${m.id})">Excluir</button></td>
    </tr>
  `).join('');
}

async function excluirMensagem(id) {
  if (!confirm('Excluir esta mensagem?')) return;
  try {
    const res = await fetch(`${API_BASE}/mensagens/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) throw new Error('Erro ao excluir');
    showToast('Mensagem excluída.', 'ok');
    carregarMensagens();
  } catch (err) {
    showToast(err.message, 'err');
  }
}

// ── Change password ──
async function alterarSenha() {
  const atual = document.getElementById('senha-atual').value;
  const nova = document.getElementById('senha-nova').value;
  const confirmar = document.getElementById('senha-confirmar').value;
  const statusEl = document.getElementById('save-status-senha');

  if (!atual || !nova) {
    statusEl.textContent = 'Preencha todos os campos.';
    statusEl.className = 'save-status err';
    return;
  }
  if (nova !== confirmar) {
    statusEl.textContent = 'As senhas não coincidem.';
    statusEl.className = 'save-status err';
    return;
  }
  if (nova.length < 6) {
    statusEl.textContent = 'A nova senha deve ter pelo menos 6 caracteres.';
    statusEl.className = 'save-status err';
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/senha`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ senha_atual: atual, senha_nova: nova }),
    });
    if (res.status === 401) { handleUnauth(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Erro ao alterar senha');
    statusEl.textContent = 'Senha alterada! Faça login novamente.';
    statusEl.className = 'save-status';
    // New token
    if (data.token) {
      adminToken = data.token;
      localStorage.setItem(TOKEN_KEY, adminToken);
    }
    document.getElementById('senha-atual').value = '';
    document.getElementById('senha-nova').value = '';
    document.getElementById('senha-confirmar').value = '';
    showToast('Senha alterada com sucesso!', 'ok');
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = 'save-status err';
  }
}

// ── Sidebar navigation ──
function setupSidebarNav() {
  const tabLabels = {
    marca: 'Marca',
    hero: 'Hero',
    servicos: 'Serviços',
    sobre: 'Sobre',
    depoimentos: 'Depoimentos',
    contato: 'Contato',
    mensagens: 'Mensagens',
    senha: 'Alterar Senha',
  };

  document.querySelectorAll('.sidebar-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      // Update active
      document.querySelectorAll('.sidebar-nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Show panel
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      const panel = document.getElementById(`tab-${tab}`);
      if (panel) panel.classList.add('active');
      // Update header
      const label = document.getElementById('current-tab-label');
      if (label) label.textContent = tabLabels[tab] || tab;
      // Load messages when tab is shown
      if (tab === 'mensagens') carregarMensagens();
    });
  });
}

// ── Image uploads ──
function setupImageUploads() {
  // Logo
  setupImgUpload('logo-file', 'logo-preview', 256, 256, (data) => { newLogoData = data; });
  // Sobre image
  setupImgUpload('sobre-img-file', 'sobre-img-preview', 800, 600, (data) => { newSobreImgData = data; });
  // Depoimento photo
  setupImgUpload('new-dep-foto', 'new-dep-foto-preview', 128, 128, (data) => { newDepFotoData = data; });
}

function setupImgUpload(inputId, previewId, maxW, maxH, callback) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  if (!input || !preview) return;

  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width;
        let h = img.height;
        const ratio = Math.min(maxW / w, maxH / h, 1);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const data = canvas.toDataURL('image/jpeg', 0.85);
        preview.src = data;
        preview.classList.add('show');
        callback(data);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── Toast notifications ──
function showToast(msg, type = 'ok') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'ok' ? '✓' : '✗'}</span> ${escAdmin(msg)}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(30px)';
    toast.style.transition = 'all 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ── Handle 401 ──
function handleUnauth() {
  showToast('Sessão expirada. Faça login novamente.', 'err');
  localStorage.removeItem(TOKEN_KEY);
  adminToken = '';
  document.getElementById('admin-panel').style.display = 'none';
  document.getElementById('login-page').style.display = 'flex';
}

// ── Escape HTML for admin display ──
function escAdmin(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
