(function () {
  const canvas = document.createElement("canvas");
  canvas.id = "neural-background";
  document.body.prepend(canvas);

  const ctx = canvas.getContext("2d");

  const SETTINGS = {
    pointCount: 42,
    maxLinkDistance: 190,
    pointRadiusMin: 1.2,
    pointRadiusMax: 2.8,

    driftSpeed: 0.06,
    swayAmount: 10,

    triangleChance: 0.16,
    ambientPulseEveryMs: 1600,

    basePointAlpha: 0.22,
    activePointAlpha: 0.42,
    lineAlpha: 0.09,
    triangleAlpha: 0.045,

    mouseInfluence: 90,
  };

  let width = 0;
  let height = 0;
  let points = [];
  let pulses = [];
  let lastPulse = 0;

  const mouse = {
    x: null,
    y: null,
  };

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    points = Array.from({ length: SETTINGS.pointCount }, () => createPoint());
  }

  function createPoint() {
    const homeX = rand(0, width);
    const homeY = rand(0, height);

    return {
      homeX,
      homeY,
      x: homeX,
      y: homeY,

      vx: rand(-SETTINGS.driftSpeed, SETTINGS.driftSpeed),
      vy: rand(-SETTINGS.driftSpeed, SETTINGS.driftSpeed),

      swayX: rand(0, Math.PI * 2),
      swayY: rand(0, Math.PI * 2),
      swaySpeedX: rand(0.002, 0.005),
      swaySpeedY: rand(0.002, 0.005),

      radius: rand(SETTINGS.pointRadiusMin, SETTINGS.pointRadiusMax),
      alphaPhase: rand(0, Math.PI * 2),
      alphaSpeed: rand(0.004, 0.01),

      glow: 0,
    };
  }

  function pulseNearestPoint(x, y) {
    let bestIndex = 0;
    let bestDistance = Infinity;

    points.forEach((p, i) => {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = i;
      }
    });

    points[bestIndex].glow = 1;
    pulses.push({
      index: bestIndex,
      life: 1,
    });
  }

  function updatePoints() {
    for (const p of points) {
      p.homeX += p.vx;
      p.homeY += p.vy;

      if (p.homeX < 20 || p.homeX > width - 20) p.vx *= -1;
      if (p.homeY < 20 || p.homeY > height - 20) p.vy *= -1;

      p.swayX += p.swaySpeedX;
      p.swayY += p.swaySpeedY;
      p.alphaPhase += p.alphaSpeed;

      let offsetX = Math.sin(p.swayX) * SETTINGS.swayAmount;
      let offsetY = Math.cos(p.swayY) * SETTINGS.swayAmount;

      if (mouse.x !== null) {
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const d = Math.hypot(dx, dy);

        if (d < SETTINGS.mouseInfluence && d > 0) {
          offsetX += dx / 35;
          offsetY += dy / 35;
        }
      }

      p.x = p.homeX + offsetX;
      p.y = p.homeY + offsetY;

      p.glow *= 0.96;
    }
  }

  function updatePulses() {
    for (let i = pulses.length - 1; i >= 0; i--) {
      pulses[i].life *= 0.965;
      if (pulses[i].life < 0.03) {
        pulses.splice(i, 1);
      }
    }
  }

  function maybeAmbientPulse(timestamp) {
    if (timestamp - lastPulse > SETTINGS.ambientPulseEveryMs) {
      const index = Math.floor(rand(0, points.length));
      points[index].glow = 1;
      pulses.push({
        index,
        life: 1,
      });
      lastPulse = timestamp;
    }
  }

  function getNeighbors(index) {
    const source = points[index];
    const neighbors = [];

    for (let j = 0; j < points.length; j++) {
      if (j === index) continue;
      const d = dist(source, points[j]);
      if (d < SETTINGS.maxLinkDistance) {
        neighbors.push({ index: j, d });
      }
    }

    neighbors.sort((a, b) => a.d - b.d);
    return neighbors.slice(0, 4);
  }

  function drawTriangles() {
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const neighbors = getNeighbors(i);

      if (neighbors.length < 2) continue;

      if (Math.random() > SETTINGS.triangleChance) continue;

      const a = points[neighbors[0].index];
      const b = points[neighbors[1].index];

      const glowBoost = Math.max(p.glow, a.glow, b.glow);

      ctx.fillStyle = `rgba(160, 178, 188, ${
        SETTINGS.triangleAlpha + glowBoost * 0.03
      })`;

      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawLines() {
    for (let i = 0; i < points.length; i++) {
      const p = points[i];

      for (let j = i + 1; j < points.length; j++) {
        const q = points[j];
        const d = dist(p, q);

        if (d > SETTINGS.maxLinkDistance) continue;

        const alpha =
          (1 - d / SETTINGS.maxLinkDistance) * SETTINGS.lineAlpha +
          Math.max(p.glow, q.glow) * 0.08;

        ctx.strokeStyle = `rgba(145, 162, 170, ${alpha})`;
        ctx.lineWidth = 0.8;

        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
    }
  }

  function drawPoints() {
    for (const p of points) {
      const pulse = 0.5 + 0.5 * Math.sin(p.alphaPhase);
      const alpha =
        SETTINGS.basePointAlpha +
        pulse * 0.08 +
        p.glow * SETTINGS.activePointAlpha;

      ctx.fillStyle = `rgba(210, 220, 226, ${alpha})`;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius + p.glow * 1.2, 0, Math.PI * 2);
      ctx.fill();

      if (p.glow > 0.05) {
        ctx.fillStyle = `rgba(220, 228, 232, ${p.glow * 0.10})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawPulseRings() {
    for (const pulse of pulses) {
      const p = points[pulse.index];
      if (!p) continue;

      const radius = (1 - pulse.life) * 36;
      const alpha = pulse.life * 0.12;

      ctx.strokeStyle = `rgba(190, 205, 212, ${alpha})`;
      ctx.lineWidth = 1;

      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function draw(timestamp = 0) {
    ctx.clearRect(0, 0, width, height);

    updatePoints();
    updatePulses();
    maybeAmbientPulse(timestamp);

    drawTriangles();
    drawLines();
    drawPoints();
    drawPulseRings();

    requestAnimationFrame(draw);
  }

  window.addEventListener("resize", resize);

  window.addEventListener("mousemove", function (e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });

  window.addEventListener("mouseleave", function () {
    mouse.x = null;
    mouse.y = null;
  });

  window.addEventListener("click", function (e) {
    pulseNearestPoint(e.clientX, e.clientY);
  });

  resize();
  draw();
})();
