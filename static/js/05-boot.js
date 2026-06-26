/* ==========================================================================
   05-boot.js — Boot screen animation
   ========================================================================== */
const BOOT_MESSAGES = [
  'Initializing AI systems…',
  'Loading ML pipeline…',
  'Calibrating forecasting engine…',
  'Preparing workforce models…',
  'Building cost optimizer…',
  'Ready!',
];

const BOOT_STEP_DELAYS = [0, 320, 620, 960, 1280, 1820];

function runBootAnimation() {
  return new Promise((resolve) => {
    const canvas  = document.getElementById('boot-canvas');
    const ctx     = canvas.getContext('2d');
    const barFill = document.getElementById('boot-bar');
    const msgEl   = document.getElementById('boot-msg');

    function resize() {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const PARTICLE_COUNT = 70;
    const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
      x:  Math.random() * canvas.width,
      y:  Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.55,
      vy: (Math.random() - 0.5) * 0.55,
      r:  Math.random() * 1.6 + 0.5,
      a:  Math.random() * 0.55 + 0.15,
    }));

    const waves = [
      { amp: 38, freq: 0.012, phase: 0,           speed: 0.018, color: 'rgba(0, 212, 170, 0.18)', width: 1.8 },
      { amp: 24, freq: 0.018, phase: Math.PI*0.6, speed: 0.024, color: 'rgba(77, 142, 240, 0.14)', width: 1.4 },
      { amp: 16, freq: 0.026, phase: Math.PI*1.2, speed: 0.032, color: 'rgba(0, 212, 170, 0.09)',  width: 1.0 },
    ];

    let globalAlpha = 0;
    const startTime = performance.now();

    BOOT_STEP_DELAYS.forEach((delay, i) => {
      setTimeout(() => {
        const pct = Math.round(((i + 1) / BOOT_MESSAGES.length) * 100);
        msgEl.classList.add('fade');
        setTimeout(() => {
          msgEl.textContent = BOOT_MESSAGES[i];
          barFill.style.width = `${pct}%`;
          msgEl.classList.remove('fade');
        }, 200);
      }, delay);
    });

    function frame(now) {
      const elapsed = now - startTime;
      globalAlpha   = Math.min(elapsed / 500, 1);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const cy = canvas.height / 2;
      waves.forEach((w) => {
        w.phase += w.speed;
        ctx.beginPath();
        for (let x = 0; x <= canvas.width; x += 2) {
          const y = cy + Math.sin(x * w.freq + w.phase) * w.amp;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = w.color.replace('0.', `${(globalAlpha * parseFloat(w.color.match(/[\d.]+\)$/)[0])).toFixed(2)}.`.replace('..', '.'));
        ctx.lineWidth   = w.width;
        ctx.stroke();
      });

      particles.forEach((p) => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 212, 170, ${(p.a * globalAlpha).toFixed(3)})`;
        ctx.fill();
      });

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx   = particles[i].x - particles[j].x;
          const dy   = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 110) {
            const lineA = (1 - dist / 110) * 0.12 * globalAlpha;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(0, 212, 170, ${lineA.toFixed(3)})`;
            ctx.lineWidth   = 0.7;
            ctx.stroke();
          }
        }
      }

      if (!frame._done) requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);

    const totalDuration = BOOT_STEP_DELAYS[BOOT_STEP_DELAYS.length - 1] + 580;
    setTimeout(() => {
      frame._done = true;
      window.removeEventListener('resize', resize);
      const boot = document.getElementById('boot-screen');
      boot.classList.add('fade-out');
      setTimeout(resolve, 720);
    }, totalDuration);
  });
}
