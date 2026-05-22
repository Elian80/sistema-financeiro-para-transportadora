/* ===================================================
   GM7 Sistemas — Landing Page Script
   =================================================== */

const API_BASE = '/gm7-api';

// ── Default content (fallback when API unavailable) ──
const DEFAULT_CONTENT = {
  marca: {
    nome: 'GM7 Sistemas',
    tagline: 'Tecnologia que move o Brasil. Soluções para transportadoras, gestão e automação.',
    logo: null,
  },
  hero: {
    title: 'Gestão inteligente para <span class="grad-text" id="hero-keyword">transportadoras</span> que crescem',
    subtitle: 'Automatize processos, controle suas finanças e tome decisões baseadas em dados reais com a plataforma completa da GM7 Sistemas.',
    cta1: 'Começar agora →',
    cta2: '📄 Ver serviços',
    stat_clients: '50',
    stat_projects: '120',
    stat_years: '5',
    stat_clients_label: 'Clientes ativos',
    stat_projects_label: 'Projetos entregues',
    stat_years_label: 'Anos de experiência',
  },
  servicos: [
    {
      icone: '🚛',
      titulo: 'Gestão para Transportadoras',
      descricao: 'Sistema completo de gestão financeira, controle de frota, motoristas, folha de pagamento e relatórios para transportadoras de todos os portes.',
      destaque: true,
    },
    {
      icone: '⚡',
      titulo: 'Automação Multitarefas',
      descricao: 'Automatize rotinas operacionais, integrações entre sistemas, geração de relatórios e notificações para sua equipe.',
      destaque: false,
    },
    {
      icone: '💻',
      titulo: 'Desenvolvimento Personalizado',
      descricao: 'Criamos soluções sob medida para os desafios únicos do seu negócio — desde apps mobile até sistemas web completos.',
      destaque: false,
    },
  ],
  sobre: {
    title: 'Tecnologia com <span class="grad-text">propósito</span>',
    subtitle: 'Nascemos para resolver um problema real.',
    texto: 'A GM7 Sistemas nasceu da necessidade real de transportadoras que precisavam de um sistema robusto, simples e acessível. Com anos de experiência no setor, desenvolvemos soluções que vão além do software — entregamos eficiência operacional, controle financeiro e tranquilidade para gestores e proprietários.',
    imagem: null,
  },
  depoimentos: [],
  contato: {
    whatsapp: '',
    email: 'contato@gm7sistemas.com.br',
    instagram: '',
    linkedin: '',
    endereco: '',
  },
};

let siteContent = DEFAULT_CONTENT;

// ── Fetch content from API ──
async function carregarConteudo() {
  try {
    const res = await fetch(`${API_BASE}/content`);
    if (res.ok) {
      const data = await res.json();
      siteContent = deepMerge(DEFAULT_CONTENT, data);
    }
  } catch (e) {
    // silently use defaults
  }
  aplicarConteudo();
}

