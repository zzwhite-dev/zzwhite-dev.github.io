(function () {
  const canvas = document.createElement("canvas");
  canvas.id = "neural-background";
  document.body.prepend(canvas);

  const ctx = canvas.getContext("2d");

  const SETTINGS = {
    pointCount: 58,
    maxDistance: 135,
    maxLinksPerPoint: 3,

    driftSpeed: 0.018,
    swayRadius: 6,

    pointRadiusMin: 1.0,
    pointRadiusMax: 2.1,

    baseDotAlpha: 0.34,
    glowDotAlpha: 0.78,
    lineAlpha: 0.10,
    shapeAlpha: 0.035,

    ambientEventEveryMs: 2200,
    mouseRadius: 85,
  };

  let width = 0;
  let height = 0;
  let points = [];
  let clusters = [];
  let lastAmbientEvent = 0;

  const mouse = { x: null, y: null };

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
    createPoints();
  }

  function createPoints() {
    points = Array.from({ length: SETTINGS.pointCount }, () => {
      const homeX = rand(0, width);
      const homeY = rand(0, height);

      return {
        homeX,
        homeY,
        x: homeX,
        y: homeY,

        vx: rand(-SETTINGS.driftSpeed, SETTINGS.driftSpeed),
        vy: rand(-SETTINGS.driftSpeed, SETTINGS.driftSpeed),

        swayPhaseX: rand(0, Math.PI * 2),
        swayPhaseY: rand(0, Math.PI * 2),
        swaySpeedX: rand(0.0015, 0.0032),
        swaySpeedY: rand(0.0015, 0.0032),

        radius: rand(SETTINGS.pointRadiusMin, SETTINGS.pointRadiusMax),
        pulsePhase: rand(0, Math.PI * 2),
        pulseSpeed: rand(0.003, 0.007),

        glow: 0,
      };
    });

    clusters = [];
  }

  function updatePoints() {
    for (const p of points) {
      p.homeX += p.vx;
      p.homeY += p.vy;

      if (p.homeX < 20 || p.homeX > width - 20) p.vx *= -1;
      if (p.homeY < 20 || p.homeY > height - 20) p.vy *= -1;

      p.swayPhaseX += p.swaySpeedX;
      p.swayPhaseY += p.swaySpeedY;
      p.pulsePhase += p.pulseSpeed;

      let offsetX = Math.sin(p.swayPhaseX) * SETTINGS.swayRadius;
      let offsetY = Math.cos(p.swayPhaseY) * SETTINGS.swayRadius;

      if (mouse.x !== null) {
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const d = Math.hypot(dx, dy);

        if (d < SETTINGS.mouseRadius && d > 0) {
          offsetX += dx / 60;
          offsetY += dy / 60;
        }
      }

      p.x = p.homeX + offsetX;
      p.y = p.homeY + offsetY;

      p.glow *= 0.965;
    }
  }

  function getNeighbors(index) {
    const p = points[index];
    const neighbors = [];

    for (let j = 0; j < points.length; j++) {
      if (j === index) continue;

      const q = points[j];
      const d = dist(p, q);

      if (d <= SETTINGS.maxDistance) {
        neighbors.push({ index: j, d });
      }
    }

    neighbors.sort((a, b) => a.d - b.d);
    return neighbors.slice(0, SETTINGS.maxLinksPerPoint);
  }

  function triggerAmbientCluster() {
    const index = Math.floor(rand(0, points.length));
    const center = points[index];
    const neighbors = getNeighbors(index);

    center.glow = 1;

    const linked = [index, ...neighbors.slice(0, 2).map((n) => n.index)];
    linked.forEach((i) => {
      if (points[i]) points[i].glow = Math.max(points[i].glow, 0.65);
    });

    clusters.push({
      indices: linked,
      life: 1,
    });
  }

  function updateClusters() {
    for (let i = clusters.length - 1; i >= 0; i--) {
      clusters[i].life *= 0.96;
      if (clusters[i].life < 0.04) {
        clusters.splice(i, 1);
      }
    }
  }

  function maybeAmbientEvent(timestamp) {
    if (timestamp - lastAmbientEvent > SETTINGS.ambientEventEveryMs) {
      triggerAmbientCluster();
      lastAmbientEvent = timestamp;
    }
  }

  function clickNearestPoint(x, y) {
    let bestIndex = 0;
    let bestDistance = Infinity;

    points.forEach((p, i) => {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = i;
      }
    });

    const neighbors = getNeighbors(bestIndex);
    const linked = [bestIndex, ...neighbors.slice(0, 3).map((n) => n.index)];

    linked.forEach((i) => {
      if (points[i]) points[i].glow = 1;
    });

    clusters.push({
      indices: linked,
      life: 1,
    });
  }

  function drawShapes() {
    for (const cluster of clusters) {
      if (cluster.indices.length < 3) continue;

      const a = points[cluster.indices[0]];
      const b = points[cluster.indices[1]];
      const c = points[cluster.indices[2]];
      if (!a || !b || !c) continue;

      ctx.fillStyle = `rgba(170, 182, 190, ${SETTINGS.shapeAlpha * cluster.life})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawLines() {
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const neighbors = getNeighbors(i);

      for (const n of neighbors) {
        const j = n.index;
        if (j <= i) continue;

        const q = points[j];
        const distanceFactor = 1 - n.d / SETTINGS.maxDistance;
        const glow = Math.max(p.glow, q.glow);

        ctx.strokeStyle = `rgba(150, 164, 172, ${
          SETTINGS.lineAlpha * distanceFactor + glow * 0.12
        })`;
        ctx.lineWidth = glow > 0.2 ? 1.0 : 0.7;

        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
    }
  }

  function drawPoints() {
    for (const p of points) {
      const pulse = 0.5 + 0.5 * Math.sin(p.pulsePhase);
      const alpha = SETTINGS.baseDotAlpha + pulse * 0.08 + p.glow * 0.35;

      ctx.fillStyle = `rgba(220, 226, 230, ${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius + p.glow * 0.8, 0, Math.PI * 2);
      ctx.fill();

      if (p.glow > 0.06) {
        ctx.fillStyle = `rgba(220, 226, 230, ${p.glow * 0.08})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (p.radius + 1.5) * 3.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function draw(timestamp = 0) {
    ctx.clearRect(0, 0, width, height);

    updatePoints();
    updateClusters();
    maybeAmbientEvent(timestamp);

    drawShapes();
    drawLines();
    drawPoints();

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
    clickNearestPoint(e.clientX, e.clientY);
  });

  resize();
  draw();
})();
