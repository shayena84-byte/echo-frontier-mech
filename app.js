"use strict";

(() => {
  const {
    WIDTH, HEIGHT, MAX_MECHS, MAX_TURRETS, BASE_CAPTURE_SECONDS, RESOURCES, FACTION, CHASSIS, WEAPONS, KIT,
    TURRET_COST, DEFAULT_BUILD, Match, affordable, buildCost, buildDuration, equipmentFor, clamp, nearestWalkable, shotStatus,
  } = EchoSim;
  const resourceNames = ["сплав", "энергия", "данные"];
  const $ = (id) => document.getElementById(id);
  const canvas = $("terrain");
  const minimap = $("minimap");
  const minimapControl = $("minimap-control");
  const view = new FrontierView(canvas, minimap);
  const manual = $("manual");
  const inspector = $("object-inspector");
  const buildQueue = $("build-queue");
  const productionPicker = $("production-site");
  const pauseButton = $("pause");
  const followButton = $("inspect-follow");
  const speedButtons = [...document.querySelectorAll(".speed-options button")];
  const speeds = [0.5, 1, 2];
  const format = new Intl.NumberFormat("ru", { maximumFractionDigits: 1 });
  const rateFormat = new Intl.NumberFormat("ru", { maximumFractionDigits: 3 });
  const [chassisTimes, weaponTimes, kitTimes] = [CHASSIS, WEAPONS, KIT]
    .map((catalog) => catalog.map((part) => part.assemblyTime));
  const minAssembly = Math.min(...chassisTimes) + Math.min(...weaponTimes, ...kitTimes);
  const maxAssembly = Math.max(...chassisTimes) + 2 * Math.max(...weaponTimes) + Math.max(...kitTimes);
  const assemblyRange = format.format(minAssembly) + "–" + format.format(maxAssembly) + " с на меха";
  const unitCards = new Map();
  const mapPointers = new Map();
  const isFriendlyMech = (entity) => entity.type === "mech" && entity.faction === FACTION.ally;
  const isOrderTarget = (entity) => entity.gate || entity.faction === FACTION.hostile;
  let match = new Match();
  let selected = new Set([match.allies()[0].id]);
  let inspected = null;
  let phase = "briefing";
  let lastFrame = 0;
  let lastPanels = -1;
  let lastShot = -1;
  let currentSound = null;
  let audioEnabled = false;
  let stepBank = 0;
  let speed = speeds[0];
  let lastPreview = "";
  let shownQueue = [];
  let factoryListKey = null;
  let pointerType = "";
  let mapMoved = false;
  let attackMoveMode = false;
  let announcedEvent = null;
  let loggedEvent = null;

  const timeText = (seconds) => {
    const rounded = Math.max(0, Math.ceil(seconds));
    return String(Math.floor(rounded / 60)).padStart(2, "0") + ":" + String(rounded % 60).padStart(2, "0");
  };
  const secondsText = (seconds) => format.format(seconds) + " с";
  const buildEta = (seconds) => secondsText(Math.ceil(seconds * 10 - 1e-9) / 10);

  function setText(id, value) {
    const element = $(id);
    if (element.textContent !== String(value)) element.textContent = value;
  }

  function setProgress(id, value) {
    $(id).style.width = clamp(value * 100, 0, 100) + "%";
  }

  function simulationRunning() {
    return phase === "running" && !manual.open;
  }

  function ordersAllowed() {
    return (phase === "running" || phase === "paused") && !manual.open;
  }

  function touchClick(event) {
    const type = event.pointerType || pointerType;
    return type === "touch" || type === "pen" || event.sourceCapabilities?.firesTouchEvents === true;
  }

  function onRightClick(element, action) {
    element.addEventListener("contextmenu", (event) => {
      if (!ordersAllowed()) return;
      event.preventDefault();
      if (event.button === 2 || (event.button === 0 && event.ctrlKey)) action(event);
    });
  }

  function tone(frequency, duration = 0.12, level = 0.055, ending = frequency) {
    if (!audioEnabled || !currentSound || currentSound.state !== "running") return;
    const time = currentSound.currentTime;
    const oscillator = currentSound.createOscillator();
    const envelope = currentSound.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, time);
    oscillator.frequency.exponentialRampToValueAtTime(ending, time + duration);
    envelope.gain.setValueAtTime(.001, time);
    envelope.gain.exponentialRampToValueAtTime(level, time + .014);
    envelope.gain.exponentialRampToValueAtTime(.001, time + duration);
    oscillator.connect(envelope).connect(currentSound.destination);
    oscillator.start(time);
    oscillator.stop(time + duration + .02);
  }

  function selectUnit(id, append = false, center = false) {
    const unit = match.allies().find((item) => item.id === id);
    if (!unit) return;
    if (!append) selected.clear();
    if (append && selected.has(id)) selected.delete(id);
    else selected.add(id);
    if (center && !append && view.zoom > 1 && !view.followedId) view.zoomTo(view.zoom, unit);
    tone(455);
    showInspection(unit);
  }

  function showInspection(entity) {
    inspected = entity;
    if (entity) toggleEventList(false);
    updatePanels();
    if (entity) inspector.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function describeOrder(unit) {
    const { order } = unit;
    if (order.escort && match.units.some((other) => other.hp > 0 && other.order === order.escort)) {
      const site = match.sites.find(({ id }) => id === order.escort.target);
      if (site) return "Прикрывать захват · " + site.name;
    }
    const site = match.sites.find(({ id }) => id === order.target);
    switch (order.kind) {
      case "attack": {
        const target = site ?? match.entities().find(({ id }) => id === order.target);
        return target ? "Атаковать · " + target.name : "Атаковать";
      }
      case "attack-move": {
        const contact = unit.engagement && match.entities().find(({ id }) => id === unit.engagement);
        const status = contact ? "В бою" : unit.path.length ? "Атака с продвижением" : "Атака · на позиции";
        return status + " · клетка " + (order.x + 1) + ", " + (order.y + 1);
      }
      case "capture":
        if (!site) return "Захват";
        if (site.faction === unit.faction) return "Оборонять ворота · " + site.name;
        if (site.gate.capturer === unit.id) {
          const progress = site.gate.contested ? "Захват оспаривается" : "Захват " + Math.floor(site.gate.progress * 100) + "%";
          return progress + " · " + site.name;
        }
        return "Захват · " + site.name;
      case "repair":
        return site ? "На ремонт · " + site.name : "На ремонт";
      case "move":
        return (unit.path.length ? "Переместиться" : "На позиции") + " · клетка " + (order.x + 1) + ", " + (order.y + 1);
      default:
        return "Удерживать позицию";
    }
  }

  function updateInspection(canCommand, hasArmed) {
    if (inspected?.type === "mech" && inspected.hp <= 0) inspected = null;
    inspector.hidden = !inspected;
    if (!inspected) return;

    const entity = inspected;
    const mech = entity.type === "mech";
    const ally = entity.faction === FACTION.ally;
    const neutral = entity.faction === FACTION.neutral;
    const owner = ally ? (mech ? "Ваш отряд" : "Под вашим контролем") :
      neutral ? "Нейтральный объект" : mech ? "Мех противника" : "Под контролем противника";
    inspector.classList.toggle("ally", ally);
    inspector.classList.toggle("hostile", !ally && !neutral);
    setText("inspection-name", entity.name);
    $("inspection-mech").hidden = !mech;
    $("inspection-site").hidden = mech;
    if (mech) {
      setText("inspection-status", owner + " · " + Math.ceil(entity.hp) + " / " + entity.hull + " ОЗ");
      setText("inspect-chassis", CHASSIS[entity.chassisId].name);
      setText("inspect-module", KIT[entity.kitId]?.name ?? "—");
      setText("inspect-weapon-1", WEAPONS[entity.weaponIds[0]]?.name ?? "—");
      setText("inspect-weapon-2", WEAPONS[entity.weaponIds[1]]?.name ?? "—");
      setText("inspect-order", describeOrder(entity));
      const id = entity.order.kind === "attack" ? entity.order.target : entity.engagement;
      const target = id && match.entities().find((candidate) => candidate.id === id);
      $("fire-line-status").hidden = !target;
      if (target) {
        const status = shotStatus(match.terrain, entity, target);
        setText("inspect-fire-line", { clear: "Открыта", blocked: "Перекрыта скалой", distant: "Цель вне дальности" }[status]);
      }
    } else {
      const active = match.productionFor(entity.faction).includes(entity);
      const paused = !simulationRunning();
      const status = neutral ? "выпуск после захвата" : !active ? "выпуск остановлен" : paused ? "пауза" : "";
      setText("inspection-status", status ? owner + " · " + status : owner);
      setText("inspect-income-label", neutral ? "Доход после захвата за игровую секунду" : "Доход за игровую секунду");
      for (const [i, resource] of RESOURCES.entries()) {
        setText("inspect-" + resource, rateFormat.format(active || neutral ? entity.rates[i] : 0));
      }
      setText("inspect-capacity", active || neutral ? assemblyRange : "Остановлен");
      const job = entity.queue[0];
      setText("inspect-queue", job ? entity.queue.length + " · " + CHASSIS[job.build[0]].name + " · " +
        buildEta(job.remaining) + " до выпуска" : "Нет заказов");
    }

    const canAttack = !ally && (mech || (entity.type === "base" && entity.hp > 0));
    $("inspect-gate").hidden = mech;
    $("inspect-gate").disabled = !canCommand;
    $("inspect-attack").hidden = !canAttack;
    $("inspect-attack").disabled = !canCommand || !hasArmed;
    followButton.hidden = !mech;
    followButton.setAttribute("aria-pressed", String(view.followedId === entity.id));
  }

  function selectAll() {
    if (!ordersAllowed()) return;
    selected = new Set(match.allies().map((unit) => unit.id));
    tone(540);
    updatePanels();
  }

  function command(target, kind = "move") {
    if (!ordersAllowed()) return false;
    if (!match.setOrder([...selected], target, kind)) {
      if (kind === "attack" && selected.size) {
        match.log("Для атаки выберите меха с оружием.");
        updatePanels();
      }
      return false;
    }
    attackMoveMode = false;
    showOrder(target, kind);
    updatePanels();
    return true;
  }

  function showOrder(target, kind) {
    const destination = kind === "capture" ? target.gate : target;
    view.marker = kind === "hold" ? null : {
      x: destination.x, y: destination.y, time: performance.now() / 1000,
      faction: kind === "attack" ? FACTION.hostile : FACTION.ally, kind,
    };
    tone(kind === "attack" ? 365 : 620, .14, .045, 470);
  }

  function commandNearest(kind) {
    if (!ordersAllowed() || !selected.size) return;
    const capture = kind === "capture";
    const target = capture ? match.captureNearest([...selected]) : match.attackNearestMech([...selected]);
    if (target) {
      attackMoveMode = false;
      showOrder(target, kind);
      match.log(capture ? "Приказ на захват · " + target.name : "Приказ атаковать · " + target.name + ".",
        "ally", capture ? target.gate : target);
    } else if (capture) {
      match.log("Нет доступных ворот для нового приказа.");
    }
    updatePanels();
  }

  function setSpeed(index) {
    speed = speeds[index];
    speedButtons.forEach((button, i) => button.setAttribute("aria-pressed", String(i === index)));
  }

  function start(reset = false) {
    if (reset) {
      match = new Match();
      selected = new Set([match.allies()[0].id]);
      for (const item of unitCards.values()) item.button.remove();
      unitCards.clear();
      view.marker = null;
      view.hover = null;
      view.overview();
      productionPicker.value = match.bases[0].id;
      setSpeed(0);
    }
    attackMoveMode = false;
    toggleEventList(false);
    inspected = null;
    phase = "paused";
    stepBank = 0;
    $("intro").hidden = true;
    $("end-screen").hidden = true;
    canvas.focus({ preventScroll: true });
    tone(445, .25, .055, 735);
    updatePanels();
  }

  function togglePause() {
    if (phase !== "running" && phase !== "paused") return;
    phase = phase === "paused" ? "running" : "paused";
    lastFrame = performance.now() / 1000;
    updatePanels();
  }

  function showEnd() {
    phase = "ended";
    inspected = null;
    const won = match.winner === FACTION.ally;
    setText("end-kicker", won ? "Сигнал принят" : "Связь потеряна");
    setText("end-title", won ? "Операция удалась" : "Лагерь пал");
    setText("end-reason", match.reason);
    setText("result-time", timeText(match.time));
    setText("result-kills", match.kills);
    $("end-screen").hidden = false;
    $("restart").focus({ preventScroll: true });
    tone(won ? 522 : 210, .43, .08, won ? 784 : 110);
    updatePanels();
  }

  function makeCard(className) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    const call = document.createElement("span");
    call.className = "call";
    call.setAttribute("aria-hidden", "true");
    const name = document.createElement("strong");
    const state = document.createElement("small");
    button.append(call, name, state);
    return { button, call, name, state };
  }

  function bindCaptureControl(button, getSite, inspectOnClick = false) {
    const sendToGate = () => {
      const site = getSite();
      if (command(site, "capture") && view.zoom > 1) view.zoomTo(view.zoom, site.gate);
    };
    onRightClick(button, sendToGate);
    button.addEventListener("click", inspectOnClick ? () => showInspection(getSite()) : sendToGate);
  }

  bindCaptureControl($("citadel-gate-order"), () => match.bases[1], true);
  const nodeCards = match.nodes.map((node, index) => {
    const card = makeCard("station");
    card.name.textContent = node.name;
    card.call.textContent = node.call;
    card.button.title = "Занять ворота станции · " + resourceNames[node.resource] + " +" + format.format(node.income) + "/с";
    bindCaptureControl(card.button, () => match.nodes[index]);
    $("stations").append(card.button);
    return card;
  });
  const facilityCards = match.facilities.map((site, index) => {
    const card = makeCard("station facility");
    card.name.textContent = site.name;
    card.call.textContent = site.call;
    card.button.title = "Сведения о площадке · правый клик отправляет к воротам";
    bindCaptureControl(card.button, () => match.facilities[index], true);
    $("facilities").append(card.button);
    return card;
  });

  const emptySquad = document.createElement("span");
  emptySquad.className = "empty-squad";
  emptySquad.textContent = "Мастерская может собрать новый мех.";
  $("units").append(emptySquad);

  function equipmentNames(weaponIds, kitId) {
    return equipmentFor(weaponIds, kitId).map((item) => item.name).join(" · ");
  }

  function renderSquad(allies, active) {
    const living = new Set(allies.map((unit) => unit.id));
    const hadSelection = selected.size > 0;
    for (const [id, card] of unitCards) {
      if (living.has(id)) continue;
      card.button.remove();
      unitCards.delete(id);
      selected.delete(id);
    }
    if (!selected.size && allies.length && (hadSelection || !unitCards.size)) selected.add(allies[0].id);
    emptySquad.hidden = allies.length > 0;
    for (const [index, unit] of allies.entries()) {
      let card = unitCards.get(unit.id);
      if (!card) {
        card = makeCard("unit");
        card.name.textContent = unit.name;
        card.button.title = equipmentNames(unit.weaponIds, unit.kitId);
        card.button.addEventListener("click", (event) => selectUnit(unit.id, event.shiftKey, true));
        unitCards.set(unit.id, card);
        $("units").append(card.button);
      }
      const picked = selected.has(unit.id);
      const hp = Math.ceil(unit.hp);
      card.call.textContent = index + 1;
      card.state.textContent = hp + " ОЗ";
      card.button.classList.toggle("selected", picked);
      card.button.disabled = !active;
      card.button.setAttribute("aria-pressed", String(picked));
      card.button.style.setProperty("--fill", unit.hp / unit.hull * 100 + "%");
      card.button.style.setProperty("--meter", hp < unit.hull * .35 ? "#ff937b" : "#7fe9c4");
    }
  }

  const costs = RESOURCES.map((resource, index) => {
    const item = document.createElement("span");
    item.className = "cost-item " + resource;
    item.title = resourceNames[index];
    $("build-cost").append(item);
    return item;
  });
  const buildSlots = [
    { id: "chassis", catalog: CHASSIS },
    { id: "weapon-1", catalog: WEAPONS },
    { id: "weapon-2", catalog: WEAPONS },
    { id: "module", catalog: KIT },
  ];
  function currentBuild() {
    return buildSlots.map(({ id }) => {
      const { value } = $(id);
      return value === "" ? null : Number(value);
    });
  }
  for (const [slot, { id, catalog }] of buildSlots.entries()) {
    const field = $(id);
    for (const [index, part] of catalog.entries()) field.append(new Option(part.name, index));
    field.value = DEFAULT_BUILD[slot] ?? "";
    field.addEventListener("change", updatePanels);
  }
  setText("mission-detail", "Удерживайте ворота Цитадели одним мехом " + BASE_CAPTURE_SECONDS + " игровых секунд. Станции дают ресурсы.");

  function selectProductionSite(sites) {
    const listKey = sites.map((site) => site.id + "/" + site.queue.length).join("|");
    if (listKey !== factoryListKey) {
      const requested = productionPicker.value;
      const options = sites.map((site) => new Option(site.name +
        (site.queue.length ? " · " + site.queue.length + " в очереди" : ""), site.id));
      productionPicker.replaceChildren(...(options.length ? options : [new Option("Нет доступных площадок", "")]));
      if (sites.some((site) => site.id === requested)) productionPicker.value = requested;
      factoryListKey = listKey;
    }
    productionPicker.disabled = !sites.length;
    const site = sites.find(({ id }) => id === productionPicker.value);
    setText("factory-detail", site?.type === "base" ? "Доход стартовой базы · ремонт" :
      site ? "Половина дохода базы" + (site.type === "outpost" ? " · ремонт" : "") : "");
    return site ?? null;
  }

  function updateBuildQueue(queue, statusText) {
    if (queue.length !== shownQueue.length || queue.some((job, i) => job !== shownQueue[i])) {
      shownQueue = queue.slice();
      buildQueue.replaceChildren(...queue.map(({ build, duration }, i) => {
        const row = document.createElement("li");
        const name = document.createElement("strong");
        const details = document.createElement("small");
        const status = document.createElement("span");
        name.textContent = CHASSIS[build[0]].name;
        details.textContent = equipmentNames(build.slice(1, 3), build[3]);
        status.className = "build-job-status";
        if (i === 0) status.id = "active-build-time";
        else status.textContent = "Ожидает · " + secondsText(duration);
        row.append(name, details, status);
        return row;
      }));
    }
    const active = queue[0];
    setText("build-queue-count", queue.length);
    $("queue-empty").hidden = !!active;
    $("build-progress").hidden = !active;
    if (active) {
      setText("active-build-time", statusText + " · " + buildEta(active.remaining));
      setProgress("build-bar", 1 - active.remaining / active.duration);
    }
  }

  function gateStatus(gate, idleLabel) {
    if (gate.contested) return "Оспариваются";
    if (!gate.capturer) return idleLabel;
    return (gate.faction === FACTION.ally ? "Захват " : "Противник ") + Math.floor(gate.progress * 100) + "%";
  }

  function showGateProgress(button, gate) {
    button.style.setProperty("--fill", gate.progress * 100 + "%");
    button.style.setProperty("--meter", gate.faction === FACTION.ally ? "#79efc8" : "#ff9c80");
  }

  function updateSiteCard(card, site, enabled, incoming) {
    const { button, state } = card;
    const color = site.faction === FACTION.ally ? "ally" : site.faction === FACTION.hostile ? "hostile" : "";
    button.className = "station " + (site.type ? "facility " : "") + color;
    button.disabled = !enabled;
    const owner = color === "ally" ? (site.type === "factory" ? "Наш" : "Наша") :
      color === "hostile" ? "Противник" : site.type === "factory" ? "Свободен" : "Свободна";
    const status = gateStatus(site.gate, incoming ? "Мех в пути" : owner);
    if (state.textContent !== status) state.textContent = status;
    showGateProgress(button, site.gate);
  }

  function toggleEventList(open) {
    $("event-list").hidden = !open;
    $("event-toggle").setAttribute("aria-expanded", String(open));
  }

  function focusEvent(event) {
    if (!event?.point) return;
    view.focusSector(event.point);
    toggleEventList(false);
    canvas.focus({ preventScroll: true });
    updatePanels();
  }

  function updateNews() {
    const recent = match.news[0];
    const alert = match.news.find((event) => event.important && match.time - event.time <= 8);
    const event = alert ?? recent;
    if (announcedEvent !== event) {
      announcedEvent = event;
      setText("event-text", event.message);
      $("event-dot").className = event.tone;
      $("event-focus").disabled = !event.point;
      $("event-focus").title = event.point ? "Показать на карте" : "";
      $("event-focus").classList.toggle("important", !!alert);
    }
    const list = $("event-list");
    if (list.hidden || loggedEvent === recent) return;
    loggedEvent = recent;
    const focused = document.activeElement?.dataset.event;
    list.replaceChildren(...match.news.map((entry) => {
      const row = document.createElement("li");
      const button = document.createElement("button");
      const stamp = document.createElement("span");
      stamp.textContent = timeText(entry.time);
      stamp.className = "event-time";
      button.type = "button";
      button.className = entry.important ? "important" : "";
      button.dataset.event = entry.id;
      button.disabled = !entry.point;
      button.append(stamp, entry.message);
      button.addEventListener("click", () => focusEvent(entry));
      row.append(button);
      return row;
    }));
    if (focused) [...list.querySelectorAll("button")].find((item) => item.dataset.event === focused)?.focus({ preventScroll: true });
  }

  function updatePanels() {
    const canOrder = ordersAllowed();
    const paused = phase === "paused";
    const allies = match.allies();
    const [base, enemy] = match.bases;
    const { bank } = base;
    const production = match.productionFor(FACTION.ally);
    const workshop = selectProductionSite(production);
    const income = match.income();
    for (const [i, id] of RESOURCES.entries()) {
      setText(id, Math.floor(bank[i]));
      setText(id + "-rate", "+" + format.format(income[i]) + "/с");
    }
    const enemySites = match.productionFor(FACTION.hostile);
    const enemyEta = Math.min(...enemySites.map((site) => site.queue[0]?.remaining ?? Infinity));
    const enemyJobs = match.queuedCount(FACTION.hostile);
    setText("enemy-factory-sites", "Площадки противника · " + enemySites.length);
    setText("enemy-factory-queue", enemyJobs ? "Заказов · " + enemyJobs : enemySites.length ? "Очередь пуста" : "Выпуск остановлен");
    $("enemy-factory-eta").hidden = !Number.isFinite(enemyEta);
    if (Number.isFinite(enemyEta)) setText("enemy-factory-eta", (paused ? "Пауза · " : "Сборка · ") + buildEta(enemyEta));
    updateNews();

    const controlled = match.nodes.filter((node) => node.faction === FACTION.ally).length;
    setText("node-count", controlled + " / " + match.nodes.length);
    const facilityCount = match.facilities.filter((site) => site.faction === FACTION.ally).length;
    setText("facility-count", facilityCount + " / " + match.facilities.length);
    renderSquad(allies, canOrder);
    const canCommand = canOrder && selected.size > 0;
    const incoming = new Set(allies.filter((unit) => unit.order.continuous).map((unit) => unit.order.target));
    const citadelButton = $("citadel-gate-order");
    citadelButton.disabled = !canOrder;
    $("camp-inspect").disabled = !canOrder;
    const citadelStatus = incoming.has(enemy.id) ? "Мех в пути" : enemy.hp <= 0 ? "Оборона отключена" : "К захвату";
    setText("citadel-gate-status", gateStatus(enemy.gate, citadelStatus));
    showGateProgress(citadelButton, enemy.gate);
    $("camp-gate-status").hidden = !base.gate.capturer && !base.gate.contested;
    setText("camp-gate-status", "Ворота лагеря · " + gateStatus(base.gate, ""));
    const hull = base.hp / base.hull;
    setProgress("base-bar", hull);
    setText("base-hp", base.hp > 0 ? Math.ceil(hull * 100) + "%" : "Отключена");
    $("base-bar").style.background = hull < .35 ? "#ff947c" : "";
    match.nodes.forEach((node, i) => updateSiteCard(nodeCards[i], node, canCommand, incoming.has(node.id)));
    match.facilities.forEach((site, i) => updateSiteCard(facilityCards[i], site, canOrder, incoming.has(site.id)));

    const hasArmed = allies.some((unit) => selected.has(unit.id) && unit.range > 0);
    const hasTarget = match.mechs(FACTION.hostile).length > 0;
    $("select-all").disabled = !canOrder || !allies.length;
    $("capture-nearest").disabled = !canCommand;
    $("attack-mech").disabled = !canCommand || !hasArmed || !hasTarget;
    $("attack-mech").title = !hasArmed ? "Выберите меха с оружием" : !hasTarget ? "На поле нет вражеских мехов" : "Преследовать ближайшего вражеского меха";
    if (!canCommand) attackMoveMode = false;
    $("attack-move").disabled = !canCommand || !hasArmed;
    $("attack-move").setAttribute("aria-pressed", String(attackMoveMode));
    $("attack-move-hint").hidden = !attackMoveMode;
    $("hold").disabled = !canCommand;
    $("return-base").disabled = !canCommand || !match.repairSites(FACTION.ally).length;
    pauseButton.disabled = phase === "briefing" || phase === "ended";
    pauseButton.setAttribute("aria-pressed", String(paused));
    pauseButton.title = (paused ? "Снять паузу" : "Поставить на паузу") + " · Пробел";
    $("pause-status").hidden = !paused;
    $("zoom-out").disabled = view.zoom <= FrontierView.MIN_ZOOM;
    $("zoom-in").disabled = view.zoom >= FrontierView.MAX_ZOOM;
    setText("zoom-overview", Math.round(view.zoom * 100) + "%");

    const design = currentBuild();
    const preview = design.join("/");
    if (preview !== lastPreview) {
      MechArt.preview($("mech-preview"), ...design);
      lastPreview = preview;
    }
    const cost = buildCost(design);
    const duration = buildDuration(design);
    $("build-duration").hidden = duration === null;
    setText("build-duration-value", duration === null ? "" : secondsText(duration));
    for (const [slot, { id, catalog }] of buildSlots.entries()) {
      const detailId = id + "-detail";
      const detail = catalog[design[slot]]?.detail;
      $(detailId).hidden = !detail;
      setText(detailId, detail ?? "");
    }
    $("build-requirement").hidden = !!cost;
    for (const [i, item] of costs.entries()) {
      item.textContent = cost ? cost[i] : "—";
      item.classList.toggle("insufficient", !!cost && bank[i] < cost[i]);
    }
    setText("factory-state", (allies.length + match.queuedCount(FACTION.ally)) + " / " + MAX_MECHS + " мест");
    $("build").disabled = !canOrder || !match.canBuild(design, FACTION.ally, workshop);
    updateBuildQueue(workshop?.queue ?? [], paused ? "Пауза" : "Сборка");
    const turrets = match.turretsFor(FACTION.ally).length;
    const freeSocket = workshop && match.freePad(FACTION.ally, workshop);
    const turretStatus = !workshop || workshop.type === "factory" ? "Площадки для турелей есть у баз" :
      !freeSocket ? "Площадки базы заняты" : turrets >= MAX_TURRETS ? "Достигнут лимит турелей" : workshop.name;
    setText("turret", "Турель «Дозор» · " + TURRET_COST.join(" / "));
    setText("turret-status", turretStatus + " · " + turrets + " / " + MAX_TURRETS);
    $("turret").title = turretStatus + " · " + TURRET_COST.map((value, i) => value + " " + resourceNames[i]).join(", ");
    $("turret").disabled = !canOrder || !freeSocket || turrets >= MAX_TURRETS || !affordable(bank, TURRET_COST);
    canvas.classList.toggle("aiming", canOrder && selected.size > 0);
    canvas.classList.toggle("attack-aim", attackMoveMode);
    updateInspection(canCommand, hasArmed);
  }

  function buildMech() {
    const site = match.productionFor(FACTION.ally).find(({ id }) => id === productionPicker.value);
    if (!ordersAllowed() || !site || !match.requestBuild(currentBuild(), FACTION.ally, site)) return;
    tone(305, .21, .065, 615);
    updatePanels();
  }

  $("launch").addEventListener("click", () => start());
  $("restart").addEventListener("click", () => start(true));
  pauseButton.addEventListener("click", togglePause);
  $("camp-inspect").addEventListener("click", () => showInspection(match.bases[0]));
  $("close-inspector").addEventListener("click", () => {
    showInspection(null);
    canvas.focus({ preventScroll: true });
  });
  $("inspect-gate").addEventListener("click", () => {
    if (inspected?.gate && command(inspected, "capture")) updatePanels();
  });
  $("inspect-attack").addEventListener("click", () => {
    if (inspected && command(inspected, "attack")) updatePanels();
  });
  followButton.addEventListener("click", () => {
    if (inspected?.type !== "mech" || inspected.hp <= 0 || !ordersAllowed()) return;
    if (view.followedId === inspected.id) view.followedId = null;
    else view.follow(inspected);
    updatePanels();
  });
  speedButtons.forEach((button, index) => button.addEventListener("click", () => setSpeed(index)));
  $("select-all").addEventListener("click", selectAll);
  $("capture-nearest").addEventListener("click", () => commandNearest("capture"));
  $("attack-mech").addEventListener("click", () => commandNearest("attack"));
  function toggleAttackMove() {
    if ($("attack-move").disabled) return;
    attackMoveMode = !attackMoveMode;
    canvas.focus({ preventScroll: true });
    updatePanels();
  }
  $("attack-move").addEventListener("click", toggleAttackMove);
  $("hold").addEventListener("click", () => command({}, "hold"));
  $("return-base").addEventListener("click", () => {
    if (!ordersAllowed() || !match.returnForRepairs([...selected])) return;
    match.log("Мехи направлены на ремонт к ближайшим базам.", "ally");
    tone(620, .14, .045, 470);
    updatePanels();
  });
  $("build").addEventListener("click", buildMech);
  productionPicker.addEventListener("change", updatePanels);
  $("turret").addEventListener("click", () => {
    const workshop = match.productionFor(FACTION.ally).find(({ id }) => id === productionPicker.value);
    if (ordersAllowed() && workshop && match.requestTurret(FACTION.ally, workshop)) {
      tone(260, .22, .06, 520);
      updatePanels();
    }
  });
  $("event-focus").addEventListener("click", () => focusEvent(announcedEvent));
  $("event-toggle").addEventListener("click", () => {
    const open = $("event-list").hidden;
    if (open) inspected = null;
    toggleEventList(open);
    updatePanels();
  });
  minimapControl.addEventListener("click", (event) => {
    view.focusSector(event.detail === 0 ? view.center : view.minimapPosition(event));
    updatePanels();
  });
  minimapControl.addEventListener("keydown", (event) => {
    const delta = { ArrowLeft: [0, 7], ArrowRight: [0, -7], ArrowUp: [7, 0], ArrowDown: [-7, 0] }[event.code];
    if (!delta) return;
    event.preventDefault();
    view.focusSector({ x: view.center.x + delta[0], y: view.center.y + delta[1] });
    updatePanels();
  });
  $("help").addEventListener("click", () => { manual.showModal(); updatePanels(); });
  $("close-help").addEventListener("click", () => manual.close());
  manual.addEventListener("close", updatePanels);
  $("sound").addEventListener("click", () => {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    if (!currentSound) currentSound = new Audio();
    audioEnabled = !audioEnabled;
    $("sound").setAttribute("aria-pressed", String(audioEnabled));
    setText("sound", audioEnabled ? "Звук вкл." : "Звук выкл.");
    if (audioEnabled) currentSound.resume().then(() => tone(550)).catch(() => {});
  });

  function zoomBy(multiplier) {
    const focus = view.zoom <= 1 && multiplier > 1 && match.allies().find((unit) => selected.has(unit.id));
    view.zoomTo(view.zoom * multiplier, focus || undefined);
    updatePanels();
  }

  $("zoom-in").addEventListener("click", () => zoomBy(1.28));
  $("zoom-out").addEventListener("click", () => zoomBy(1 / 1.28));
  $("zoom-overview").addEventListener("click", () => {
    view.overview();
    updatePanels();
  });
  const sectorTargets = {
    "sector-camp": () => match.bases[0],
    "sector-center": () => ({ x: (WIDTH - 1) / 2, y: (HEIGHT - 1) / 2 }),
    "sector-citadel": () => match.bases[1],
  };
  for (const [id, center] of Object.entries(sectorTargets)) {
    $(id).addEventListener("click", () => {
      view.focusSector(center());
      updatePanels();
    });
  }
  canvas.addEventListener("wheel", (event) => {
    if (event.ctrlKey) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.height : 1);
    view.zoomAt(view.zoom * Math.exp(-delta * .0017), view.position(event));
  }, { passive: false });

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    if (!mapPointers.size) mapMoved = false;
    const point = view.position(event);
    mapPointers.set(event.pointerId, { start: point, point });
    canvas.setPointerCapture(event.pointerId);
    if (event.button === 1) event.preventDefault();
  });
  function releaseMapPointer(event) {
    if (!mapPointers.delete(event.pointerId) || mapPointers.size) return;
    canvas.classList.remove("dragging");
  }
  canvas.addEventListener("pointerup", releaseMapPointer);
  canvas.addEventListener("pointercancel", releaseMapPointer);
  canvas.addEventListener("lostpointercapture", releaseMapPointer);

  window.addEventListener("pointerdown", (event) => { pointerType = event.pointerType; }, { capture: true, passive: true });
  canvas.addEventListener("pointermove", (event) => {
    const point = view.position(event);
    const tracked = mapPointers.get(event.pointerId);
    if (!tracked) {
      if (ordersAllowed()) view.hover = view.hitTest(match, point)?.id || null;
      return;
    }
    const previous = tracked.point;
    tracked.point = point;
    const other = [...mapPointers.values()].find((pointer) => pointer !== tracked);
    if (other) {
      const before = Math.hypot(previous.x - other.point.x, previous.y - other.point.y);
      const after = Math.hypot(point.x - other.point.x, point.y - other.point.y);
      view.panBy((point.x - previous.x) / 2, (point.y - previous.y) / 2);
      if (before >= 8 && after >= 8) view.zoomAt(view.zoom * after / before,
        { x: (point.x + other.point.x) / 2, y: (point.y + other.point.y) / 2 });
    } else {
      if (!mapMoved && Math.hypot(point.x - tracked.start.x, point.y - tracked.start.y) < 6) return;
      const origin = mapMoved ? previous : tracked.start;
      view.panBy(point.x - origin.x, point.y - origin.y);
    }
    mapMoved = true;
    view.hover = null;
    canvas.classList.add("dragging");
  });
  canvas.addEventListener("pointerleave", () => { view.hover = null; });

  function commandOnMap(screen) {
    if (attackMoveMode) return attackMoveOnMap(screen);
    const target = view.hitTest(match, screen, isOrderTarget);
    if (target?.type === "mech" || target?.type === "turret") return command(target, "attack");
    const site = view.hitTestGate(match, screen);
    if (site) return command(site, "capture");
    if (target) return command(target, target.type === "base" && target.faction === FACTION.hostile && target.hp > 0 ?
      "attack" : "capture");

    const point = groundPoint(screen);
    return point ? command(point) : false;
  }

  function groundPoint(screen) {
    const point = view.unproject(screen.x, screen.y);
    return point.x >= -.65 && point.y >= -.65 && point.x <= WIDTH - .35 && point.y <= HEIGHT - .35 ?
      nearestWalkable(match.terrain, point) : null;
  }

  function attackMoveOnMap(screen) {
    const point = groundPoint(screen);
    return point ? command(point, "attack-move") : false;
  }

  canvas.addEventListener("click", (event) => {
    if (!ordersAllowed() || mapMoved) return;
    const screen = view.position(event);
    if (attackMoveMode) {
      attackMoveOnMap(screen);
      return;
    }
    const target = view.hitTest(match, screen, (entity) => entity.type === "mech" || !!entity.rates);
    if (target && isFriendlyMech(target)) selectUnit(target.id, event.shiftKey);
    else if (target) showInspection(target);
    else {
      if (inspected) showInspection(null);
      if (touchClick(event)) commandOnMap(screen);
    }
  });
  onRightClick(canvas, (event) => {
    if (commandOnMap(view.position(event))) canvas.focus({ preventScroll: true });
  });
  window.addEventListener("keydown", (event) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || manual.open ||
        event.target.closest?.("input, select, textarea")) return;
    if (event.code === "Escape" && (attackMoveMode || !$("event-list").hidden)) {
      event.preventDefault();
      attackMoveMode = false;
      toggleEventList(false);
      canvas.focus({ preventScroll: true });
      updatePanels();
      return;
    }
    if (event.code === "Escape" && inspected) {
      event.preventDefault();
      showInspection(null);
      canvas.focus({ preventScroll: true });
      return;
    }
    if (event.code === "Space" && !event.target.closest?.("button") && (phase === "running" || phase === "paused")) {
      event.preventDefault();
      togglePause();
      return;
    }
    if (event.target === canvas) {
      const pan = { ArrowLeft: [100, 0], ArrowRight: [-100, 0], ArrowUp: [0, 100], ArrowDown: [0, -100] }[event.code];
      if (pan) {
        event.preventDefault();
        view.panBy(...pan);
        return;
      }
    }
    if (!ordersAllowed()) return;
    if (event.code === "KeyG") selectAll();
    if (event.code === "KeyF") buildMech();
    if (event.code === "KeyA") toggleAttackMove();
    if (/^Digit[1-8]$/.test(event.code)) {
      const unit = match.allies()[Number(event.code.at(-1)) - 1];
      if (unit) selectUnit(unit.id, event.shiftKey, true);
    }
  });

  function frame(milliseconds) {
    const now = milliseconds / 1000;
    const dt = lastFrame ? clamp(now - lastFrame, 0, .14) : 0;
    lastFrame = now;
    if (simulationRunning()) {
      stepBank += dt * speed;
      const step = 1 / 30;
      while (stepBank >= step && !match.winner) {
        match.tick(step);
        stepBank -= step;
      }
      if (match.winner) showEnd();
      if (audioEnabled && now > lastShot + .19 &&
          match.effects.some((effect) => effect.type === "shot" && effect.max - effect.life < .08)) {
        tone(172, .095, .028, 80);
        lastShot = now;
      }
    }
    view.draw(match, selected, now);
    if (now - lastPanels > .14) {
      updatePanels();
      lastPanels = now;
    }
    requestAnimationFrame(frame);
  }

  setText("sector-size", WIDTH + " × " + HEIGHT);
  updatePanels();
  requestAnimationFrame(frame);
})();
