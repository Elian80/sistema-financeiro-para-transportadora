/* =====================================================
   bg.js — Fundo animado com partículas (canvas)
   Usado no app financeiro principal (index.html)
   Respeita prefers-reduced-motion.
   ===================================================== */
(function () {
  'use strict';

  // Não roda se usuário prefere sem movimento
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.getElementById('app-bg-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let W, H, pts = [], raf, active = true;

  /* ── Dimensiona o canvas ao tamanho da janela ── */
  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize, { passive: true });

  /* ── Cores das partículas — combinam com o tema escuro do app ── */
  const COLORS = [
    'rgba(56,189,248,',   // --blue (ciano)
    'rgba(99,102,241,',   // indigo
    'rgba(34,197,94,',    // --green
    'rgba(59,130,246,',   // --blue-2
  ];

  /* ── Cria partículas ── */
  const N = Math.min(60, Math.floor(window.innerWidth / 22));
  for (let i = 0; i < N; i++) {
    pts.push({
      x:  Math.random() * window.innerWidth,
      y:  Math.random() * window.innerHeight,
      r:  Math.random() * 1.6 + 0.4,
      vx: (Math.random() - 0.5) * 0.28,
      vy: (Math.random() - 0.5) * 0.28,
      a:  Math.random() * 0.45 + 0.12,
      c:  COLORS[Math.floor(Math.random() * COLORS.length)],
    });
  }

  /* ── Loop de animação ── */
  function draw() {
    if (!active) return;
    ctx.clearRect(0, 0, W, H);

    // Linhas conectoras entre partículas próximas
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x;
        const dy = pts[i].y - pts[j].y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < 120) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(56,189,248,${0.1 * (1 - d / 120)})`;
          ctx.lineWidth = 0.5;
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.stroke();
        }
      }
    }

    // Pontos
    pts.forEach(p => {
      // Move
      p.x += p.vx;
      p.y += p.vy;
      // Wrap
      if (p.x < -8)  p.x = W + 8;
      if (p.x > W+8) p.x = -8;
      if (p.y < -8)  p.y = H + 8;
      if (p.y > H+8) p.y = -8;
      // Desenha
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `${p.c}${p.a})`;
      ctx.fill();
    });

    raf = requestAnimationFrame(draw);
  }

  // Pausa quando aba está em segundo plano
  document.addEventListener('visibilitychange', () => {
    active = !document.hidden;
    if (active) draw();
    else cancelAnimationFrame(raf);
  });

  // Para no tema claro (não fica bonito em fundo branco)
  function checkTheme() {
    const light = document.body.dataset.theme === 'light';
    canvas.style.opacity = light ? '0.06' : '0.45';
  }

  // Observa mudança de tema
  const themeObserver = new MutationObserver(checkTheme);
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
  checkTheme();

  draw();
})();
