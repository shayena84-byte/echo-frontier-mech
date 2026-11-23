"use strict";

const EchoSim = (() => {
  const WIDTH = 25;
  const HEIGHT = 18;
  const MAX_MECHS = 8;
  const SECURE_SECONDS = 24;
  const RESOURCES = ["alloy", "energy", "signal"];
  const FACTION = Object.freeze({ neutral: 0, ally: 1, hostile: -1 });
  const CHASSIS = [
    { name: "Стриж", detail: "Быстрое шасси · 90 ОЗ", speed: 2.65, hull: 90, cost: [36, 15, 0] },
    { name: "Веретено", detail: "Универсальное · 122 ОЗ", speed: 2.15, hull: 122, cost: [54, 18, 0] },
    { name: "Гранит", detail: "Танк · 168 ОЗ", speed: 1.64, hull: 168, cost: [73, 20, 4] },
  ];
  const WEAPONS = [
    { name: "Импульс", detail: "18 урона · 3,5 дальность", damage: 18, range: 3.5, cycle: 0.77, color: "#88f1cf", cost: [29, 20, 0] },
    { name: "Гаусс", detail: "35 урона · 5 дальность", damage: 35, range: 5, cycle: 1.48, color: "#ffc081", cost: [44, 28, 6] },
    { name: "Дуга", detail: "15 урона · 2,8 дальность", damage: 15, range: 2.8, cycle: 0.47, color: "#c9acff", cost: [28, 40, 4] },
  ];
  const KIT = [
    { name: "Сканер", detail: "Захват ×1,55 · дальность +0,5", capture: 1.55, hull: 0, range: 0.5, repair: 0, cost: [9, 11, 1] },
    { name: "Обшивка", detail: "Запас прочности +42 ОЗ", capture: 1, hull: 42, range: 0, repair: 0, cost: [24, 9, 2] },
    { name: "Ремдрон", detail: "Восстановление вне боя", capture: 1, hull: 0, range: 0, repair: 6, cost: [16, 19, 12] },
  ];
  const NODE_DEFS = [
    { name: "Разлом", x: 6, y: 5, resource: 0, income: 2.6, call: "Р" },
    { name: "Линза", x: 12, y: 9, resource: 1, income: 2.2, call: "Л" },
    { name: "Сигма", x: 19, y: 13, resource: 2, income: 1.25, call: "С" },
  ];
  const BASE_DEFS = [
    { name: "Лагерь «Эхо»", x: 3, y: 13, faction: FACTION.ally, hull: 740 },
    { name: "Цитадель", x: 22, y: 4, faction: FACTION.hostile, hull: 610 },
  ];
  const PADS = [{ x: 5, y: 12 }, { x: 5, y: 15 }];
  const TURRET_COST = [82, 41, 6];
  const WAVE_SECONDS = 34;
  const DEFAULT_BUILD = [0, 0, 0];
  const NEIGHBORS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];
  const clamp = (value, lower, upper) => Math.max(lower, Math.min(upper, value));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const cellIndex = (x, y) => y * WIDTH + x;
  const inBounds = (x, y) => x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;

  function noise(x, y, salt = 0) {
    const value = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
    return value - Math.floor(value);
  }

  function makeTerrain() {
    const terrain = [];
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const grit = noise(x, y);
        terrain.push({ x, y, grit, kind: grit < 0.28 ? "dust" : "basalt", blocked: false });
      }
    }
    const ridgeClusters = [
      [[0, 2], [1, 2], [1, 3], [2, 3], [2, 4], [2, 5], [3, 5]],
      [[7, 0], [7, 1], [8, 1], [8, 2], [9, 2], [10, 2], [10, 3]],
      [[10, 5], [10, 6], [9, 6], [9, 7], [9, 8], [8, 8]],
      [[15, 1], [15, 2], [16, 2], [17, 2], [17, 3], [18, 3]],
      [[17, 8], [17, 9], [16, 9], [16, 10], [15, 10], [15, 11]],
      [[21, 11], [22, 11], [22, 12], [23, 12], [24, 12], [24, 13]],
      [[8, 13], [8, 14], [9, 14], [9, 15], [10, 15], [11, 15]],
      [[12, 17], [13, 16], [13, 17], [14, 17], [15, 17]],
      [[2, 17], [3, 17], [4, 17], [4, 16]],
    ];
    const fissures = [[1, 8], [2, 8], [3, 9], [4, 9], [4, 10],
      [11, 0], [12, 0], [13, 1], [13, 2], [13, 3], [14, 4],
      [21, 16], [22, 16], [23, 17], [24, 17]];
    for (const [x, y] of ridgeClusters.flat()) {
      Object.assign(terrain[cellIndex(x, y)], { kind: "ridge", blocked: true });
    }
    for (const [x, y] of fissures) {
      Object.assign(terrain[cellIndex(x, y)], { kind: "fissure", blocked: true });
    }
    for (const [x, y] of [[5, 2], [6, 3], [7, 9], [10, 11], [12, 13], [13, 14],
      [15, 6], [16, 6], [20, 8], [21, 8], [22, 9], [18, 15], [19, 16], [6, 16]]) {
      terrain[cellIndex(x, y)].kind = "crystal";
    }
    return terrain;
  }

  function affordable(bank, cost) {
    return cost.every((value, index) => bank[index] >= value);
  }

  function buildCost([chassis, weapon, kit]) {
    return RESOURCES.map((_, index) => CHASSIS[chassis].cost[index] + WEAPONS[weapon].cost[index] + KIT[kit].cost[index]);
  }

  function resourceDelta(node) {
    const income = [0, 0, 0];
    income[node.resource] = node.income;
    return income;
  }

  function nearestWalkable(terrain, target) {
    const x = clamp(Math.round(target.x), 0, WIDTH - 1);
    const y = clamp(Math.round(target.y), 0, HEIGHT - 1);
    if (!terrain[cellIndex(x, y)].blocked) return { x, y };
    let closest = null;
    let best = Infinity;
    for (const tile of terrain) {
      if (tile.blocked) continue;
      const range = distance(tile, target);
      if (range < best) {
        closest = tile;
        best = range;
      }
    }
    return { x: closest.x, y: closest.y };
  }

  function findPath(terrain, origin, destination) {
    const start = nearestWalkable(terrain, origin);
    const end = nearestWalkable(terrain, destination);
    const startId = cellIndex(start.x, start.y);
    const endId = cellIndex(end.x, end.y);
    if (startId === endId) return [end];

    const costs = new Float64Array(terrain.length).fill(Infinity);
    const previous = new Int32Array(terrain.length).fill(-1);
    const closed = new Uint8Array(terrain.length);
    costs[startId] = 0;
    const open = [{ id: startId, score: distance(start, end) }];
    while (open.length) {
      let best = 0;
      for (let i = 1; i < open.length; i++) if (open[i].score < open[best].score) best = i;
      const [{ id }] = open.splice(best, 1);
      if (closed[id]) continue;
      if (id === endId) {
        const path = [];
        for (let current = endId; current !== startId; current = previous[current]) {
          const { x, y } = terrain[current];
          path.push({ x, y });
        }
        return path.reverse();
      }
      closed[id] = 1;
      const from = terrain[id];
      for (const [dx, dy, weight] of NEIGHBORS) {
        const x = from.x + dx;
        const y = from.y + dy;
        if (!inBounds(x, y)) continue;
        const next = cellIndex(x, y);
        if (closed[next] || terrain[next].blocked) continue;
        if (dx && dy && (terrain[cellIndex(x, from.y)].blocked || terrain[cellIndex(from.x, y)].blocked)) continue;
        const score = costs[id] + weight * (terrain[next].kind === "crystal" ? 1.18 : 1);
        if (score >= costs[next]) continue;
        costs[next] = score;
        previous[next] = id;
        open.push({ id: next, score: score + distance(terrain[next], end) });
      }
    }
    return [];
  }

  class Match {
    constructor() {
      this.terrain = makeTerrain();
      this.nodes = NODE_DEFS.map((node) => ({ ...node, faction: FACTION.neutral, influence: 0, contested: false }));
      this.bases = BASE_DEFS.map((base, index) => ({
        ...base, id: "base-" + index, hp: base.hull, type: "base", range: 3.3, cooldown: 0,
      }));
      this.pads = PADS.map((pad) => ({ ...pad, turret: null }));
      this.units = [];
      this.effects = [];
      this.news = [];
      this.bank = [164, 115, 14];
      this.baseIncome = [2.35, 1.75, 0.28];
      this.time = 0;
      this.wave = 0;
      this.nextWave = WAVE_SECONDS;
      this.secure = 0;
      this.queue = null;
      this.nextThinking = 14;
      this.winner = null;
      this.reason = "";
      this.kills = 0;
      this.sequence = 0;
      this.allySequence = 0;
      this.spawn(FACTION.ally, 4, 12, [0, 0, 0]);
      this.spawn(FACTION.ally, 4, 14, [1, 0, 1]);
      this.spawn(FACTION.hostile, 19, 6, [0, 0, 0], "capture");
      this.spawn(FACTION.hostile, 20, 8, [1, 0, 1], "capture");
      this.log("Связь с лагерем «Эхо» установлена.", "ally");
    }

    log(message, tone = "") {
      this.news.unshift({ message, tone, time: this.time });
      this.news.length = Math.min(9, this.news.length);
    }

    income() {
      const total = this.baseIncome.slice();
      for (const node of this.nodes) {
        if (node.faction !== FACTION.ally) continue;
        resourceDelta(node).forEach((amount, i) => { total[i] += amount; });
      }
      return total;
    }

    allies() {
      return this.units.filter((unit) => unit.faction === FACTION.ally && unit.hp > 0);
    }

    entities() {
      return [...this.units, ...this.bases, ...this.pads.map((pad) => pad.turret).filter(Boolean)]
        .filter((entity) => entity.hp > 0);
    }

    spawn(faction, x, y, build, role = "") {
      const [chassisId, weaponId, kitId] = build;
      const chassis = CHASSIS[chassisId];
      const weapon = WEAPONS[weaponId];
      const kit = KIT[kitId];
      const hull = chassis.hull + kit.hull;
      const spot = nearestWalkable(this.terrain, { x, y });
      const ally = faction === FACTION.ally;
      const mech = {
        ...spot, id: "mech-" + (++this.sequence), faction, type: "mech", chassisId, weaponId, kitId,
        name: ally ? chassis.name + " / " + String(++this.allySequence).padStart(2, "0") : "Дрон " + chassis.name,
        speed: chassis.speed, hull, hp: hull, range: weapon.range + kit.range,
        damage: weapon.damage, cycle: weapon.cycle, color: weapon.color, capture: kit.capture, repair: kit.repair,
        direction: ally ? -0.7 : 2.45, order: { kind: "hold" }, path: [], role, cooldown: 0,
        hitAge: 100, replan: 0, moving: false, foot: 0,
      };
      this.units.push(mech);
      return mech;
    }

    setOrder(ids, target, kind = "move") {
      const active = this.allies().filter((unit) => ids.includes(unit.id));
      for (const [index, unit] of active.entries()) {
        const angle = index * 2.4;
        const offset = index ? 0.75 + 0.23 * index : 0;
        const goal = offset ? { x: target.x + offset * Math.cos(angle), y: target.y + offset * Math.sin(angle) } : target;
        if (kind === "attack") this.giveOrder(unit, { kind, target: target.id });
        else if (kind === "hold") this.giveOrder(unit, { kind });
        else this.giveOrder(unit, { kind, ...nearestWalkable(this.terrain, goal) });
      }
      return active.length;
    }

    giveOrder(unit, order) {
      unit.order = order;
      unit.path = order.kind === "move" ? findPath(this.terrain, unit, order) : [];
      unit.replan = 0;
    }

    requestBuild(build) {
      const cost = buildCost(build);
      if (this.winner || this.queue || this.allies().length >= MAX_MECHS || !affordable(this.bank, cost)) return false;
      this.spend(cost);
      this.queue = { build: build.slice(), duration: 4.2, remaining: 4.2 };
      this.log("Завод начал сборку меха.", "ally");
      return true;
    }

    spend(cost) {
      this.bank = this.bank.map((value, i) => value - cost[i]);
    }

    requestTurret() {
      const pad = this.pads.find((socket) => !socket.turret || socket.turret.hp <= 0);
      if (!pad || this.winner || !affordable(this.bank, TURRET_COST)) return false;
      this.spend(TURRET_COST);
      pad.turret = {
        x: pad.x, y: pad.y, id: "turret-" + (++this.sequence), name: "Дозор",
        faction: FACTION.ally, type: "turret", hull: 172, hp: 172, damage: 18, cycle: 1.02, range: 4, cooldown: 0,
      };
      this.log("Турель «Дозор» развёрнута у лагеря.", "ally");
      return true;
    }

    enemyWave() {
      this.wave++;
      const remaining = this.units.filter((unit) => unit.faction === FACTION.hostile && unit.hp > 0).length;
      const count = Math.min(3 + Math.floor(this.wave / 3), Math.max(0, 11 - remaining));
      const designs = [[0, 0, 0], [1, 2, 0], [2, 1, 1], [0, 2, 2]];
      for (let i = 0; i < count; i++) {
        this.spawn(FACTION.hostile, 21 - (i % 2), 5 + Math.floor(i / 2), designs[(i + this.wave - 1) % designs.length],
          i === 0 && this.wave % 2 === 0 ? "raid" : "capture");
      }
      this.nextWave = this.time + Math.max(21, WAVE_SECONDS - this.wave);
      this.log(count ? "Волна " + this.wave + ". С «Цитадели» вышло дронов: " + count + "." :
        "Волна " + this.wave + ". Дроны на поле продолжают наступление.", "hostile");
    }

    think(enemies, allies) {
      for (const unit of enemies) {
        const close = allies.reduce((best, target) => distance(unit, target) < (best ? distance(unit, best) : 4.6) ? target : best, null);
        if (close) {
          if (unit.order.target !== close.id) this.giveOrder(unit, { kind: "attack", target: close.id });
          continue;
        }
        const candidates = this.nodes.filter((node) => node.faction !== FACTION.hostile);
        if (!candidates.length || unit.role === "raid") {
          if (unit.order.target !== this.bases[0].id) this.giveOrder(unit, { kind: "attack", target: this.bases[0].id });
          continue;
        }
        const preferred = candidates.reduce((best, target) => {
          const score = (node) => distance(unit, node) + (node.faction === FACTION.ally ? 0.55 : 0) +
            enemies.filter((other) => other !== unit && other.order.kind === "move" &&
              other.order.x === node.x && other.order.y === node.y).length * 1.9;
          return score(target) < score(best) ? target : best;
        }, candidates[0]);
        if (unit.order.kind !== "move" || unit.order.x !== preferred.x || unit.order.y !== preferred.y) {
          this.giveOrder(unit, { kind: "move", x: preferred.x, y: preferred.y });
        }
      }
    }

    fire(shooter, target) {
      shooter.cooldown = shooter.cycle;
      shooter.direction = Math.atan2(target.y - shooter.y, target.x - shooter.x);
      target.hp = Math.max(0, target.hp - shooter.damage);
      target.hitAge = 0;
      this.effects.push({
        type: "shot", x: shooter.x, y: shooter.y, tx: target.x, ty: target.y, life: 0.19, max: 0.19,
        faction: shooter.faction, color: shooter.faction === FACTION.ally ? shooter.color || "#69f1c1" : "#ff826d",
        high: shooter.type === "base" ? 24 : shooter.type === "turret" ? 14 : 11,
        targetHigh: target.type === "base" ? 18 : target.type === "turret" ? 11 : 7,
        mech: shooter.type === "mech" ? {
          chassisId: shooter.chassisId, weaponId: shooter.weaponId, direction: shooter.direction,
          moving: shooter.moving, foot: shooter.foot,
        } : null,
        targetChassis: target.chassisId,
      });
      if (target.hp > 0) return;
      this.effects.push({ type: "burst", x: target.x, y: target.y, life: 0.65, max: 0.65, faction: target.faction });
      if (target.type === "mech") {
        if (target.faction === FACTION.hostile) {
          this.kills++;
          this.bank[0] += 14;
          this.bank[2] += 2;
        } else {
          this.log("Потеря меха «" + target.name + "».", "hostile");
        }
      } else if (target.type === "turret") {
        this.log("Турель «Дозор» уничтожена.", "hostile");
      }
    }

    updateUnit(unit, entities, dt) {
      unit.cooldown = Math.max(0, unit.cooldown - dt);
      unit.hitAge += dt;
      unit.replan -= dt;
      unit.moving = false;

      let orderedTarget = null;
      if (unit.order.kind === "attack") {
        orderedTarget = entities.find((target) => target.id === unit.order.target && target.hp > 0);
        if (!orderedTarget) this.giveOrder(unit, { kind: "hold" });
      }
      const inRange = (target) => distance(unit, target) <= unit.range + (target.type === "base" ? 0.5 : 0);
      const orderedInRange = orderedTarget && inRange(orderedTarget);
      if (orderedTarget && !orderedInRange && unit.replan <= 0) {
        unit.path = findPath(this.terrain, unit, orderedTarget);
        unit.replan = 0.55;
      }
      if (!orderedInRange) this.advance(unit, dt);
      const target = orderedInRange ? orderedTarget : entities.reduce((best, other) => {
        if (other.hp <= 0 || unit.faction === other.faction || !inRange(other)) return best;
        return !best || distance(unit, other) < distance(unit, best) ? other : best;
      }, null);
      if (target && unit.cooldown <= 0) this.fire(unit, target);
      const base = unit.faction === FACTION.ally ? this.bases[0] : this.bases[1];
      const baseRepair = base.hp > 0 && distance(unit, base) <= 2.08 ? 11 : 0;
      if (unit.hitAge > 3.0) unit.hp = Math.min(unit.hull, unit.hp + (unit.repair + baseRepair) * dt);
    }

    advance(unit, dt) {
      const waypoint = unit.path[0];
      if (!waypoint) return;
      const range = distance(unit, waypoint);
      const tile = this.terrain[cellIndex(clamp(Math.round(unit.x), 0, WIDTH - 1), clamp(Math.round(unit.y), 0, HEIGHT - 1))];
      const step = dt * unit.speed * (tile.kind === "crystal" ? 0.78 : 1);
      if (range <= step) {
        unit.x = waypoint.x;
        unit.y = waypoint.y;
        unit.path.shift();
        return;
      }
      const dx = waypoint.x - unit.x;
      const dy = waypoint.y - unit.y;
      unit.x += dx * step / range;
      unit.y += dy * step / range;
      unit.direction = Math.atan2(dy, dx);
      unit.foot += dt * unit.speed * 7.5;
      unit.moving = true;
    }

    updateDefense(entities, dt) {
      for (const position of entities) {
        if (position.type === "mech" || position.hp <= 0) continue;
        position.cooldown -= dt;
        if (position.cooldown > 0) continue;
        const target = entities.reduce((best, other) => {
          if (position.faction === other.faction || other.hp <= 0 || distance(position, other) > position.range) return best;
          return !best || distance(position, other) < distance(position, best) ? other : best;
        }, null);
        if (target) {
          if (position.type === "base") {
            position.damage = position.faction === FACTION.ally ? 16 : 14;
            position.cycle = 1.18;
          }
          this.fire(position, target);
        }
      }
    }

    updateNodes(dt) {
      for (const node of this.nodes) {
        let ally = 0;
        let hostile = 0;
        for (const unit of this.units) {
          if (unit.hp <= 0 || distance(unit, node) > 1.35) continue;
          if (unit.faction === FACTION.ally) ally += unit.capture;
          else hostile += unit.capture;
        }
        node.contested = ally > 0 && hostile > 0;
        if (node.contested || (!ally && !hostile)) continue;
        const previous = node.faction;
        const direction = ally ? 1 : -1;
        const influence = node.influence + direction * (ally || hostile) * dt / 5.8;
        node.influence = clamp(influence, -1, 1);
        if (node.influence * previous < 0) node.faction = FACTION.neutral;
        if (Math.abs(node.influence) === 1) node.faction = direction;
        if (node.faction === previous) continue;
        if (node.faction === FACTION.neutral) this.log("Контроль над станцией «" + node.name + "» прерван.");
        else if (node.faction === FACTION.ally) {
          this.bank[0] += 24;
          this.bank[2] += 6;
          this.log("Станция «" + node.name + "» подключена.", "ally");
          this.effects.push({ type: "capture", x: node.x, y: node.y, life: 0.95, max: 0.95, faction: node.faction });
        } else {
          this.log("Дроны захватили станцию «" + node.name + "».", "hostile");
        }
      }
    }

    finish(winner, reason) {
      this.winner = winner;
      this.reason = reason;
      this.log(reason, winner === FACTION.ally ? "ally" : "hostile");
    }

    tick(dt) {
      if (this.winner || dt <= 0) return;
      this.time += dt;
      this.income().forEach((value, i) => { this.bank[i] += value * dt; });
      if (this.queue) {
        this.queue.remaining -= dt;
        if (this.queue.remaining <= 0) {
          const base = this.bases[0];
          const spots = [[base.x + 1, base.y], [base.x + 1, base.y + 1], [base.x + 1, base.y - 1], [base.x, base.y - 1]];
          const [x, y] = spots.find(([sx, sy]) => this.allies().every((unit) => distance(unit, { x: sx, y: sy }) > 0.7)) || spots[0];
          const unit = this.spawn(FACTION.ally, x, y, this.queue.build);
          this.log("Мех «" + unit.name + "» готов.", "ally");
          this.queue = null;
        }
      }
      if (this.time >= this.nextWave && this.bases[1].hp > 0) this.enemyWave();
      if (this.time >= this.nextThinking) {
        this.think(this.units.filter((unit) => unit.faction === FACTION.hostile && unit.hp > 0), this.allies());
        this.nextThinking = this.time + 0.76;
      }

      const entities = this.entities();
      this.updateDefense(entities, dt);
      for (const unit of this.units) if (unit.hp > 0) this.updateUnit(unit, entities, dt);
      this.units = this.units.filter((unit) => unit.hp > 0);
      this.updateNodes(dt);
      for (const effect of this.effects) effect.life -= dt;
      this.effects = this.effects.filter((effect) => effect.life > 0);

      const maintainsAll = this.nodes.every((node) => node.faction === FACTION.ally && !node.contested && node.influence >= 0.98);
      this.secure = maintainsAll ? this.secure + dt : 0;
      if (this.bases[0].hp <= 0) this.finish(FACTION.hostile, "Лагерь «Эхо» потерян.");
      else if (this.bases[1].hp <= 0) this.finish(FACTION.ally, "Цитадель дронов уничтожена.");
      else if (this.secure >= SECURE_SECONDS) this.finish(FACTION.ally, "Сеть станций передала сигнал эвакуации.");
    }
  }

  return { WIDTH, HEIGHT, MAX_MECHS, SECURE_SECONDS, RESOURCES, FACTION, CHASSIS, WEAPONS, KIT, TURRET_COST,
    DEFAULT_BUILD, Match, clamp, distance, noise, findPath, nearestWalkable, buildCost, affordable };
})();

if (typeof module === "object" && module.exports) module.exports = EchoSim;
