(function () {
  const canvas = document.createElement("canvas");
  canvas.id = "neural-background";
  document.body.prepend(canvas);

  const ctx = canvas.getContext("2d");

  const SETTINGS = {
    neuronCount: 78,
    maxConnectionDistance: 260,
    minConnections: 2,
    maxConnections: 4,

    driftSpeed: 0.045,
    swayAmount: 0.22,

    ambientFireEveryMs: 1200,
    maxPropagationDepth: 2,

    signalSpeedMin: 0.012,
    signalSpeedMax: 0.02,

    dendriteCountMin: 5,
    dendriteCountMax: 8,
    dendriteLengthMin: 30,
    dendriteLengthMax: 62,

    connectionRefreshFrames: 180,
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
      const branchAngle = angle + (Math.random() > 0.5 ? 0.55 : -0.55);
      const branchLength = 10 + Math.random() * 18;

      return {
        angle,
        length,
        branchAngle,
        branchLength,
      };
    });

    return {
      x: x ?? Math.random() * width,
      y: y ?? Math.random() * height,
      vx: (Math.random() - 0.5) * SETTINGS.driftSpeed,
      vy: (Math.random() - 0.5) * SETTINGS.driftSpeed,
      radius: 3.5 + Math.random() * 2.2,

      phase: Math.random() * Math.PI * 2,
      swayPhaseX: Math.random() * Math.PI * 2,
      swayPhaseY: Math.random() * Math.PI * 2,

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

          const curveSeed = (((i * 37 + j * 19) % 100) / 100 - 0.5) * 28;

          const edge = {
            i,
            j,
            curve: curveSeed,
            glow: 0,
          };

          edges.push(edge);
          edgeMap[key] = edge;
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

    return {
      x: mx + nx * edge.curve,
      y: my + ny * edge.curve,
    };
  }

  function quadraticPoint(p0, p1, p2, t) {
    const mt = 1 - t;
    return {
      x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
      y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
    };
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
        delay: order * 6 + Math.random() * 10,
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
      n.phase += 0.012;
      n.swayPhaseX += 0.004 + Math.random() * 0.001;
      n.swayPhaseY += 0.0035 + Math.random() * 0.001;

      n.x += n.vx + Math.sin(n.swayPhaseX) * SETTINGS.swayAmount * 0.05;
      n.y += n.vy + Math.cos(n.swayPhaseY) * SETTINGS.swayAmount * 0.05;

      n.flash *= 0.95;
      n.cooldown *= 0.97;

      if (n.x < -70 || n.x > width + 70) n.vx *= -1;
      if (n.y < -70 || n.y > height + 70) n.vy *= -1;

      if (mouse.x !== null) {
        const dx = n.x - mouse.x;
        const dy = n.y - mouse.y;
        const d = Math.hypot(dx, dy);

        if (d < 120 && d > 0) {
          n.x += dx / 140;
          n.y += dy / 140;
        }
      }
    }

    for (const edge of edges) {
      edge.glow *= 0.92;
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
      if (edge) edge.glow = Math.max(edge.glow, 0.9);

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
      const alpha = Math.max(0.04, 1 - d / SETTINGS.maxConnectionDistance) * 0.13;

      ctx.strokeStyle = `rgba(70, 170, 205, ${alpha})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
      ctx.stroke();

      if (edge.glow > 0.02) {
        ctx.strokeStyle = `rgba(165, 240, 255, ${edge.glow * 0.28})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
        ctx.stroke();
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
      const tailT = Math.max(0, s.t - 0.16);

      const head = quadraticPoint(a, c, b, headT);
      const tail = quadraticPoint(a, c, b, tailT);

      ctx.strokeStyle = "rgba(190, 250, 255, 0.72)";
      ctx.lineWidth = 2.0;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();
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

      ctx.strokeStyle = `rgba(95, 205, 230, ${0.10 + baseGlow * 0.05 + active * 0.35})`;
      ctx.lineWidth = 0.85 + active * 0.5;
      ctx.lineCap = "round";

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(xb, yb);
      ctx.stroke();
    }

    ctx.fillStyle = `rgba(125, 230, 245, ${0.26 + baseGlow * 0.15 + active * 0.22})`;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius + baseGlow * 0.35 + active * 0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(220, 255, 255, ${0.18 + active * 0.25})`;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius * 0.28, 0, Math.PI * 2);
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
