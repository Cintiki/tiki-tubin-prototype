import { tuning } from "./tuning";
import "./styles.css";

type Vec = { x: number; y: number };
type StrokeSide = "left" | "right" | "both" | "leftReverse" | "rightReverse" | "bothReverse";
type SingleStrokeSide = "left" | "right" | "leftReverse" | "rightReverse";
type GameAction = "leftBack" | "leftForward" | "rightBack" | "rightForward" | "throw";

type Player = {
  position: Vec;
  velocity: Vec;
  angle: number;
  angularVelocity: number;
};

type Obstacle = {
  position: Vec;
  radius: number;
  kind: "rock" | "log";
};

type CurrentStream = {
  x: number;
  y: number;
  width: number;
  height: number;
  pushX: number;
};

type StrokeFx = {
  position: Vec;
  side: StrokeSide;
  age: number;
  duration: number;
};

function getRequiredCanvas() {
  const element = document.querySelector<HTMLCanvasElement>("#game");

  if (!element) {
    throw new Error("Canvas element was not found.");
  }

  return element;
}

const canvas = getRequiredCanvas();

const context = canvas.getContext("2d");

if (!context) {
  throw new Error("2D canvas context was not available.");
}

const ctx = context;
const keys = new Set<string>();
const activeTouches = new Map<number, "left" | "right">();
const strokeFx: StrokeFx[] = [];
const pendingStroke = {
  side: "none",
  timer: 0
};

const river = {
  width: 520,
  bankWidth: 260
};

const player: Player = {
  position: { x: 0, y: 0 },
  velocity: { x: 0, y: tuning.riverCurrentSpeed },
  angle: 0,
  angularVelocity: 0
};

const obstacles: Obstacle[] = [
  { position: { x: -150, y: 420 }, radius: 36, kind: "rock" },
  { position: { x: 135, y: 760 }, radius: 42, kind: "log" },
  { position: { x: -55, y: 1130 }, radius: 30, kind: "rock" },
  { position: { x: 170, y: 1540 }, radius: 34, kind: "rock" },
  { position: { x: -135, y: 1900 }, radius: 48, kind: "log" }
];

const currentStreams: CurrentStream[] = [
  { x: -112, y: 300, width: 150, height: 360, pushX: 42 },
  { x: 92, y: 980, width: 165, height: 420, pushX: -48 },
  { x: -24, y: 1640, width: 210, height: 460, pushX: 18 }
];

let width = 1;
let height = 1;
let dpr = 1;
let cameraY = 0;
let lastTime = performance.now();
let lastAnyStroke = -Infinity;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function add(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, y: a.y + b.y };
}

function sub(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, y: a.y - b.y };
}

function mul(v: Vec, scalar: number): Vec {
  return { x: v.x * scalar, y: v.y * scalar };
}

function length(v: Vec): number {
  return Math.hypot(v.x, v.y);
}

function normalize(v: Vec): Vec {
  const len = length(v);
  return len > 0.0001 ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
}

