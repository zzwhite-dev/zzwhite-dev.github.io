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
    pointCount: 65,
    maxDistance: 140,
    maxLinksPerPoint: 3,

    driftSpeed: 0.018,
    swayRadius: 6,

    pointRadiusMin: 1.1,
    pointRadiusMax: 2.4,

    baseDotAlpha: 0.32,
    lineAlpha: 0.10,

    // electrical-signal palette (cool blue/cyan)
    dotColor: "150, 210, 255",
    lineColor: "110, 170, 210",
    pulseColor: "120, 230, 255",
    nodeFireColor: "180, 240, 255",

    ambientEventEveryMs: 1800,
    ambientHops: 3, // how many edges an ambient signal travels

    mouseRadius: 110,
    mouseRepelStrength: 18, // px of max push at center of radius

    pulseSpeed: 0.045, // fraction of edge length per frame
    pulseTrailAlpha: 0.9,
  };

  let width = 0;
  let height = 0;
  let points = [];
  let edges = []; // {a, b, d} precomputed adjacency, rebuilt occasionally
  let pulses = []; // traveling signals: {a, b, t, life}
  let lastAmbientEvent = 0;
  let lastEdgeRebuild = 0;

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
    rebuildEdges();
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

        fire: 0, // node "just received a signal" glow
      };
    });
    pulses = [];
  }

  // Build adjacency list once (and periodically), rather than every frame,
  // since point positions only drift slightly.
  function rebuildEdges() {
    edges = [];
    const adjacency = points.map(() => []);

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const candidates = [];

      for (let j = 0; j < points.length; j++) {
        if (j === i) continue;
        const d = dist(p, points[j]);
        if (d <= SETTINGS.maxDistance) candidates.push({ j, d });
      }

      candidates.sort((a, b) => a.d - b.d);
      candidates.slice(0, SETTINGS.maxLinksPerPoint).forEach((c) => {
        adjacency[i].push(c.j);
      });
    }

    const seen = new Set();
    for (let i = 0; i < points.length; i++) {
      for (const j of adjacency[i]) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ a: i, b: j });
      }
    }

    // index edges by node for fast lookup when a pulse needs to hop onward
    const byNode = points.map(() => []);
    edges.forEach((e, idx) => {
      byNode[e.a].push(idx);
      byNode[e.b].push(idx);
    });
    edges.byNode = byNode;
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

      // gentle repel from the cursor, like a probe disturbing the field
      if (mouse.x !== null) {
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const d = Math.hypot(dx, dy);

        if (d < SETTINGS.mouseRadius && d > 0.001) {
          const falloff = 1 - d / SETTINGS.mouseRadius;
          const push = (SETTINGS.mouseRepelStrength * falloff * falloff) / d;
          offsetX += dx * push;
          offsetY += dy * push;
        }
      }

      p.x = p.homeX + offsetX;
      p.y = p.homeY + offsetY;

      p.fire *= 0.93;
    }
  }

  // Spawn a traveling pulse along a specific edge, in a given direction (a->b)
  function spawnPulse(edgeIndex, forwardFromA) {
    const e = edges[edgeIndex];
    pulses.push({
      edgeIndex,
      from: forwardFromA ? e.a : e.b,
      to: forwardFromA ? e.b : e.a,
      t: 0,
      life: 1,
    });
  }

  function fireFromNode(nodeIndex, hopsLeft) {
    points[nodeIndex].fire = 1;
    if (hopsLeft <= 0) return;

    const candidateEdges = edges.byNode[nodeIndex] || [];
    if (candidateEdges.length === 0) return;

    // fire along 1-2 random outgoing edges to branch the signal
    const branchCount = Math.min(candidateEdges.length, Math.random() < 0.5 ? 1 : 2);
    const shuffled = [...candidateEdges].sort(() => Math.random() - 0.5);

    for (let k = 0; k < branchCount; k++) {
      const idx = shuffled[k];
      const e = edges[idx];
      const forwardFromA = e.a === nodeIndex;
      spawnPulse(idx, forwardFromA);
    }
  }

  function updatePulses() {
    for (let i = pulses.length - 1; i >= 0; i--) {
      const pulse = pulses[i];
      pulse.t += SETTINGS.pulseSpeed;

      if (pulse.t >= 1) {
        // reached destination node: light it up and maybe continue onward
        const arrivedAt = pulse.to;
        points[arrivedAt].fire = Math.max(points[arrivedAt].fire, 1);

        if (pulse.hopsLeft === undefined) pulse.hopsLeft = SETTINGS.ambientHops - 1;

        if (pulse.hopsLeft > 0 && Math.random() < 0.85) {
          const candidateEdges = (edges.byNode[arrivedAt] || []).filter(
            (idx) => idx !== pulse.edgeIndex
          );
          if (candidateEdges.length > 0) {
            const idx = candidateEdges[Math.floor(rand(0, candidateEdges.length))];
            const e = edges[idx];
            const forwardFromA = e.a === arrivedAt;
            pulses.push({
              edgeIndex: idx,
              from: forwardFromA ? e.a : e.b,
              to: forwardFromA ? e.b : e.a,
              t: 0,
              life: 1,
              hopsLeft: pulse.hopsLeft - 1,
            });
          }
        }

        pulses.splice(i, 1);
        continue;
      }
    }
  }

  function maybeAmbientEvent(timestamp) {
    if (timestamp - lastAmbientEvent > SETTINGS.ambientEventEveryMs) {
      const nodeIndex = Math.floor(rand(0, points.length));
      fireFromNode(nodeIndex, SETTINGS.ambientHops);
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

    fireFromNode(bestIndex, SETTINGS.ambientHops + 1);
  }

  function drawLines() {
    for (const e of edges) {
      const p = points[e.a];
      const q = points[e.b];
      const d = dist(p, q);
      const distanceFactor = 1 - d / SETTINGS.maxDistance;
      const glow = Math.max(p.fire, q.fire) * 0.18;

      ctx.strokeStyle = `rgba(${SETTINGS.lineColor}, ${
        SETTINGS.lineAlpha * distanceFactor + glow
      })`;
      ctx.lineWidth = glow > 0.05 ? 1.1 : 0.7;

      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
  }

  function drawPulses() {
    for (const pulse of pulses) {
      const e = edges[pulse.edgeIndex];
      if (!e) continue;
      const from = points[pulse.from];
      const to = points[pulse.to];
      if (!from || !to) continue;

      const x = from.x + (to.x - from.x) * pulse.t;
      const y = from.y + (to.y - from.y) * pulse.t;

      // short glowing trail behind the pulse head
      const trailT = Math.max(0, pulse.t - 0.12);
      const tx = from.x + (to.x - from.x) * trailT;
      const ty = from.y + (to.y - from.y) * trailT;

      ctx.strokeStyle = `rgba(${SETTINGS.pulseColor}, ${SETTINGS.pulseTrailAlpha})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(x, y);
      ctx.stroke();

      // bright head of the signal
      ctx.fillStyle = `rgba(${SETTINGS.pulseColor}, 0.95)`;
      ctx.beginPath();
      ctx.arc(x, y, 2.1, 0, Math.PI * 2);
      ctx.fill();

      // soft halo
      ctx.fillStyle = `rgba(${SETTINGS.pulseColor}, 0.12)`;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawPoints() {
    for (const p of points) {
      const pulse = 0.5 + 0.5 * Math.sin(p.pulsePhase);
      const alpha = SETTINGS.baseDotAlpha + pulse * 0.08 + p.fire * 0.5;

      ctx.fillStyle = `rgba(${SETTINGS.dotColor}, ${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius + p.fire * 1.1, 0, Math.PI * 2);
      ctx.fill();

      if (p.fire > 0.05) {
        ctx.fillStyle = `rgba(${SETTINGS.nodeFireColor}, ${p.fire * 0.10})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (p.radius + 1.5) * 4.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function draw(timestamp = 0) {
    ctx.clearRect(0, 0, width, height);

    updatePoints();
    updatePulses();
    maybeAmbientEvent(timestamp);

    // periodically rebuild adjacency since points drift over time
    if (timestamp - lastEdgeRebuild > 4000) {
      rebuildEdges();
      lastEdgeRebuild = timestamp;
    }

    drawLines();
    drawPulses();
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