function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override || {})) {
    if (override[key] !== null && typeof override[key] === 'object' && !Array.isArray(override[key])) {
      result[key] = deepMerge(base[key] || {}, override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

// ── Apply content to DOM ──
function aplicarConteudo() {
  const c = siteContent;
  const marca = c.marca || {};
  const hero = c.hero || {};
  const sobre = c.sobre || {};
  const contato = c.contato || {};

  // Marca
  const companyName = marca.nome || 'GM7 Sistemas';
  setText('nav-company-name', companyName);
  setText('footer-company-name', companyName);
  setText('footer-copy-name', companyName);
  setText('footer-tagline', marca.tagline || '');

  // Logo
  if (marca.logo) {
    const navLogoImg = document.getElementById('nav-logo-img');
    if (navLogoImg) {
      navLogoImg.outerHTML = `<img id="nav-logo-img" src="${marca.logo}" alt="${companyName}" style="width:36px;height:36px;border-radius:8px;object-fit:contain;" />`;
    }
    const footerLogo = document.getElementById('footer-logo');
    if (footerLogo) {
      footerLogo.outerHTML = `<img id="footer-logo" src="${marca.logo}" alt="${companyName}" style="width:28px;height:28px;border-radius:6px;object-fit:contain;" />`;
    }
  }

  // Hero title — set innerHTML to allow span tags
  const heroTitleEl = document.getElementById('hero-title');
  if (heroTitleEl && hero.title) {
    heroTitleEl.innerHTML = hero.title;
  }
  setText('hero-subtitle', hero.subtitle || '');

  const cta1 = document.getElementById('hero-cta1');
  if (cta1 && hero.cta1) cta1.textContent = hero.cta1;
  const cta2 = document.getElementById('hero-cta2');
  if (cta2 && hero.cta2) cta2.textContent = hero.cta2;

  // Stats
  const statClients = document.getElementById('stat-clients');
  if (statClients) statClients.dataset.target = hero.stat_clients || '50';
  const statProjects = document.getElementById('stat-projects');
  if (statProjects) statProjects.dataset.target = hero.stat_projects || '120';
  const statYears = document.getElementById('stat-years');
  if (statYears) statYears.dataset.target = hero.stat_years || '5';
  setText('stat-clients-label', hero.stat_clients_label || 'Clientes ativos');
  setText('stat-projects-label', hero.stat_projects_label || 'Projetos entregues');
  setText('stat-years-label', hero.stat_years_label || 'Anos de experiência');

  // Services
  renderServices(c.servicos || DEFAULT_CONTENT.servicos);

  // Sobre
  const sobreTitleEl = document.getElementById('sobre-title');
  if (sobreTitleEl && sobre.title) sobreTitleEl.innerHTML = sobre.title;
  setText('sobre-subtitle', sobre.subtitle || '');
  setText('sobre-text', sobre.texto || '');

  if (sobre.imagem) {
    const imgContainer = document.getElementById('sobre-img-container');
    if (imgContainer) {
      imgContainer.innerHTML = `<img src="${sobre.imagem}" alt="Sobre a GM7" style="width:100%;height:100%;object-fit:cover;" />`;
    }
  }

  // Testimonials
  renderTestimonials(c.depoimentos || []);

  // Contato
  const wa = contato.whatsapp || '';
  const waLink = wa ? `https://wa.me/${wa.replace(/\D/g, '')}` : '#';
  setAttr('contato-whatsapp-link', 'href', waLink);
  setAttr('footer-whatsapp', 'href', waLink);
  setText('contato-whatsapp-link', wa ? `WhatsApp: ${wa}` : 'Clique para conversar');

  const email = contato.email || '';
  setAttr('contato-email-link', 'href', email ? `mailto:${email}` : '#');
  setText('contato-email-link', email || 'contato@gm7sistemas.com.br');

  const ig = contato.instagram || '';
  const igLink = ig ? `https://instagram.com/${ig.replace('@', '')}` : '#';
  setAttr('contato-instagram-link', 'href', igLink);
  setAttr('footer-instagram', 'href', igLink);
  setText('contato-instagram-link', ig || '@gm7sistemas');

  const li = contato.linkedin || '';
  const liLink = li ? li : '#';
  setAttr('contato-linkedin-link', 'href', liLink);
  setAttr('footer-linkedin', 'href', liLink);

  const addr = contato.endereco || '';
  if (addr) {
    const addrItem = document.getElementById('contato-address-item');
    if (addrItem) addrItem.style.display = 'flex';
    setText('contato-address-text', addr);
  }

  // WhatsApp CTA for "Falar conosco" nav button
  const navWaBtn = document.getElementById('nav-whatsapp-btn');
  if (navWaBtn && waLink !== '#') {
    navWaBtn.href = waLink;
    navWaBtn.target = '_blank';
    navWaBtn.rel = 'noopener';
  }
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setAttr(id, attr, value) {
  const el = document.getElementById(id);
  if (el) el.setAttribute(attr, value);
}

function renderServices(servicos) {
  const grid = document.getElementById('services-grid');
  if (!grid) return;
  grid.innerHTML = servicos.map((s, i) => `
    <div class="service-card ${s.destaque ? 'destaque' : ''} fade-in fade-in-delay-${i}">
      <span class="service-icon">${s.icone || '⚙️'}</span>
      <h3>${escapeHtml(s.titulo || '')}</h3>
      <p>${escapeHtml(s.descricao || '')}</p>
      ${s.destaque ? '<span class="service-tag">⭐ Destaque</span>' : ''}
    </div>
  `).join('');
  // Re-observe new elements
  observeFadeIns();
}

function renderTestimonials(depoimentos) {
  const grid = document.getElementById('testimonials-grid');
  if (!grid) return;
  if (!depoimentos || depoimentos.length === 0) {
    grid.innerHTML = `
      <div class="testimonials-empty">
        <span class="empty-icon">💬</span>
        Nenhum depoimento cadastrado ainda.
      </div>`;
    return;
  }
  grid.innerHTML = depoimentos.map(d => `
    <div class="testimonial-card fade-in">
      <div class="testimonial-quote">"</div>
      <p class="testimonial-text">${escapeHtml(d.texto || '')}</p>
      <div class="testimonial-author">
        <div class="testimonial-photo">
          ${d.foto ? `<img src="${d.foto}" alt="${escapeHtml(d.nome || '')}" />` : '👤'}
        </div>
        <div>
          <div class="testimonial-name">${escapeHtml(d.nome || '')}</div>
          <div class="testimonial-company">${escapeHtml(d.empresa || '')}</div>
        </div>
      </div>
    </div>
  `).join('');
  observeFadeIns();
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Navbar scroll effect ──
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  if (window.scrollY > 20) {
    navbar.classList.add('scrolled');
  } else {
    navbar.classList.remove('scrolled');
  }
}, { passive: true });

// ── Hamburger menu ──
const hamburgerBtn = document.getElementById('hamburger-btn');
const mobileMenu = document.getElementById('mobile-menu');
hamburgerBtn.addEventListener('click', () => {
  hamburgerBtn.classList.toggle('open');
  mobileMenu.classList.toggle('open');
});
document.querySelectorAll('.mobile-nav-close').forEach(el => {
  el.addEventListener('click', () => {
    hamburgerBtn.classList.remove('open');
    mobileMenu.classList.remove('open');
  });
});

// ── Smooth scroll for hash links ──
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// ── Counter animation ──
function animateCounters() {
  document.querySelectorAll('.counter').forEach(el => {
    const target = parseInt(el.dataset.target || '0', 10);
    const duration = 1500;
    const start = performance.now();
    function step(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.floor(eased * target);
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = target;
    }
    requestAnimationFrame(step);
  });
}

// ── IntersectionObserver for fade-in and counters ──
let countersAnimated = false;
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

const heroSection = document.getElementById('hero');
const heroObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting && !countersAnimated) {
      countersAnimated = true;
      animateCounters();
    }
  });
}, { threshold: 0.3 });
if (heroSection) heroObserver.observe(heroSection);

