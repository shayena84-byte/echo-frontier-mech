"use strict";

const EchoSim = (() => {
  const WIDTH = 25;
  const HEIGHT = 18;
  const MAX_MECHS = 8;
  const BUILD_SECONDS = 4.2;
  const SECURE_SECONDS = 24;
  const RESOURCES = ["alloy", "energy", "signal"];
  const FACTION = Object.freeze({ neutral: 0, ally: 1, hostile: -1 });
  const STARTING_BANK = [164, 115, 14];
  const BASE_INCOME = [2.35, 1.75, 0.28];
  const BASE_HULL = 740;
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
    { name: "Лагерь «Эхо»", x: 3, y: 13, faction: FACTION.ally },
    { name: "Цитадель", x: 22, y: 4, faction: FACTION.hostile },
  ];
  const PAD_OFFSETS = [[2, -1], [2, 2]];
  const RELEASE_OFFSETS = [[1, 0], [1, 1], [1, -1], [0, -1], [0, 1], [2, 0], [1, -2], [1, 2], [0, -2], [0, 2]];
  const TURRET_COST = [82, 41, 6];
  const DEFAULT_BUILD = [0, 0, 0];
  const STARTING_BUILDS = [DEFAULT_BUILD, [1, 0, 1]];
  const ENEMY_BUILDS = [DEFAULT_BUILD, [0, 1, 0], [1, 0, 1], [1, 2, 0], [2, 1, 1], [0, 2, 2]];
  const NEIGHBORS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];
  const clamp = (value, lower, upper) => Math.max(lower, Math.min(upper, value));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const cellIndex = (x, y) => y * WIDTH + x;
  const inBounds = (x, y) => x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;
  const offsetFromBase = (base, [x, y]) => ({ x: base.x + x * base.faction, y: base.y + y * base.faction });

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
        ...base, id: "base-" + index, type: "base", hull: BASE_HULL, hp: BASE_HULL, range: 3.3,
        damage: 16, cycle: 1.18, cooldown: 0, bank: STARTING_BANK.slice(), queue: [],
      }));
      this.pads = this.bases.flatMap((base) => PAD_OFFSETS.map((offset) => ({
        ...offsetFromBase(base, offset), faction: base.faction, turret: null,
      })));
      this.units = [];
      this.effects = [];
      this.news = [];
      this.time = 0;
      this.secure = 0;
      this.nextThinking = 0;
      this.winner = null;
      this.reason = "";
      this.kills = 0;
      this.sequence = 0;
      this.allySequence = 0;
      for (const base of this.bases) {
        for (const [index, design] of STARTING_BUILDS.entries()) {
          const spot = offsetFromBase(base, [1, index * 2 - 1]);
          this.spawn(base.faction, spot.x, spot.y, design);
        }
      }
      this.log("Связь с лагерем «Эхо» установлена.", "ally");
    }

    log(message, tone = "") {
      this.news.unshift({ message, tone, time: this.time });
      this.news.length = Math.min(9, this.news.length);
    }

    baseFor(faction) {
      return this.bases.find((base) => base.faction === faction);
    }

    income(faction = FACTION.ally) {
      const total = BASE_INCOME.slice();
      for (const node of this.nodes) {
        if (node.faction === faction) total[node.resource] += node.income;
      }
      return total;
    }

    mechs(faction) {
      return this.units.filter((unit) => unit.faction === faction && unit.hp > 0);
    }

    allies() {
      return this.mechs(FACTION.ally);
    }

    entities() {
      return [...this.units, ...this.bases, ...this.pads.map((pad) => pad.turret).filter(Boolean)]
        .filter((entity) => entity.hp > 0);
    }

    spawn(faction, x, y, build) {
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
        direction: ally ? -0.7 : 2.45, order: { kind: "hold" }, path: [], cooldown: 0,
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

    canBuild(build, faction = FACTION.ally) {
      const base = this.baseFor(faction);
      return !this.winner && base.hp > 0 && this.mechs(faction).length + base.queue.length < MAX_MECHS &&
        affordable(base.bank, buildCost(build));
    }

    requestBuild(build, faction = FACTION.ally) {
      if (!this.canBuild(build, faction)) return false;
      const base = this.baseFor(faction);
      this.spend(base, buildCost(build));
      base.queue.push({ build: build.slice(), remaining: BUILD_SECONDS });
      if (faction === FACTION.ally) this.log("Мех «" + CHASSIS[build[0]].name + "» добавлен в очередь.", "ally");
      return true;
    }

    advanceFactory(base, dt) {
      let available = dt;
      while (available > 0 && base.queue.length) {
        const job = base.queue[0];
        if (job.remaining > available + 1e-9) {
          job.remaining -= available;
          return;
        }
        available = Math.max(0, available - job.remaining);
        base.queue.shift();
        const occupied = this.entities();
        const spots = RELEASE_OFFSETS.map((offset) => offsetFromBase(base, offset))
          .filter(({ x, y }) => inBounds(x, y) && !this.terrain[cellIndex(x, y)].blocked);
        const spot = spots.find((point) => occupied.every((entity) => distance(entity, point) > .7)) ?? spots[0] ?? base;
        const unit = this.spawn(base.faction, spot.x, spot.y, job.build);
        if (base.faction === FACTION.ally) this.log("Мех «" + unit.name + "» готов.", "ally");
        else this.log("Цитадель выпустила меха «" + CHASSIS[job.build[0]].name + "».", "hostile");
      }
    }

    spend(base, cost) {
      cost.forEach((price, index) => { base.bank[index] -= price; });
    }

    freePad(faction = FACTION.ally) {
      return this.pads.find((pad) => pad.faction === faction && (!pad.turret || pad.turret.hp <= 0));
    }

    requestTurret(faction = FACTION.ally) {
      const base = this.baseFor(faction);
      const pad = this.freePad(faction);
      if (!pad || this.winner || base.hp <= 0 || !affordable(base.bank, TURRET_COST)) return false;
      this.spend(base, TURRET_COST);
      pad.turret = {
        x: pad.x, y: pad.y, id: "turret-" + (++this.sequence), name: "Дозор",
        faction, type: "turret", hull: 172, hp: 172, damage: 18, cycle: 1.02, range: 4, cooldown: 0,
      };
      if (faction === FACTION.ally) this.log("Турель «Дозор» развёрнута у лагеря.", "ally");
      else this.log("Цитадель развернула турель «Дозор».", "hostile");
      return true;
    }

    planEnemyProduction(enemies, allies) {
      const base = this.baseFor(FACTION.hostile);
      if (allies.some((unit) => distance(unit, base) < 6)) this.requestTurret(base.faction);
      const committed = enemies.length + base.queue.length;
      const design = ENEMY_BUILDS[committed % ENEMY_BUILDS.length];
      if (!this.requestBuild(design, base.faction) && design !== DEFAULT_BUILD) {
        this.requestBuild(DEFAULT_BUILD, base.faction);
      }
    }

    think(enemies, allies) {
      for (const unit of enemies) {
        const close = allies.reduce((best, target) => distance(unit, target) < (best ? distance(unit, best) : 4.6) ? target : best, null);
        if (close) {
          if (unit.order.target !== close.id) this.giveOrder(unit, { kind: "attack", target: close.id });
          continue;
        }
        const candidates = this.nodes.filter((node) => node.faction !== FACTION.hostile);
        if (!candidates.length) {
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
        const bank = this.baseFor(shooter.faction).bank;
        bank[0] += 14;
        bank[2] += 2;
        if (target.faction === FACTION.hostile) {
          this.kills++;
        } else {
          this.log("Потеря меха «" + target.name + "».", "hostile");
        }
      } else if (target.type === "turret") {
        if (target.faction === FACTION.ally) this.log("Турель «Дозор» у лагеря уничтожена.", "hostile");
        else this.log("Турель «Дозор» у Цитадели уничтожена.", "ally");
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
      const base = this.baseFor(unit.faction);
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
        if (target) this.fire(position, target);
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
        if (node.faction === FACTION.neutral) {
          this.log("Контроль над станцией «" + node.name + "» прерван.");
          continue;
        }
        const bank = this.baseFor(node.faction).bank;
        bank[0] += 24;
        bank[2] += 6;
        const allied = node.faction === FACTION.ally;
        if (allied) this.log("Станция «" + node.name + "» подключена.", "ally");
        else this.log("Дроны захватили станцию «" + node.name + "».", "hostile");
        this.effects.push({ type: "capture", x: node.x, y: node.y, life: 0.95, max: 0.95, faction: node.faction });
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
      for (const base of this.bases) {
        if (base.hp <= 0) continue;
        this.income(base.faction).forEach((value, i) => { base.bank[i] += value * dt; });
        this.advanceFactory(base, dt);
      }
      if (this.time >= this.nextThinking) {
        const enemies = this.mechs(FACTION.hostile);
        const allies = this.allies();
        this.planEnemyProduction(enemies, allies);
        this.think(enemies, allies);
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

  return { WIDTH, HEIGHT, MAX_MECHS, BUILD_SECONDS, SECURE_SECONDS, RESOURCES, FACTION, CHASSIS, WEAPONS, KIT, TURRET_COST,
    DEFAULT_BUILD, Match, clamp, distance, noise, findPath, nearestWalkable, buildCost, affordable };
})();

if (typeof module === "object" && module.exports) module.exports = EchoSim;
