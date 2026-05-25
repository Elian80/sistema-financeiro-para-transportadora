/* ===================================================
   GM7 Sistemas — Landing Page v3
   GSAP + ScrollTrigger + Canvas particles
   =================================================== */

const API_BASE = '/gm7-api';
const rm = () => document.documentElement.classList.contains('rm');

// ── Default content ──
const DEFAULT_CONTENT = {
  marca: {
    nome: 'GM7 Sistemas',
    tagline: 'Software sob medida, automação e sistemas de gestão para empresas que querem crescer.',
    logo: null,
  },
  hero: {
    stat_clients:        '50',
    stat_projects:       '120',
    stat_years:          '5',
    stat_clients_label:  'Clientes ativos',
    stat_projects_label: 'Projetos entregues',
    stat_years_label:    'Anos de mercado',
  },
  servicos: [], // empty = use static HTML cards
  sobre: {
    title:   'Tecnologia com <span class="grad-text">propósito</span>',
    subtitle: 'Nascemos para resolver problemas reais.',
    texto: 'A GM7 Sistemas nasceu da necessidade real de transportadoras que precisavam de um sistema robusto, simples e acessível. Hoje somos um estúdio de desenvolvimento que atende empresas de múltiplos segmentos — entregando eficiência operacional, controle financeiro e automação que funcionam de verdade no dia a dia.',
    imagem: null,
  },
  depoimentos: [],
  contato: {
    whatsapp: '',
    email:    'contato@gm7sistemas.com.br',
    instagram:'',
    linkedin: '',
    endereco: '',
  },
};

let siteContent = DEFAULT_CONTENT;

// ── Fetch & apply content ──
async function carregarConteudo() {
  try {
    const res = await fetch(`${API_BASE}/content`);
    if (res.ok) siteContent = deepMerge(DEFAULT_CONTENT, await res.json());
  } catch (_) {}
  aplicarConteudo();
}

function deepMerge(base, override) {
  const r = { ...base };
  for (const k of Object.keys(override || {})) {
    if (override[k] !== null && typeof override[k] === 'object' && !Array.isArray(override[k]))
      r[k] = deepMerge(base[k] || {}, override[k]);
    else r[k] = override[k];
  }
  return r;
}

function aplicarConteudo() {
  const { marca, hero, sobre, contato, depoimentos, servicos } = siteContent;

  // Marca
  const nome = marca.nome || 'GM7 Sistemas';
  setText('nav-company-name',   nome);
  setText('footer-company-name', nome);
  setText('footer-copy-name',    nome);
  setText('sobre-company-name',  nome);
  setText('footer-tagline', marca.tagline || '');

  if (marca.logo) {
    const img = document.getElementById('nav-logo-img');
    if (img) { img.src = marca.logo; img.style.display = 'block'; }
  }

  // Hero stats
  setTarget('stat-clients-label',  hero.stat_clients_label  || 'Clientes ativos');
  setTarget('stat-projects-label', hero.stat_projects_label || 'Projetos entregues');
  setTarget('stat-years-label',    hero.stat_years_label    || 'Anos de mercado');
  setCounterTarget('[data-target="50"]',  hero.stat_clients  || '50');
  setCounterTarget('[data-target="120"]', hero.stat_projects || '120');
  setCounterTarget('[data-target="5"]',   hero.stat_years    || '5');

  // Sobre
  const sobreTitle = document.getElementById('sobre-title');
  if (sobreTitle && sobre.title) sobreTitle.innerHTML = sobre.title;
  setText('sobre-sub', sobre.subtitle || '');
  setText('sobre-text', sobre.texto  || '');
  if (sobre.imagem) {
    const img = document.getElementById('sobre-img-container');
    if (img) img.innerHTML = `<img src="${sobre.imagem}" alt="Sobre" style="width:100%;object-fit:cover" />`;
  }

  // Contato
  const wa = contato.whatsapp || '';
  const waLink = wa ? `https://wa.me/${wa.replace(/\D/g,'')}` : '#';
  setHref('contato-whatsapp-link', waLink);
  setHref('footer-whatsapp',       waLink);
  setText('contato-whatsapp-link', wa ? `WhatsApp: ${wa}` : 'Clique para conversar');
  const email = contato.email || '';
  setHref('contato-email-link', email ? `mailto:${email}` : '#');
  setText('contato-email-link', email || 'contato@gm7sistemas.com.br');
  const ig = contato.instagram || '';
  const igLink = ig ? `https://instagram.com/${ig.replace('@','')}` : '#';
  setHref('contato-instagram-link', igLink); setHref('footer-instagram', igLink);
  setText('contato-instagram-link', ig || '@gm7sistemas');
  const li = contato.linkedin || '';
  setHref('contato-linkedin-link', li || '#'); setHref('footer-linkedin', li || '#');
  if (contato.endereco) {
    const el = document.getElementById('contato-address-item');
    if (el) el.style.display = 'flex';
    setText('contato-address-text', contato.endereco);
  }
  const navWa = document.getElementById('nav-whatsapp-btn');
  if (navWa && waLink !== '#') { navWa.href = waLink; navWa.target = '_blank'; navWa.rel = 'noopener'; }

  // Services — only render if API returned custom ones
  if (servicos && servicos.length > 0) renderServices(servicos);

  // Testimonials
  renderTestimonials(depoimentos || []);
}

