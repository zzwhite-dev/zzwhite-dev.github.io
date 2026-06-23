(function () {
  const canvas = document.createElement("canvas");
  canvas.id = "neural-background";
  document.body.prepend(canvas);

  const ctx = canvas.getContext("2d");

  const SETTINGS = {
    neuronCount: 28,
    maxTargetsPerNeuron: 2,
    maxConnectionDistance: 340,

    ambientFireEveryMs: 1800,
    maxPropagationDepth: 2,

    signalSpeedMin: 0.005,
    signalSpeedMax: 0.010,
    signalTailLength: 0.26,

    homeDriftSpeed: 0.006,
    swayRadius: 5.5,

    connectionRefreshFrames: 420,
  };

  let width;
  let height;
  let neurons = [];
  let edges = [];
  let signals = [];
  let lastAmbientFire = 0;
  let frameCounter = 0;

  const mouse = { x: null, y: null };

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function pointLerp(a, b, t) {
    return {
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
    };
  }

  function angleWrap(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    buildScene();
  }

  function buildScene() {
    neurons = Array.from({ length: SETTINGS.neuronCount }, () => createNeuron());
    buildEdges();
  }

  function createNeuron(x, y) {
    const homeX = x ?? rand(60, width - 60);
    const homeY = y ?? rand(60, height - 60);

    const orientation = rand(0, Math.PI * 2);
    const somaRadius = rand(11, 17);

    const somaPoints = [];
    const somaPointCount = 16;
    for (let i = 0; i < somaPointCount; i++) {
      const a = (i / somaPointCount) * Math.PI * 2;
      const r = somaRadius * rand(0.82, 1.20);
      somaPoints.push({ angle: a, radius: r });
    }

    const dendrites = [];
    const dendriteCount = Math.floor(rand(6, 10));
    for (let i = 0; i < dendriteCount; i++) {
      const local = rand(-1.55, 1.55);
      const angle = orientation + Math.PI + local;
      const len1 = rand(12, 22);
      const len2 = rand(8, 18);
      const bend = rand(-0.45, 0.45);
      const branch = Math.random() > 0.5 ? 1 : -1;

      dendrites.push({
        angle,
        len1,
        len2,
        bend,
        branch,
      });
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
      swaySpeedX: rand(0.0016, 0.0031),
      swaySpeedY: rand(0.0016, 0.0031),

      orientation,
      orientationPhase: rand(0, Math.PI * 2),
      orientationSpeed: rand(0.0008, 0.0018),

      somaRadius,
      somaPoints,
      dendrites,

      flash: 0,
      cooldown: 0,
      phase: rand(0, Math.PI * 2),

      outgoing: [],
      incoming: [],
    };
  }

  function getSomaBoundaryPoint(neuron, angle) {
    let bestPoint = neuron.somaPoints[0];
    let best = Infinity;

    for (const p of neuron.somaPoints) {
      const d = Math.abs(angleWrap(p.angle - angle));
      if (d < best) {
        best = d;
        bestPoint = p;
      }
    }

    return {
      x: neuron.x + Math.cos(angle) * bestPoint.radius,
      y: neuron.y + Math.sin(angle) * bestPoint.radius,
    };
  }

  function buildOrganicPath(aNeuron, bNeuron) {
    const axonAngle = aNeuron.orientation;
    const dendriteAngle = bNeuron.orientation + Math.PI;

    const start = getSomaBoundaryPoint(aNeuron, axonAngle);
    const end = getSomaBoundaryPoint(bNeuron, dendriteAngle);

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy) || 1;

    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;

    const p1 = {
      x: start.x + Math.cos(axonAngle) * rand(30, 65) + nx * rand(-8, 8),
      y: start.y + Math.sin(axonAngle) * rand(30, 65) + ny * rand(-8, 8),
    };

    const midBias = rand(-32, 32);
    const p2 = {
      x: lerp(start.x, end.x, 0.42) + nx * midBias,
      y: lerp(start.y, end.y, 0.42) + ny * midBias,
    };

    const p3 = {
      x: lerp(start.x, end.x, 0.72) + nx * rand(-20, 20),
      y: lerp(start.y, end.y, 0.72) + ny * rand(-20, 20),
    };

    const p4 = {
      x: end.x + Math.cos(dendriteAngle) * rand(10, 20),
      y: end.y + Math.sin(dendriteAngle) * rand(10, 20),
    };

    const raw = [start, p1, p2, p3, p4, end];
    return sampleSmoothPath(raw, 18);
  }

  function sampleSmoothPath(points, subdivisions) {
    const sampled = [];

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];

      for (let j = 0; j < subdivisions; j++) {
        const t = j / subdivisions;
        const t2 = t * t;
        const t3 = t2 * t;

        const x =
          0.5 *
          ((2 * p1.x) +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);

        const y =
          0.5 *
          ((2 * p1.y) +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);

        sampled.push({ x, y });
      }
    }

    sampled.push(points[points.length - 1]);
    return sampled;
  }

  function buildEdges() {
    edges = [];
    neurons.forEach((n) => {
      n.outgoing = [];
      n.incoming = [];
    });

    for (let i = 0; i < neurons.length; i++) {
      const source = neurons[i];
      const candidates = [];

      for (let j = 0; j < neurons.length; j++) {
        if (i === j) continue;

        const target = neurons[j];
        const d = dist(source, target);
        if (d > SETTINGS.maxConnectionDistance) continue;

        const toTarget = Math.atan2(target.y - source.y, target.x - source.x);
        const alignment = Math.abs(angleWrap(toTarget - source.orientation));
        candidates.push({ j, d, alignment });
      }

      candidates.sort((a, b) => {
        const scoreA = a.d + a.alignment * 50;
        const scoreB = b.d + b.alignment * 50;
        return scoreA - scoreB;
      });

      const count = Math.min(
        SETTINGS.maxTargetsPerNeuron,
        Math.max(1, candidates.length ? Math.floor(rand(1, SETTINGS.maxTargetsPerNeuron + 1)) : 0)
      );

      for (let k = 0; k < count; k++) {
        const c = candidates[k];
        if (!c) continue;

        const path = buildOrganicPath(source, neurons[c.j]);

        const edge = {
          from: i,
          to: c.j,
          path,
          glow: 0,
        };

        edges.push(edge);
        source.outgoing.push(c.j);
        neurons[c.j].incoming.push(i);
      }
    }
  }

  function findEdge(from, to) {
    return edges.find((e) => e.from === from && e.to === to);
  }

  function updateNeurons() {
    for (const n of neurons) {
      n.phase += 0.008;
      n.swayPhaseX += n.swaySpeedX;
      n.swayPhaseY += n.swaySpeedY;
      n.orientationPhase += n.orientationSpeed;

      n.homeX += n.homeVX;
      n.homeY += n.homeVY;

      if (n.homeX < 50 || n.homeX > width - 50) n.homeVX *= -1;
      if (n.homeY < 50 || n.homeY > height - 50) n.homeVY *= -1;

      if (mouse.x !== null) {
        const dx = n.homeX - mouse.x;
        const dy = n.homeY - mouse.y;
        const d = Math.hypot(dx, dy);
        if (d < 120 && d > 0) {
          n.homeX += dx / 240;
          n.homeY += dy / 240;
        }
      }

      n.x = n.homeX + Math.sin(n.swayPhaseX) * SETTINGS.swayRadius;
      n.y = n.homeY + Math.cos(n.swayPhaseY) * SETTINGS.swayRadius * 0.8;
      n.orientation += Math.sin(n.orientationPhase) * 0.0008;

      n.flash *= 0.95;
      n.cooldown *= 0.975;
    }

    for (const e of edges) {
      e.glow *= 0.93;
    }
  }

  function fireNeuron(index, depth = 0) {
    const n = neurons[index];
    if (!n) return;
    if (depth > 0 && n.cooldown > 0.55) return;

    n.flash = 1;
    n.cooldown = 1;

    if (depth >= SETTINGS.maxPropagationDepth) return;

    n.outgoing.forEach((target, order) => {
      signals.push({
        from: index,
        to: target,
        t: 0,
        delay: order * 8 + rand(0, 10),
        speed: rand(SETTINGS.signalSpeedMin, SETTINGS.signalSpeedMax),
        depth: depth + 1,
      });
    });
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
        fireNeuron(s.to, s.depth);
        signals.splice(i, 1);
      }
    }
  }

  function maybeAmbientFire(timestamp) {
    if (timestamp - lastAmbientFire > SETTINGS.ambientFireEveryMs) {
      const idx = Math.floor(Math.random() * neurons.length);
      fireNeuron(idx, 0);
      lastAmbientFire = timestamp;
    }
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

    fireNeuron(bestIndex, 0);
  }

  function drawPolyline(points, color, width) {
    if (points.length < 2) return;

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

  function samplePathSegment(path, t0, t1) {
    if (path.length < 2) return [];

    const out = [];
    const segs = path.length - 1;

    for (let i = 0; i < segs; i++) {
      const a = i / segs;
      const b = (i + 1) / segs;

      if (t1 < a || t0 > b) continue;

      const localT0 = Math.max(0, (t0 - a) / (b - a));
      const localT1 = Math.min(1, (t1 - a) / (b - a));

      const pA = pointLerp(path[i], path[i + 1], localT0);
      const pB = pointLerp(path[i], path[i + 1], localT1);

      if (!out.length) out.push(pA);
      out.push(pB);
    }

    return out;
  }

  function drawSignal(path, headT, tailLength) {
    const tailT = Math.max(0, headT - tailLength);

    const layers = 7;
    for (let i = 0; i < layers; i++) {
      const fracA = i / layers;
      const fracB = (i + 1) / layers;

      const segStart = lerp(tailT, headT, fracA);
      const segEnd = lerp(tailT, headT, fracB);
      const seg = samplePathSegment(path, segStart, segEnd);

      const alpha = lerp(0.06, 0.42, fracB);
      const width = lerp(1.0, 2.2, fracB);

      drawPolyline(seg, `rgba(214, 228, 232, ${alpha})`, width);
    }

    const head = samplePathSegment(path, Math.max(0, headT - 0.015), headT);
    drawPolyline(head, "rgba(235, 242, 244, 0.65)", 2.6);
  }

  function drawConnections() {
    for (const e of edges) {
      drawPolyline(e.path, "rgba(110, 126, 132, 0.10)", 0.8);

      if (e.glow > 0.02) {
        drawPolyline(e.path, `rgba(168, 184, 190, ${e.glow * 0.12})`, 1.15);
      }
    }
  }

  function drawSignals() {
    for (const s of signals) {
      if (s.delay > 0) continue;
      const edge = findEdge(s.from, s.to);
      if (!edge) continue;
      drawSignal(edge.path, Math.min(1, s.t), SETTINGS.signalTailLength);
    }
  }

  function drawNeuron(n) {
    const pulse = 0.35 + 0.65 * Math.sin(n.phase);
    const active = Math.min(1, n.flash);

    // dendrite fan
    for (const d of n.dendrites) {
      const start = getSomaBoundaryPoint(n, d.angle);

      const mid = {
        x: start.x + Math.cos(d.angle + d.bend * 0.5) * d.len1,
        y: start.y + Math.sin(d.angle + d.bend * 0.5) * d.len1,
      };

      const tip = {
        x: mid.x + Math.cos(d.angle + d.bend) * d.len2,
        y: mid.y + Math.sin(d.angle + d.bend) * d.len2,
      };

      const branch = {
        x: tip.x + Math.cos(d.angle + d.bend + d.branch * 0.75) * (d.len2 * 0.55),
        y: tip.y + Math.sin(d.angle + d.bend + d.branch * 0.75) * (d.len2 * 0.55),
      };

      ctx.strokeStyle = `rgba(118, 132, 138, ${0.10 + pulse * 0.02 + active * 0.16})`;
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

    // longer visible axon stub
    const axonStart = getSomaBoundaryPoint(n, n.orientation);
    const axonMid = {
      x: axonStart.x + Math.cos(n.orientation) * 18,
      y: axonStart.y + Math.sin(n.orientation) * 18,
    };
    const axonTip = {
      x: axonMid.x + Math.cos(n.orientation + Math.sin(n.phase) * 0.08) * 12,
      y: axonMid.y + Math.sin(n.orientation + Math.sin(n.phase) * 0.08) * 12,
    };

    ctx.strokeStyle = `rgba(122, 136, 142, ${0.10 + active * 0.18})`;
    ctx.lineWidth = 1.15 + active * 0.25;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(axonStart.x, axonStart.y);
    ctx.lineTo(axonMid.x, axonMid.y);
    ctx.lineTo(axonTip.x, axonTip.y);
    ctx.stroke();

    // irregular soma
    const blob = n.somaPoints.map((p) => ({
      x: n.x + Math.cos(p.angle) * p.radius,
      y: n.y + Math.sin(p.angle) * p.radius,
    }));

    ctx.fillStyle = `rgba(142, 154, 160, ${0.16 + pulse * 0.04 + active * 0.10})`;
    ctx.beginPath();
    ctx.moveTo(blob[0].x, blob[0].y);

    for (let i = 1; i < blob.length; i++) {
      const prev = blob[i - 1];
      const curr = blob[i];
      const mx = (prev.x + curr.x) / 2;
      const my = (prev.y + curr.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
    }

    const last = blob[blob.length - 1];
    const first = blob[0];
    const mx = (last.x + first.x) / 2;
    const my = (last.y + first.y) / 2;
    ctx.quadraticCurveTo(last.x, last.y, mx, my);
    ctx.closePath();
    ctx.fill();

    // nucleus
    ctx.fillStyle = `rgba(216, 226, 230, ${0.06 + active * 0.12})`;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.somaRadius * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw(timestamp = 0) {
    ctx.clearRect(0, 0, width, height);

    updateNeurons();

    frameCounter++;
    if (frameCounter % SETTINGS.connectionRefreshFrames === 0) {
      buildEdges();
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
