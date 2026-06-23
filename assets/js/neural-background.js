(function () {
  const canvas = document.createElement("canvas");
  canvas.id = "neural-background";
  document.body.prepend(canvas);

  const ctx = canvas.getContext("2d");

  const SETTINGS = {
    neuronCount: 68,
    maxConnectionDistance: 235,
    minConnections: 2,
    maxConnections: 4,

    ambientFireEveryMs: 1700,
    maxPropagationDepth: 2,

    signalSpeedMin: 0.01,
    signalSpeedMax: 0.018,

    dendriteCountMin: 5,
    dendriteCountMax: 8,
    dendriteLengthMin: 28,
    dendriteLengthMax: 56,

    connectionRefreshFrames: 260,

    homeDriftSpeed: 0.018,
    swayRadius: 6,
  };

  let width;
  let height;
  let neurons = [];
  let edges = [];
  let edgeMap = {};
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

  function createNeuron(x, y) {
    const dendriteCount =
      SETTINGS.dendriteCountMin +
      Math.floor(Math.random() * (SETTINGS.dendriteCountMax - SETTINGS.dendriteCountMin + 1));

    const dendrites = Array.from({ length: dendriteCount }, () => {
      const angle = Math.random() * Math.PI * 2;
      const length =
        SETTINGS.dendriteLengthMin +
        Math.random() * (SETTINGS.dendriteLengthMax - SETTINGS.dendriteLengthMin);
      const branchAngle = angle + (Math.random() > 0.5 ? 0.5 : -0.5);
      const branchLength = 10 + Math.random() * 16;

      return {
        angle,
        length,
        branchAngle,
        branchLength,
      };
    });

    const homeX = x ?? Math.random() * width;
    const homeY = y ?? Math.random() * height;

    return {
      homeX,
      homeY,
      x: homeX,
      y: homeY,

      homeVX: (Math.random() - 0.5) * SETTINGS.homeDriftSpeed,
      homeVY: (Math.random() - 0.5) * SETTINGS.homeDriftSpeed,

      swayPhaseX: Math.random() * Math.PI * 2,
      swayPhaseY: Math.random() * Math.PI * 2,
      swaySpeedX: 0.003 + Math.random() * 0.002,
      swaySpeedY: 0.003 + Math.random() * 0.002,

      radius: 3.4 + Math.random() * 2.0,
      phase: Math.random() * Math.PI * 2,
      flash: 0,
      cooldown: 0,

      dendrites,
      neighbors: [],
    };
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function pairKey(i, j) {
    return i < j ? `${i}-${j}` : `${j}-${i}`;
  }

  function buildConnections() {
    edges = [];
    edgeMap = {};
    const used = new Set();

    neurons.forEach((n) => {
      n.neighbors = [];
    });

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
        const key = pairKey(i, j);

        if (!used.has(key)) {
          used.add(key);

          edges.push({
            i,
            j,
            curve: (((i * 31 + j * 17) % 100) / 100 - 0.5) * 34,
            bendPhase: Math.random() * Math.PI * 2,
            glow: 0,
          });

          edgeMap[key] = edges[edges.length - 1];
        }

        if (!neurons[i].neighbors.includes(j)) neurons[i].neighbors.push(j);
        if (!neurons[j].neighbors.includes(i)) neurons[j].neighbors.push(i);
      }
    }
  }

  function getControlPoint(edge) {
    const a = neurons[edge.i];
    const b = neurons[edge.j];

    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;

    const nx = -dy / len;
    const ny = dx / len;

    const breathe = Math.sin(edge.bendPhase) * 6;

    return {
      x: mx + nx * (edge.curve + breathe),
      y: my + ny * (edge.curve + breathe),
    };
  }

  function quadraticPoint(p0, p1, p2, t) {
    const mt = 1 - t;
    return {
      x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
      y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
    };
  }

  function drawCurveSegment(a, c, b, t0, t1, steps, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.beginPath();

    for (let i = 0; i <= steps; i++) {
      const t = t0 + (t1 - t0) * (i / steps);
      const p = quadraticPoint(a, c, b, t);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }

    ctx.stroke();
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
        delay: order * 8 + Math.random() * 12,
        speed:
          SETTINGS.signalSpeedMin +
          Math.random() * (SETTINGS.signalSpeedMax - SETTINGS.signalSpeedMin),
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

        if (d < 120 && d > 0) {
          n.homeX += dx / 180;
          n.homeY += dy / 180;
        }
      }

      n.x = n.homeX + Math.sin(n.swayPhaseX) * SETTINGS.swayRadius;
      n.y = n.homeY + Math.cos(n.swayPhaseY) * SETTINGS.swayRadius;

      n.flash *= 0.95;
      n.cooldown *= 0.97;
    }

    for (const edge of edges) {
      edge.glow *= 0.93;
      edge.bendPhase += 0.004;
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

      const edge = edgeMap[pairKey(s.from, s.to)];
      if (edge) edge.glow = Math.max(edge.glow, 0.75);

      if (s.t >= 1) {
        fireNeuron(s.to, s.depth, s.from);
        signals.splice(i, 1);
      }
    }
  }

  function drawConnections() {
    for (const edge of edges) {
      const a = neurons[edge.i];
      const b = neurons[edge.j];
      const c = getControlPoint(edge);

      const d = dist(a, b);
      const alpha = Math.max(0.03, 1 - d / SETTINGS.maxConnectionDistance) * 0.09;

      ctx.strokeStyle = `rgba(115, 155, 170, ${alpha})`;
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
      ctx.stroke();

      if (edge.glow > 0.02) {
        drawCurveSegment(
          a,
          c,
          b,
          0,
          1,
          18,
          `rgba(175, 215, 225, ${edge.glow * 0.16})`,
          1.2
        );
      }
    }
  }

  function drawSignals() {
    for (const s of signals) {
      if (s.delay > 0) continue;

      const edge = edgeMap[pairKey(s.from, s.to)];
      if (!edge) continue;

      const a = neurons[edge.i];
      const b = neurons[edge.j];
      const c = getControlPoint(edge);

      const headT = Math.min(1, s.t);
      const tailT = Math.max(0, s.t - 0.14);

      drawCurveSegment(
        a,
        c,
        b,
        tailT,
        headT,
        10,
        "rgba(210, 230, 235, 0.42)",
        1.6
      );
    }
  }

  function drawNeuron(n) {
    const baseGlow = 0.35 + 0.65 * Math.sin(n.phase);
    const active = Math.min(1, n.flash);

    for (const d of n.dendrites) {
      const x1 = n.x + Math.cos(d.angle) * n.radius;
      const y1 = n.y + Math.sin(d.angle) * n.radius;
      const x2 = n.x + Math.cos(d.angle) * d.length;
      const y2 = n.y + Math.sin(d.angle) * d.length;
      const xb = x2 + Math.cos(d.branchAngle) * d.branchLength;
      const yb = y2 + Math.sin(d.branchAngle) * d.branchLength;

      ctx.strokeStyle = `rgba(120, 165, 178, ${0.08 + baseGlow * 0.03 + active * 0.22})`;
      ctx.lineWidth = 0.8 + active * 0.35;
      ctx.lineCap = "round";

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(xb, yb);
      ctx.stroke();
    }

    ctx.fillStyle = `rgba(145, 185, 195, ${0.18 + baseGlow * 0.06 + active * 0.14})`;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius + baseGlow * 0.22 + active * 0.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(220, 235, 238, ${0.08 + active * 0.16})`;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius * 0.26, 0, Math.PI * 2);
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
