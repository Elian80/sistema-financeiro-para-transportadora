/* ===================================================
   GM7 Sistemas — Landing Page Script v2
   =================================================== */

const API_BASE = '/gm7-api';

// ── Reduced motion helper ──
const reducedMotion = () => document.documentElement.classList.contains('reduced-motion');

// ── Default content ──
const DEFAULT_CONTENT = {
  marca: {
    nome: 'GM7 Sistemas',
    tagline: 'Tecnologia que move o Brasil. Soluções para transportadoras, gestão e automação.',
    logo: null,
  },
  hero: {
    title: 'Gestao inteligente para <span class="grad-text typing-target" id="hero-keyword">transportadoras</span> que crescem',
    subtitle: 'Controle financeiro, frota, motoristas e estoque em uma unica plataforma. Decisoes baseadas em dados reais, nao em achismos.',
    cta1: 'Comecar agora →',
    cta2: '📄 Ver solucoes',
    stat_clients: '50',
    stat_projects: '120',
    stat_years: '5',
    stat_clients_label: 'Clientes ativos',
    stat_projects_label: 'Projetos entregues',
    stat_years_label: 'Anos de experiencia',
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
  } catch (_) { /* use defaults */ }
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
      navLogoImg.src = marca.logo;
      navLogoImg.style.display = 'block';
    }
  }

  // Hero title (innerHTML allows span tags)
  const heroTitleEl = document.getElementById('hero-title');
  if (heroTitleEl && hero.title) {
    heroTitleEl.innerHTML = hero.title;
  }
  setText('hero-subtitle', hero.subtitle || '');

  const cta1 = document.getElementById('hero-cta1');
  if (cta1 && hero.cta1) cta1.childNodes[0].textContent = hero.cta1 + ' ';
  const cta2 = document.getElementById('hero-cta2');
  if (cta2 && hero.cta2) cta2.textContent = hero.cta2;

  // Hero stats
  setCounterTarget('stat-clients',  hero.stat_clients  || '50');
  setCounterTarget('stat-projects', hero.stat_projects || '120');
  setCounterTarget('stat-years',    hero.stat_years    || '5');
  setText('stat-clients-label',  hero.stat_clients_label  || 'Clientes ativos');
  setText('stat-projects-label', hero.stat_projects_label || 'Projetos entregues');
  setText('stat-years-label',    hero.stat_years_label    || 'Anos de experiencia');

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
  setAttr('contato-linkedin-link', 'href', li || '#');
  setAttr('footer-linkedin', 'href', li || '#');

  const addr = contato.endereco || '';
  if (addr) {
    const addrItem = document.getElementById('contato-address-item');
    if (addrItem) addrItem.style.display = 'flex';
    setText('contato-address-text', addr);
  }

  const navWaBtn = document.getElementById('nav-whatsapp-btn');
  if (navWaBtn && waLink !== '#') {
    navWaBtn.href = waLink;
    navWaBtn.target = '_blank';
    navWaBtn.rel = 'noopener';
  }

  // After applying content, restart animations and typing
  observeAnimations();
  startTypingAnimation();
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
function setAttr(id, attr, value) {
  const el = document.getElementById(id);
  if (el) el.setAttribute(attr, value);
}
function setCounterTarget(id, value) {
  const el = document.getElementById(id);
  if (el) el.dataset.target = value;
}

// ── Render services grid ──
function renderServices(servicos) {
  const grid = document.getElementById('services-grid');
  if (!grid) return;
  grid.innerHTML = servicos.map((s, i) => `
    <div class="service-card ${s.destaque ? 'destaque' : ''} animate-up stagger-${(i % 3) + 1}">
      <span class="service-icon">${s.icone || '⚙️'}</span>
      <h3>${escapeHtml(s.titulo || '')}</h3>
      <p>${escapeHtml(s.descricao || '')}</p>
      ${s.destaque ? '<span class="service-tag">⭐ Destaque</span>' : ''}
    </div>
  `).join('');
  observeAnimations();
}

