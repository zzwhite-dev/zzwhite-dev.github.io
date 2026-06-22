(function () {
  const canvas = document.createElement("canvas");
  canvas.id = "neural-background";
  document.body.prepend(canvas);

  const ctx = canvas.getContext("2d");

  const SETTINGS = {
    neuronCount: 72,
    maxConnectionDistance: 250,
    minConnections: 2,
    maxConnections: 4,
    driftSpeed: 0.16,
    ambientFireEveryMs: 1400,
    maxPropagationDepth: 2,
    signalSpeedMin: 0.016,
    signalSpeedMax: 0.028,
    dendriteCountMin: 5,
    dendriteCountMax: 8,
    dendriteLengthMin: 24,
    dendriteLengthMax: 48,
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
      const branchAngle = angle + (Math.random() > 0.5 ? 0.65 : -0.65);
      const branchLength = 8 + Math.random() * 14;

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
      radius: 3.6 + Math.random() * 2.6,
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

          const curveSeed = (((i * 37 + j * 19) % 100) / 100 - 0.5) * 24;

          const edge = {
            i,
            j,
            curve: curveSeed,
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
        prevT: 0,
        delay: order * 5 + Math.random() * 10,
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
      n.x += n.vx;
      n.y += n.vy;
      n.phase += 0.02;
      n.flash *= 0.94;
      n.cooldown *= 0.96;

      if (n.x < -60 || n.x > width + 60) n.vx *= -1;
      if (n.y < -60 || n.y > height + 60) n.vy *= -1;

      if (mouse.x !== null) {
        const dx = n.x - mouse.x;
        const dy = n.y - mouse.y;
        const d = Math.hypot(dx, dy);

        if (d < 120 && d > 0) {
          n.x += dx / 90;
          n.y += dy / 90;
        }
      }
    }
  }

  function updateSignals() {
    for (let i = signals.length - 1; i >= 0; i--) {
      const s = signals[i];

      if (s.delay > 0) {
        s.delay -= 1;
        continue;
      }

      s.prevT = s.t;
      s.t += s.speed;

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
      const alpha = Math.max(0.05, 1 - d / SETTINGS.maxConnectionDistance) * 0.16;

      ctx.strokeStyle = `rgba(70, 170, 205, ${alpha})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
      ctx.stroke();
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

      const head = quadraticPoint(a, c, b, Math.min(1, s.t));
      const tail = quadraticPoint(a, c, b, Math.max(0, s.t - 0.08));

      ctx.strokeStyle = "rgba(170, 245, 255, 0.9)";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();

      ctx.fillStyle = "rgba(210, 255, 255, 0.95)";
      ctx.beginPath();
      ctx.arc(head.x, head.y, 2.4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(140, 235, 255, 0.22)";
      ctx.beginPath();
      ctx.arc(head.x, head.y, 6.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawNeuron(n) {
    const glow = 0.35 + 0.65 * Math.sin(n.phase);
    const active = Math.min(1, n.flash);

    for (const d of n.dendrites) {
      const x1 = n.x + Math.cos(d.angle) * n.radius;
      const y1 = n.y + Math.sin(d.angle) * n.radius;
      const x2 = n.x + Math.cos(d.angle) * d.length;
      const y2 = n.y + Math.sin(d.angle) * d.length;
      const xb = x2 + Math.cos(d.branchAngle) * d.branchLength;
      const yb = y2 + Math.sin(d.branchAngle) * d.branchLength;

      ctx.strokeStyle = `rgba(95, 205, 230, ${0.12 + glow * 0.05 + active * 0.15})`;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(xb, yb);
      ctx.stroke();
    }

    ctx.fillStyle = `rgba(125, 230, 245, ${0.32 + glow * 0.22 + active * 0.4})`;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius + glow * 0.45 + active * 1.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(225, 255, 255, ${0.32 + active * 0.45})`;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius * 0.34, 0, Math.PI * 2);
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
    if (frameCounter % 45 === 0) {
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
