import React, { useEffect, useMemo, useRef, useState } from "react";

const CONSTANTS = {
  sv_maxspeed: 250,
  sv_accelerate: 5.5,
  sv_friction: 5.2
};

const WEAPONS = {
  knife: { name: "Knife", maxSpeed: 250 },
  ak47: { name: "AK-47", maxSpeed: 215 },
  m4a4: { name: "M4A4", maxSpeed: 225 },
  awp: { name: "AWP", maxSpeed: 200 }
};

const KEY_TO_AXIS = {
  KeyW: [0, -1],
  KeyA: [-1, 0],
  KeyS: [0, 1],
  KeyD: [1, 0],
  ArrowUp: [0, -1],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowRight: [1, 0]
};

const FEEDBACK_MS = 980;
const DECAL_MS = 10000;
const MAX_DECALS = 40;
const TREE_SHAPES = [
  { x: 70, y: 32, r: 36 },
  { x: 320, y: 42, r: 44 },
  { x: 560, y: 29, r: 35 },
  { x: 830, y: 46, r: 47 },
  { x: 1090, y: 34, r: 39 }
];

function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createSimulation(now) {
  return {
    lastFrame: now,
    world: { w: 1280, h: 720 },
    pressed: new Set(),
    player: {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0
    },
    target: {
      active: false,
      side: "left",
      worldX: -210,
      worldY: 0,
      nextSpawnAt: now + randomInRange(450, 1000),
      expiresAt: 0
    },
    decals: []
  };
}

function getWishDirection(pressed) {
  let x = 0;
  let y = 0;

  for (const code of pressed) {
    const axis = KEY_TO_AXIS[code];
    if (!axis) continue;
    x += axis[0];
    y += axis[1];
  }

  const length = Math.hypot(x, y);
  if (length === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: x / length,
    y: y / length
  };
}

function applyGroundFriction(player, dt) {
  const speed = Math.hypot(player.vx, player.vy);
  if (speed < 0.0001) {
    player.vx = 0;
    player.vy = 0;
    return;
  }

  const drop = speed * CONSTANTS.sv_friction * dt;
  const nextSpeed = Math.max(0, speed - drop);
  const scale = nextSpeed / speed;

  player.vx *= scale;
  player.vy *= scale;

  if (nextSpeed < 0.001) {
    player.vx = 0;
    player.vy = 0;
  }
}

function accelerate(player, wishDir, wishSpeed, dt) {
  const currentSpeed = player.vx * wishDir.x + player.vy * wishDir.y;
  const addSpeed = wishSpeed - currentSpeed;
  if (addSpeed <= 0) return;

  let accelSpeed = CONSTANTS.sv_accelerate * dt * wishSpeed;
  if (accelSpeed > addSpeed) accelSpeed = addSpeed;

  player.vx += accelSpeed * wishDir.x;
  player.vy += accelSpeed * wishDir.y;
}

function clampVelocity(player, maxSpeed) {
  const speed = Math.hypot(player.vx, player.vy);
  if (speed <= maxSpeed) return;

  const scale = maxSpeed / speed;
  player.vx *= scale;
  player.vy *= scale;
}

function stepMovement(sim, dt, maxWeaponSpeed) {
  const wishDir = getWishDirection(sim.pressed);

  applyGroundFriction(sim.player, dt);
  if (wishDir.x !== 0 || wishDir.y !== 0) {
    accelerate(sim.player, wishDir, maxWeaponSpeed, dt);
  }
  clampVelocity(sim.player, maxWeaponSpeed);

  sim.player.x += sim.player.vx * dt;
  sim.player.y += sim.player.vy * dt;

  const clampedX = clamp(sim.player.x, -260, 260);
  const clampedY = clamp(sim.player.y, -120, 120);

  if (clampedX !== sim.player.x) {
    sim.player.x = clampedX;
    sim.player.vx = 0;
  }
  if (clampedY !== sim.player.y) {
    sim.player.y = clampedY;
    sim.player.vy = 0;
  }
}