function dot(a: Vec, b: Vec): number {
  return a.x * b.x + a.y * b.y;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function worldToScreen(point: Vec): Vec {
  return {
    x: width / 2 + point.x,
    y: height / 2 + point.y - cameraY
  };
}

function applyStroke(side: StrokeSide, now: number, bypassCooldown = false) {
  if (!bypassCooldown && now - lastAnyStroke < tuning.strokeCooldownMs) {
    return;
  }

  const reverseStroke = side === "leftReverse" || side === "rightReverse" || side === "bothReverse";
  const thrustDirection = reverseStroke ? -1 : 1;
  const forward = {
    x: Math.sin(player.angle) * thrustDirection,
    y: -Math.cos(player.angle) * thrustDirection
  };
  const turnDirection = side === "left" || side === "rightReverse" ? 1 : side === "right" || side === "leftReverse" ? -1 : 0;
  const impulse = side === "both" || side === "bothReverse" ? tuning.twoArmStrokeImpulse : tuning.leftRightStrokeImpulse;
  const torqueScale = side === "both" || side === "bothReverse" ? tuning.twoArmTorqueScale : 1;

  player.velocity = add(player.velocity, mul(forward, impulse));
  player.angularVelocity += turnDirection * tuning.strokeTorque * torqueScale;

  lastAnyStroke = now;
  strokeFx.push({
    position: { ...player.position },
    side,
    age: 0,
    duration: 0.32
  });
}

function isPairedStroke(first: string, second: SingleStrokeSide) {
  return (
    (first === "left" && second === "right") ||
    (first === "right" && second === "left") ||
    (first === "leftReverse" && second === "rightReverse") ||
    (first === "rightReverse" && second === "leftReverse")
  );
}

function queueStroke(side: SingleStrokeSide, now: number) {
  if (pendingStroke.side !== "none" && pendingStroke.side !== side && isPairedStroke(pendingStroke.side, side)) {
    const bothSide = side === "leftReverse" || side === "rightReverse" ? "bothReverse" : "both";
    window.clearTimeout(pendingStroke.timer);
    pendingStroke.side = "none";
    pendingStroke.timer = 0;
    applyStroke(bothSide, now, true);
    return;
  }

  if (pendingStroke.side === side) {
    return;
  }

  pendingStroke.side = side;
  pendingStroke.timer = window.setTimeout(() => {
    const queuedSide = pendingStroke.side;
    pendingStroke.side = "none";
    pendingStroke.timer = 0;

    if (
      queuedSide === "left" ||
      queuedSide === "right" ||
      queuedSide === "leftReverse" ||
      queuedSide === "rightReverse"
    ) {
      applyStroke(queuedSide, performance.now());
    }
  }, tuning.twoArmTapWindowMs);
}

function triggerAction(action: GameAction, now: number) {
  switch (action) {
    case "leftBack":
      queueStroke("leftReverse", now);
      break;
    case "leftForward":
      queueStroke("left", now);
      break;
    case "rightBack":
      queueStroke("rightReverse", now);
      break;
    case "rightForward":
      queueStroke("right", now);
      break;
    case "throw":
      break;
  }
}

function updatePlayer(dt: number) {
  const localCurrent = getLocalCurrent();
  const currentInfluence = localCurrent.y - player.velocity.y;
  player.velocity.y += currentInfluence * 0.55 * dt;
  player.velocity.x += localCurrent.x * dt;

  const damping = Math.pow(tuning.linearDamping, dt * 60);
  player.velocity.x *= damping;
  player.velocity.y *= 1 - (1 - damping) * 0.62;

  player.angularVelocity -= player.angle * tuning.rotationRecoveryStrength * dt;
  player.angularVelocity -= Math.sin(player.angle) * tuning.forwardRecoveryStrength * dt;
  player.angularVelocity *= Math.pow(tuning.angularDamping, dt * 60);
  if (Math.abs(player.angularVelocity) < tuning.angularDeadzone && Math.abs(player.angle) < 0.035) {
    player.angularVelocity = 0;
    player.angle = 0;
  }

  const speed = length(player.velocity);
  if (speed > tuning.maxSpeed) {
    player.velocity = mul(normalize(player.velocity), tuning.maxSpeed);
  }

  player.angularVelocity = clamp(
    player.angularVelocity,
    -tuning.maxAngularVelocity,
    tuning.maxAngularVelocity
  );

  player.position = add(player.position, mul(player.velocity, dt));
  player.angle += player.angularVelocity * dt;

  handleBankCollision();
  handleObstacleCollisions();
}

function getLocalCurrent(): Vec {
  const current = { x: 0, y: tuning.riverCurrentSpeed };

  for (const stream of currentStreams) {
    const dx = Math.abs(player.position.x - stream.x);
    const dy = Math.abs(player.position.y - stream.y);

    if (dx > stream.width / 2 || dy > stream.height / 2) {
      continue;
    }

    const edgeFadeX = 1 - dx / (stream.width / 2);
    const edgeFadeY = 1 - dy / (stream.height / 2);
    const strength = Math.min(edgeFadeX, edgeFadeY);
    current.y += tuning.fastCurrentSpeed * strength;
    current.x += stream.pushX * strength;
  }

  return current;
}

function handleBankCollision() {
  const halfRiver = river.width / 2;
  const limit = halfRiver - tuning.tubeRadius;

  if (player.position.x < -limit) {
    resolveCollision({ x: 1, y: 0 }, -limit - player.position.x, tuning.wallBounceStrength);
  } else if (player.position.x > limit) {
    resolveCollision({ x: -1, y: 0 }, player.position.x - limit, tuning.wallBounceStrength);
  }
}

function handleObstacleCollisions() {
  for (const obstacle of obstacles) {
    const delta = sub(player.position, obstacle.position);
    const distance = length(delta);
    const combinedRadius = tuning.tubeRadius + obstacle.radius;

    if (distance >= combinedRadius) {
      continue;
    }

    const normal = distance > 0.001 ? mul(delta, 1 / distance) : { x: 0, y: -1 };
    resolveCollision(normal, combinedRadius - distance, tuning.obstacleBounceStrength);
  }
}

function resolveCollision(normal: Vec, overlap: number, bounce: number) {
  player.position = add(player.position, mul(normal, overlap + 0.2));

  const intoSurface = dot(player.velocity, normal);
  if (intoSurface < 0) {
    player.velocity = sub(player.velocity, mul(normal, intoSurface * (1 + bounce)));
  }

  const tangentImpact = player.velocity.x * normal.y - player.velocity.y * normal.x;
  player.angularVelocity += clamp(tangentImpact * 0.012, -1.2, 1.2) * tuning.collisionSpinStrength;
}

function updateStrokeFx(dt: number) {
  for (const fx of strokeFx) {
    fx.age += dt;
  }

  for (let index = strokeFx.length - 1; index >= 0; index -= 1) {
    if (strokeFx[index].age >= strokeFx[index].duration) {
      strokeFx.splice(index, 1);
    }
  }
}

function updateCamera(dt: number) {
  const targetY = player.position.y;
  cameraY += (targetY - cameraY) * (1 - Math.exp(-tuning.cameraFollowStrength * dt));
}

function render() {
  ctx.clearRect(0, 0, width, height);
  drawRiver();
  drawCurrentStreams();
  drawObstacles();
  drawStrokeFx();
  drawPlayer();
  drawTouchHints();
}

function drawCurrentStreams() {
  for (const stream of currentStreams) {
    const screen = worldToScreen({ x: stream.x, y: stream.y });
    const top = screen.y - stream.height / 2;

    if (top > height + 80 || top + stream.height < -80) {
      continue;
    }

    const gradient = ctx.createLinearGradient(
      screen.x - stream.width / 2,
      0,
      screen.x + stream.width / 2,
      0
    );
    gradient.addColorStop(0, "rgba(180, 245, 255, 0)");
    gradient.addColorStop(0.5, "rgba(180, 245, 255, 0.22)");
    gradient.addColorStop(1, "rgba(180, 245, 255, 0)");

    ctx.fillStyle = gradient;
    ctx.fillRect(screen.x - stream.width / 2, top, stream.width, stream.height);

    ctx.strokeStyle = "rgba(235, 255, 255, 0.55)";
    ctx.lineWidth = 3;
    for (let line = 0; line < 6; line += 1) {
      const yOffset = ((line * 74 - cameraY * 0.95) % stream.height + stream.height) % stream.height;
      const y = top + yOffset;
      const sway = Math.sin((stream.y + line * 31 + cameraY) * 0.012) * 13;

      ctx.beginPath();
      ctx.moveTo(screen.x - stream.width * 0.27 + sway, y);
      ctx.quadraticCurveTo(screen.x + sway * 0.3, y + 30, screen.x + stream.width * 0.24, y + 70);
      ctx.stroke();
    }
  }
}

function drawRiver() {
  ctx.fillStyle = "#5daa61";
  ctx.fillRect(0, 0, width, height);

  const riverLeft = width / 2 - river.width / 2;
  const riverRight = width / 2 + river.width / 2;

  ctx.fillStyle = "#23a7c7";
  ctx.fillRect(riverLeft, 0, river.width, height);

  ctx.fillStyle = "#d8bd72";
  ctx.fillRect(riverLeft - 22, 0, 22, height);
  ctx.fillRect(riverRight, 0, 22, height);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  ctx.lineWidth = 2;
  for (let i = -2; i < 9; i += 1) {
    const y = ((i * 150 - cameraY * 0.55) % 150 + 150) % 150;
    const x = width / 2 + Math.sin((cameraY + i * 180) * 0.006) * 90;
    ctx.beginPath();
    ctx.moveTo(x - 32, y);
    ctx.quadraticCurveTo(x, y + 22, x + 28, y + 54);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(15, 103, 123, 0.35)";
  ctx.lineWidth = 5;
  ctx.strokeRect(riverLeft, -4, river.width, height + 8);
}

function drawObstacles() {
  for (const obstacle of obstacles) {
    const screen = worldToScreen(obstacle.position);
    if (screen.y < -100 || screen.y > height + 100) {
      continue;
    }

    ctx.save();
    ctx.translate(screen.x, screen.y);

    if (obstacle.kind === "rock") {
      ctx.fillStyle = "#6f7774";
      ctx.strokeStyle = "#4f5754";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(0, 0, obstacle.radius * 1.05, obstacle.radius * 0.86, 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.beginPath();
      ctx.arc(-obstacle.radius * 0.25, -obstacle.radius * 0.22, obstacle.radius * 0.2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.rotate(-0.55);
      ctx.fillStyle = "#8b5730";
      ctx.strokeStyle = "#5f351e";
      ctx.lineWidth = 4;
      roundRect(-obstacle.radius * 1.25, -obstacle.radius * 0.48, obstacle.radius * 2.5, obstacle.radius * 0.96, 16);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "rgba(60, 31, 18, 0.38)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-obstacle.radius * 0.7, -obstacle.radius * 0.35);
      ctx.lineTo(-obstacle.radius * 0.45, obstacle.radius * 0.35);
      ctx.moveTo(obstacle.radius * 0.3, -obstacle.radius * 0.35);
      ctx.lineTo(obstacle.radius * 0.54, obstacle.radius * 0.35);
      ctx.stroke();
    }

    ctx.restore();
  }
}

function drawPlayer() {
  const screen = worldToScreen(player.position);

  ctx.save();
  ctx.translate(screen.x, screen.y);
  ctx.rotate(player.angle);

  ctx.fillStyle = "#f4bf4d";
  ctx.strokeStyle = "#b86b27";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(0, 0, tuning.tubeRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#30aac7";
  ctx.beginPath();
  ctx.arc(0, 0, tuning.tubeRadius - 11, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#8a4f2a";
  roundRect(-13, -22, 26, 38, 9);
  ctx.fill();

  ctx.fillStyle = "#5f2f1a";
  ctx.beginPath();
  ctx.arc(0, -28, 15, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f6d66d";
  ctx.fillRect(-7, -34, 4, 4);
  ctx.fillRect(4, -34, 4, 4);
  ctx.fillRect(-6, -24, 12, 3);

  ctx.fillStyle = "#5f2f1a";
  roundRect(-27, -10, 9, 30, 5);
  ctx.fill();
  roundRect(18, -10, 9, 30, 5);
  ctx.fill();

  ctx.restore();
}

function drawStrokeFx() {
  for (const fx of strokeFx) {
    const progress = fx.age / fx.duration;
    const alpha = 1 - progress;
    const screen = worldToScreen(fx.position);

    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(player.angle);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;

    const splashX = fx.side === "left" || fx.side === "leftReverse" ? -44 : fx.side === "right" || fx.side === "rightReverse" ? 44 : 0;
    const splashY = fx.side === "leftReverse" || fx.side === "rightReverse" || fx.side === "bothReverse" ? -28 : 18;
    const spread = fx.side === "both" || fx.side === "bothReverse" ? 36 : 0;

    ctx.beginPath();
    ctx.arc(splashX - spread, splashY + progress * 16, 12 + progress * 20, 0.2 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();

    if (fx.side === "both" || fx.side === "bothReverse") {
      ctx.beginPath();
      ctx.arc(44, splashY + progress * 16, 12 + progress * 20, 0.15 * Math.PI, 0.8 * Math.PI);
      ctx.stroke();
    }

    ctx.restore();
  }
}

function drawTouchHints() {
  ctx.fillStyle = "rgba(4, 54, 67, 0.42)";
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("A/D forward paddles, Z/C reverse paddles", width / 2, height - 20);
}

function roundRect(x: number, y: number, rectWidth: number, rectHeight: number, radius: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, rectWidth, rectHeight, radius);
}

function loop(now: number) {
  const dt = Math.min((now - lastTime) / 1000, 0.033);
  lastTime = now;

  updatePlayer(dt);
  updateStrokeFx(dt);
  updateCamera(dt);
  render();

  requestAnimationFrame(loop);
}

window.addEventListener("resize", resize);

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (["a", "d", "z", "c", "arrowleft", "arrowright", " "].includes(key)) {
    event.preventDefault();
  }

  if (event.repeat) {
    return;
  }

  keys.add(key);

  const now = performance.now();
  const leftPressed = keys.has("a") || keys.has("arrowleft");
  const rightPressed = keys.has("d") || keys.has("arrowright");
  const leftReversePressed = keys.has("z");
  const rightReversePressed = keys.has("c");

  if (key === "a" || key === "arrowleft") {
    if (leftPressed && rightPressed) {
      window.clearTimeout(pendingStroke.timer);
      pendingStroke.side = "none";
      pendingStroke.timer = 0;
      applyStroke("both", now, true);
    } else {
      triggerAction("leftForward", now);
    }
  }

  if (key === "d" || key === "arrowright") {
    if (leftPressed && rightPressed) {
      window.clearTimeout(pendingStroke.timer);
      pendingStroke.side = "none";
      pendingStroke.timer = 0;
      applyStroke("both", now, true);
    } else {
      triggerAction("rightForward", now);
    }
  }

  if (key === "z") {
    if (leftReversePressed && rightReversePressed) {
      window.clearTimeout(pendingStroke.timer);
      pendingStroke.side = "none";
      pendingStroke.timer = 0;
      applyStroke("bothReverse", now, true);
    } else {
      triggerAction("leftBack", now);
    }
  }

  if (key === "c") {
    if (leftReversePressed && rightReversePressed) {
      window.clearTimeout(pendingStroke.timer);
      pendingStroke.side = "none";
      pendingStroke.timer = 0;
      applyStroke("bothReverse", now, true);
    } else {
      triggerAction("rightBack", now);
    }
  }
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key.toLowerCase());
});

canvas.addEventListener(
  "pointerdown",
  (event) => {
    if (event.pointerType === "mouse") {
      return;
    }

    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const side = event.clientX < width / 2 ? "left" : "right";
    activeTouches.set(event.pointerId, side);

    const now = performance.now();
    const hasLeft = [...activeTouches.values()].includes("left");
    const hasRight = [...activeTouches.values()].includes("right");

    if (hasLeft && hasRight) {
      window.clearTimeout(pendingStroke.timer);
      pendingStroke.side = "none";
      pendingStroke.timer = 0;
      applyStroke("both", now, true);
    } else {
      queueStroke(side, now);
    }
  },
  { passive: false }
);

canvas.addEventListener("mousedown", (event) => {
  if (event.button !== 0 && event.button !== 2) {
    return;
  }

  event.preventDefault();
  const now = performance.now();
  const leftMouseDown = (event.buttons & 1) === 1;
  const rightMouseDown = (event.buttons & 2) === 2;

  if (leftMouseDown && rightMouseDown) {
    window.clearTimeout(pendingStroke.timer);
    pendingStroke.side = "none";
    pendingStroke.timer = 0;
    applyStroke("both", now, true);
    return;
  }

  queueStroke(event.button === 2 ? "right" : "left", now);
});

document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const action = button.dataset.action as GameAction | undefined;

    if (!action) {
      return;
    }

    button.classList.add("is-pressed");
    button.setPointerCapture(event.pointerId);
    triggerAction(action, performance.now());
  });

  button.addEventListener("pointerup", () => {
    button.classList.remove("is-pressed");
  });

  button.addEventListener("pointercancel", () => {
    button.classList.remove("is-pressed");
  });
});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

canvas.addEventListener("pointerup", (event) => {
  activeTouches.delete(event.pointerId);
});

canvas.addEventListener("pointercancel", (event) => {
  activeTouches.delete(event.pointerId);
});

resize();
requestAnimationFrame(loop);
