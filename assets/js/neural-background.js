(function () {
  const canvas = document.createElement("canvas");
  canvas.id = "neural-background";
  document.body.prepend(canvas);

  const ctx = canvas.getContext("2d");

  const SETTINGS = {
    neuronCount: 54,
    maxConnectionDistance: 240,
    minConnections: 1,
    maxConnections: 3,

    ambientFireEveryMs: 1900,
    maxPropagationDepth: 2,

    signalSpeedMin: 0.008,
    signalSpeedMax: 0.015,

    dendriteCountMin: 6,
    dendriteCountMax: 10,
    dendriteLengthMin: 18,
    dendriteLengthMax: 42,

    homeDriftSpeed: 0.01,
    swayRadius: 4.5,

    connectionRefreshFrames: 320,
  };

  let width;
  let height;
  let neurons = [];
  let edges = [];
  let signals = [];
  let lastAmbientFire = 0;
  let frameCounter = 0;

  const mouse = { x: null, y: null };

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    neurons = Array.from({ length: SETTINGS.neuronCount }, () => createNeuron());
    buildConnections();
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function pointLerp(p1, p2, t) {
    return {
      x: lerp(p1.x, p2.x, t),
      y: lerp(p1.y, p2.y, t),
    };
  }

  function createNeuron(x, y) {
    const homeX = x ?? rand(0, width);
    const homeY = y ?? rand(0, height);

    const baseRadius = rand(10, 16);

    const dendriteCount =
      SETTINGS.dendriteCountMin +
      Math.floor(Math.random() * (SETTINGS.dendriteCountMax - SETTINGS.dendriteCountMin + 1));

    const dendrites = Array.from({ length: dendriteCount }, () => {
      const angle = rand(0, Math.PI * 2);
      const length = rand(SETTINGS.dendriteLengthMin, SETTINGS.dendriteLengthMax);
      const bend = rand(-0.6, 0.6);
      const branchLength = rand(6, 14);
      const branchSide = Math.random() > 0.5 ? 1 : -1;

      return {
        angle,
        length,
        bend,
        branchLength,
        branchSide,
      };
    });

    const somaPoints = [];
    const pointCount = 14;
    for (let i = 0; i < pointCount; i++) {
      const angle = (i / pointCount) * Math.PI * 2;
      const radius = baseRadius * rand(0.8, 1.22);
      somaPoints.push({ angle, radius });
    }

    return {
      homeX,
      homeY,
      x: homeX,
      y: homeY,

      homeVX: rand(-SETTINGS.homeDriftSpeed, SETTINGS.homeDriftSpeed),
      homeVY: rand(-SETTINGS.homeDriftSpeed, SETTINGS.homeDriftSpeed),

      swayPhaseX: rand(0, Math.PI * 2),
      swayPhaseY: rand(0, Math.PI * 2),
      swaySpeedX: rand(0.0025, 0.004),
      swaySpeedY: rand(0.0025, 0.004),

      baseRadius,
      somaPoints,
      dendrites,

      flash: 0,
      cooldown: 0,
      phase: rand(0, Math.PI * 2),

      neighbors: [],
    };
  }

  function getSomaBoundaryPoint(n, angle) {
    let closest = n.somaPoints[0];
    let best = Infinity;

    for (const p of n.somaPoints) {
      let d = Math.abs(p.angle - angle);
      d = Math.min(d, Math.PI * 2 - d);
      if (d < best) {
        best = d;
        closest = p;
      }
    }

    return {
      x: n.x + Math.cos(angle) * closest.radius,
      y: n.y + Math.sin(angle) * closest.radius,
    };
  }

  function createOrganicPath(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;

    const startAngle = Math.atan2(dy, dx);
    const endAngle = Math.atan2(-dy, -dx);

    const start = getSomaBoundaryPoint(a, startAngle);
    const end = getSomaBoundaryPoint(b, endAngle);

    const points = [start];

    const midCount = 3 + Math.floor(Math.random() * 2);

    for (let i = 1; i <= midCount; i++) {
      const t = i / (midCount + 1);

      const along = lerp(0, len, t);
      const side = Math.sin(t * Math.PI) * rand(-26, 26);
      const drift = rand(-10, 10);

      points.push({
        x: start.x + ux * (along + drift) + nx * side,
        y: start.y + uy * (along + drift) + ny * side,
      });
    }

    points.push(end);

    return points;
  }

  function buildConnections() {
    edges = [];
    neurons.forEach((n) => (n.neighbors = []));

    const used = new Set();

    for (let i = 0; i < neurons.length; i++) {
      const candidates = [];

      for (let j = 0; j < neurons.length; j++) {
        if (i === j) continue;
        const d = dist(neurons[i], neurons[j]);
        if (d < SETTINGS.maxConnectionDistance) {
          candidates.push({ j, d });
        }
      }

      candidates.sort((a, b) => a.d - b.d);

      const count = Math.min(
        SETTINGS.maxConnections,
        Math.max(SETTINGS.minConnections, candidates.length)
      );

      for (let k = 0; k < count; k++) {
        if (!candidates[k]) continue;

        const j = candidates[k].j;
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (used.has(key)) continue;
        used.add(key);

        const path = createOrganicPath(neurons[i], neurons[j]);

        edges.push({
          i,
          j,
          path,
          glow: 0,
        });

        neurons[i].neighbors.push(j);
        neurons[j].neighbors.push(i);
      }
    }
  }

  function findEdge(from, to) {
    return edges.find(
      (e) => (e.i === from && e.j === to) || (e.i === to && e.j === from)
    );
  }

  function fireNeuron(index, depth = 0, fromIndex = null) {
    const n = neurons[index];
    if (!n) return;
    if (depth > 0 && n.cooldown > 0.45) return;

    n.flash = 1;
    n.cooldown = 1;

    if (depth >= SETTINGS.maxPropagationDepth) return;

    const targets = n.neighbors.filter((neighbor) => neighbor !== fromIndex);

    targets.forEach((targetIndex, order) => {
      signals.push({
        from: index,
        to: targetIndex,
        t: 0,
        delay: order * 9 + rand(0, 12),
        speed: rand(SETTINGS.signalSpeedMin, SETTINGS.signalSpeedMax),
        depth: depth + 1,
      });
    });
  }

  function triggerNearestNeuron(x, y) {
    let bestIndex = 0;
    let bestDistance = Infinity;

    neurons.forEach((n, i) => {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = i;
      }
    });

    fireNeuron(bestIndex, 0, null);
  }

  function updateNeurons() {
    for (const n of neurons) {
      n.phase += 0.01;
      n.swayPhaseX += n.swaySpeedX;
      n.swayPhaseY += n.swaySpeedY;

      n.homeX += n.homeVX;
      n.homeY += n.homeVY;

      if (n.homeX < 40 || n.homeX > width - 40) n.homeVX *= -1;
      if (n.homeY < 40 || n.homeY > height - 40) n.homeVY *= -1;

      if (mouse.x !== null) {
        const dx = n.homeX - mouse.x;
        const dy = n.homeY - mouse.y;
        const d = Math.hypot(dx, dy);
        if (d < 110 && d > 0) {
          n.homeX += dx / 220;
          n.homeY += dy / 220;
        }
      }

      n.x = n.homeX + Math.sin(n.swayPhaseX) * SETTINGS.swayRadius;
      n.y = n.homeY + Math.cos(n.swayPhaseY) * SETTINGS.swayRadius;

      n.flash *= 0.95;
      n.cooldown *= 0.97;
    }

    for (const e of edges) {
      e.glow *= 0.92;
    }
  }

  function updateSignals() {
    for (let i = signals.length - 1; i >= 0; i--) {
      const s = signals[i];

      if (s.delay > 0) {
        s.delay -= 1;
        continue;
      }

      s.t += s.speed;

      const edge = findEdge(s.from, s.to);
      if (edge) edge.glow = Math.max(edge.glow, 0.75);

      if (s.t >= 1) {
        fireNeuron(s.to, s.depth, s.from);
        signals.splice(i, 1);
      }
    }
  }

  function drawPolyline(points, color, width) {
    if (!points.length) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
  }

  function samplePathSegment(points, t0, t1) {
    if (points.length < 2) return [];

    const segments = points.length - 1;
    const out = [];

    for (let i = 0; i < segments; i++) {
      const segStart = i / segments;
      const segEnd = (i + 1) / segments;

      if (t1 < segStart || t0 > segEnd) continue;

      const localT0 = Math.max(0, (t0 - segStart) / (segEnd - segStart));
      const localT1 = Math.min(1, (t1 - segStart) / (segEnd - segStart));

      const pA = pointLerp(points[i], points[i + 1], localT0);
      const pB = pointLerp(points[i], points[i + 1], localT1);

      if (!out.length) out.push(pA);
      out.push(pB);
    }

    return out;
  }

  function drawConnections() {
    for (const e of edges) {
      drawPolyline(e.path, "rgba(112, 138, 145, 0.10)", 0.85);

      if (e.glow > 0.02) {
        drawPolyline(e.path, `rgba(170, 198, 205, ${e.glow * 0.12})`, 1.2);
      }
    }
  }

  function drawSignals() {
    for (const s of signals) {
      if (s.delay > 0) continue;

      const edge = findEdge(s.from, s.to);
      if (!edge) continue;

      const headT = Math.min(1, s.t);
      const tailT = Math.max(0, s.t - 0.18);

      const segment = samplePathSegment(edge.path, tailT, headT);

      drawPolyline(segment, "rgba(215, 228, 232, 0.36)", 1.6);
    }
  }

  function drawNeuron(n) {
    const baseGlow = 0.35 + 0.65 * Math.sin(n.phase);
    const active = Math.min(1, n.flash);

    // dendrites
    for (const d of n.dendrites) {
      const start = getSomaBoundaryPoint(n, d.angle);

      const mid = {
        x: start.x + Math.cos(d.angle + d.bend * 0.4) * (d.length * 0.55),
        y: start.y + Math.sin(d.angle + d.bend * 0.4) * (d.length * 0.55),
      };

      const tip = {
        x: start.x + Math.cos(d.angle + d.bend) * d.length,
        y: start.y + Math.sin(d.angle + d.bend) * d.length,
      };

      const branch = {
        x: tip.x + Math.cos(d.angle + d.bend + d.branchSide * 0.75) * d.branchLength,
        y: tip.y + Math.sin(d.angle + d.bend + d.branchSide * 0.75) * d.branchLength,
      };

      ctx.strokeStyle = `rgba(118, 156, 166, ${0.08 + baseGlow * 0.03 + active * 0.18})`;
      ctx.lineWidth = 1.0 + active * 0.35;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(mid.x, mid.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(branch.x, branch.y);
      ctx.stroke();
    }

    // soma blob
    const blobPoints = n.somaPoints.map((p) => ({
      x: n.x + Math.cos(p.angle) * p.radius,
      y: n.y + Math.sin(p.angle) * p.radius,
    }));

    ctx.fillStyle = `rgba(145, 178, 186, ${0.16 + baseGlow * 0.05 + active * 0.12})`;
    ctx.beginPath();
    ctx.moveTo(blobPoints[0].x, blobPoints[0].y);

    for (let i = 1; i < blobPoints.length; i++) {
      const prev = blobPoints[i - 1];
      const curr = blobPoints[i];
      const mx = (prev.x + curr.x) / 2;
      const my = (prev.y + curr.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
    }

    const last = blobPoints[blobPoints.length - 1];
    const first = blobPoints[0];
    const mx = (last.x + first.x) / 2;
    const my = (last.y + first.y) / 2;
    ctx.quadraticCurveTo(last.x, last.y, mx, my);
    ctx.closePath();
    ctx.fill();

    // inner nucleus
    ctx.fillStyle = `rgba(220, 232, 235, ${0.07 + active * 0.10})`;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.baseRadius * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }

  function maybeAmbientFire(timestamp) {
    if (timestamp - lastAmbientFire > SETTINGS.ambientFireEveryMs) {
      const index = Math.floor(Math.random() * neurons.length);
      fireNeuron(index, 0, null);
      lastAmbientFire = timestamp;
    }
  }

  function draw(timestamp = 0) {
    ctx.clearRect(0, 0, width, height);

    updateNeurons();

    frameCounter++;
    if (frameCounter % SETTINGS.connectionRefreshFrames === 0) {
      buildConnections();
    }

    maybeAmbientFire(timestamp);
    updateSignals();

    drawConnections();

    for (const n of neurons) {
      drawNeuron(n);
    }

    drawSignals();

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
    triggerNearestNeuron(e.clientX, e.clientY);
  });

  resize();
  draw();
})();
