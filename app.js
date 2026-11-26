"use strict";

(() => {
  const {
    WIDTH, HEIGHT, MAX_MECHS, MAX_TURRETS, BASE_CAPTURE_SECONDS, RESOURCES, FACTION, CHASSIS, WEAPONS, KIT,
    TURRET_COST, SCAN_COST, SCAN_DURATION, DEFAULT_BUILD, Match, affordable, buildCost, buildDuration, equipmentFor,
    clamp, nearestWalkable, shotStatus, loadoutOf, refitQuote,
  } = EchoSim;
  const PLAYER = FACTION.ally;
  const resourceNames = ["сплав", "энергия", "данные"];
  const $ = (id) => document.getElementById(id);
  const canvas = $("terrain");
  const minimap = $("minimap");
  const minimapControl = $("minimap-control");
  const view = new FrontierView(canvas, minimap);
  const manual = $("manual");
  const refitDialog = $("refit-dialog");
  const factoryDialog = $("factory-dialog");
  const workshopPanel = $("workshop");
  const workshopHome = workshopPanel.parentElement;
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
  let lastInspectedDesign = "";
  let shownQueue = [];
  let factoryListKey = null;
  let pointerType = "";
  let mapMoved = false;
  let mapOrder = null;
  let refitUnit = null;
  let recorder = new EchoReplay.Recorder();
  let playback = null;
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
    return phase === "running" && !manual.open && !refitDialog.open && !factoryDialog.open;
  }

  function operationActive() {
    return phase === "running" || phase === "paused";
  }

  function ordersAllowed() {
    return operationActive() && !manual.open && !refitDialog.open;
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

  function openWorkshop(site) {
    if (!ordersAllowed() || factoryDialog.open || !site) return false;
    const sites = match.productionFor(PLAYER);
    if (!sites.includes(site)) return false;
    selectProductionSite(sites);
    productionPicker.value = site.id;
    inspected = null;
    mapOrder = null;
    toggleEventList(false);
    setText("factory-name", site.name);
    factoryDialog.showModal();
    $("factory-dock").append(workshopPanel);
    updatePanels();
    return true;
  }

  function inspectSite(site) {
    if (!openWorkshop(site)) showInspection(site);
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
        if (target && match.canSeeEntity(PLAYER, target)) return "Атаковать · " + target.name;
        return order.lastKnown ? "К последней позиции цели" : "Атаковать";
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
      case "refit": {
        const remaining = site?.refit?.remaining;
        return (unit.refitting && remaining != null ? "Переоснащение · " + buildEta(remaining) :
          "На переоснащение") + (site ? " · " + site.name : "");
      }
      case "move":
        return (unit.path.length ? "Переместиться" : "На позиции") + " · клетка " + (order.x + 1) + ", " + (order.y + 1);
      default:
        return "Удерживать позицию";
    }
  }

  function updateInspection(canCommand, hasArmed) {
    if (inspected?.type === "mech" && (inspected.hp <= 0 || !match.canSeeEntity(PLAYER, inspected))) inspected = null;
    inspector.hidden = !inspected;
    if (!inspected) return;

    const entity = inspected;
    const mech = entity.type === "mech";
    const visible = match.canSeeEntity(PLAYER, entity);
    const faction = mech ? entity.faction : match.observedFaction(PLAYER, entity);
    const ally = faction === PLAYER;
    const neutral = faction === FACTION.neutral;
    const owner = ally ? (mech ? "Ваш отряд" : "Под вашим контролем") :
      neutral ? "Нейтральный объект" : mech ? "Мех противника" : "Под контролем противника";
    inspector.classList.toggle("ally", ally);
    inspector.classList.toggle("hostile", faction === FACTION.hostile);
    inspector.classList.toggle("neutral", neutral);
    setText("inspection-name", entity.name);
    $("inspection-mech").hidden = !mech;
    $("inspection-site").hidden = mech || !visible;
    $("inspection-production").hidden = !entity.rates;
    $("inspection-intel").hidden = visible;
    if (!visible) {
      setText("inspection-status", "Вне обзора");
      setText("inspection-intel", faction === null ? "Сведения о владельце появятся после разведки." :
        "По последним данным · " + owner);
    }
    if (mech) {
      setText("inspection-status", owner + " · " + Math.ceil(entity.hp) + " / " + entity.hull + " ОЗ");
      const design = loadoutOf(entity);
      const key = [entity.faction, ...design].join("/");
      if (key !== lastInspectedDesign) {
        MechArt.preview($("inspect-model"), ...design, { faction: entity.faction, inspect: true });
        lastInspectedDesign = key;
      }
      setText("inspect-chassis", CHASSIS[entity.chassisId].name);
      setText("inspect-module", KIT[entity.kitId]?.name ?? "—");
      setText("inspect-weapon-1", WEAPONS[entity.weaponIds[0]]?.name ?? "—");
      setText("inspect-weapon-2", WEAPONS[entity.weaponIds[1]]?.name ?? "—");
      setText("inspect-order", describeOrder(entity));
      const id = entity.order.kind === "attack" ? entity.order.target : entity.engagement;
      const target = id && match.entities().find((candidate) => candidate.id === id && match.canSeeEntity(PLAYER, candidate));
      $("fire-line-status").hidden = !target;
      if (target) {
        const status = shotStatus(match.terrain, entity, target);
        setText("inspect-fire-line", { clear: "Открыта", blocked: "Перекрыта скалой", distant: "Цель вне дальности" }[status]);
      }
    } else if (visible) {
      let rates;
      if (entity.rates) {
        const active = match.productionFor(faction).includes(entity);
        const status = neutral ? "выпуск после захвата" : !active ? "выпуск остановлен" : !simulationRunning() ? "пауза" : "";
        setText("inspection-status", status ? owner + " · " + status : owner);
        setText("inspect-capacity", active || neutral ? assemblyRange : "Остановлен");
        const job = entity.queue[0];
        setText("inspect-queue", job ? entity.queue.length + " · " + CHASSIS[job.build[0]].name + " · " +
          buildEta(job.remaining) + " до выпуска" : "Нет заказов");
        rates = active || neutral ? entity.rates : null;
      } else {
        setText("inspection-status", owner);
        rates = RESOURCES.map((_, i) => i === entity.resource ? entity.income : 0);
      }
      setText("inspect-income-label", neutral ? "Доход после захвата за игровую секунду" : "Доход за игровую секунду");
      for (const [i, resource] of RESOURCES.entries()) {
        setText("inspect-" + resource, rateFormat.format(rates?.[i] ?? 0));
      }
    }

    const canAttack = visible && !ally && mech;
    $("inspect-gate").hidden = mech;
    $("inspect-gate").disabled = !canCommand;
    $("inspect-attack").hidden = !canAttack;
    $("inspect-attack").disabled = !canCommand || !hasArmed;
    const inRefit = mech && entity.order.kind === "refit";
    $("inspect-refit").hidden = !mech || !ally || inRefit;
    const refitReady = mech && ally && match.refitSites(entity).length > 0;
    $("inspect-refit").disabled = !ordersAllowed() || !refitReady;
    $("inspect-refit").title = refitReady ? "Выбрать оборудование и базу" : "Нет свободной ремонтной базы";
    $("inspect-cancel-refit").hidden = !mech || !ally || !inRefit;
    $("inspect-cancel-refit").disabled = !ordersAllowed();
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
    mapOrder = null;
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
      mapOrder = null;
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

  function resetOperation(nextPhase) {
    match = new Match({ fogOfWar: $("fog-of-war").checked });
    recorder = new EchoReplay.Recorder();
    recorder.record(match);
    playback = null;
    selected = new Set([match.allies()[0].id]);
    for (const card of unitCards.values()) card.button.remove();
    unitCards.clear();
    factoryListKey = null;
    view.marker = null;
    view.hover = null;
    view.overview();
    productionPicker.value = match.bases[0].id;
    setSpeed(0);
    mapOrder = null;
    toggleEventList(false);
    inspected = null;
    phase = nextPhase;
    stepBank = 0;
    $("intro").hidden = nextPhase !== "briefing";
    $("end-screen").hidden = true;
    $("replay-controls").hidden = true;
    $("live-events").hidden = false;
    (nextPhase === "briefing" ? $("launch") : canvas).focus({ preventScroll: true });
    if (nextPhase === "paused") tone(445, .25, .055, 735);
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
    renderReplays();
    $("restart").focus({ preventScroll: true });
    tone(won ? 522 : 210, .43, .08, won ? 784 : 110);
    updatePanels();
  }

  const replayLabels = { loss: "Потеря меха", raid: "Контрудар", capture: "Захват" };
  const noSelection = new Set();

  function renderReplays() {
    const clips = recorder.clips.slice().reverse().filter((clip) => clip.frames.length > 1);
    $("replay-directory").hidden = !clips.length;
    $("replay-list").replaceChildren(...clips.map((clip) => {
      const row = document.createElement("li");
      const button = document.createElement("button");
      const label = document.createElement("small");
      button.type = "button";
      button.className = "secondary";
      label.textContent = timeText(clip.event.time) + " · " + replayLabels[clip.event.replay];
      button.append(label, clip.event.message);
      button.addEventListener("click", () => startReplay(clip));
      row.append(button);
      return row;
    }));
  }

  function startReplay(clip) {
    playback = { clip, time: clip.frames[0].time, end: clip.frames.at(-1).time, playing: true };
    const slider = $("replay-position");
    slider.min = playback.time;
    slider.max = playback.end;
    slider.value = playback.time;
    $("replay-speed").value = ".5";
    setText("replay-title", clip.event.message);
    $("replay-controls").hidden = false;
    $("end-screen").hidden = true;
    $("live-events").hidden = true;
    toggleEventList(false);
    view.followedId = null;
    view.marker = null;
    view.hover = null;
    view.focusSector(clip.event.point);
    view.zoomTo(Math.max(view.zoom, Math.min(10, 1.7 / view.fit)), clip.event.point);
    $("replay-play").focus({ preventScroll: true });
    updatePanels();
  }

  function advanceReplay(dt) {
    if (playback.playing) {
      playback.time = Math.min(playback.end, playback.time + dt * Number($("replay-speed").value));
      if (playback.time >= playback.end) playback.playing = false;
    }
    const slider = $("replay-position");
    if (document.activeElement !== slider || playback.playing) slider.value = playback.time;
    setText("replay-time", timeText(playback.time));
    setText("replay-play", playback.playing ? "Пауза" : "Воспроизвести");
    return EchoReplay.frameAt(playback.clip, playback.time);
  }

  $("replay-play").addEventListener("click", () => {
    if (!playback) return;
    if (playback.time >= playback.end) playback.time = playback.clip.frames[0].time;
    playback.playing = !playback.playing;
  });
  $("replay-position").addEventListener("input", (event) => {
    if (!playback) return;
    playback.time = Number(event.target.value);
    playback.playing = false;
  });
  $("replay-close").addEventListener("click", () => {
    playback = null;
    $("replay-controls").hidden = true;
    $("live-events").hidden = false;
    $("end-screen").hidden = false;
    $("restart").focus({ preventScroll: true });
  });


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

  function bindCaptureControl(button, getSite) {
    onRightClick(button, () => {
      const site = getSite();
      if (command(site, "capture") && view.zoom > 1) view.zoomTo(view.zoom, site.gate);
    });
    button.addEventListener("click", () => inspectSite(getSite()));
  }

  bindCaptureControl($("citadel-gate-order"), () => match.bases[1]);
  bindCaptureControl($("camp-inspect"), () => match.bases[0]);
  const nodeCards = match.nodes.map((node, index) => {
    const card = makeCard("station");
    card.name.textContent = node.name;
    card.call.textContent = node.call;
    card.button.title = "Сведения о станции · правый клик отправляет к воротам";
    bindCaptureControl(card.button, () => match.nodes[index]);
    $("stations").append(card.button);
    return card;
  });
  const facilityCards = match.facilities.map((site, index) => {
    const card = makeCard("station facility");
    card.name.textContent = site.name;
    card.call.textContent = site.call;
    bindCaptureControl(card.button, () => match.facilities[index]);
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
        card.button.addEventListener("click", (event) => selectUnit(unit.id, event.shiftKey, true));
        unitCards.set(unit.id, card);
        $("units").append(card.button);
      }
      const picked = selected.has(unit.id);
      const hp = Math.ceil(unit.hp);
      card.call.textContent = index + 1;
      card.state.textContent = hp + " ОЗ";
      card.button.title = equipmentNames(unit.weaponIds, unit.kitId) +
        (unit.order.kind === "refit" ? " · " + describeOrder(unit) : "");
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

  const presetKey = "echo-frontier-presets-v1";
  const presetLimit = 8;
  const presets = readPresets();
  let presetRows = [];

  function readPresets() {
    try {
      const saved = JSON.parse(localStorage.getItem(presetKey) ?? "[]");
      return Array.isArray(saved) ? saved.filter((item) => typeof item?.name === "string" &&
        item.name.trim().length && Array.isArray(item.build) && item.build.length === 4 && buildCost(item.build))
        .slice(0, presetLimit).map(({ name, build }) => ({ name: name.trim().slice(0, 32), build })) : [];
    } catch {
      return [];
    }
  }

  function showPresets() {
    try {
      localStorage.setItem(presetKey, JSON.stringify(presets));
    } catch {
      setText("preset-note", "Хранилище недоступно. Шаблоны доступны в этой вкладке.");
    }
    presetRows = presets.map((preset) => {
      const row = document.createElement("li");
      const order = document.createElement("button");
      const remove = document.createElement("button");
      const name = document.createElement("strong");
      const cost = document.createElement("small");
      order.type = remove.type = "button";
      order.className = remove.className = "secondary";
      name.textContent = preset.name;
      cost.textContent = buildCost(preset.build).join(" / ") + " · " + secondsText(buildDuration(preset.build));
      order.append(name, cost);
      order.setAttribute("aria-label", "Заказать по шаблону «" + preset.name + "»");
      order.addEventListener("click", () => buildMech(preset.build));
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Удалить шаблон «" + preset.name + "»");
      remove.addEventListener("click", () => {
        presets.splice(presets.indexOf(preset), 1);
        showPresets();
        updatePanels();
      });
      row.append(order, remove);
      return { row, order, preset };
    });
    $("preset-list").replaceChildren(...presetRows.map(({ row }) => row));
    $("preset-empty").hidden = presets.length > 0;
  }

  $("save-preset").addEventListener("click", () => {
    const build = currentBuild();
    if (!buildCost(build)) return;
    const built = CHASSIS[build[0]].name + " · " + equipmentNames(build.slice(1, 3), build[3]);
    const name = ($("preset-name").value.trim() || built).slice(0, 32);
    const index = presets.findIndex((preset) => preset.name.toLocaleLowerCase("ru") === name.toLocaleLowerCase("ru"));
    const preset = { name, build };
    if (index >= 0) presets[index] = preset;
    else if (presets.length < presetLimit) presets.push(preset);
    else {
      setText("preset-note", "Лимит шаблонов · " + presetLimit);
      return;
    }
    $("preset-name").value = "";
    setText("preset-note", "");
    showPresets();
    updatePanels();
  });
  showPresets();

  const refitFields = [
    { id: "refit-weapon-1", catalog: WEAPONS },
    { id: "refit-weapon-2", catalog: WEAPONS },
    { id: "refit-module", catalog: KIT },
  ];
  for (const { id, catalog } of refitFields) {
    const input = $(id);
    catalog.forEach((part, i) => input.append(new Option(part.name, i)));
    input.addEventListener("change", updateRefitQuote);
  }

  function refitDesign() {
    return [refitUnit.chassisId, ...refitFields.map(({ id }) => $(id).value === "" ? null : Number($(id).value))];
  }

  function updateRefitQuote() {
    if (!refitUnit) return;
    const design = refitDesign();
    const quote = refitQuote(refitUnit, design);
    const payable = !!quote && affordable(match.baseFor(PLAYER).bank, quote.cost);
    setText("refit-quote", quote ? quote.cost.map((value, i) => resourceNames[i] + " " + value).join(" · ") +
      " · " + secondsText(quote.duration) : buildCost(design) ? "Выберите новое оснащение" : "Нужен хотя бы один предмет оснащения");
    $("refit-submit").disabled = !payable || !$("refit-site").value;
    $("refit-submit").title = quote && !payable ? "Недостаточно ресурсов" : "";
  }

  function openRefit() {
    if (!ordersAllowed() || !isFriendlyMech(inspected ?? {})) return;
    const sites = match.refitSites(inspected);
    if (!sites.length) return;
    refitUnit = inspected;
    const design = loadoutOf(refitUnit);
    setText("refit-name", "Переоснастить «" + refitUnit.name + "»");
    $("refit-site").replaceChildren(...sites.map((site) => new Option(site.name, site.id)));
    refitFields.forEach(({ id }, i) => { $(id).value = design[i + 1] ?? ""; });
    updateRefitQuote();
    refitDialog.showModal();
    updatePanels();
  }

  $("inspect-refit").addEventListener("click", openRefit);
  $("inspect-cancel-refit").addEventListener("click", () => {
    if (ordersAllowed() && match.cancelRefit(PLAYER, inspected)) updatePanels();
  });
  $("refit-site").addEventListener("change", updateRefitQuote);
  $("refit-close").addEventListener("click", () => refitDialog.close());
  $("refit-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const site = match.sites.find((candidate) => candidate.id === $("refit-site").value);
    if (!operationActive() || !refitUnit || !match.requestRefit(PLAYER, refitUnit, site, refitDesign())) return;
    refitDialog.close();
    updatePanels();
  });
  refitDialog.addEventListener("close", () => {
    refitUnit = null;
    updatePanels();
  });


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
    const faction = match.observedFaction(PLAYER, site);
    const visible = match.canSeeEntity(PLAYER, site);
    const color = faction === PLAYER ? "ally" : faction === FACTION.hostile ? "hostile" : faction === FACTION.neutral ? "neutral" : "";
    button.className = "station " + (site.type ? "facility " : "") + color;
    if (site.type) {
      const title = (faction === PLAYER ? "Открыть цех" : "Сведения о площадке") + " · правый клик отправляет к воротам";
      if (button.title !== title) button.title = title;
    }
    button.disabled = !enabled;
    const owner = color === "ally" ? (site.type === "factory" ? "Наш" : "Наша") :
      color === "hostile" ? "Противник" : site.type === "factory" ? "Свободен" : "Свободна";
    const status = visible ? gateStatus(site.gate, incoming ? "Мех в пути" : owner) :
      incoming ? "Мех в пути" : faction === null ? "Не разведано" : "Вне обзора";
    if (state.textContent !== status) state.textContent = status;
    showGateProgress(button, visible ? site.gate : { progress: 0 });
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
    $("open-factory").disabled = !canOrder || !workshop;
    const income = match.income();
    for (const [i, id] of RESOURCES.entries()) {
      setText(id, Math.floor(bank[i]));
      setText(id + "-rate", "+" + format.format(income[i]) + "/с");
    }
    if (factoryDialog.open && workshop) {
      setText("factory-name", workshop.name);
      for (const [i, resource] of RESOURCES.entries()) {
        setText("factory-bank-" + resource, Math.floor(bank[i]));
        setText("factory-income-" + resource, "+" + rateFormat.format(workshop.rates[i]) + "/с");
      }
    }
    const enemySites = match.productionFor(FACTION.hostile).filter((site) => match.isVisible(PLAYER, site));
    const enemyEta = Math.min(...enemySites.map((site) => site.queue[0]?.remaining ?? Infinity));
    const enemyJobs = enemySites.reduce((sum, site) => sum + site.queue.length, 0);
    setText("enemy-factory-sites", (match.fogOfWar ? "Площадки в обзоре · " : "Площадки противника · ") + enemySites.length);
    setText("enemy-factory-queue", enemyJobs ? "Заказов · " + enemyJobs :
      enemySites.length ? "Очередь пуста" : match.fogOfWar ? "Вне обзора" : "Выпуск остановлен");
    $("enemy-factory-eta").hidden = !Number.isFinite(enemyEta);
    if (Number.isFinite(enemyEta)) setText("enemy-factory-eta", (paused ? "Пауза · " : "Сборка · ") + buildEta(enemyEta));
    updateNews();

    const controlled = match.nodes.filter((node) => node.faction === FACTION.ally).length;
    setText("node-count", controlled + " / " + match.nodes.length);
    const facilityCount = match.facilities.filter((site) => site.faction === FACTION.ally).length;
    setText("facility-count", facilityCount + " / " + match.facilities.length);
    renderSquad(allies, canOrder);
    const ready = allies.filter((unit) => selected.has(unit.id) && unit.order.kind !== "refit");
    const canCommand = canOrder && ready.length > 0;
    const incoming = new Set(allies.filter((unit) => unit.order.continuous).map((unit) => unit.order.target));
    const citadelButton = $("citadel-gate-order");
    const campButton = $("camp-inspect");
    citadelButton.disabled = !canOrder;
    campButton.disabled = !canOrder;
    const enemySeen = match.isVisible(PLAYER, enemy);
    const citadelStatus = incoming.has(enemy.id) ? "Мех в пути" : !enemySeen ? "Вне обзора" : "К захвату";
    const enemyGate = match.isVisible(PLAYER, enemy.gate) ? enemy.gate : { progress: 0 };
    setText("citadel-gate-status", gateStatus(enemyGate, citadelStatus));
    showGateProgress(citadelButton, enemyGate);
    setText("camp-gate-status", gateStatus(base.gate, "Под охраной"));
    campButton.classList.toggle("threatened", base.gate.faction === FACTION.hostile);
    showGateProgress(campButton, base.gate);
    match.nodes.forEach((node, i) => updateSiteCard(nodeCards[i], node, canOrder, incoming.has(node.id)));
    match.facilities.forEach((site, i) => updateSiteCard(facilityCards[i], site, canOrder, incoming.has(site.id)));

    const hasArmed = ready.some((unit) => unit.range > 0);
    const hasTarget = match.mechs(FACTION.hostile).some((unit) => match.isVisible(PLAYER, unit));
    $("select-all").disabled = !canOrder || !allies.length;
    $("capture-nearest").disabled = !canCommand;
    $("attack-mech").disabled = !canCommand || !hasArmed || !hasTarget;
    $("attack-mech").title = !hasArmed ? "Выберите меха с оружием" : !hasTarget ? "Нет вражеских мехов в обзоре" : "Преследовать ближайшего вражеского меха";
    $("attack-move").disabled = !canCommand || !hasArmed;
    updateMapOrders(canOrder, workshop, bank);
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
    $("save-preset").disabled = !cost;
    for (const { order, preset } of presetRows) {
      order.disabled = !canOrder || !workshop || !match.canBuild(preset.build, PLAYER, workshop);
    }
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
    updateBuildQueue(workshop?.queue ?? [], simulationRunning() ? "Сборка" : "Пауза");
    const turrets = match.turretsFor(FACTION.ally).length;
    const freeSocket = workshop && match.freePad(FACTION.ally, workshop);
    const turretStatus = !workshop || workshop.type === "factory" ? "Площадки для турелей есть у баз" :
      !freeSocket ? "Площадки базы заняты" : turrets >= MAX_TURRETS ? "Достигнут лимит турелей" : workshop.name;
    setText("turret", "Турель «Дозор» · " + TURRET_COST.join(" / "));
    setText("turret-status", turretStatus + " · " + turrets + " / " + MAX_TURRETS);
    $("turret").title = turretStatus + " · " + TURRET_COST.map((value, i) => value + " " + resourceNames[i]).join(", ");
    $("turret").disabled = !canOrder || !freeSocket || turrets >= MAX_TURRETS || !affordable(bank, TURRET_COST);
    canvas.classList.toggle("aiming", canOrder && selected.size > 0);
    canvas.classList.toggle("attack-aim", !!mapOrder);
    updateInspection(canCommand, hasArmed);
  }

  function updateMapOrders(canOrder, workshop, bank) {
    const rallyAllowed = canOrder && !!workshop;
    const scanWait = match.scanReadyIn(PLAYER);
    const scanAllowed = canOrder && match.fogOfWar && !scanWait && bank[2] >= SCAN_COST;
    if (!canOrder || (mapOrder?.kind === "attack-move" && $("attack-move").disabled) ||
        (mapOrder?.kind === "rally" && workshop !== mapOrder.site) ||
        (mapOrder?.kind === "scan" && !scanAllowed)) mapOrder = null;
    $("attack-move").setAttribute("aria-pressed", String(mapOrder?.kind === "attack-move"));
    $("rally-set").disabled = !rallyAllowed;
    $("rally-set").setAttribute("aria-pressed", String(mapOrder?.kind === "rally"));
    $("rally-clear").disabled = !rallyAllowed || !workshop.rally;
    setText("rally-status", workshop?.rally ? "Сбор · клетка " + (workshop.rally.x + 1) + ", " +
      (workshop.rally.y + 1) : "Сбор у мастерской");
    $("scan-button").hidden = !match.fogOfWar || !!playback;
    $("scan-button").disabled = !scanAllowed;
    $("scan-button").setAttribute("aria-pressed", String(mapOrder?.kind === "scan"));
    $("scan-button").title = scanWait ? "Доступно через " + buildEta(scanWait) :
      "Открывает сектор на " + SCAN_DURATION + " игровых секунд";
    setText("scan-button", scanWait ? "Разведка · " + buildEta(scanWait) : "Разведка · " + SCAN_COST + " данных");
    const prompts = {
      "attack-move": "Укажите точку атаки на карте",
      rally: "Укажите точку сбора для «" + (mapOrder?.site?.label ?? "Эхо") + "»",
      scan: "Укажите сектор для разведки",
    };
    $("attack-move-hint").hidden = !mapOrder;
    if (mapOrder) setText("attack-move-hint", prompts[mapOrder.kind] + " · Esc отменяет");
  }

  function setMapOrder(kind, site = null) {
    mapOrder = mapOrder?.kind === kind ? null : { kind, site };
    canvas.focus({ preventScroll: true });
    updatePanels();
  }

  function workshopSite() {
    return match.productionFor(PLAYER).find(({ id }) => id === productionPicker.value);
  }

  function buildMech(build = currentBuild()) {
    const site = workshopSite();
    if (!ordersAllowed() || !site || !match.requestBuild(build, PLAYER, site)) return;
    tone(305, .21, .065, 615);
    updatePanels();
  }

  $("launch").addEventListener("click", () => resetOperation("paused"));
  $("restart").addEventListener("click", () => resetOperation("briefing"));
  $("fog-of-war").addEventListener("change", () => {
    if (phase !== "briefing") return;
    resetOperation("briefing");
    $("fog-of-war").focus({ preventScroll: true });
  });
  pauseButton.addEventListener("click", togglePause);
  $("open-factory").addEventListener("click", () => openWorkshop(workshopSite()));
  $("close-factory").addEventListener("click", () => factoryDialog.close());
  factoryDialog.addEventListener("close", () => {
    if (factoryDialog.open) return;
    workshopHome.append(workshopPanel);
    canvas.focus({ preventScroll: true });
    updatePanels();
  });
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
    setMapOrder("attack-move");
  }
  $("attack-move").addEventListener("click", toggleAttackMove);
  $("hold").addEventListener("click", () => command({}, "hold"));
  $("return-base").addEventListener("click", () => {
    if (!ordersAllowed() || !match.returnForRepairs([...selected])) return;
    match.log("Мехи направлены на ремонт к ближайшим базам.", "ally");
    tone(620, .14, .045, 470);
    updatePanels();
  });
  $("build").addEventListener("click", () => buildMech());
  $("rally-set").addEventListener("click", () => {
    const site = workshopSite();
    if (!ordersAllowed() || !site) return;
    if (factoryDialog.open) factoryDialog.close();
    setMapOrder("rally", site);
  });
  $("rally-clear").addEventListener("click", () => {
    if (!ordersAllowed() || !match.setRally(PLAYER, workshopSite(), null)) return;
    mapOrder = null;
    updatePanels();
  });
  $("scan-button").addEventListener("click", () => {
    if (ordersAllowed() && !$("scan-button").disabled) setMapOrder("scan");
  });
  productionPicker.addEventListener("change", updatePanels);
  $("turret").addEventListener("click", () => {
    const workshop = workshopSite();
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
    const point = event.detail === 0 ? view.center : view.minimapPosition(event);
    if (mapOrder?.kind === "scan" || mapOrder?.kind === "rally") issueMapOrder(point);
    else view.focusSector(point);
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
    const focus = !playback && view.zoom <= 1 && multiplier > 1 && match.allies().find((unit) => selected.has(unit.id));
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
    if (mapOrder) return issueMapOrder(groundPoint(screen));
    const target = view.hitTest(match, screen, isOrderTarget);
    if (target?.type === "mech" || target?.type === "turret") return command(target, "attack");
    const site = view.hitTestGate(match, screen);
    if (site) return command(site, "capture");
    if (target) return command(target, "capture");

    const point = groundPoint(screen);
    return point ? command(point) : false;
  }

  function groundPoint(screen) {
    const point = view.unproject(screen.x, screen.y);
    return point.x >= -.65 && point.y >= -.65 && point.x <= WIDTH - .35 && point.y <= HEIGHT - .35 ?
      nearestWalkable(match.terrain, point) : null;
  }

  function issueMapOrder(point) {
    if (!point || !ordersAllowed() || !mapOrder) return false;
    const { kind, site } = mapOrder;
    if (kind === "attack-move") return command(point, kind);
    const accepted = kind === "scan" ? match.requestScan(PLAYER, point) : match.setRally(PLAYER, site, point);
    if (accepted) {
      mapOrder = null;
      showOrder(point, kind);
      updatePanels();
    }
    return accepted;
  }

  canvas.addEventListener("click", (event) => {
    if (!ordersAllowed() || mapMoved) return;
    const screen = view.position(event);
    if (mapOrder) {
      issueMapOrder(groundPoint(screen));
      return;
    }
    const target = view.hitTest(match, screen, (entity) => entity.type === "mech" || !!entity.gate);
    if (target && isFriendlyMech(target)) selectUnit(target.id, event.shiftKey);
    else if (target?.gate) inspectSite(target);
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
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || manual.open || refitDialog.open ||
        event.target.closest?.("input, select, textarea")) return;
    if (factoryDialog.open) {
      if (event.code === "KeyF") buildMech();
      return;
    }
    if (event.code === "Escape" && (mapOrder || !$("event-list").hidden)) {
      event.preventDefault();
      mapOrder = null;
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
        recorder.record(match);
        stepBank -= step;
      }
      if (match.winner) showEnd();
      if (audioEnabled && now > lastShot + .19 &&
          match.effects.some((effect) => effect.type === "shot" && effect.max - effect.life < .08 && match.isVisible(PLAYER, effect))) {
        tone(172, .095, .028, 80);
        lastShot = now;
      }
    }
    if (playback) view.draw(advanceReplay(dt), noSelection, now);
    else if (!factoryDialog.open) view.draw(match, selected, now, workshopSite());
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
