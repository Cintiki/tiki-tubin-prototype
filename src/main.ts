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

type Gate = {
  id: string;
  position: Vec;
  stageIndex: number;
  scored: boolean;
  lastPostHitAt: number;
};

type StrokeFx = {
  position: Vec;
  side: StrokeSide;
  age: number;
  duration: number;
};

type ScorePopup = {
  position: Vec;
  score: number;
  age: number;
  duration: number;
};

type CoconutPickup = {
  position: Vec;
  collected: boolean;
};

type CoconutProjectile = {
  position: Vec;
  velocity: Vec;
  traveled: number;
};

type ImpactFx = {
  position: Vec;
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
const scoreValue = document.querySelector<HTMLElement>("#score-value");
const coconutAmmoValue = document.querySelector<HTMLElement>("#coconut-ammo");

const context = canvas.getContext("2d");

if (!context) {
  throw new Error("2D canvas context was not available.");
}

const ctx = context;
const keys = new Set<string>();
const activeTouches = new Map<number, "left" | "right">();
const strokeFx: StrokeFx[] = [];
const scorePopups: ScorePopup[] = [];
const coconutProjectiles: CoconutProjectile[] = [];
const impactFx: ImpactFx[] = [];
const pendingStroke = {
  side: "none",
  timer: 0
};

const river = {
  width: 520,
  minVisibleMargin: 28,
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

const gates: Gate[] = [
  { id: "gate-1", position: { x: 0, y: 610 }, stageIndex: 0, scored: false, lastPostHitAt: -Infinity },
  { id: "gate-2", position: { x: -65, y: 1320 }, stageIndex: 0, scored: false, lastPostHitAt: -Infinity },
  { id: "gate-3", position: { x: 70, y: 2120 }, stageIndex: 0, scored: false, lastPostHitAt: -Infinity }
];

const coconutPickups: CoconutPickup[] = [
  { position: { x: 115, y: 520 }, collected: false },
  { position: { x: -125, y: 1040 }, collected: false },
  { position: { x: 35, y: 1760 }, collected: false }
];

let width = 1;
let height = 1;
let dpr = 1;
let worldScale = 1;
let cameraY = 0;
let lastTime = performance.now();
let lastAnyStroke = -Infinity;
let playerScore = 4564;
let coconutAmmo = 0;
let lastCoconutThrowAt = -Infinity;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  worldScale = Math.min(1, (width - river.minVisibleMargin * 2) / river.width);
}

function updateHud() {
  if (scoreValue) {
    scoreValue.textContent = String(playerScore);
  }

  if (coconutAmmoValue) {
    coconutAmmoValue.textContent = `coconuts: x${coconutAmmo}`;
  }
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
    x: width / 2 + point.x * worldScale,
    y: height / 2 + (point.y - cameraY) * worldScale
  };
}

function screenDistance(distance: number) {
  return distance * worldScale;
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
      throwCoconut(now);
      break;
  }
}

function throwCoconut(now: number) {
  if (coconutAmmo <= 0 || now - lastCoconutThrowAt < tuning.coconutThrowCooldownMs) {
    return;
  }

  const direction = { x: -Math.sin(player.angle), y: Math.cos(player.angle) };
  coconutProjectiles.push({
    position: add(player.position, mul(direction, tuning.tubeRadius * 0.65)),
    velocity: mul(direction, tuning.coconutThrowSpeed),
    traveled: 0
  });

  coconutAmmo -= 1;
  lastCoconutThrowAt = now;
  updateHud();
}

