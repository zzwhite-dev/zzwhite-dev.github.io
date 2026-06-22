(function () {
  const canvas = document.createElement("canvas");
  canvas.id = "neural-background";
  document.body.prepend(canvas);

  const ctx = canvas.getContext("2d");

  let width;
  let height;
  let neurons = [];
  let pulses = [];

  const neuronCount = 42;
  const maxConnectionDistance = 190;
  const mouse = { x: null, y: null };

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    neurons = Array.from({ length: neuronCount }, () => createNeuron());
  }

  function createNeuron(x, y) {
    const dendrites = Array.from({ length: 4 + Math.floor(Math.random() * 4) }, () => ({
      angle: Math.random() * Math.PI * 2,
      length: 14 + Math.random() * 22,
      branch: 6 + Math.random() * 10,
    }));

    return {
      x: x ?? Math.random() * width,
      y: y ?? Math.random() * height,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      radius: 3.2 + Math.random() * 2.2,
      phase: Math.random() * Math.PI * 2,
      dendrites,
    };
  }

  function drawNeuron(n) {
    n.phase += 0.025;
    const glow = 0.45 + 0.55 * Math.sin(n.phase);

    // dendrite arms
    for (const d of n.dendrites) {
      const x1 = n.x + Math.cos(d.angle) * n.radius;
      const y1 = n.y + Math.sin(d.angle) * n.radius;
      const x2 = n.x + Math.cos(d.angle) * d.length;
      const y2 = n.y + Math.sin(d.angle) * d.length;

      ctx.strokeStyle = `rgba(110, 220, 240, ${0.16 + glow * 0.08})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // tiny secondary branch
      const branchAngle = d.angle + (Math.random() > 0.5 ? 0.55 : -0.55);
      const xb = x2 + Math.cos(branchAngle) * d.branch;
      const yb = y2 + Math.sin(branchAngle) * d.branch;

      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(xb, yb);
      ctx.stroke();
    }

    // soma/cell body
    ctx.fillStyle = `rgba(130, 230, 245, ${0.38 + glow * 0.35})`;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius + glow * 0.8, 0, Math.PI * 2);
    ctx.fill();

    // inner nucleus dot
    ctx.fillStyle = `rgba(230, 255, 255, ${0.35 + glow * 0.25})`;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  function updateNeuron(n) {
    n.x += n.vx;
    n.y += n.vy;

    if (n.x < -30 || n.x > width + 30) n.vx *= -1;
    if (n.y < -30 || n.y > height + 30) n.vy *= -1;

    if (mouse.x !== null) {
      const dx = n.x - mouse.x;
      const dy = n.y - mouse.y;
      const d = Math.sqrt(dx * dx + dy * dy);

      if (d < 120) {
        n.x += dx / 85;
        n.y += dy / 85;
      }
    }
  }

  function drawConnections() {
    for (let i = 0; i < neurons.length; i++) {
      for (let j = i + 1; j < neurons.length; j++) {
        const a = neurons[i];
        const b = neurons[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < maxConnectionDistance) {
          const opacity = 1 - distance / maxConnectionDistance;

          ctx.strokeStyle = `rgba(85, 190, 220, ${opacity * 0.17})`;
          ctx.lineWidth = 0.9;

          ctx.beginPath();
          ctx.moveTo(a.x, a.y);

          // slight curve so it feels more organic than straight geometry
          const mx = (a.x + b.x) / 2 + Math.sin(a.phase) * 10;
          const my = (a.y + b.y) / 2 + Math.cos(b.phase) * 10;

          ctx.quadraticCurveTo(mx, my, b.x, b.y);
          ctx.stroke();
        }
      }
    }
  }

  function drawPulses() {
    pulses = pulses.filter((p) => p.life < 1);

    for (const p of pulses) {
      p.life += 0.018;

      const radius = p.life * 85;
      const opacity = 1 - p.life;

      ctx.strokeStyle = `rgba(140, 230, 255, ${opacity * 0.35})`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    for (const n of neurons) {
      updateNeuron(n);
    }

    drawConnections();

    for (const n of neurons) {
      drawNeuron(n);
    }

    drawPulses();

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
    neurons.push(createNeuron(e.clientX, e.clientY));
    pulses.push({ x: e.clientX, y: e.clientY, life: 0 });

    if (neurons.length > 60) {
      neurons.shift();
    }
  });

  resize();
  draw();
})();