function isTargetVisible(sim) {
  if (!sim.target.active) return false;
  const revealThreshold = 32;

  if (sim.target.side === "left") {
    return sim.player.x < -revealThreshold;
  }
  return sim.player.x > revealThreshold;
}

function spawnTarget(sim, now) {
  const side = Math.random() < 0.5 ? "left" : "right";

  sim.target.active = true;
  sim.target.side = side;
  sim.target.worldX = side === "left" ? randomInRange(-250, -180) : randomInRange(180, 250);
  sim.target.worldY = randomInRange(-22, 26);
  sim.target.expiresAt = now + randomInRange(1500, 2700);
}

function stepTarget(sim, now) {
  if (!sim.target.active && now >= sim.target.nextSpawnAt) {
    spawnTarget(sim, now);
  }

  if (sim.target.active && now >= sim.target.expiresAt) {
    sim.target.active = false;
    sim.target.nextSpawnAt = now + randomInRange(800, 1700);
  }

  sim.decals = sim.decals.filter((entry) => now - entry.createdAt <= DECAL_MS);
}

function drawScene(ctx, sim) {
  const { w, h } = sim.world;
  const now = performance.now();
  const speed = Math.hypot(sim.player.vx, sim.player.vy);
  const bob = Math.sin(now * 0.009) * Math.min(2.5, speed * 0.025);

  const horizon = h * 0.33 + sim.player.y * 0.22 + bob;
  const fenceTop = horizon - h * 0.08;
  const fenceBottom = horizon + h * 0.30;
  const farShift = -sim.player.x * 0.82;

  ctx.clearRect(0, 0, w, h);

  const sky = ctx.createLinearGradient(0, 0, 0, fenceTop);
  sky.addColorStop(0, "#6a8ea6");
  sky.addColorStop(1, "#a6bdcb");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, fenceTop);

  for (const tree of TREE_SHAPES) {
    const span = w + 340;
    let treeX = (tree.x + farShift * 0.35) % span;
    if (treeX < 0) treeX += span;
    treeX -= 170;

    ctx.fillStyle = "rgba(60, 90, 62, 0.55)";
    ctx.beginPath();
    ctx.arc(treeX, fenceTop - tree.y, tree.r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#62707f";
  ctx.fillRect(0, fenceTop, w, fenceBottom - fenceTop);

  const plankSpacing = 26;
  for (
    let x = -plankSpacing + (((farShift % plankSpacing) + plankSpacing) % plankSpacing);
    x <= w + plankSpacing;
    x += plankSpacing
  ) {
    ctx.fillStyle = "rgba(42, 53, 67, 0.43)";
    ctx.fillRect(x, fenceTop + 12, 2, fenceBottom - fenceTop - 18);
  }

  ctx.fillStyle = "rgba(42, 50, 61, 0.60)";
  ctx.fillRect(0, fenceTop + 6, w, 10);
  ctx.fillRect(0, fenceBottom - 12, w, 10);

  const ground = ctx.createLinearGradient(0, fenceBottom, 0, h);
  ground.addColorStop(0, "#8f7b62");
  ground.addColorStop(1, "#715f4a");
  ctx.fillStyle = ground;
  ctx.fillRect(0, fenceBottom, w, h - fenceBottom);

  ctx.strokeStyle = "rgba(95, 82, 66, 0.42)";
  for (let y = fenceBottom + 12; y < h; y += 18) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y + 8);
    ctx.stroke();
  }

  const leftLabelX = w * 0.18 + farShift * 0.2;
  const rightLabelX = w * 0.64 + farShift * 0.2;
  ctx.font = `${Math.max(15, w * 0.016)}px "JetBrains Mono", monospace`;
  ctx.fillStyle = "#ff315a";
  ctx.fillText("No Counter-Strafe", leftLabelX, fenceTop + 38);
  ctx.fillStyle = "#2fff73";
  ctx.fillText("Proper Counter-Strafe", rightLabelX, fenceTop + 38);

  const leftAnchorY = fenceTop + 56;
  const rightAnchorY = fenceTop + 56;
  for (const marker of sim.decals) {
    const age = now - marker.createdAt;
    const alpha = clamp(1 - age / DECAL_MS, 0, 1);

    const anchorX = marker.group === "proper" ? rightLabelX + 18 : leftLabelX + 18;
    const anchorY = marker.group === "proper" ? rightAnchorY : leftAnchorY;
    const x = anchorX + marker.dx + farShift * 0.08;
    const y = anchorY + marker.dy;

    ctx.fillStyle = `rgba(255, 0, 212, ${0.9 * alpha})`;
    ctx.fillRect(x, y, 7, 7);
    ctx.strokeStyle = `rgba(255, 173, 244, ${0.7 * alpha})`;
    ctx.strokeRect(x - 0.6, y - 0.6, 8.2, 8.2);
  }

  if (sim.target.active && isTargetVisible(sim)) {
    const tx = w * 0.5 + (sim.target.worldX - sim.player.x) * 1.32;
    const ty = fenceTop + (fenceBottom - fenceTop) * 0.54 + sim.target.worldY;

    ctx.beginPath();
    ctx.arc(tx, ty, 18, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(68, 255, 153, 0.95)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(tx, ty, 28, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(68, 255, 153, 0.38)";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(tx, ty, 6, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 15, 205, 0.92)";
    ctx.fill();
  }

  const pillarWidth = Math.max(92, w * 0.17);
  const pillarX = w * 0.5 - pillarWidth * 0.5 - sim.player.x * 3.5;
  ctx.fillStyle = "#4f5f70";
  ctx.fillRect(pillarX, -2, pillarWidth, h * 0.84);

  ctx.fillStyle = "rgba(31, 39, 47, 0.56)";
  for (let i = 0; i < 7; i += 1) {
    const shadeX = pillarX + i * (pillarWidth / 7);
    ctx.fillRect(shadeX, 0, 2, h * 0.84);
  }

  ctx.strokeStyle = "#708294";
  ctx.lineWidth = 2;
  ctx.strokeRect(pillarX, 0, pillarWidth, h * 0.84);

  const gunX = w * 0.56;
  const gunY = h * 0.90 + bob * 0.6;
  ctx.save();
  ctx.translate(gunX, gunY);
  ctx.rotate(-0.2);

  ctx.fillStyle = "#20252d";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w * 0.22, -14);
  ctx.lineTo(w * 0.26, -42);
  ctx.lineTo(w * 0.32, -45);
  ctx.lineTo(w * 0.34, -24);
  ctx.lineTo(w * 0.30, -8);
  ctx.lineTo(w * 0.18, 8);
  ctx.lineTo(w * 0.02, 16);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#323842";
  ctx.fillRect(w * 0.12, -28, w * 0.11, 15);
  ctx.fillRect(w * 0.26, -38, w * 0.06, 8);

  ctx.strokeStyle = "rgba(255, 42, 70, 0.75)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i += 1) {
    const offset = i * 26;
    ctx.beginPath();
    ctx.moveTo(w * 0.06 + offset, -6 - i * 0.6);
    ctx.lineTo(w * 0.08 + offset, -26 - i * 0.8);
    ctx.stroke();
  }
  ctx.restore();

  const cx = w * 0.5;
  const cy = h * 0.52;
  ctx.strokeStyle = "rgba(235, 241, 249, 0.92)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx - 9, cy);
  ctx.lineTo(cx + 9, cy);
  ctx.moveTo(cx, cy - 9);
  ctx.lineTo(cx, cy + 9);
  ctx.stroke();

  ctx.fillStyle = "rgba(10, 14, 20, 0.22)";
  ctx.fillRect(0, 0, w, h);
}

