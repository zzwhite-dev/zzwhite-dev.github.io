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
    particleCount: 1400,

    // streaklines: each particle remembers its previous position to draw a
    // short line segment rather than a dot, which is what makes flow visible
    // as "current" rather than "scattered dots drifting"
    trailFadeAlpha: 0.05, // lower = longer-lived trails on the canvas itself
    lineWidth: 1,

    speedMin: 0.5,
    speedMax: 2.6,

    // --- layered current field ---
    // Large-scale bands give the field visible "channels" (like real current
    // maps) instead of uniform turbulence everywhere. Detail layer adds
    // texture on top. Both evolve slowly over time so currents shift and
    // wander rather than freezing into a static pattern.
    bandScale: 0.0011,
    bandSpeed: 0.00009,
    detailScale: 0.004,
    detailSpeed: 0.00021,
    detailInfluence: 0.55,

    turnRate: 0.12, // how quickly a particle's heading follows the field (lower = smoother arcs)

    // occasional eddies: independent of the cursor, these spawn and drift on
    // their own so the field never looks fully "calm" even with no input
    eddyCount: 3,
    eddyStrength: 0.85,
    eddyRadiusMin: 140,
    eddyRadiusMax: 260,
    eddyLifeMs: 14000,

    // --- cursor: pushes/redirects the flow, no visual glow ---
    cursorRadius: 150,
    cursorStrength: 1.1, // how strongly nearby flow bends away/around the cursor

    // color: speed-mapped, cool blues/teals/white-foam at the top end
    colorSlow: [40, 90, 130],
    colorMid: [70, 160, 200],
    colorFast: [190, 230, 240],
  };

  let width = 0;
  let height = 0;
  let particles = [];
  let eddies = [];
  let timeAccum = 0;

  const mouse = { x: null, y: null, active: false };

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // Layered sine-based current field. Returns an angle in radians.
  // Large "band" layer = broad channels of flow. Detail layer = finer
  // wandering texture riding on top of the bands.
  function fieldAngle(x, y, t) {
    const bandT = t * SETTINGS.bandSpeed;
    const band =
      Math.sin(x * SETTINGS.bandScale + bandT) * 1.4 +
      Math.cos(y * SETTINGS.bandScale * 1.3 - bandT * 0.7);

    const detailT = t * SETTINGS.detailSpeed;
    const detail =
      Math.sin((x - y) * SETTINGS.detailScale + detailT) +
      Math.cos((x + y * 0.6) * SETTINGS.detailScale * 1.1 - detailT * 1.4);

    return (band + detail * SETTINGS.detailInfluence) * Math.PI;
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
    createParticles();
    createEddies();

    ctx.fillStyle = "rgba(5, 12, 20, 1)";
    ctx.fillRect(0, 0, width, height);
  }

  function createParticles() {
    particles = Array.from({ length: SETTINGS.particleCount }, () => {
      const x = rand(0, width);
      const y = rand(0, height);
      return {
        x,
        y,
        px: x,
        py: y,
        angle: rand(0, Math.PI * 2),
        speed: rand(SETTINGS.speedMin, SETTINGS.speedMax),
      };
    });
  }

  function createEddies() {
    // stagger initial "born at" times into the past by a random fraction of
    // their lifespan, so eddies don't all expire/respawn in sync later on
    eddies = Array.from({ length: SETTINGS.eddyCount }, () =>
      spawnEddy(-rand(0, SETTINGS.eddyLifeMs))
    );
  }

  function spawnEddy(bornAt) {
    return {
      x: rand(0, width),
      y: rand(0, height),
      radius: rand(SETTINGS.eddyRadiusMin, SETTINGS.eddyRadiusMax),
      direction: Math.random() < 0.5 ? 1 : -1,
      bornAt,
    };
  }

  function updateEddies(timestamp) {
    for (let i = 0; i < eddies.length; i++) {
      if (timestamp - eddies[i].bornAt > SETTINGS.eddyLifeMs) {
        eddies[i] = spawnEddy(timestamp);
      }
    }
  }

  function updateParticles(timestamp) {
    const t = timeAccum;

    for (const p of particles) {
      p.px = p.x;
      p.py = p.y;

      let targetAngle = fieldAngle(p.x, p.y, t);
      let pull = 0; // blend weight toward special (eddy/cursor) directions

      for (const eddy of eddies) {
        const dx = p.x - eddy.x;
        const dy = p.y - eddy.y;
        const d = Math.hypot(dx, dy);
        if (d < eddy.radius && d > 0.001) {
          const falloff = 1 - d / eddy.radius;
          const swirl = Math.atan2(dy, dx) + (Math.PI / 2) * eddy.direction;
          const w = falloff * falloff * SETTINGS.eddyStrength;
          targetAngle = lerp(targetAngle, swirl, w);
        }
      }

      if (mouse.active) {
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const d = Math.hypot(dx, dy);
        if (d < SETTINGS.cursorRadius && d > 0.001) {
          // push the flow around the cursor, like water parting around an
          // obstacle: redirect tangentially plus a small outward component
          const falloff = 1 - d / SETTINGS.cursorRadius;
          const away = Math.atan2(dy, dx);
          const tangent = away + Math.PI / 2;
          const blended = Math.atan2(
            Math.sin(tangent) * 0.75 + Math.sin(away) * 0.45,
            Math.cos(tangent) * 0.75 + Math.cos(away) * 0.45
          );
          const w = falloff * falloff * SETTINGS.cursorStrength;
          targetAngle = lerp(targetAngle, blended, Math.min(w, 0.95));
        }
      }

      // shortest-path angle interpolation so headings don't spin the long
      // way around when crossing the -PI/PI boundary
      let diff = targetAngle - p.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      p.angle += diff * SETTINGS.turnRate;

      p.x += Math.cos(p.angle) * p.speed;
      p.y += Math.sin(p.angle) * p.speed;

      if (p.x < 0) { p.x += width; p.px = p.x; }
      if (p.x > width) { p.x -= width; p.px = p.x; }
      if (p.y < 0) { p.y += height; p.py = p.y; }
      if (p.y > height) { p.y -= height; p.py = p.y; }
    }
  }

  function colorForSpeed(speed) {
    const frac = (speed - SETTINGS.speedMin) / (SETTINGS.speedMax - SETTINGS.speedMin);
    let r, g, b;
    if (frac < 0.5) {
      const t = frac / 0.5;
      r = lerp(SETTINGS.colorSlow[0], SETTINGS.colorMid[0], t);
      g = lerp(SETTINGS.colorSlow[1], SETTINGS.colorMid[1], t);
      b = lerp(SETTINGS.colorSlow[2], SETTINGS.colorMid[2], t);
    } else {
      const t = (frac - 0.5) / 0.5;
      r = lerp(SETTINGS.colorMid[0], SETTINGS.colorFast[0], t);
      g = lerp(SETTINGS.colorMid[1], SETTINGS.colorFast[1], t);
      b = lerp(SETTINGS.colorMid[2], SETTINGS.colorFast[2], t);
    }
    return `${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}`;
  }

  function drawParticles() {
    ctx.lineWidth = SETTINGS.lineWidth;
    ctx.globalCompositeOperation = "lighter";

    for (const p of particles) {
      // skip drawing the segment if the particle just wrapped around an edge,
      // otherwise a long streak flashes across the whole screen
      const dx = p.x - p.px;
      const dy = p.y - p.py;
      if (Math.abs(dx) > width / 2 || Math.abs(dy) > height / 2) continue;

      ctx.strokeStyle = `rgba(${colorForSpeed(p.speed)}, 0.5)`;
      ctx.beginPath();
      ctx.moveTo(p.px, p.py);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = "source-over";
  }

  function draw(timestamp = 0) {
    timeAccum = timestamp;

    // fade the previous frame instead of clearing, so motion leaves a
    // short luminous trail behind each particle (the core "current" look)
    ctx.fillStyle = `rgba(5, 12, 20, ${SETTINGS.trailFadeAlpha})`;
    ctx.fillRect(0, 0, width, height);

    updateEddies(timestamp);
    updateParticles(timestamp);
    drawParticles();

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

  resize();
  draw();
})();
