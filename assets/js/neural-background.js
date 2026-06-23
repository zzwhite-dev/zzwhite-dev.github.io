(function () {
  const canvas = document.createElement("canvas");
  canvas.id = "neural-background";
  canvas.style.position = "fixed";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.zIndex = "-1";
  canvas.style.pointerEvents = "none";
  document.body.prepend(canvas);

  const ctx = canvas.getContext("2d");

  const SETTINGS = {
    // ---- flow-field particle storm ----
    particleCount: 420,
    particleSpeedMin: 0.6,
    particleSpeedMax: 1.8,
    particleFadeAlpha: 0.085, // lower = longer trails (canvas not fully cleared each frame)
    particleSize: 1.15,

    // flow field tuning (layered sine noise, animates over time)
    flowScale: 0.0026, // spatial frequency of the field
    flowScale2: 0.0055, // second octave, adds detail
    flowTimeSpeed: 0.00012, // how fast the field itself evolves
    flowStrength: 0.18, // turn rate per frame

    particleColorCold: "70, 140, 210", // slower particles
    particleColorHot: "150, 230, 255", // faster particles (closer to cursor / vortex)

    // ---- magnetic anchor network ----
    anchorCount: 24,
    anchorMaxDistance: 230,
    anchorMaxLinks: 3,
    anchorDriftSpeed: 0.05,
    anchorRadiusMin: 1.8,
    anchorRadiusMax: 3.4,
    anchorColor: "160, 215, 255",
    anchorLineColor: "100, 175, 230",
    anchorLineBaseAlpha: 0.16,

    // ---- cursor: magnet + vortex ----
    magnetRadius: 230, // how far the magnet bends nearby connection lines
    magnetStrength: 70, // max px the line midpoint bends toward cursor
    vortexRadius: 170, // how far the cursor swirls the particle flow
    vortexStrength: 0.06, // added rotational pull near cursor, blended into flow direction
    cursorGlowRadius: 16,

    clickBurstParticles: 36,
    clickBurstSpeed: 4.2,
  };

  let width = 0;
  let height = 0;
  let particles = [];
  let anchors = [];
  let anchorEdges = [];
  let burstParticles = [];
  let timeAccum = 0;

  const mouse = { x: null, y: null, active: false };

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // Cheap multi-octave pseudo-noise flow field: returns an angle in radians
  // for any (x, y, t). Built from layered sine/cosine rather than true Perlin
  // noise, since it's far cheaper per-sample and visually similar for this use.
  function flowAngle(x, y, t) {
    const a =
      Math.sin(x * SETTINGS.flowScale + t) * Math.cos(y * SETTINGS.flowScale - t * 0.8) +
      Math.sin((x + y) * SETTINGS.flowScale2 + t * 1.3) * 0.6;
    return a * Math.PI * 2;
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
    createParticles();
    createAnchors();
    rebuildAnchorEdges();

    // opaque-ish background fill so trail fading works (transparent canvases
    // can't "fade to black" — they'd fade to see-through, revealing old frames
    // as the page background shows through instead of darkening smoothly)
    ctx.fillStyle = "rgba(6, 10, 16, 1)";
    ctx.fillRect(0, 0, width, height);
  }

  function createParticles() {
    particles = Array.from({ length: SETTINGS.particleCount }, () => ({
      x: rand(0, width),
      y: rand(0, height),
      speed: rand(SETTINGS.particleSpeedMin, SETTINGS.particleSpeedMax),
      angle: rand(0, Math.PI * 2),
    }));
    burstParticles = [];
  }

  function createAnchors() {
    anchors = Array.from({ length: SETTINGS.anchorCount }, () => {
      const homeX = rand(0, width);
      const homeY = rand(0, height);
      return {
        homeX,
        homeY,
        x: homeX,
        y: homeY,
        vx: rand(-SETTINGS.anchorDriftSpeed, SETTINGS.anchorDriftSpeed),
        vy: rand(-SETTINGS.anchorDriftSpeed, SETTINGS.anchorDriftSpeed),
        radius: rand(SETTINGS.anchorRadiusMin, SETTINGS.anchorRadiusMax),
        pulsePhase: rand(0, Math.PI * 2),
        glow: 0,
      };
    });
  }

  function rebuildAnchorEdges() {
    anchorEdges = [];
    for (let i = 0; i < anchors.length; i++) {
      const candidates = [];
      for (let j = 0; j < anchors.length; j++) {
        if (j === i) continue;
        const d = Math.hypot(anchors[i].x - anchors[j].x, anchors[i].y - anchors[j].y);
        if (d <= SETTINGS.anchorMaxDistance) candidates.push({ j, d });
      }
      candidates.sort((a, b) => a.d - b.d);
      candidates.slice(0, SETTINGS.anchorMaxLinks).forEach((c) => {
        const key = i < c.j ? `${i}-${c.j}` : `${c.j}-${i}`;
        if (!anchorEdges.some((e) => e.key === key)) {
          anchorEdges.push({ a: i, b: c.j, key });
        }
      });
    }
  }

  function updateParticles() {
    const t = timeAccum * SETTINGS.flowTimeSpeed;

    for (const p of particles) {
      let angle = flowAngle(p.x, p.y, t);

      // vortex: near the cursor, bend the flow into a swirl rather than
      // just following the ambient field
      if (mouse.active) {
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const d = Math.hypot(dx, dy);
        if (d < SETTINGS.vortexRadius && d > 0.001) {
          const swirl = Math.atan2(dy, dx) + Math.PI / 2; // perpendicular = tangential pull
          const falloff = 1 - d / SETTINGS.vortexRadius;
          angle = lerp(angle, swirl, falloff * falloff * 0.9);
        }
      }

      p.angle = lerp(p.angle, angle, SETTINGS.flowStrength);
      p.x += Math.cos(p.angle) * p.speed;
      p.y += Math.sin(p.angle) * p.speed;

      if (p.x < -10) p.x = width + 10;
      if (p.x > width + 10) p.x = -10;
      if (p.y < -10) p.y = height + 10;
      if (p.y > height + 10) p.y = -10;
    }

    for (let i = burstParticles.length - 1; i >= 0; i--) {
      const b = burstParticles[i];
      b.x += b.vx;
      b.y += b.vy;
      b.vx *= 0.96;
      b.vy *= 0.96;
      b.life *= 0.96;
      if (b.life < 0.04) burstParticles.splice(i, 1);
    }
  }

  function updateAnchors() {
    for (const a of anchors) {
      a.homeX += a.vx;
      a.homeY += a.vy;
      if (a.homeX < 30 || a.homeX > width - 30) a.vx *= -1;
      if (a.homeY < 30 || a.homeY > height - 30) a.vy *= -1;

      a.x = a.homeX;
      a.y = a.homeY;
      a.pulsePhase += 0.02;
      a.glow *= 0.94;

      if (mouse.active) {
        const d = Math.hypot(a.x - mouse.x, a.y - mouse.y);
        if (d < SETTINGS.magnetRadius) {
          a.glow = Math.max(a.glow, (1 - d / SETTINGS.magnetRadius) * 0.6);
        }
      }
    }
  }

  function spawnBurst(x, y) {
    for (let i = 0; i < SETTINGS.clickBurstParticles; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(SETTINGS.clickBurstSpeed * 0.4, SETTINGS.clickBurstSpeed);
      burstParticles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
      });
    }

    for (const a of anchors) {
      const d = Math.hypot(a.x - x, a.y - y);
      if (d < SETTINGS.magnetRadius * 1.3) {
        a.glow = 1;
      }
    }
  }

  function drawParticles() {
    ctx.globalCompositeOperation = "lighter";
    for (const p of particles) {
      const speedFrac = (p.speed - SETTINGS.particleSpeedMin) /
        (SETTINGS.particleSpeedMax - SETTINGS.particleSpeedMin);
      const color = speedFrac > 0.6 ? SETTINGS.particleColorHot : SETTINGS.particleColorCold;
      ctx.fillStyle = `rgba(${color}, 0.55)`;
      ctx.fillRect(p.x, p.y, SETTINGS.particleSize, SETTINGS.particleSize);
    }

    for (const b of burstParticles) {
      ctx.fillStyle = `rgba(${SETTINGS.particleColorHot}, ${b.life * 0.8})`;
      ctx.fillRect(b.x, b.y, 1.6, 1.6);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // Draw an anchor-to-anchor connection as a quadratic curve whose control
  // point gets pulled toward the cursor when the cursor is near the line,
  // producing the "magnet bending the wire" effect.
  function drawAnchorEdges() {
    for (const e of anchorEdges) {
      const a = anchors[e.a];
      const b = anchors[e.b];
      if (!a || !b) continue;

      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;

      let ctrlX = midX;
      let ctrlY = midY;
      let bendGlow = 0;

      if (mouse.active) {
        const d = Math.hypot(midX - mouse.x, midY - mouse.y);
        if (d < SETTINGS.magnetRadius) {
          const pull = (1 - d / SETTINGS.magnetRadius);
          const eased = pull * pull;
          ctrlX = lerp(midX, mouse.x, eased * 0.85);
          ctrlY = lerp(midY, mouse.y, eased * 0.85);
          bendGlow = eased;
        }
      }

      const glow = Math.max(a.glow, b.glow, bendGlow * 0.5);

      ctx.strokeStyle = `rgba(${SETTINGS.anchorLineColor}, ${
        SETTINGS.anchorLineBaseAlpha + glow * 0.5
      })`;
      ctx.lineWidth = 0.8 + glow * 1.6;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(ctrlX, ctrlY, b.x, b.y);
      ctx.stroke();
    }
  }

  function drawAnchors() {
    for (const a of anchors) {
      const pulse = 0.5 + 0.5 * Math.sin(a.pulsePhase);
      const alpha = 0.55 + pulse * 0.15 + a.glow * 0.4;

      ctx.fillStyle = `rgba(${SETTINGS.anchorColor}, ${Math.min(alpha, 1)})`;
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.radius + a.glow * 2, 0, Math.PI * 2);
      ctx.fill();

      if (a.glow > 0.08) {
        ctx.fillStyle = `rgba(${SETTINGS.anchorColor}, ${a.glow * 0.18})`;
        ctx.beginPath();
        ctx.arc(a.x, a.y, (a.radius + 2) * 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawCursorGlow() {
    if (!mouse.active) return;
    const grad = ctx.createRadialGradient(
      mouse.x, mouse.y, 0,
      mouse.x, mouse.y, SETTINGS.vortexRadius
    );
    grad.addColorStop(0, "rgba(150, 220, 255, 0.05)");
    grad.addColorStop(1, "rgba(150, 220, 255, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, SETTINGS.vortexRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw(timestamp = 0) {
    timeAccum = timestamp;

    // fade the previous frame slightly instead of clearing fully, so fast
    // particles leave short glowing trails as they stream through the field
    ctx.fillStyle = `rgba(6, 10, 16, ${SETTINGS.particleFadeAlpha})`;
    ctx.fillRect(0, 0, width, height);

    updateParticles();
    updateAnchors();

    drawCursorGlow();
    drawAnchorEdges();
    drawParticles();
    drawAnchors();

    requestAnimationFrame(draw);
  }

  window.addEventListener("resize", resize);

  window.addEventListener("mousemove", function (e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
  });

  window.addEventListener("mouseleave", function () {
    mouse.active = false;
  });

  window.addEventListener("click", function (e) {
    spawnBurst(e.clientX, e.clientY);
  });

  resize();
  draw();
})();