function updatePlayer(dt: number) {
  const previousPosition = { ...player.position };
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
  handleGateCollisions(performance.now());
  handleObstacleCollisions();
  handleGateScoring(previousPosition);
  handleCoconutPickups();
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

function getGateStage(gate: Gate) {
  return tuning.gateStages[gate.stageIndex];
}

function getGatePostPositions(gate: Gate) {
  const openingWidth = getGateStage(gate).openingWidth;
  const postOffset = openingWidth / 2 + tuning.gatePostRadius;

  return [
    { x: gate.position.x - postOffset, y: gate.position.y },
    { x: gate.position.x + postOffset, y: gate.position.y }
  ];
}

function handleGateCollisions(now: number) {
  for (const gate of gates) {
    if (gate.scored) {
      continue;
    }

    for (const postPosition of getGatePostPositions(gate)) {
      const delta = sub(player.position, postPosition);
      const distance = length(delta);
      const combinedRadius = tuning.tubeRadius + tuning.gatePostRadius;

      if (distance >= combinedRadius) {
        continue;
      }

      const normal = distance > 0.001 ? mul(delta, 1 / distance) : { x: 0, y: -1 };
      resolveCollision(normal, combinedRadius - distance, tuning.obstacleBounceStrength);

      if (now - gate.lastPostHitAt >= tuning.gateHitCooldownMs) {
        gate.stageIndex = Math.min(gate.stageIndex + 1, tuning.gateStages.length - 1);
        gate.lastPostHitAt = now;
      }
    }
  }
}

function handleGateScoring(previousPosition: Vec) {
  for (const gate of gates) {
    if (gate.scored) {
      continue;
    }

    const crossedGate = previousPosition.y < gate.position.y && player.position.y >= gate.position.y;
    const insideOpening = Math.abs(player.position.x - gate.position.x) <= getGateStage(gate).openingWidth / 2;

    if (!crossedGate || !insideOpening) {
      continue;
    }

    const score = getGateStage(gate).score;
    gate.scored = true;
    playerScore += score;
    updateHud();
    scorePopups.push({
      position: { x: gate.position.x, y: gate.position.y - 34 },
      score,
      age: 0,
      duration: 1.1
    });
  }
}

function handleCoconutPickups() {
  for (const pickup of coconutPickups) {
    if (pickup.collected) {
      continue;
    }

    const pickupDistance = length(sub(player.position, pickup.position));
    if (pickupDistance > tuning.tubeRadius + tuning.coconutPickupRadius) {
      continue;
    }

    pickup.collected = true;
    coconutAmmo += 1;
    updateHud();
    impactFx.push({
      position: { ...pickup.position },
      age: 0,
      duration: 0.35
    });
  }
}

function updateCoconutProjectiles(dt: number) {
  for (let index = coconutProjectiles.length - 1; index >= 0; index -= 1) {
    const projectile = coconutProjectiles[index];
    const step = mul(projectile.velocity, dt);
    projectile.position = add(projectile.position, step);
    projectile.traveled += length(step);

    if (projectile.traveled >= tuning.coconutThrowRange || coconutHitObject(projectile)) {
      impactFx.push({
        position: { ...projectile.position },
        age: 0,
        duration: 0.28
      });
      coconutProjectiles.splice(index, 1);
    }
  }
}

function coconutHitObject(projectile: CoconutProjectile) {
  for (const obstacle of obstacles) {
    const hitDistance = obstacle.radius + tuning.coconutProjectileRadius;

    if (length(sub(projectile.position, obstacle.position)) <= hitDistance) {
      return true;
    }
  }

  for (const gate of gates) {
    if (gate.scored) {
      continue;
    }

    for (const postPosition of getGatePostPositions(gate)) {
      const hitDistance = tuning.gatePostRadius + tuning.coconutProjectileRadius;

      if (length(sub(projectile.position, postPosition)) <= hitDistance) {
        return true;
      }
    }
  }

  return false;
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

function updateScorePopups(dt: number) {
  for (const popup of scorePopups) {
    popup.age += dt;
  }

  for (let index = scorePopups.length - 1; index >= 0; index -= 1) {
    if (scorePopups[index].age >= scorePopups[index].duration) {
      scorePopups.splice(index, 1);
    }
  }
}

function updateImpactFx(dt: number) {
  for (const fx of impactFx) {
    fx.age += dt;
  }

  for (let index = impactFx.length - 1; index >= 0; index -= 1) {
    if (impactFx[index].age >= impactFx[index].duration) {
      impactFx.splice(index, 1);
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
  drawGates();
  drawObstacles();
  drawCoconutPickups();
  drawCoconutProjectiles();
  drawStrokeFx();
  drawPlayer();
  drawScorePopups();
  drawImpactFx();
  drawTouchHints();
}

function drawCurrentStreams() {
  for (const stream of currentStreams) {
    const screen = worldToScreen({ x: stream.x, y: stream.y });
    const streamWidth = screenDistance(stream.width);
    const streamHeight = screenDistance(stream.height);
    const top = screen.y - streamHeight / 2;

    if (top > height + 80 || top + streamHeight < -80) {
      continue;
    }

    const gradient = ctx.createLinearGradient(
      screen.x - streamWidth / 2,
      0,
      screen.x + streamWidth / 2,
      0
    );
    gradient.addColorStop(0, "rgba(180, 245, 255, 0)");
    gradient.addColorStop(0.5, "rgba(180, 245, 255, 0.22)");
    gradient.addColorStop(1, "rgba(180, 245, 255, 0)");

    ctx.fillStyle = gradient;
    ctx.fillRect(screen.x - streamWidth / 2, top, streamWidth, streamHeight);

    ctx.strokeStyle = "rgba(235, 255, 255, 0.55)";
    ctx.lineWidth = screenDistance(3);
    for (let line = 0; line < 6; line += 1) {
      const yOffset = ((line * 74 - cameraY * 0.95) % stream.height + stream.height) % stream.height;
      const y = top + yOffset;
      const sway = screenDistance(Math.sin((stream.y + line * 31 + cameraY) * 0.012) * 13);

      ctx.beginPath();
      ctx.moveTo(screen.x - streamWidth * 0.27 + sway, y);
      ctx.quadraticCurveTo(screen.x + sway * 0.3, y + screenDistance(30), screen.x + streamWidth * 0.24, y + screenDistance(70));
      ctx.stroke();
    }
  }
}

function drawRiver() {
  ctx.fillStyle = "#5daa61";
  ctx.fillRect(0, 0, width, height);

  const riverScreenWidth = screenDistance(river.width);
  const riverLeft = width / 2 - riverScreenWidth / 2;
  const riverRight = width / 2 + riverScreenWidth / 2;
  const bankEdgeWidth = screenDistance(22);

  ctx.fillStyle = "#23a7c7";
  ctx.fillRect(riverLeft, 0, riverScreenWidth, height);

  ctx.fillStyle = "#d8bd72";
  ctx.fillRect(riverLeft - bankEdgeWidth, 0, bankEdgeWidth, height);
  ctx.fillRect(riverRight, 0, bankEdgeWidth, height);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  ctx.lineWidth = screenDistance(2);
  for (let i = -2; i < 9; i += 1) {
    const y = ((i * screenDistance(150) - cameraY * 0.55 * worldScale) % screenDistance(150) + screenDistance(150)) % screenDistance(150);
    const x = width / 2 + screenDistance(Math.sin((cameraY + i * 180) * 0.006) * 90);
    ctx.beginPath();
    ctx.moveTo(x - screenDistance(32), y);
    ctx.quadraticCurveTo(x, y + screenDistance(22), x + screenDistance(28), y + screenDistance(54));
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(15, 103, 123, 0.35)";
  ctx.lineWidth = screenDistance(5);
  ctx.strokeRect(riverLeft, -4, riverScreenWidth, height + 8);
}

function drawObstacles() {
  for (const obstacle of obstacles) {
    const screen = worldToScreen(obstacle.position);
    if (screen.y < -100 || screen.y > height + 100) {
      continue;
    }

    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.scale(worldScale, worldScale);

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

function drawGates() {
  for (const gate of gates) {
    const screen = worldToScreen(gate.position);

    if (screen.y < -100 || screen.y > height + 100) {
      continue;
    }

    const stage = getGateStage(gate);
    const postPositions = getGatePostPositions(gate);
    const leftPost = worldToScreen(postPositions[0]);
    const rightPost = worldToScreen(postPositions[1]);
    const alpha = gate.scored ? 0.35 : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = gate.scored ? "rgba(223, 255, 223, 0.7)" : "rgba(255, 248, 180, 0.85)";
    ctx.lineWidth = screenDistance(4);
    ctx.setLineDash([screenDistance(10), screenDistance(8)]);
    ctx.beginPath();
    ctx.moveTo(leftPost.x + screenDistance(tuning.gatePostRadius), screen.y);
    ctx.lineTo(rightPost.x - screenDistance(tuning.gatePostRadius), screen.y);
    ctx.stroke();
    ctx.setLineDash([]);

    for (const post of [leftPost, rightPost]) {
      ctx.fillStyle = gate.scored ? "#77b57a" : "#ddca5f";
      ctx.strokeStyle = gate.scored ? "#437245" : "#7d6720";
      ctx.lineWidth = screenDistance(4);
      ctx.beginPath();
      ctx.arc(post.x, post.y, screenDistance(tuning.gatePostRadius), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      ctx.arc(post.x - screenDistance(6), post.y - screenDistance(7), screenDistance(5), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = gate.scored ? "rgba(215, 255, 215, 0.88)" : "rgba(255, 250, 190, 0.92)";
    ctx.font = `800 ${screenDistance(14)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(gate.scored ? "cleared" : `${stage.score}`, screen.x, screen.y - screenDistance(28));
    ctx.restore();
  }
}

function drawCoconutPickups() {
  for (const pickup of coconutPickups) {
    if (pickup.collected) {
      continue;
    }

    const screen = worldToScreen(pickup.position);
    if (screen.y < -70 || screen.y > height + 70) {
      continue;
    }

    drawCoconutShape(screen, screenDistance(12));
    ctx.strokeStyle = "rgba(255, 255, 255, 0.34)";
    ctx.lineWidth = screenDistance(2);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, screenDistance(tuning.coconutPickupRadius), 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawCoconutProjectiles() {
  for (const projectile of coconutProjectiles) {
    const screen = worldToScreen(projectile.position);
    drawCoconutShape(screen, screenDistance(tuning.coconutProjectileRadius));
  }
}

function drawCoconutShape(screen: Vec, radius: number) {
  ctx.save();
  ctx.fillStyle = "#7b4d2e";
  ctx.strokeStyle = "#4c2a18";
  ctx.lineWidth = Math.max(1, radius * 0.22);
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.arc(screen.x - radius * 0.28, screen.y - radius * 0.32, radius * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawScorePopups() {
  for (const popup of scorePopups) {
    const progress = popup.age / popup.duration;
    const screen = worldToScreen({
      x: popup.position.x,
      y: popup.position.y - progress * 34
    });

    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.fillStyle = "#fff6a8";
    ctx.strokeStyle = "rgba(55, 35, 0, 0.65)";
    ctx.lineWidth = screenDistance(3);
    ctx.font = `800 ${screenDistance(24)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.strokeText(`+${popup.score}`, screen.x, screen.y);
    ctx.fillText(`+${popup.score}`, screen.x, screen.y);
    ctx.restore();
  }
}

function drawImpactFx() {
  for (const fx of impactFx) {
    const progress = fx.age / fx.duration;
    const screen = worldToScreen(fx.position);

    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.strokeStyle = "#fff2b0";
    ctx.lineWidth = screenDistance(3);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, screenDistance(8 + progress * 18), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawPlayer() {
  const screen = worldToScreen(player.position);

  ctx.save();
  ctx.translate(screen.x, screen.y);
  ctx.scale(worldScale, worldScale);
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
    ctx.scale(worldScale, worldScale);
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
  updateCoconutProjectiles(dt);
  updateStrokeFx(dt);
  updateScorePopups(dt);
  updateImpactFx(dt);
  updateCamera(dt);
  render();

  requestAnimationFrame(loop);
}

window.addEventListener("resize", resize);

window.addEventListener(
  "touchmove",
  (event) => {
    event.preventDefault();
  },
  { passive: false }
);

window.addEventListener("gesturestart", (event) => {
  event.preventDefault();
});

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (["a", "d", "z", "c", "x", "arrowleft", "arrowright", " "].includes(key)) {
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

  if (key === "x" || key === " ") {
    triggerAction("throw", now);
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
updateHud();
requestAnimationFrame(loop);
