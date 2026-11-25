"use strict";

const EchoSim = (() => {
  const WIDTH = 37;
  const HEIGHT = 81;
  const MAX_MECHS = 8;
  const MAX_TURRETS = 4;
  const STATION_CAPTURE_SECONDS = 5.8;
  const FACILITY_CAPTURE_SECONDS = 8;
  const BASE_CAPTURE_SECONDS = 12;
  const BASE_TARGET_RANGE_BONUS = .5;
  const GATE_RADIUS = .4;
  const RESOURCES = ["alloy", "energy", "signal"];
  const FACTION = Object.freeze({ neutral: 0, ally: 1, hostile: -1 });
  const STARTING_BANK = [164, 115, 14];
  const BASE_INCOME = [2.35, 1.75, 0.28];
  const FACILITY_INCOME = BASE_INCOME.map((rate) => rate / 2);
  const BASE_HULL = 740;
  const CHASSIS = [
    { name: "Стриж", detail: "Быстрое шасси · 90 ОЗ", speed: 2.65, hull: 90, cost: [36, 15, 0], assemblyTime: 2.6 },
    { name: "Веретено", detail: "Универсальное · 122 ОЗ", speed: 2.15, hull: 122, cost: [54, 18, 0], assemblyTime: 3.5 },
    { name: "Гранит", detail: "Танк · 168 ОЗ", speed: 1.64, hull: 168, cost: [73, 20, 4], assemblyTime: 4.6 },
  ];
  const WEAPONS = [
    { name: "Импульс", detail: "18 урона · 3,5 дальность", damage: 18, range: 3.5, cycle: 0.77, color: "#88f1cf", cost: [29, 20, 0], assemblyTime: 1.6 },
    { name: "Гаусс", detail: "35 урона · 5 дальность", damage: 35, range: 5, cycle: 1.48, color: "#ffc081", cost: [44, 28, 6], assemblyTime: 2.4 },
    { name: "Дуга", detail: "15 урона · 2,8 дальность", damage: 15, range: 2.8, cycle: 0.47, color: "#c9acff", cost: [28, 40, 4], assemblyTime: 2 },
  ];
  const KIT = [
    { name: "Сканер", detail: "Скорость захвата ×1,55", capture: 1.55, hull: 0, repair: 0, cost: [9, 11, 1], assemblyTime: .8 },
    { name: "Обшивка", detail: "Запас прочности +42 ОЗ", capture: 1, hull: 42, range: 0, repair: 0, cost: [24, 9, 2], assemblyTime: 1.1 },
    { name: "Ремдрон", detail: "Восстановление вне боя", capture: 1, hull: 0, range: 0, repair: 6, cost: [16, 19, 12], assemblyTime: 1.7 },
  ];
  const NODE_DEFS = [
    { name: "Разлом", x: 6, y: 67, gateX: 6, gateY: 68, resource: 0, income: 2.6, call: "Р" },
    { name: "Линза", x: 21, y: 48, gateX: 20, gateY: 48, resource: 1, income: 2.2, call: "Л" },
    { name: "Сигма", x: 29, y: 54, gateX: 28, gateY: 54, resource: 2, income: 1.25, call: "С" },
    { name: "Жила", x: 30, y: 13, gateX: 30, gateY: 12, resource: 0, income: 2.6, call: "Ж" },
    { name: "Призма", x: 15, y: 32, gateX: 16, gateY: 32, resource: 1, income: 2.2, call: "П" },
    { name: "Пульсар", x: 7, y: 26, gateX: 8, gateY: 26, resource: 2, income: 1.25, call: "П" },
  ];
  const FACILITY_DEFS = [
    { type: "factory", name: "Завод «Ковка»", label: "КОВКА", x: 10, y: 71, gateX: 9, gateY: 71, call: "З" },
    { type: "factory", name: "Завод «Литейная»", label: "ЛИТЕЙНАЯ", x: 26, y: 9, gateX: 27, gateY: 9, call: "З" },
    { type: "outpost", name: "База «Перевал»", label: "ПЕРЕВАЛ", x: 12, y: 63, gateX: 12, gateY: 64, call: "Б" },
    { type: "outpost", name: "База «Маяк»", label: "МАЯК", x: 24, y: 17, gateX: 24, gateY: 16, call: "Б" },
    { type: "factory", name: "Завод «Каскад»", label: "КАСКАД", x: 25, y: 56, gateX: 24, gateY: 56, call: "З" },
    { type: "factory", name: "Завод «Горн»", label: "ГОРН", x: 11, y: 24, gateX: 12, gateY: 24, call: "З" },
    { type: "outpost", name: "База «Бастион»", label: "БАСТИОН", x: 8, y: 50, gateX: 8, gateY: 51, call: "Б" },
    { type: "outpost", name: "База «Кордон»", label: "КОРДОН", x: 28, y: 30, gateX: 28, gateY: 29, call: "Б" },
    { type: "factory", name: "Завод «Карьер»", label: "КАРЬЕР", x: 27, y: 41, gateX: 26, gateY: 41, call: "З" },
    { type: "factory", name: "Завод «Рудник»", label: "РУДНИК", x: 9, y: 39, gateX: 10, gateY: 39, call: "З" },
    { type: "outpost", name: "База «Заслон»", label: "ЗАСЛОН", x: 14, y: 45, gateX: 14, gateY: 46, call: "Б" },
    { type: "outpost", name: "База «Шпиль»", label: "ШПИЛЬ", x: 22, y: 35, gateX: 22, gateY: 34, call: "Б" },
  ];
  const BASE_DEFS = [
    { name: "Лагерь «Эхо»", label: "ЭХО", x: 4, y: HEIGHT - 6, faction: FACTION.ally },
    { name: "Цитадель", label: "ЦИТАДЕЛЬ", x: 32, y: 5, faction: FACTION.hostile },
  ];
  const PAD_OFFSETS = [[2, -1], [2, 2]];
  const RELEASE_OFFSETS = [[1, 0], [1, 1], [1, -1], [0, -1], [0, 1], [1, -2], [1, 2], [0, -2], [0, 2], [-1, 0]];
  const TURRET_COST = [82, 41, 6];
  const DEFAULT_BUILD = [0, 0, null, null];
  const STARTING_BUILDS = [[0, null, null, 0], [1, 0, null, null]];
  const SCANNER_BUILD = [0, null, null, 0];
  const ENEMY_DEFENSE_BUILDS = [[2, 0, 2, 1], [1, 0, 2, 1], [0, 0, null, 1], DEFAULT_BUILD];
  const ENEMY_SIEGE_BUILDS = [[1, 1, 1, 1], [1, 1, 0, 1], [0, 1, null, null], DEFAULT_BUILD];
  const NEIGHBORS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];
  const clamp = (value, lower, upper) => Math.max(lower, Math.min(upper, value));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const cellIndex = (x, y) => y * WIDTH + x;
  const inBounds = (x, y) => x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;
  const offsetFromBase = (base, [x, y]) => ({ x: base.x + x * base.faction, y: base.y + y * base.faction });
  const makeGate = (x, y) => ({ x, y, capturer: null, faction: FACTION.neutral, progress: 0, contested: false });
  const makePad = (site, point) => ({ ...point, site, turret: null, get faction() { return site.faction; } });
  const captureSeconds = (site) => site.type === "base" ? BASE_CAPTURE_SECONDS :
    site.type ? FACILITY_CAPTURE_SECONDS : STATION_CAPTURE_SECONDS;
  const weaponReach = (shooter, target, range) =>
    range + (shooter.type === "mech" && target.type === "base" ? BASE_TARGET_RANGE_BONUS : 0);

  function takeBest(units, score) {
    let best = Infinity;
    let chosen = -1;
    for (const [i, unit] of units.entries()) {
      const value = score(unit);
      if (value >= best) continue;
      best = value;
      chosen = i;
    }
    return chosen < 0 ? null : units.splice(chosen, 1)[0];
  }

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
    const clearings = new Set();
    const protect = ({ x, y }, radius) => {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (inBounds(x + dx, y + dy)) clearings.add(cellIndex(x + dx, y + dy));
        }
      }
    };
    for (const site of [...NODE_DEFS, ...FACILITY_DEFS]) {
      protect(site, 1);
      protect({ x: site.gateX, y: site.gateY }, 1);
    }
    for (const base of BASE_DEFS) protect(base, 3);

    const details = [
      ["ridge", [[0, 3], [1, 3], [1, 4], [2, 4], [2, 5], [3, 5],
        [7, 1], [8, 1], [9, 2], [9, 3], [10, 3], [11, 4],
        [15, 0], [15, 1], [16, 1], [17, 2], [18, 2], [18, 3],
        [9, 8], [9, 9], [9, 10], [10, 10], [10, 11],
        [15, 9], [15, 10], [15, 11], [16, 11], [16, 12],
        [13, 16], [13, 17], [14, 17], [14, 18], [15, 19], [15, 20], [16, 21],
        [7, 23], [8, 23], [8, 24], [9, 24], [9, 25], [10, 26], [11, 26],
        [0, 24], [1, 25], [2, 25], [3, 26],
        [23, 19], [24, 20], [24, 21], [25, 21], [26, 22],
        [31, 15], [32, 16], [32, 17], [33, 18], [33, 19],
        [6, 29], [7, 29], [8, 30], [8, 31], [9, 32],
        [18, 25], [18, 26], [19, 27], [20, 27], [20, 28], [21, 29], [21, 30],
        [31, 30], [32, 31], [33, 31], [33, 32], [34, 33], [35, 34],
        [1, 35], [2, 35], [3, 36], [4, 37], [4, 38],
        [12, 36], [13, 36], [14, 37], [15, 37], [15, 38],
        [23, 37], [24, 38], [24, 39], [25, 39]]],
      ["fissure", [[0, 14], [1, 14], [2, 15], [3, 15], [4, 16], [4, 17],
        [12, 0], [13, 1], [13, 2], [14, 3], [14, 4], [15, 5],
        [18, 22], [19, 22], [20, 23], [20, 24], [21, 25], [22, 26],
        [0, 31], [1, 32], [2, 32], [3, 33],
        [26, 26], [26, 27], [27, 27], [28, 27], [29, 28],
        [15, 39], [16, 39], [17, 40], [18, 40],
        [32, 37], [33, 38], [34, 38], [35, 39]]],
      ["crystal", [[4, 7], [5, 8], [6, 4], [7, 14], [8, 15], [11, 15], [10, 20],
        [12, 20], [14, 13], [15, 14], [16, 15], [19, 12], [17, 7], [18, 7], [3, 23],
        [5, 27], [9, 28], [13, 28], [14, 29], [15, 29], [17, 30], [20, 33], [26, 31],
        [27, 32], [29, 34], [30, 34], [32, 35], [4, 36], [6, 37], [11, 34], [14, 35],
        [20, 39], [21, 39], [22, 40], [28, 38], [29, 39]]],
    ];
    for (const [kind, positions] of details) {
      for (const [x, y] of positions) {
        const detail = { kind, blocked: kind !== "crystal" };
        const index = cellIndex(x, y);
        const opposite = cellIndex(WIDTH - 1 - x, HEIGHT - 1 - y);
        if (!clearings.has(index)) Object.assign(terrain[index], detail);
        if (!clearings.has(opposite)) Object.assign(terrain[opposite], detail);
      }
    }
    return terrain;
  }

  function affordable(bank, cost) {
    return cost.every((value, index) => bank[index] >= value);
  }

  function equipmentFor(weaponIds, kitId) {
    return [...weaponIds.map((id) => WEAPONS[id]), KIT[kitId]].filter(Boolean);
  }

  function normalizeBuild(build) {
    return Array.isArray(build) && build.length === 3 ? [build[0], build[1], null, build[2]] : build;
  }

  const validSlot = (id, catalog) => id === null || (Number.isInteger(id) && !!catalog[id]);

  function buildParts(build) {
    const design = normalizeBuild(build);
    if (!Array.isArray(design) || design.length !== 4) return null;
    const [chassis, firstWeapon, secondWeapon, kit] = design;
    if (chassis === null || !validSlot(chassis, CHASSIS) || !validSlot(firstWeapon, WEAPONS) ||
        !validSlot(secondWeapon, WEAPONS) || !validSlot(kit, KIT)) return null;
    const equipment = equipmentFor([firstWeapon, secondWeapon], kit);
    return equipment.length ? [CHASSIS[chassis], ...equipment] : null;
  }

  function buildCost(build) {
    const parts = buildParts(build);
    return parts && RESOURCES.map((_, i) => parts.reduce((sum, part) => sum + part.cost[i], 0));
  }

  function buildDuration(build) {
    const parts = buildParts(build);
    return parts && Math.round(parts.reduce((sum, part) => sum + part.assemblyTime, 0) * 10) / 10;
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

  function hasLineOfFire(terrain, origin, target) {
    let x = Math.round(origin.x);
    let y = Math.round(origin.y);
    const endX = Math.round(target.x);
    const endY = Math.round(target.y);
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const stepX = Math.sign(dx);
    const stepY = Math.sign(dy);
    const deltaX = stepX ? 1 / Math.abs(dx) : Infinity;
    const deltaY = stepY ? 1 / Math.abs(dy) : Infinity;
    let nextX = stepX ? Math.abs(x + stepX * .5 - origin.x) * deltaX : Infinity;
    let nextY = stepY ? Math.abs(y + stepY * .5 - origin.y) * deltaY : Infinity;
    const ridge = (column, row) => inBounds(column, row) && terrain[cellIndex(column, row)].kind === "ridge";
    while (x !== endX || y !== endY) {
      const crossX = x === endX ? Infinity : nextX;
      const crossY = y === endY ? Infinity : nextY;
      if (Math.abs(crossX - crossY) < 1e-9) {
        if (ridge(x + stepX, y) || ridge(x, y + stepY)) return false;
        x += stepX;
        y += stepY;
        nextX += deltaX;
        nextY += deltaY;
      } else if (crossX < crossY) {
        x += stepX;
        nextX += deltaX;
      } else {
        y += stepY;
        nextY += deltaY;
      }
      if (ridge(x, y)) return false;
    }
    return true;
  }

  function shotStatus(terrain, shooter, target, range = shooter.maxRange ?? shooter.range) {
    if (!range || distance(shooter, target) > weaponReach(shooter, target, range)) return "distant";
    return hasLineOfFire(terrain, shooter, target) ? "clear" : "blocked";
  }

  function findPath(terrain, origin, destination, firingRange = 0, hostileRange = 0) {
    const start = nearestWalkable(terrain, origin);
    const end = nearestWalkable(terrain, destination);
    const startId = cellIndex(start.x, start.y);
    const endId = cellIndex(end.x, end.y);
    const aim = firingRange ? destination : end;
    const estimate = (point) => Math.max(0, distance(point, aim) - firingRange);
    if (!firingRange && startId === endId) return [end];

    const costs = new Float64Array(terrain.length).fill(Infinity);
    const previous = new Int32Array(terrain.length).fill(-1);
    const closed = new Uint8Array(terrain.length);
    costs[startId] = 0;
    const open = [{ id: startId, score: estimate(start) }];
    while (open.length) {
      let best = 0;
      for (let i = 1; i < open.length; i++) if (open[i].score < open[best].score) best = i;
      const [{ id }] = open.splice(best, 1);
      if (closed[id]) continue;
      const reached = firingRange ? estimate(terrain[id]) === 0 && hasLineOfFire(terrain, terrain[id], aim) : id === endId;
      if (reached) {
        if (id === startId) return [start];
        const path = [];
        for (let current = id; current !== startId; current = previous[current]) {
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
        const tile = terrain[next];
        // A shorter-ranged opponent can spend extra movement getting behind cover.
        const exposed = hostileRange && distance(tile, aim) <= hostileRange && hasLineOfFire(terrain, aim, tile);
        const score = costs[id] + weight * (tile.kind === "crystal" ? 1.18 : 1) + (exposed ? 1.8 : 0);
        if (score >= costs[next]) continue;
        costs[next] = score;
        previous[next] = id;
        open.push({ id: next, score: score + estimate(tile) });
      }
    }
    return [];
  }

  class Match {
    constructor() {
      this.terrain = makeTerrain();
      this.nodes = NODE_DEFS.map(({ gateX, gateY, ...node }, index) => ({
        ...node, id: "station-" + index, faction: FACTION.neutral, gate: makeGate(gateX, gateY),
      }));
      this.bases = BASE_DEFS.map((base, index) => ({
        ...base, id: "base-" + index, type: "base", hull: BASE_HULL, hp: BASE_HULL, range: 3.3,
        damage: 16, cycle: 1.18, cooldown: 0, bank: STARTING_BANK.slice(), queue: [],
        gate: makeGate(base.x + 2 * base.faction, base.y), rates: BASE_INCOME,
      }));
      this.facilities = FACILITY_DEFS.map(({ gateX, gateY, ...site }, index) => ({
        ...site, id: "facility-" + index, faction: FACTION.neutral, gate: makeGate(gateX, gateY),
        queue: [], rates: FACILITY_INCOME,
      }));
      this.productionSites = [...this.bases, ...this.facilities];
      this.sites = [...this.nodes, ...this.productionSites];
      this.pads = [
        ...this.bases.flatMap((base) => PAD_OFFSETS.map((offset) => makePad(base, offsetFromBase(base, offset)))),
        ...this.facilities.filter((site) => site.type === "outpost").map((site) =>
          makePad(site, { x: site.x + (site.y > (HEIGHT - 1) / 2 ? 1 : -1), y: site.y })),
      ];
      this.units = [];
      this.effects = [];
      this.effectSequence = 0;
      this.news = [];
      this.newsSequence = 0;
      this.time = 0;
      this.nextThinking = 0;
      this.assaultLaunched = false;
      this.winner = null;
      this.reason = "";
      this.kills = 0;
      this.sequence = 0;
      this.mechNumbers = { [FACTION.ally]: 0, [FACTION.hostile]: 0 };
      for (const base of this.bases) {
        for (const [index, design] of STARTING_BUILDS.entries()) {
          const spot = offsetFromBase(base, [1, index * 2 - 1]);
          this.spawn(base.faction, spot.x, spot.y, design);
        }
      }
      this.log("Связь с лагерем «Эхо» установлена.", "ally", this.bases[0]);
    }

    log(message, tone = "", point = null, important = false) {
      this.news.unshift({ id: ++this.newsSequence, message, tone, time: this.time, important,
        point: point ? { x: point.x, y: point.y } : null });
      this.news.length = Math.min(12, this.news.length);
    }

    addEffect(type, point, duration, details = {}) {
      this.effects.push({ type, x: point.x, y: point.y, life: duration, max: duration,
        seed: ++this.effectSequence, ...details });
    }

    baseFor(faction) {
      return this.bases.find((base) => base.faction === faction);
    }

    productionFor(faction) {
      if (faction === FACTION.neutral) return [];
      return this.productionSites.filter((site) => site.faction === faction &&
        (site.type !== "base" || site.hp > 0));
    }

    queuedCount(faction) {
      return this.productionSites.reduce((total, site) => total + (site.faction === faction ? site.queue.length : 0), 0);
    }

    income(faction = FACTION.ally) {
      const total = [0, 0, 0];
      for (const site of this.productionFor(faction)) {
        site.rates.forEach((rate, resource) => { total[resource] += rate; });
      }
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
      const [chassisId, firstWeapon, secondWeapon, kitId] = normalizeBuild(build);
      const chassis = CHASSIS[chassisId];
      const weaponIds = [firstWeapon, secondWeapon];
      const weapons = weaponIds.map((id) => WEAPONS[id]).filter(Boolean);
      const kit = KIT[kitId];
      const hull = chassis.hull + (kit?.hull ?? 0);
      const spot = nearestWalkable(this.terrain, { x, y });
      const ally = faction === FACTION.ally;
      const mech = {
        ...spot, id: "mech-" + (++this.sequence), faction, type: "mech", chassisId, weaponIds, kitId,
        name: chassis.name + " / " + String(++this.mechNumbers[faction]).padStart(2, "0"),
        speed: chassis.speed, hull, hp: hull,
        range: weapons.length ? Math.min(...weapons.map((weapon) => weapon.range)) : 0,
        maxRange: Math.max(0, ...weapons.map((weapon) => weapon.range)),
        capture: kit?.capture ?? 1, repair: kit?.repair ?? 0,
        direction: ally ? -0.7 : 2.45, order: { kind: "hold" }, path: [], weaponCooldowns: [0, 0],
        hitAge: 100, replan: 0, moving: false, foot: 0,
      };
      this.units.push(mech);
      return mech;
    }

    setOrder(ids, target, kind = "move") {
      if (kind === "attack" && target.type === "base" && target.hp <= 0) kind = "capture";
      const active = this.allies().filter((unit) => ids.includes(unit.id) && (kind !== "attack" || unit.range > 0));
      if (kind === "capture" && active.length) {
        return this.orderGroupCapture(active, target) ? active.length : 0;
      }
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

    captureNearest(ids) {
      const group = this.allies().filter((unit) => ids.includes(unit.id));
      const closest = this.findNearestCapture(group);
      if (!closest) return null;
      this.orderGroupCapture(group, closest.site, closest);
      return closest.site;
    }

    captureLeader(site, faction) {
      const units = this.mechs(faction);
      return (site.faction !== faction && units.find((unit) => unit.id === site.gate.capturer &&
        !unit.path.length && distance(unit, site.gate) <= GATE_RADIUS)) ||
        units.find(({ order }) => order.kind === "capture" && order.target === site.id);
    }

    findNearestCapture(group, sites = this.sites, includeOwned = false) {
      if (!group.length) return null;
      const candidates = [];
      for (const site of sites) {
        const incumbent = this.captureLeader(site, group[0].faction);
        if (incumbent && !group.includes(incumbent)) continue;
        for (const unit of group) {
          if ((site.faction === unit.faction && !includeOwned) || (incumbent && incumbent !== unit)) continue;
          const remaining = unit.id === site.gate.capturer ? 1 - site.gate.progress : 1;
          const capturing = site.faction === unit.faction ? 0 : captureSeconds(site) * remaining / unit.capture;
          const lowerBound = distance(unit, site.gate) / unit.speed + capturing;
          candidates.push({ site, unit, lowerBound, capturing });
        }
      }
      candidates.sort((a, b) => a.lowerBound - b.lowerBound);
      let closest = null;
      for (const { site, unit, lowerBound, capturing } of candidates) {
        if (closest && lowerBound >= closest.time) break;
        const path = findPath(this.terrain, unit, site.gate);
        if (!path.length || distance(path.at(-1), site.gate) > GATE_RADIUS) continue;
        const travel = path.reduce((sum, point, i) => {
          const from = i ? path[i - 1] : unit;
          const slowing = this.terrain[cellIndex(Math.round(from.x), Math.round(from.y))].kind === "crystal" ? .78 : 1;
          return sum + distance(from, point) / (unit.speed * slowing);
        }, 0);
        const time = travel + capturing;
        if (!closest || time < closest.time) closest = { site, unit, time, path };
      }
      return closest;
    }

    attackNearestMech(ids) {
      const attackers = this.allies().filter((unit) => ids.includes(unit.id) && unit.range > 0);
      if (!attackers.length) return null;
      let closest = null;
      let bestDistance = Infinity;
      for (const target of this.mechs(FACTION.hostile)) {
        const range = Math.min(...attackers.map((unit) => distance(unit, target)));
        if (range >= bestDistance) continue;
        closest = target;
        bestDistance = range;
      }
      if (!closest) return null;
      for (const unit of attackers) this.giveOrder(unit, { kind: "attack", target: closest.id, focus: true });
      return closest;
    }

    orderGroupCapture(group, site, plan = null) {
      if (!group.length) return false;
      const incumbent = this.captureLeader(site, group[0].faction);
      const next = plan ?? (!incumbent && this.findNearestCapture(group, [site], true));
      const lead = incumbent ?? next?.unit;
      if (!lead) return false;
      this.orderCapture(lead, site, site.faction !== lead.faction, next?.path);
      const escort = lead.order.continuous ? lead.order : null;
      const separate = escort ? this.mechs(lead.faction).filter((unit) => !group.includes(unit) && unit.order.escort === escort) : [];
      const positions = this.coverPositions(site).filter((point) =>
        !separate.some(({ order }) => order.x === point.x && order.y === point.y));
      for (const unit of group) {
        if (unit === lead) continue;
        const position = positions.shift();
        this.giveOrder(unit, { kind: position ? "move" : "hold", ...position, escort });
      }
      return true;
    }

    giveOrder(unit, order, route) {
      unit.order = order;
      unit.engagement = null;
      unit.path = route ?? (["move", "attack-move", "capture", "repair"].includes(order.kind) ?
        findPath(this.terrain, unit, order) : []);
      unit.replan = 0;
    }

    orderCapture(unit, site, continuous = false, path) {
      const incumbent = this.captureLeader(site, unit.faction);
      if (incumbent && incumbent !== unit) return;
      if (unit.order.kind === "capture" && unit.order.target === site.id && unit.order.continuous === continuous) return;
      this.giveOrder(unit, { kind: "capture", target: site.id, x: site.gate.x, y: site.gate.y, continuous }, path);
    }

    continueCaptures() {
      const allies = this.allies();
      const teams = new Map();
      for (const unit of allies) {
        const escort = unit.order.escort;
        if (!escort) continue;
        if (!teams.has(escort)) teams.set(escort, []);
        teams.get(escort).push(unit);
      }
      for (const [order, group] of teams) {
        if (allies.some((unit) => unit.order === order)) continue;
        const site = this.sites.find(({ id }) => id === order.target);
        if (site && site.faction !== group[0].faction && this.orderGroupCapture(group, site)) continue;
        const next = this.findNearestCapture(group);
        if (next) this.orderGroupCapture(group, next.site, next);
        else for (const unit of group) this.giveOrder(unit, { kind: "hold" });
      }
      for (const lead of allies) {
        const { order } = lead;
        if (!order.continuous) continue;
        const site = this.sites.find(({ id }) => id === order.target);
        if (site.faction !== lead.faction) continue;
        const group = [lead, ...(teams.get(order) ?? [])];
        const next = this.findNearestCapture(group);
        if (next) this.orderGroupCapture(group, next.site, next);
        else for (const unit of group) this.giveOrder(unit, { kind: "hold" });
      }
    }

    advanceBaseAssault(shooter, base, weaponRange) {
      const allies = this.mechs(shooter.faction);
      if (allies.some((unit) => unit.id === base.gate.capturer ||
          (unit.order.kind === "capture" && unit.order.target === base.id))) return;

      const attackers = allies.filter((unit) => unit.order.kind === "attack" && unit.order.target === base.id);
      if (!attackers.length && shooter.type === "mech" && !shooter.order.escort) {
        const { kind } = shooter.order;
        const closingIn = (kind === "move" || kind === "attack-move") &&
          distance(shooter.order, base) <= weaponReach(shooter, base, weaponRange);
        if (kind === "hold" || closingIn) attackers.push(shooter);
      }
      this.orderGroupCapture(attackers, base);
    }

    coverPositions(site) {
      const { gate } = site;
      return NEIGHBORS.map(([dx, dy]) => ({ x: gate.x + dx, y: gate.y + dy }))
        .filter((point) => inBounds(point.x, point.y) && !this.terrain[cellIndex(point.x, point.y)].blocked &&
          this.sites.every((other) => distance(point, other) > .1 && distance(point, other.gate) > .1));
    }

    repairSites(faction) {
      return this.productionFor(faction).filter((site) => site.type !== "factory");
    }

    orderRepair(unit, site) {
      if (unit.order.kind === "repair" && unit.order.target === site.id) return;
      const point = nearestWalkable(this.terrain, offsetFromBase(site, [1, 0]));
      this.giveOrder(unit, { kind: "repair", target: site.id, ...point });
    }

    returnForRepairs(ids) {
      const sites = this.repairSites(FACTION.ally);
      let count = 0;
      for (const unit of this.allies()) {
        if (!ids.includes(unit.id) || !sites.length) continue;
        const nearest = sites.reduce((a, b) => distance(unit, b) < distance(unit, a) ? b : a);
        this.orderRepair(unit, nearest);
        count++;
      }
      return count;
    }

    canBuild(build, faction = FACTION.ally, site = this.baseFor(faction)) {
      const cost = buildCost(build);
      return !!cost && !this.winner && this.productionFor(faction).includes(site) &&
        this.mechs(faction).length + this.queuedCount(faction) < MAX_MECHS &&
        affordable(this.baseFor(faction).bank, cost);
    }

    requestBuild(build, faction = FACTION.ally, site = this.baseFor(faction)) {
      if (!this.canBuild(build, faction, site)) return false;
      const base = this.baseFor(faction);
      this.spend(base, buildCost(build));
      const duration = buildDuration(build);
      site.queue.push({ build: normalizeBuild(build).slice(), duration, remaining: duration });
      if (faction === FACTION.ally) this.log("Заказ принят · " + site.name + " · " + CHASSIS[build[0]].name, "ally", site);
      return true;
    }

    advanceFactory(site, dt) {
      let available = dt;
      while (available > 0 && site.queue.length) {
        const job = site.queue[0];
        if (job.remaining > available + 1e-9) {
          job.remaining -= available;
          return;
        }
        available = Math.max(0, available - job.remaining);
        site.queue.shift();
        const occupied = this.entities();
        const spots = RELEASE_OFFSETS.map((offset) => offsetFromBase(site, offset))
          .filter((point) => inBounds(point.x, point.y) && !this.terrain[cellIndex(point.x, point.y)].blocked &&
            this.sites.every((other) => distance(other, point) > .1 && distance(other.gate, point) > .1));
        const spot = spots.find((point) => occupied.every((entity) => distance(entity, point) > .7)) ?? spots[0] ?? site;
        const unit = this.spawn(site.faction, spot.x, spot.y, job.build);
        const name = site.faction === FACTION.ally ? unit.name : CHASSIS[job.build[0]].name;
        this.log("Выпуск меха · " + site.name + " · " + name, site.faction === FACTION.ally ? "ally" : "hostile", site);
      }
    }

    spend(base, cost) {
      cost.forEach((price, index) => { base.bank[index] -= price; });
    }

    cancelBuilds(site) {
      if (!site.queue.length) return;
      const { bank } = this.baseFor(site.faction);
      for (const job of site.queue) buildCost(job.build).forEach((price, index) => { bank[index] += price; });
      site.queue.length = 0;
    }

    turretsFor(faction) {
      return this.pads.filter(({ turret }) => turret?.faction === faction && turret.hp > 0);
    }

    freePad(faction = FACTION.ally, site = this.baseFor(faction)) {
      if (!this.productionFor(faction).includes(site)) return undefined;
      return this.pads.find((pad) => pad.site === site && (!pad.turret || pad.turret.hp <= 0));
    }

    requestTurret(faction = FACTION.ally, site = this.baseFor(faction)) {
      const base = this.baseFor(faction);
      const pad = this.freePad(faction, site);
      if (!pad || this.winner || this.turretsFor(faction).length >= MAX_TURRETS ||
          !affordable(base.bank, TURRET_COST)) return false;
      this.spend(base, TURRET_COST);
      pad.turret = {
        x: pad.x, y: pad.y, id: "turret-" + (++this.sequence), name: "Дозор",
        faction, type: "turret", siteName: site.name, hull: 172, hp: 172, damage: 18, cycle: 1.02, range: 4, cooldown: 0,
      };
      this.log("Турель «Дозор» развёрнута · " + site.name, faction === FACTION.ally ? "ally" : "hostile", pad);
      return true;
    }

    planEnemyProduction(enemies, allies, front = this.bases[0].gate) {
      const faction = FACTION.hostile;
      const home = this.baseFor(faction);
      const homeThreat = allies.some((unit) => distance(unit, home.gate) < 7);
      const sites = this.productionFor(faction);
      const exposed = sites.filter((site) => site.type === "outpost" &&
        allies.some((unit) => distance(unit, site.gate) < 6));
      if (!homeThreat || !this.requestTurret(faction, home)) {
        exposed.sort((a, b) => distance(a, front) - distance(b, front));
        exposed.some((site) => this.requestTurret(faction, site));
      }
      const scoutCount = enemies.filter((unit) => unit.capture > 1).length +
        sites.reduce((count, site) => count + site.queue.filter(({ build }) => build[3] === 0).length, 0);
      const expanding = this.facilities.some((site) => site.faction !== faction);
      const battlefront = homeThreat ? home.gate : front;
      const facingLongRange = allies.some((unit) => unit.maxRange >= 5 && distance(unit, battlefront) < 18);
      const preparingAssault = battlefront.y > HEIGHT * .59;
      const builds = homeThreat || (!facingLongRange && !preparingAssault) ? ENEMY_DEFENSE_BUILDS : ENEMY_SIEGE_BUILDS;
      let trainScout = !homeThreat && expanding && scoutCount < 2 && enemies.filter((unit) => unit.range > 0).length >= 3;
      const risk = (site) => distance(site, battlefront) + allies.filter((unit) => unit.range && distance(unit, site) < 4).length * 9;
      const ready = sites.filter((site) => !site.queue.length).sort((a, b) => risk(a) - risk(b));
      for (const site of ready) {
        if (trainScout && this.requestBuild(SCANNER_BUILD, faction, site)) {
          trainScout = false;
          continue;
        }
        builds.some((design) => this.requestBuild(design, faction, site));
      }
    }

    orderMove(unit, position) {
      if (unit.order.kind !== "move" || unit.order.x !== position.x || unit.order.y !== position.y) {
        this.giveOrder(unit, { kind: "move", x: position.x, y: position.y });
      }
    }

    defendSites(available, allies, citadel) {
      const alerts = this.sites.filter((site) => site.faction === FACTION.hostile).map((site) => {
        const home = site === citadel;
        const threats = allies.filter((unit) => distance(unit, site.gate) < (home ? 8 : 5.6) ||
          (home && unit.maxRange > 0 && distance(unit, site) <= unit.maxRange + 1));
        const intruder = threats.find((unit) => unit.id === site.gate.capturer);
        const priority = (home ? 30 : site.type === "outpost" ? 12 : site.type ? 8 : 0) +
          (intruder ? 16 + site.gate.progress * 24 : 0) + threats.length * 2;
        return { site, threats, intruder, priority };
      }).filter(({ threats }) => threats.length).sort((a, b) => b.priority - a.priority);

      for (const { site, threats, intruder } of alerts) {
        const home = site === citadel;
        if (intruder) {
          const blocker = takeBest(available, (unit) => distance(unit, site.gate) <= (home ? 13 : 8) ?
            distance(unit, site.gate) / unit.speed - unit.hp / unit.hull : Infinity);
          if (blocker) this.orderMove(blocker, site.gate);
        }
        const target = intruder ?? threats.reduce((a, b) =>
          distance(a, site.gate) + 2 * a.hp / a.hull < distance(b, site.gate) + 2 * b.hp / b.hull ? a : b);
        const count = home ? Math.min(4, 2 + threats.filter((unit) => unit.range).length) :
          Math.min(2, intruder ? 2 : threats.length);
        for (let i = 0; i < count; i++) {
          const gun = takeBest(available, (unit) => unit.range && distance(unit, site.gate) < (home ? 30 : 17) ?
            Math.max(0, distance(unit, target) - unit.maxRange) / unit.speed : Infinity);
          if (gun) this.orderAttack(gun, target);
        }
      }
      return alerts.find(({ site }) => site === citadel);
    }

    supportPosition(unit, site, allies, positions) {
      const threats = allies.filter((target) => distance(target, site.gate) < 6.5 && distance(unit, target) < 14);
      const score = (target) => distance(unit, target) + 3 * target.hp / target.hull;
      const target = threats.reduce((best, candidate) => !best || score(candidate) < score(best) ? candidate : best, null);
      if (target) {
        this.orderAttack(unit, target);
      } else if (positions.length) {
        const position = positions.reduce((best, point) => distance(unit, point) < distance(unit, best) ? point : best);
        positions.splice(positions.indexOf(position), 1);
        this.orderMove(unit, position);
      }
    }

    advanceFront(available, allies, opportunities, citadel) {
      const goals = [];
      const groups = available.length >= 6 ? 2 : 1;
      for (let i = 0; i < groups && available.length && opportunities.length; i++) {
        const reserves = new Map(opportunities.map((site) => [site, this.captureLeader(site, FACTION.hostile)]));
        const eligible = opportunities.filter((site) => !reserves.get(site) || available.includes(reserves.get(site)));
        if (!eligible.length) break;
        const score = (site) => {
          const time = Math.min(...available.map((unit) => distance(unit, site.gate) / unit.speed));
          const resistance = allies.filter((unit) => unit.range && distance(unit, site.gate) < 6).length;
          const committed = available.some((unit) => unit.order.kind === "capture" && unit.order.target === site.id);
          return time + resistance * 4 + distance(citadel, site.gate) * .07 -
            (site.type === "outpost" ? 3.4 : site.type ? 3 : 0) -
            (site.faction === FACTION.ally ? 2.5 : 0) - (committed ? 6 : 0);
        };
        const site = takeBest(eligible, score);
        opportunities.splice(opportunities.indexOf(site), 1);
        const plan = this.findNearestCapture(available, [site]);
        if (!plan) continue;
        available.splice(available.indexOf(plan.unit), 1);
        this.orderCapture(plan.unit, site, false, plan.path);
        goals.push({ site, positions: this.coverPositions(site) });
      }
      for (const { site, positions } of goals) {
        const escort = takeBest(available, (unit) => unit.range ? distance(unit, site.gate) / unit.speed : Infinity);
        if (escort) this.supportPosition(escort, site, allies, positions);
      }
      for (const unit of available) {
        const goal = goals.reduce((best, other) =>
          !best || distance(unit, other.site.gate) < distance(unit, best.site.gate) ? other : best, null);
        if (unit.range && goal) this.supportPosition(unit, goal.site, allies, goal.positions);
        else if (unit.order.kind !== "hold") this.giveOrder(unit, { kind: "hold" });
      }
      return goals[0]?.site.gate ?? citadel.gate;
    }

    attackCamp(available, allies, camp, staging) {
      const fighters = available.filter((unit) => unit.range > 0);
      if (camp.hp <= 0) {
        const plan = this.findNearestCapture(available, [camp]);
        if (plan) {
          available.splice(available.indexOf(plan.unit), 1);
          this.orderCapture(plan.unit, camp, false, plan.path);
        }
        const positions = this.coverPositions(camp);
        for (const unit of available) if (unit.range) this.supportPosition(unit, camp, allies, positions);
        return camp.gate;
      }

      if (!this.assaultLaunched && staging && fighters.length >= 3 &&
          fighters.filter((unit) => distance(unit, staging.gate) < 7 || distance(unit, camp.gate) < 11).length < 3) {
        const positions = this.coverPositions(staging);
        for (const unit of fighters) this.supportPosition(unit, staging, allies, positions);
        return staging.gate;
      }
      this.assaultLaunched = true;
      const guards = allies.filter((unit) => distance(unit, camp.gate) < 8);
      for (const unit of fighters) {
        const targets = guards.filter((guard) => distance(unit, guard) < unit.maxRange + 3);
        const score = (target) => distance(unit, target) + 4 * target.hp / target.hull + (target.range ? 0 : 2);
        const target = targets.reduce((best, candidate) => !best || score(candidate) < score(best) ? candidate : best, null);
        this.orderAttack(unit, target ?? camp);
      }
      for (const unit of available) if (!unit.range && unit.order.kind !== "hold") this.giveOrder(unit, { kind: "hold" });
      return camp.gate;
    }

    think(enemies, allies) {
      const [camp, citadel] = this.bases;
      const faction = FACTION.hostile;
      const repair = this.repairSites(faction).filter((site) =>
        !allies.some((unit) => unit.range && distance(unit, site) < unit.maxRange + 2));
      const available = enemies.filter((unit) => {
        const recovering = unit.order.kind === "repair" && unit.hp < unit.hull * .89;
        if (!recovering && unit.hp > unit.hull * .43) return true;
        const near = repair.filter((site) => distance(unit, site) <= 18);
        if (!near.length) return true;
        const safe = near.reduce((a, b) => distance(unit, b) < distance(unit, a) ? b : a);
        this.orderRepair(unit, safe);
        return false;
      });
      const homeThreat = this.defendSites(available, allies, citadel);
      if (homeThreat) {
        const positions = this.coverPositions(citadel);
        for (const unit of available) {
          if (unit.range && (distance(unit, citadel.gate) < 24 || homeThreat.intruder)) {
            this.supportPosition(unit, citadel, allies, positions);
          }
        }
        return citadel.gate;
      }

      const occupied = this.facilities.filter((site) => site.faction === faction);
      if (available.filter((unit) => unit.range).length >= 5 || (citadel.hp < citadel.hull * .7 && available.length >= 3)) {
        const guard = takeBest(available, (unit) => unit.range && distance(unit, citadel.gate) <= 22 ?
          distance(unit, citadel.gate) / unit.speed : Infinity);
        if (guard) this.orderMove(guard, citadel.gate);
      }
      const opportunities = [...this.facilities, ...this.nodes].filter((site) => site.faction !== faction);
      const staging = occupied.filter((site) => distance(site.gate, camp.gate) < 25).reduce((best, site) =>
        !best || distance(site.gate, camp.gate) < distance(best.gate, camp.gate) ? site : best, null);
      const fighters = available.filter((unit) => unit.range).length;
      const ready = fighters >= (this.assaultLaunched ? 2 : 3);
      if (camp.hp <= 0 || !opportunities.length || (ready && occupied.length >= 3 && staging)) {
        return this.attackCamp(available, allies, camp, staging);
      }
      this.assaultLaunched = false;
      return this.advanceFront(available, allies, opportunities, citadel);
    }

    orderAttack(unit, target) {
      if (unit.order.kind !== "attack" || unit.order.target !== target.id) {
        const reach = unit.maxRange >= 5 ? unit.maxRange : unit.range;
        this.giveOrder(unit, { kind: "attack", target: target.id, reach });
      }
    }

    fire(shooter, target, slot) {
      const isMech = shooter.type === "mech";
      if (isMech && slot === undefined) slot = shooter.weaponIds.findIndex((id) => id !== null);
      const weaponId = isMech ? shooter.weaponIds[slot] : null;
      const weapon = isMech ? WEAPONS[weaponId] : shooter;
      if (!weapon || weapon.damage <= 0 || target.hp <= 0 || !hasLineOfFire(this.terrain, shooter, target)) return;
      if (isMech) shooter.weaponCooldowns[slot] = weapon.cycle;
      else shooter.cooldown = shooter.cycle;
      shooter.direction = Math.atan2(target.y - shooter.y, target.x - shooter.x);
      target.hp = Math.max(0, target.hp - weapon.damage);
      target.hitAge = 0;
      const hostile = shooter.faction === FACTION.hostile;
      const color = weaponId === 0 && hostile ? "#ff9173" : weaponId === 2 && hostile ? "#f49cf5" :
        weapon.color || (hostile ? "#ff826d" : "#ffc47a");
      this.addEffect("shot", shooter, .48, {
        tx: target.x, ty: target.y, weaponId, color,
        high: shooter.type === "base" ? 24 : shooter.type === "turret" ? 14 : 11,
        turretAngle: shooter.type === "turret" ? shooter.direction : null,
        targetHigh: target.type === "base" ? 18 : target.type === "turret" ? 11 : 7,
        mech: isMech ? {
          chassisId: shooter.chassisId, weaponId, slot, direction: shooter.direction,
          moving: shooter.moving, foot: shooter.foot,
        } : null,
        targetChassis: target.chassisId,
      });
      if (target.hp > 0) return;
      const wreck = target.type === "mech" ? {
        chassisId: target.chassisId, weaponIds: target.weaponIds, kitId: target.kitId,
        faction: target.faction, direction: target.direction + .44, wreck: true,
      } : null;
      const size = target.type === "base" ? 1.7 : target.chassisId === 2 ? 1.27 : 1;
      this.addEffect("burst", target, 6.5, { size, wreck, color });
      if (target.type === "mech") {
        const bank = this.baseFor(shooter.faction).bank;
        bank[0] += 14;
        bank[2] += 2;
        if (target.faction === FACTION.hostile) {
          this.kills++;
          this.log("Уничтожен вражеский мех «" + target.name + "».", "ally", target);
        } else {
          this.log("Потеря меха «" + target.name + "».", "hostile", target, true);
        }
      } else if (target.type === "turret") {
        const lost = target.faction === FACTION.ally;
        this.log("Турель «Дозор» уничтожена · " + target.siteName, lost ? "hostile" : "ally", target, lost);
      } else if (target.type === "base") {
        const allied = target.faction === FACTION.ally;
        this.cancelBuilds(target);
        this.log(allied ? "Оборона лагеря отключена. Защитите ворота." : "Оборона Цитадели отключена. Займите ворота.",
          allied ? "hostile" : "ally", target.gate, true);
        this.advanceBaseAssault(shooter, target, weapon.range);
      }
    }

    nearestTarget(shooter, entities, range, prioritizeArmed = false) {
      let best = null;
      let lowest = Infinity;
      for (const other of entities) {
        if (other.hp <= 0 || shooter.faction === other.faction) continue;
        const score = distance(shooter, other) + (prioritizeArmed && other.range === 0 ? 3 : 0);
        if (score < lowest && shotStatus(this.terrain, shooter, other, range) === "clear") {
          best = other;
          lowest = score;
        }
      }
      return best;
    }

    updateUnit(unit, entities, dt) {
      unit.hitAge += dt;
      unit.replan -= dt;
      unit.moving = false;

      const repairSites = this.repairSites(unit.faction);
      if (unit.order.kind === "repair" && !repairSites.some((site) => site.id === unit.order.target)) {
        this.giveOrder(unit, { kind: "hold" });
      }
      let orderedTarget = null;
      if (unit.order.kind === "attack") {
        orderedTarget = entities.find((target) => target.id === unit.order.target && target.hp > 0);
        if (!orderedTarget) this.giveOrder(unit, { kind: "hold" });
      }
      const reach = unit.order.reach ?? unit.range;
      unit.engagement = null;
      if (unit.order.kind === "attack-move" && unit.maxRange) {
        orderedTarget = this.nearestTarget(unit, entities, unit.maxRange, true);
        unit.engagement = orderedTarget?.id ?? null;
      }
      const engagingOnRoute = unit.order.kind === "attack-move" && orderedTarget;
      if (!engagingOnRoute && orderedTarget && shotStatus(this.terrain, unit, orderedTarget, reach) === "clear") {
        unit.path.length = 0;
      } else if (!engagingOnRoute) {
        if (orderedTarget && unit.replan <= 0) {
          const avoid = unit.faction === FACTION.hostile && orderedTarget.type === "mech" &&
            orderedTarget.maxRange > reach ? orderedTarget.maxRange : 0;
          unit.path = findPath(this.terrain, unit, orderedTarget, weaponReach(unit, orderedTarget, reach), avoid);
          unit.replan = 0.55;
        }
        this.advance(unit, dt);
      }
      for (const [slot, id] of unit.weaponIds.entries()) {
        const weapon = WEAPONS[id];
        if (!weapon) continue;
        unit.weaponCooldowns[slot] = Math.max(0, unit.weaponCooldowns[slot] - dt);
        if (unit.weaponCooldowns[slot] > 1e-9) continue;
        if (orderedTarget?.hp > 0 && shotStatus(this.terrain, unit, orderedTarget, weapon.range) === "clear") {
          this.fire(unit, orderedTarget, slot);
        } else if (!unit.order.focus) {
          const target = this.nearestTarget(unit, entities, weapon.range, unit.order.kind === "attack-move");
          if (target) this.fire(unit, target, slot);
        }
      }
      const baseRepair = repairSites.some((site) => distance(unit, site) <= 2.08) ? 11 : 0;
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
      const lastFoot = unit.foot;
      unit.foot += dt * unit.speed * 7.5;
      const contact = Math.floor(unit.foot / Math.PI);
      if (contact > Math.floor(lastFoot / Math.PI)) {
        const side = unit.chassisId === 2 ? .17 : contact % 2 === 0 ? .15 : -.15;
        this.addEffect("dust", {
          x: unit.x - .18 * dx / range - side * dy / range,
          y: unit.y - .18 * dy / range + side * dx / range,
        }, .8, { size: [.76, 1, 1.24][unit.chassisId] });
      }
      unit.moving = true;
    }

    updateDefense(entities, dt) {
      for (const position of entities) {
        if (position.type === "mech" || position.hp <= 0) continue;
        position.cooldown -= dt;
        if (position.cooldown > 0) continue;
        const target = this.nearestTarget(position, entities, position.range);
        if (target) this.fire(position, target);
      }
    }

    updateCaptures(dt) {
      for (const site of this.sites) {
        const { gate } = site;
        const wasThreatened = gate.faction === FACTION.hostile;
        const inside = this.units.filter((unit) => unit.hp > 0 && distance(unit, gate) <= GATE_RADIUS);
        gate.contested = inside.some((unit) => unit.faction === FACTION.ally) &&
          inside.some((unit) => unit.faction === FACTION.hostile);
        const ready = inside.filter((unit) => unit.faction !== site.faction && !unit.moving && !unit.path.length);
        const capturer = ready.find((unit) => unit.id === gate.capturer) ?? ready[0];
        if (gate.capturer !== (capturer?.id ?? null)) gate.progress = 0;
        gate.capturer = capturer?.id ?? null;
        gate.faction = capturer?.faction ?? FACTION.neutral;
        if (site.faction === FACTION.ally && gate.faction === FACTION.hostile && !wasThreatened &&
            this.time >= (gate.nextWarning ?? 0)) {
          gate.nextWarning = this.time + 5;
          this.log("Противник у ворот · " + site.name, "hostile", gate, true);
        }
        if (!capturer || gate.contested) continue;

        gate.progress = Math.min(1, gate.progress + dt * capturer.capture / captureSeconds(site));
        if (gate.progress < 1 - 1e-9) continue;
        const allied = capturer.faction === FACTION.ally;
        this.addEffect("capture", gate, .95, { faction: capturer.faction });
        if (site.type === "base") {
          gate.progress = 1;
          this.finish(capturer.faction, allied ? "Цитадель захвачена." : "Мехи противника захватили лагерь «Эхо».");
          return;
        }
        if (site.type) this.cancelBuilds(site);
        const pad = this.pads.find((entry) => entry.site === site && entry.turret);
        if (pad) {
          if (pad.turret.hp > 0) this.addEffect("burst", pad, 3.5, { size: .7 });
          pad.turret = null;
        }
        const lost = site.faction === FACTION.ally && !allied;
        site.faction = capturer.faction;
        if (!site.type) {
          const { bank } = this.baseFor(site.faction);
          bank[0] += 24;
          bank[2] += 6;
        }
        gate.progress = 0;
        gate.capturer = null;
        gate.faction = FACTION.neutral;
        const name = site.type ? site.name : "Станция «" + site.name + "»";
        this.log(name + (allied ? " · под нашим контролем" : " · под контролем противника"),
          allied ? "ally" : "hostile", gate, lost);
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
        this.income(base.faction).forEach((value, i) => { base.bank[i] += value * dt; });
      }
      for (const faction of [FACTION.ally, FACTION.hostile]) {
        for (const site of this.productionFor(faction)) this.advanceFactory(site, dt);
      }
      if (this.time >= this.nextThinking) {
        const enemies = this.mechs(FACTION.hostile);
        const allies = this.allies();
        const front = this.think(enemies, allies);
        this.planEnemyProduction(enemies, allies, front);
        this.nextThinking = this.time + 0.76;
      }

      const entities = this.entities();
      this.updateDefense(entities, dt);
      for (const unit of this.units) if (unit.hp > 0) this.updateUnit(unit, entities, dt);
      this.units = this.units.filter((unit) => unit.hp > 0);
      this.updateCaptures(dt);
      if (!this.winner) this.continueCaptures();
      for (const effect of this.effects) effect.life -= dt;
      this.effects = this.effects.filter((effect) => effect.life > 0);

    }
  }

  return { WIDTH, HEIGHT, MAX_MECHS, MAX_TURRETS, BASE_CAPTURE_SECONDS, FACILITY_CAPTURE_SECONDS, RESOURCES, FACTION, CHASSIS, WEAPONS, KIT, TURRET_COST,
    DEFAULT_BUILD, Match, clamp, distance, noise, findPath, nearestWalkable, shotStatus, hasLineOfFire, buildCost, buildDuration, equipmentFor, affordable };
})();

if (typeof module === "object" && module.exports) module.exports = EchoSim;