function observeFadeIns() {
  document.querySelectorAll('.fade-in:not(.visible)').forEach(el => observer.observe(el));
}
observeFadeIns();

// ── Contact form ──
const contatoForm = document.getElementById('contato-form');
const formMsg = document.getElementById('form-msg');

contatoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = document.getElementById('cf-nome').value.trim();
  const empresa = document.getElementById('cf-empresa').value.trim();
  const telefone = document.getElementById('cf-telefone').value.trim();
  const mensagem = document.getElementById('cf-mensagem').value.trim();

  if (!nome || !mensagem) {
    showFormMsg('Por favor, preencha nome e mensagem.', false);
    return;
  }

  // Save to API
  try {
    await fetch(`${API_BASE}/contato`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, empresa, telefone, mensagem }),
    });
  } catch (_) { /* silently ignore */ }

  showFormMsg('Mensagem enviada! Abrindo WhatsApp...', true);

  // Open WhatsApp
  const wa = (siteContent.contato || {}).whatsapp || '';
  if (wa) {
    const waNum = wa.replace(/\D/g, '');
    const waText = encodeURIComponent(`Olá! Sou ${nome}${empresa ? ` da ${empresa}` : ''}. ${mensagem}`);
    window.open(`https://wa.me/${waNum}?text=${waText}`, '_blank', 'noopener');
  }

  contatoForm.reset();
  setTimeout(() => { formMsg.textContent = ''; }, 5000);
});

function showFormMsg(msg, ok) {
  formMsg.textContent = msg;
  formMsg.className = 'form-msg ' + (ok ? 'ok' : 'err');
}

// ── Footer year ──
const footerYear = document.getElementById('footer-year');
if (footerYear) footerYear.textContent = new Date().getFullYear();

// ── Boot ──
carregarConteudo();
