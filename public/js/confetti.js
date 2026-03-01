// ── Minimal confetti burst (canvas-based, no dependencies) ───────────────────
(function () {
  const DEFAULT_COLORS = [
    { front: '#7b5cff', back: '#6245e0' },
    { front: '#b3c7ff', back: '#8fa5e5' },
    { front: '#5c86ff', back: '#345dd1' }
  ];

  function makeColors(base) {
    if (!base) return DEFAULT_COLORS;
    const m = base.match(/\d+/g);
    if (!m) return DEFAULT_COLORS;
    const [r, g, b] = m.map(Number);

    const toHex = (r, g, b) =>
      '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
    const darken  = (r, g, b, f) => toHex(r * f, g * f, b * f);
    const lighten = (r, g, b, f) => toHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f);

    function toHSL(r, g, b) {
      r /= 255; g /= 255; b /= 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      let h = 0, s = 0;
      const l = (max + min) / 2;
      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
          case g: h = ((b - r) / d + 2) / 6; break;
          case b: h = ((r - g) / d + 4) / 6; break;
        }
      }
      return [h * 360, s * 100, l * 100];
    }

    function fromHSL(h, s, l) {
      h /= 360; s /= 100; l /= 100;
      if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      const hue = (p, q, t) => {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      return [hue(p, q, h + 1/3), hue(p, q, h), hue(p, q, h - 1/3)].map(v => Math.round(v * 255));
    }

    const [h, s, l] = toHSL(r, g, b);
    const [vr, vg, vb] = fromHSL((h + 30) % 360, s, l);
    const lightR = r + (255 - r) * 0.55, lightG = g + (255 - g) * 0.55, lightB = b + (255 - b) * 0.55;

    return [
      { front: toHex(r, g, b),         back: darken(r, g, b, 0.65) },
      { front: lighten(r, g, b, 0.55), back: darken(lightR, lightG, lightB, 0.8) },
      { front: toHex(vr, vg, vb),      back: darken(vr, vg, vb, 0.65) }
    ];
  }
  const rand = (a, b) => Math.random() * (b - a) + a;

  function getCanvas() {
    let cv = document.getElementById('confettiCanvas');
    if (!cv) {
      cv = document.createElement('canvas');
      cv.id = 'confettiCanvas';
      cv.style.cssText =
        'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999';
      document.body.appendChild(cv);
    }
    cv.width  = window.innerWidth;
    cv.height = window.innerHeight;
    return cv;
  }

  let _raf = null;

  window.launchConfetti = function (originX, originY, tagColor) {
    if (_raf) cancelAnimationFrame(_raf);

    const cv     = getCanvas();
    const ctx    = cv.getContext('2d');
    const cx     = originX != null ? originX : cv.width  / 2;
    const cy     = originY != null ? originY : cv.height / 2;
    const COLORS = makeColors(tagColor);
    const pieces = [];

    // 35 spinning rectangles
    for (let i = 0; i < 35; i++) {
      const color = COLORS[Math.floor(rand(0, COLORS.length))];
      pieces.push({
        type:  'rect',
        color,
        x:  rand(cx - 40, cx + 40),
        y:  rand(cy - 10, cy + 10),
        w:  rand(5, 10),
        h:  rand(8, 16),
        vx: rand(-9, 9),
        vy: -rand(6, 14),
        rot: rand(0, Math.PI * 2),
        mod: rand(0, 99)
      });
    }

    // 18 sequin circles
    for (let i = 0; i < 18; i++) {
      pieces.push({
        type:  'circle',
        color: COLORS[Math.floor(rand(0, COLORS.length))].back,
        x:  rand(cx - 30, cx + 30),
        y:  rand(cy - 10, cy + 10),
        r:  rand(1, 2.5),
        vx: rand(-6, 6),
        vy: -rand(7, 12)
      });
    }

    function draw() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      let alive = false;

      pieces.forEach(p => {
        if (p.y > cv.height + 20) return;
        alive = true;

        if (p.type === 'rect') {
          p.vy   = Math.min(p.vy + 0.3, 4);
          p.vx  -= p.vx * 0.07;
          p.vx  += rand(-0.3, 0.3);
          p.x   += p.vx;
          p.y   += p.vy;
          const sy   = Math.cos((p.y + p.mod) * 0.09);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = sy > 0 ? p.color.front : p.color.back;
          ctx.fillRect(-p.w / 2, -(p.h * sy) / 2, p.w, p.h * sy);
          ctx.restore();
        } else {
          p.vy  += 0.55;
          p.vx  -= p.vx * 0.02;
          p.x   += p.vx;
          p.y   += p.vy;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.fill();
        }
      });

      if (alive) {
        _raf = requestAnimationFrame(draw);
      } else {
        ctx.clearRect(0, 0, cv.width, cv.height);
        _raf = null;
      }
    }

    draw();
  };
})();