function setText(id, val)  { const e=document.getElementById(id); if(e) e.textContent=val; }
function setHref(id, val)  { const e=document.getElementById(id); if(e) e.href=val; }
function setTarget(id,val) { const e=document.getElementById(id); if(e) e.textContent=val; }
function setCounterTarget(sel, val) {
  document.querySelectorAll(sel).forEach(e => { e.dataset.target = val; });
}

function renderServices(servicos) {
  const grid = document.getElementById('services-grid');
  if (!grid) return;
  grid.innerHTML = servicos.map((s,i) => `
    <div class="sol-card ${s.destaque?'sol-card--featured':''}" data-reveal data-delay="${i*0.08}">
      <span class="sol-icon">${s.icone||'⚙️'}</span>
      <h3>${esc(s.titulo||'')}</h3>
      <p>${esc(s.descricao||'')}</p>
      ${s.tag ? `<span class="sol-tag">${esc(s.tag)}</span>` : ''}
    </div>`).join('');
  setupScrollReveal();
}

function renderTestimonials(deps) {
  const grid = document.getElementById('testimonials-grid');
  if (!grid) return;
  if (!deps.length) {
    grid.innerHTML = `<div class="dep-empty"><span>💬</span>Depoimentos em breve.</div>`;
    return;
  }
  grid.innerHTML = deps.map(d => `
    <div class="dep-card" data-reveal>
      <div class="dep-quote">"</div>
      <p class="dep-text">${esc(d.texto||'')}</p>
      <div class="dep-author">
        <div class="dep-photo">${d.foto ? `<img src="${d.foto}" alt="">` : '👤'}</div>
        <div><div class="dep-name">${esc(d.nome||'')}</div><div class="dep-company">${esc(d.empresa||'')}</div></div>
      </div>
    </div>`).join('');
  setupScrollReveal();
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ══════════════════════════════════════════
// CANVAS PARTICLES
// ══════════════════════════════════════════
function initCanvas() {
  const canvas = document.getElementById('gm7-canvas');
  if (!canvas || rm()) return;
  const ctx = canvas.getContext('2d');
  let W, H, pts = [];

  const resize = () => {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  };
  resize();
  window.addEventListener('resize', resize, { passive: true });

  const COLORS = ['rgba(34,211,238,', 'rgba(99,102,241,', 'rgba(52,211,153,'];
  const N = Math.min(70, Math.floor(window.innerWidth / 18));

  for (let i = 0; i < N; i++) {
    pts.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: Math.random() * 1.8 + 0.4,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      a: Math.random() * 0.5 + 0.15,
      c: COLORS[Math.floor(Math.random() * COLORS.length)],
    });
  }

  let raf;
  function draw() {
    ctx.clearRect(0, 0, W, H);
    // Draw connecting lines
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < 130) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(99,102,241,${0.12 * (1 - dist/130)})`;
          ctx.lineWidth = 0.6;
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.stroke();
        }
      }
    }
    // Draw dots
    pts.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < -10) p.x = W + 10;
      if (p.x > W + 10) p.x = -10;
      if (p.y < -10) p.y = H + 10;
      if (p.y > H + 10) p.y = -10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `${p.c}${p.a})`;
      ctx.fill();
    });
    raf = requestAnimationFrame(draw);
  }
  draw();
  // Pause when tab hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else draw();
  });
}

// ══════════════════════════════════════════
// GSAP HERO ANIMATION
// ══════════════════════════════════════════
function initHeroAnim() {
  if (rm() || typeof gsap === 'undefined') {
    // fallback: show everything immediately
    document.querySelectorAll('[data-hero]').forEach(el => { el.style.opacity = '1'; el.style.transform = 'none'; });
    document.querySelectorAll('.clip-wrap > span').forEach(el => { el.style.transform = 'none'; });
    return;
  }

  // Definir estado inicial ANTES da timeline (ordem correta)
  gsap.set('.hero-eyebrow', { opacity: 0, y: 16 });
  gsap.set('.hero-sub',     { opacity: 0, y: 20 });
  gsap.set('.hero-ctas',    { opacity: 0, y: 20 });
  gsap.set('.hero-stats',   { opacity: 0, y: 20 });
  gsap.set('.hero-visual',  { opacity: 0, x: 40 });
  gsap.set('.clip-wrap > span', { yPercent: 110 });

  // Animar DO estado inicial (já definido acima) PARA o estado final
  gsap.timeline({ defaults: { ease: 'power4.out' } })
    .to('.clip-wrap > span', { yPercent: 0, stagger: 0.12, duration: 1 }, 0)
    .to('.hero-eyebrow', { opacity: 1, y: 0, duration: 0.6 }, 0.1)
    .to('.hero-sub',     { opacity: 1, y: 0, duration: 0.7 }, 0.5)
    .to('.hero-ctas',    { opacity: 1, y: 0, duration: 0.6 }, 0.65)
    .to('.hero-stats',   { opacity: 1, y: 0, duration: 0.6 }, 0.8)
    .to('.hero-visual',  { opacity: 1, x: 0, duration: 0.9, ease: 'power3.out' }, 0.4);
}

// ══════════════════════════════════════════
// GSAP SCROLL REVEAL
// ══════════════════════════════════════════
function setupScrollReveal() {
  if (rm() || typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') {
    document.querySelectorAll('[data-reveal]').forEach(el => {
      el.style.opacity = '1'; el.style.transform = 'none';
    });
    return;
  }

  document.querySelectorAll('[data-reveal]:not(.revealed)').forEach(el => {
    el.classList.add('revealed');
    const delay = parseFloat(el.dataset.delay || '0');

    // Usar gsap.to() (não from) porque o CSS já define opacity:0 / translateY
    // gsap.from() captura o estado atual (0) e anima 0→0 = invisível para sempre
    gsap.to(el, {
      scrollTrigger: {
        trigger: el,
        start:   'top 88%',
        once:    true,
      },
      opacity: 1, y: 0, delay,
      duration: 0.85,
      ease: 'power3.out',
    });
  });
}

// ══════════════════════════════════════════
// COUNTER ANIMATION
// ══════════════════════════════════════════
let countersDone = false;
function animateCounters() {
  if (countersDone) return;
  countersDone = true;
  document.querySelectorAll('.counter').forEach(el => {
    const target = parseInt(el.dataset.target || '0', 10);
    if (rm()) { el.textContent = target; return; }
    const dur = 1800, start = performance.now();
    (function step(now) {
      const p = Math.min((now - start) / dur, 1);
      el.textContent = Math.floor((1 - Math.pow(1-p, 3)) * target);
      if (p < 1) requestAnimationFrame(step); else el.textContent = target;
    })(start);
  });
}

// Trigger counters on hero or stats-bar
function watchCounters() {
  if (typeof IntersectionObserver === 'undefined') { animateCounters(); return; }
  const io = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) { animateCounters(); io.disconnect(); }
  }, { threshold: 0.2 });
  ['hero', 'stats-bar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) io.observe(el);
  });
}

// ══════════════════════════════════════════
// NAVBAR
// ══════════════════════════════════════════
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  if (nav) nav.classList.toggle('scrolled', window.scrollY > 24);
}, { passive: true });

// ══════════════════════════════════════════
// HAMBURGER
// ══════════════════════════════════════════
const hbtn = document.getElementById('hamburger');
const mmenu = document.getElementById('mobile-menu');
if (hbtn && mmenu) {
  hbtn.addEventListener('click', () => {
    const open = hbtn.classList.toggle('open');
    mmenu.classList.toggle('open', open);
    hbtn.setAttribute('aria-expanded', String(open));
    mmenu.setAttribute('aria-hidden', String(!open));
  });
  mmenu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    hbtn.classList.remove('open'); mmenu.classList.remove('open');
    hbtn.setAttribute('aria-expanded','false'); mmenu.setAttribute('aria-hidden','true');
  }));
}

// ══════════════════════════════════════════
// SMOOTH SCROLL
// ══════════════════════════════════════════
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const href = a.getAttribute('href');
    if (href === '#') return;
    const target = document.querySelector(href);
    if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
});

// ══════════════════════════════════════════
// FAQ ACCORDION
// ══════════════════════════════════════════
document.querySelectorAll('.faq-q').forEach(btn => {
  btn.addEventListener('click', () => {
    const item = btn.closest('.faq-item');
    const open = item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(el => {
      el.classList.remove('open');
      el.querySelector('.faq-q').setAttribute('aria-expanded','false');
    });
    if (!open) { item.classList.add('open'); btn.setAttribute('aria-expanded','true'); }
  });
});

// ══════════════════════════════════════════
// CONTACT FORM
// ══════════════════════════════════════════
const form    = document.getElementById('contato-form');
const formMsg = document.getElementById('form-msg');
if (form) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const nome     = document.getElementById('cf-nome').value.trim();
    const empresa  = document.getElementById('cf-empresa').value.trim();
    const telefone = document.getElementById('cf-telefone').value.trim();
    const mensagem = document.getElementById('cf-mensagem').value.trim();
    if (!nome || !mensagem) { showMsg('Preencha nome e mensagem.', false); return; }
    try {
      await fetch(`${API_BASE}/contato`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({nome, empresa, telefone, mensagem}),
      });
    } catch (_) {}
    showMsg('Enviado! Abrindo WhatsApp...', true);
    const wa = (siteContent.contato||{}).whatsapp||'';
    if (wa) {
      const t = encodeURIComponent(`Olá! Sou ${nome}${empresa?` da ${empresa}`:''}.  ${mensagem}`);
      window.open(`https://wa.me/${wa.replace(/\D/g,'')}?text=${t}`, '_blank', 'noopener');
    }
    form.reset();
    setTimeout(() => { if (formMsg) formMsg.textContent=''; }, 5000);
  });
}
function showMsg(msg, ok) {
  if (!formMsg) return;
  formMsg.textContent = msg;
  formMsg.className = 'cf-msg ' + (ok ? 'ok' : 'err');
}

// ══════════════════════════════════════════
// FOOTER YEAR
// ══════════════════════════════════════════
const fy = document.getElementById('footer-year');
if (fy) fy.textContent = new Date().getFullYear();

// ══════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initCanvas();

  if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);
    initHeroAnim();
    setupScrollReveal();
  } else {
    // GSAP failed to load — show everything
    document.querySelectorAll('[data-reveal]').forEach(el => { el.style.opacity='1'; el.style.transform='none'; });
    ['hero-eyebrow','hero-sub','hero-ctas','hero-stats','hero-visual'].forEach(cl => {
      const e = document.querySelector('.'+cl); if(e){e.style.opacity='1';e.style.transform='none';}
    });
  }

  watchCounters();
  carregarConteudo();
});