// ── Render testimonials ──
function renderTestimonials(depoimentos) {
  const grid = document.getElementById('testimonials-grid');
  if (!grid) return;
  if (!depoimentos || depoimentos.length === 0) {
    grid.innerHTML = `
      <div class="testimonials-empty">
        <span class="empty-icon">💬</span>
        Depoimentos em breve.
      </div>`;
    return;
  }
  grid.innerHTML = depoimentos.map(d => `
    <div class="testimonial-card animate-up">
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
  observeAnimations();
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Typing animation ──
const TYPING_WORDS = ['transportadoras', 'gestores de frota', 'empresas logisticas', 'motoristas'];
let wordIdx = 0, charIdx = 0, isDeleting = false, typingTimer = null;

function startTypingAnimation() {
  if (reducedMotion()) return;
  const el = document.querySelector('.typing-target');
  if (!el) return;

  clearTimeout(typingTimer);
  wordIdx = 0; charIdx = 0; isDeleting = false;

  function tick() {
    const word = TYPING_WORDS[wordIdx];
    if (isDeleting) {
      charIdx--;
      el.textContent = word.substring(0, charIdx);
    } else {
      charIdx++;
      el.textContent = word.substring(0, charIdx);
    }

    let delay = isDeleting ? 55 : 95;

    if (!isDeleting && charIdx === word.length) {
      delay = 2400;
      isDeleting = true;
    } else if (isDeleting && charIdx === 0) {
      isDeleting = false;
      wordIdx = (wordIdx + 1) % TYPING_WORDS.length;
      delay = 350;
    }

    typingTimer = setTimeout(tick, delay);
  }

  // Small initial delay so page settles
  typingTimer = setTimeout(tick, 800);
}

// ── FAQ accordion ──
function initFAQ() {
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const isOpen = item.classList.contains('open');
      // Close all open items
      document.querySelectorAll('.faq-item.open').forEach(openItem => {
        openItem.classList.remove('open');
        openItem.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
      });
      // Toggle clicked
      if (!isOpen) {
        item.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });
}

// ── IntersectionObserver for scroll animations ──
const animObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      animObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

function observeAnimations() {
  document.querySelectorAll('.animate-up:not(.visible), .fade-in:not(.visible)').forEach(el => {
    animObserver.observe(el);
  });
}

// ── Counter animation ──
let countersAnimated = false;

function animateCounters() {
  if (countersAnimated) return;
  countersAnimated = true;

  document.querySelectorAll('.counter').forEach(el => {
    const target = parseInt(el.dataset.target || '0', 10);
    if (reducedMotion()) { el.textContent = target; return; }
    const duration = 1800;
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

// Trigger counters when hero or stats-banner enters view
const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      animateCounters();
      counterObserver.disconnect();
    }
  });
}, { threshold: 0.2 });

const heroSection = document.getElementById('hero');
const statsBanner = document.querySelector('.stats-banner');
if (heroSection) counterObserver.observe(heroSection);
if (statsBanner) counterObserver.observe(statsBanner);

// ── Navbar scroll effect ──
const navbar = document.getElementById('navbar');
if (navbar) {
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 20);
  }, { passive: true });
}

// ── Hamburger menu ──
const hamburgerBtn = document.getElementById('hamburger-btn');
const mobileMenu   = document.getElementById('mobile-menu');
if (hamburgerBtn && mobileMenu) {
  hamburgerBtn.addEventListener('click', () => {
    const isOpen = hamburgerBtn.classList.toggle('open');
    mobileMenu.classList.toggle('open', isOpen);
    hamburgerBtn.setAttribute('aria-expanded', String(isOpen));
    mobileMenu.setAttribute('aria-hidden', String(!isOpen));
  });
  document.querySelectorAll('.mobile-nav-close').forEach(el => {
    el.addEventListener('click', () => {
      hamburgerBtn.classList.remove('open');
      mobileMenu.classList.remove('open');
      hamburgerBtn.setAttribute('aria-expanded', 'false');
      mobileMenu.setAttribute('aria-hidden', 'true');
    });
  });
}

// ── Smooth scroll for hash links ──
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const href = a.getAttribute('href');
    if (href === '#') return;
    const target = document.querySelector(href);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Close mobile menu
      if (hamburgerBtn && mobileMenu) {
        hamburgerBtn.classList.remove('open');
        mobileMenu.classList.remove('open');
        hamburgerBtn.setAttribute('aria-expanded', 'false');
        mobileMenu.setAttribute('aria-hidden', 'true');
      }
    }
  });
});

// ── Contact form ──
const contatoForm = document.getElementById('contato-form');
const formMsg     = document.getElementById('form-msg');

if (contatoForm) {
  contatoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome     = document.getElementById('cf-nome').value.trim();
    const empresa  = document.getElementById('cf-empresa').value.trim();
    const telefone = document.getElementById('cf-telefone').value.trim();
    const mensagem = document.getElementById('cf-mensagem').value.trim();

    if (!nome || !mensagem) {
      showFormMsg('Por favor, preencha nome e mensagem.', false);
      return;
    }

    try {
      await fetch(`${API_BASE}/contato`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, empresa, telefone, mensagem }),
      });
    } catch (_) { /* silently ignore */ }

    showFormMsg('Mensagem enviada! Abrindo WhatsApp...', true);

    const wa = (siteContent.contato || {}).whatsapp || '';
    if (wa) {
      const waNum  = wa.replace(/\D/g, '');
      const waText = encodeURIComponent(`Olá! Sou ${nome}${empresa ? ` da ${empresa}` : ''}. ${mensagem}`);
      window.open(`https://wa.me/${waNum}?text=${waText}`, '_blank', 'noopener');
    }

    contatoForm.reset();
    setTimeout(() => { if (formMsg) formMsg.textContent = ''; }, 5000);
  });
}

function showFormMsg(msg, ok) {
  if (!formMsg) return;
  formMsg.textContent = msg;
  formMsg.className = 'form-msg ' + (ok ? 'ok' : 'err');
}

// ── Footer year ──
const footerYear = document.getElementById('footer-year');
if (footerYear) footerYear.textContent = new Date().getFullYear();

// ── Boot ──
initFAQ();
observeAnimations();
carregarConteudo();