function scoreShot(speed, maxSpeed) {
  if (speed < 1) return 100;
  return clamp(100 - (speed / maxSpeed) * 100, 0, 100);
}

export default function App() {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const speedRef = useRef(0);
  const cleanupTimersRef = useRef([]);

  const simRef = useRef(null);
  if (!simRef.current) {
    simRef.current = createSimulation(performance.now());
  }

  const [weapon, setWeapon] = useState("knife");
  const [velocity, setVelocity] = useState(0);
  const [feedback, setFeedback] = useState([]);
  const [stats, setStats] = useState({
    shots: 0,
    accuracyTotal: 0,
    last: null
  });

  const weaponRef = useRef(weapon);
  useEffect(() => {
    weaponRef.current = weapon;
    clampVelocity(simRef.current.player, WEAPONS[weapon].maxSpeed);
  }, [weapon]);

  useEffect(() => {
    return () => {
      cleanupTimersRef.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const sim = simRef.current;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(640, Math.floor(rect.width));
      const h = Math.max(360, Math.floor(rect.height));

      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      sim.world.w = w;
      sim.world.h = h;
    };

    const onKeyDown = (event) => {
      if (event.target instanceof HTMLElement) {
        const tag = event.target.tagName;
        if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
      }

      if (KEY_TO_AXIS[event.code]) {
        sim.pressed.add(event.code);
        event.preventDefault();
      }
    };

    const onKeyUp = (event) => {
      if (KEY_TO_AXIS[event.code]) {
        sim.pressed.delete(event.code);
        event.preventDefault();
      }
    };

    const onBlur = () => {
      sim.pressed.clear();
    };

    const frame = (timestamp) => {
      let dt = (timestamp - sim.lastFrame) / 1000;
      sim.lastFrame = timestamp;
      dt = Math.min(dt, 0.033);

      const maxWeaponSpeed = WEAPONS[weaponRef.current].maxSpeed;
      stepMovement(sim, dt, maxWeaponSpeed);
      stepTarget(sim, timestamp);
      drawScene(ctx, sim);

      const nextSpeed = Math.hypot(sim.player.vx, sim.player.vy);
      if (Math.abs(nextSpeed - speedRef.current) >= 0.08) {
        speedRef.current = nextSpeed;
        setVelocity(nextSpeed);
      }

      rafRef.current = requestAnimationFrame(frame);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    rafRef.current = requestAnimationFrame((timestamp) => {
      sim.lastFrame = timestamp;
      rafRef.current = requestAnimationFrame(frame);
    });

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const averageAccuracy = useMemo(() => {
    if (stats.shots === 0) return 0;
    return stats.accuracyTotal / stats.shots;
  }, [stats]);

  const emitFeedback = (text, tone) => {
    const id = `${Date.now()}-${Math.random()}`;
    setFeedback((prev) => [...prev, { id, text, tone }]);

    const timer = setTimeout(() => {
      setFeedback((prev) => prev.filter((entry) => entry.id !== id));
    }, FEEDBACK_MS);

    cleanupTimersRef.current.push(timer);
  };

  const registerShotDecal = (accuracy) => {
    const sim = simRef.current;
    const nowValue = performance.now();

    sim.decals.push({
      createdAt: nowValue,
      group: accuracy >= 95 ? "proper" : "noCounter",
      dx: randomInRange(-64, 58),
      dy: randomInRange(0, 94)
    });

    if (sim.decals.length > MAX_DECALS) {
      sim.decals.splice(0, sim.decals.length - MAX_DECALS);
    }
  };

  const handleShot = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();

    const sim = simRef.current;
    const maxSpeed = WEAPONS[weaponRef.current].maxSpeed;
    const currentSpeed = Math.hypot(sim.player.vx, sim.player.vy);
    const accuracy = scoreShot(currentSpeed, maxSpeed);

    setStats((prev) => ({
      shots: prev.shots + 1,
      accuracyTotal: prev.accuracyTotal + accuracy,
      last: accuracy
    }));

    if (currentSpeed < 1) {
      emitFeedback("100% Perfect.", "good");
    } else {
      emitFeedback(`${Math.round(accuracy)}% Accurate - Too Fast!`, "bad");
    }

    registerShotDecal(accuracy);

    if (sim.target.active && isTargetVisible(sim)) {
      sim.target.active = false;
      sim.target.nextSpawnAt = performance.now() + randomInRange(220, 880);
    }
  };

  const resetSession = () => {
    const nowValue = performance.now();
    const sim = simRef.current;

    sim.player.x = 0;
    sim.player.y = 0;
    sim.player.vx = 0;
    sim.player.vy = 0;
    sim.pressed.clear();

    sim.target.active = false;
    sim.target.nextSpawnAt = nowValue + randomInRange(500, 1000);
    sim.target.expiresAt = 0;
    sim.decals = [];

    setStats({ shots: 0, accuracyTotal: 0, last: null });
    setFeedback([]);
    setVelocity(0);
    speedRef.current = 0;
  };

  const currentMaxSpeed = WEAPONS[weapon].maxSpeed;
  const velocityPercent = Math.min(100, (velocity / currentMaxSpeed) * 100);

  return (
    <main className="trainer-root">
      <section className="trainer-main">
        <header className="toolbar">
          <div>
            <p className="toolbar-title">CS Counter-Strafe Trainer</p>
            <p className="toolbar-subtitle">Vite + React prototype with CS-style inertia model</p>
          </div>

          <div className="toolbar-actions">
            <label htmlFor="weapon" className="inline-label">Weapon Mode</label>
            <select
              id="weapon"
              value={weapon}
              onChange={(event) => setWeapon(event.target.value)}
              className="control"
            >
              <option value="knife">Knife (250 u/s)</option>
              <option value="ak47">AK-47 (215 u/s)</option>
              <option value="m4a4">M4A4 (225 u/s)</option>
              <option value="awp">AWP (200 u/s)</option>
            </select>
            <button type="button" className="control ghost" onClick={resetSession}>
              Reset Session
            </button>
          </div>
        </header>

        <div className="viewport" onMouseDown={handleShot}>
          <canvas ref={canvasRef} className="scene-canvas" aria-label="Counter strafe training view" />

          <div className="center-crosshair" aria-hidden="true" />

          <div className="feedback-stack" aria-live="polite">
            {feedback.map((entry) => (
              <div key={entry.id} className={`feedback-pop ${entry.tone}`}>
                {entry.text}
              </div>
            ))}
          </div>

          <div className="velocity-card">
            <div className="velocity-head">
              <span>Velocity: {velocity.toFixed(1)} u/s</span>
              <span>Max: {currentMaxSpeed} u/s</span>
            </div>
            <div className="velocity-track">
              <div
                className={`velocity-fill ${velocity < 1 ? "stable" : "moving"}`}
                style={{ width: `${velocityPercent}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      <aside className="sidebar">
        <section className="panel">
          <h2>Session</h2>
          <div className="stat-row">
            <span>Total Shots Taken</span>
            <strong>{stats.shots}</strong>
          </div>
          <div className="stat-row">
            <span>Average Counter-Strafe Accuracy</span>
            <strong>{averageAccuracy.toFixed(1)}%</strong>
          </div>
          <div className="stat-row">
            <span>Last Shot</span>
            <strong>{stats.last == null ? "-" : `${stats.last.toFixed(1)}%`}</strong>
          </div>
        </section>

        <section className="panel">
          <h2>Movement Model</h2>
          <div className="stat-row">
            <span>sv_maxspeed</span>
            <strong>{CONSTANTS.sv_maxspeed}</strong>
          </div>
          <div className="stat-row">
            <span>sv_accelerate</span>
            <strong>{CONSTANTS.sv_accelerate}</strong>
          </div>
          <div className="stat-row">
            <span>sv_friction</span>
            <strong>{CONSTANTS.sv_friction}</strong>
          </div>
        </section>

        <section className="panel">
          <h2>Controls</h2>
          <p>Move: <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd></p>
          <p>Shoot: <kbd>Mouse1</kbd></p>
          <p>
            Accuracy snapshot uses <code>max(0, 100 - (speed / maxWeaponSpeed) * 100)</code>.
            Perfect stop triggers when speed is below <code>1 u/s</code>.
          </p>
        </section>
      </aside>
    </main>
  );
}
