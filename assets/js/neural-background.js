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

    // local orbiting: each point loops in a small circle around its home position
    orbitRadiusMin: 5,
    orbitRadiusMax: 14,
    orbitSpeedMin: 0.004,
    orbitSpeedMax: 0.012,

    // global rotation: the entire field slowly spins around the canvas center
    globalRotationSpeed: 0.00006, // radians per ms

    pointRadiusMin: 1.1,
    pointRadiusMax: 2.4,

    baseDotAlpha: 0.32,
    lineAlpha: 0.10,

    // electrical-signal palette (cool blue/cyan)
    dotColor: "150, 210, 255",
    lineColor: "110, 170, 210",
    pulseColor: "120, 230, 255",
    nodeFireColor: "180, 240, 255",
    constellationColor: "140, 200, 255",

    ambientEventEveryMs: 1800,
    ambientHops: 3, // how many edges an ambient signal travels

    mouseRadius: 130,
    mouseRepelStrength: 18, // px of max push at center of radius
    mouseGlowRadius: 160, // wider than repel radius, so glow announces before the push
    mouseGlowStrength: 0.85, // max added alpha boost at zero distance

    pulseSpeed: 0.045, // fraction of edge length per frame
    pulseTrailAlpha: 0.9,

    // constellation polygons: translucent shapes that form & dissolve between clusters
    constellationEveryMs: 2600,
    constellationMaxConcurrent: 3,
    constellationFadeInMs: 900,
    constellationHoldMs: 1100,
    constellationFadeOutMs: 1400,
    constellationMaxAlpha: 0.07,
  };

  let width = 0;
  let height = 0;
  let points = [];
  let edges = []; // {a, b, d} precomputed adjacency, rebuilt occasionally
  let pulses = []; // traveling signals: {a, b, t, life}
  let constellations = []; // forming/dissolving polygons between clusters
  let lastAmbientEvent = 0;
  let lastConstellationEvent = 0;
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

        orbitPhase: rand(0, Math.PI * 2),
        orbitSpeed: rand(SETTINGS.orbitSpeedMin, SETTINGS.orbitSpeedMax),
        orbitRadius: rand(SETTINGS.orbitRadiusMin, SETTINGS.orbitRadiusMax),

        radius: rand(SETTINGS.pointRadiusMin, SETTINGS.pointRadiusMax),
        pulsePhase: rand(0, Math.PI * 2),
        pulseSpeed: rand(0.003, 0.007),

        fire: 0, // node "just received a signal" glow
        mouseGlow: 0, // brightness from cursor proximity (smoothed)
      };
    });
    pulses = [];
    constellations = [];
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

  function updatePoints(dt) {
    const cx = width / 2;
    const cy = height / 2;
    const rotStep = SETTINGS.globalRotationSpeed * dt;
    const cosR = Math.cos(rotStep);
    const sinR = Math.sin(rotStep);

    for (const p of points) {
      // drift (bounces off soft walls)
      p.homeX += p.vx;
      p.homeY += p.vy;

      if (p.homeX < 20 || p.homeX > width - 20) p.vx *= -1;
      if (p.homeY < 20 || p.homeY > height - 20) p.vy *= -1;

      // global rotation: rotate home position around canvas center
      const rx = p.homeX - cx;
      const ry = p.homeY - cy;
      p.homeX = cx + rx * cosR - ry * sinR;
      p.homeY = cy + rx * sinR + ry * cosR;

      // local orbit: small circular loop around the (rotated) home position
      p.orbitPhase += p.orbitSpeed;
      const orbitX = Math.cos(p.orbitPhase) * p.orbitRadius;
      const orbitY = Math.sin(p.orbitPhase) * p.orbitRadius;

      p.pulsePhase += p.pulseSpeed;

      let offsetX = orbitX;
      let offsetY = orbitY;

      // gentle repel from the cursor, like a probe disturbing the field
      let proximity = 0;
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

        if (d < SETTINGS.mouseGlowRadius) {
          proximity = 1 - d / SETTINGS.mouseGlowRadius;
        }
      }

      p.x = p.homeX + offsetX;
      p.y = p.homeY + offsetY;

      p.fire *= 0.93;

      // smooth the glow so it doesn't snap on/off as the cursor moves
      const targetGlow = proximity * proximity * SETTINGS.mouseGlowStrength;
      p.mouseGlow += (targetGlow - p.mouseGlow) * 0.18;
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

  // Find a small mutually-close cluster (3-4 nodes) starting from a seed node,
  // reusing the cached adjacency so this stays cheap.
  function findCluster(seedIndex) {
    const neighborIdxs = (edges.byNode[seedIndex] || []).map((edgeIdx) => {
      const e = edges[edgeIdx];
      return e.a === seedIndex ? e.b : e.a;
    });

    if (neighborIdxs.length < 2) return null;

    const shuffled = [...neighborIdxs].sort(() => Math.random() - 0.5);
    const clusterSize = Math.random() < 0.5 ? 3 : 4;
    const chosen = [seedIndex, ...shuffled.slice(0, clusterSize - 1)];

    if (chosen.length < 3) return null;
    return chosen;
  }

  function maybeConstellationEvent(timestamp) {
    if (
      timestamp - lastConstellationEvent > SETTINGS.constellationEveryMs &&
      constellations.length < SETTINGS.constellationMaxConcurrent
    ) {
      const seedIndex = Math.floor(rand(0, points.length));
      const cluster = findCluster(seedIndex);

      if (cluster) {
        constellations.push({
          indices: cluster,
          startedAt: timestamp,
        });
      }
      lastConstellationEvent = timestamp;
    }
  }

  function updateConstellations(timestamp) {
    const totalLife =
      SETTINGS.constellationFadeInMs +
      SETTINGS.constellationHoldMs +
      SETTINGS.constellationFadeOutMs;

    for (let i = constellations.length - 1; i >= 0; i--) {
      const c = constellations[i];
      const age = timestamp - c.startedAt;

      if (age >= totalLife) {
        constellations.splice(i, 1);
        continue;
      }

      if (age < SETTINGS.constellationFadeInMs) {
        c.alpha = age / SETTINGS.constellationFadeInMs;
      } else if (age < SETTINGS.constellationFadeInMs + SETTINGS.constellationHoldMs) {
        c.alpha = 1;
      } else {
        const fadeAge = age - SETTINGS.constellationFadeInMs - SETTINGS.constellationHoldMs;
        c.alpha = 1 - fadeAge / SETTINGS.constellationFadeOutMs;
      }
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

  function drawConstellations() {
    for (const c of constellations) {
      const pts = c.indices.map((idx) => points[idx]).filter(Boolean);
      if (pts.length < 3) continue;

      ctx.fillStyle = `rgba(${SETTINGS.constellationColor}, ${
        SETTINGS.constellationMaxAlpha * c.alpha
      })`;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let k = 1; k < pts.length; k++) {
        ctx.lineTo(pts[k].x, pts[k].y);
      }
      ctx.closePath();
      ctx.fill();

      // faint outline so the shape reads even at low alpha
      ctx.strokeStyle = `rgba(${SETTINGS.constellationColor}, ${
        SETTINGS.constellationMaxAlpha * c.alpha * 3.5
      })`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
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
      const glowTotal = p.fire + p.mouseGlow;
      const alpha = SETTINGS.baseDotAlpha + pulse * 0.08 + Math.min(glowTotal, 1) * 0.5;

      ctx.fillStyle = `rgba(${SETTINGS.dotColor}, ${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius + glowTotal * 1.1, 0, Math.PI * 2);
      ctx.fill();

      if (glowTotal > 0.05) {
        ctx.fillStyle = `rgba(${SETTINGS.nodeFireColor}, ${Math.min(glowTotal, 1) * 0.10})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (p.radius + 1.5) * 4.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  let lastTimestamp = 0;

  function draw(timestamp = 0) {
    const dt = lastTimestamp ? timestamp - lastTimestamp : 16.7;
    lastTimestamp = timestamp;

    ctx.clearRect(0, 0, width, height);

    updatePoints(dt);
    updatePulses();
    updateConstellations(timestamp);
    maybeAmbientEvent(timestamp);
    maybeConstellationEvent(timestamp);

    // periodically rebuild adjacency since points drift over time
    if (timestamp - lastEdgeRebuild > 4000) {
      rebuildEdges();
      lastEdgeRebuild = timestamp;
    }

    drawConstellations();
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
