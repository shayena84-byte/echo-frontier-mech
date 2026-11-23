"use strict";

(() => {
  const {
    WIDTH, HEIGHT, MAX_MECHS, BUILD_SECONDS, BASE_CAPTURE_SECONDS, RESOURCES, FACTION, CHASSIS, WEAPONS, KIT,
    TURRET_COST, DEFAULT_BUILD, Match, affordable, buildCost, equipmentFor, clamp, nearestWalkable,
  } = EchoSim;
  const resourceNames = ["сплав", "энергия", "данные"];
  const $ = (id) => document.getElementById(id);
  const canvas = $("terrain");
  const view = new FrontierView(canvas);
  const manual = $("manual");
  const buildQueue = $("build-queue");
  const speedButtons = [...document.querySelectorAll(".speed-options button")];
  const speeds = [0.5, 1, 2];
  const format = new Intl.NumberFormat("ru", { maximumFractionDigits: 1 });
  const unitCards = new Map();
  const isFriendlyMech = (entity) => entity.type === "mech" && entity.faction === FACTION.ally;
  const isOrderTarget = (entity) => !entity.type || entity.faction === FACTION.hostile;
  let match = new Match();
  let selected = new Set([match.allies()[0].id]);
  let phase = "briefing";
  let lastFrame = 0;
  let lastPanels = -1;
  let lastShot = -1;
  let currentSound = null;
  let audioEnabled = false;
  let stepBank = 0;
  let speed = speeds[1];
  let lastPreview = "";
  let shownQueue = [];
  let pointerType = "";

  const timeText = (seconds) => {
    const rounded = Math.max(0, Math.ceil(seconds));
    return String(Math.floor(rounded / 60)).padStart(2, "0") + ":" + String(rounded % 60).padStart(2, "0");
  };
  const buildEta = (seconds) => format.format(Math.ceil(seconds * 10) / 10) + " с";

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

  function selectUnit(id, append = false) {
    if (!append) selected.clear();
    if (append && selected.has(id)) selected.delete(id);
    else selected.add(id);
    tone(455);
    updatePanels();
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
    showOrder(target, kind);
    return true;
  }

  function showOrder(target, kind) {
    const destination = kind === "capture" ? target.gate : target;
    view.marker = kind === "hold" ? null : {
      x: destination.x, y: destination.y, time: performance.now() / 1000,
      faction: kind === "attack" ? FACTION.hostile : FACTION.ally,
    };
    tone(kind === "attack" ? 365 : 620, .14, .045, 470);
  }

  function commandNearest(kind) {
    if (!ordersAllowed() || !selected.size) return;
    const capture = kind === "capture";
    const target = capture ? match.captureNearest([...selected]) : match.attackNearestMech([...selected]);
    if (target) {
      showOrder(target, kind);
      match.log(capture ? "Приказ занять ворота «" + target.name + "»." : "Приказ атаковать · " + target.name + ".");
    } else if (capture) {
      match.log("До свободных или вражеских ворот нет маршрута.");
    }
    updatePanels();
  }

  function start(reset = false) {
    if (reset) {
      match = new Match();
      selected = new Set([match.allies()[0].id]);
      for (const item of unitCards.values()) item.button.remove();
      unitCards.clear();
      view.marker = null;
      view.hover = null;
      view.zoomTo(1);
    }
    phase = "running";
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
    canvas.focus({ preventScroll: true });
    updatePanels();
  }

  function showEnd() {
    phase = "ended";
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

  function bindCaptureControl(button, getSite) {
    const sendToGate = () => {
      const site = getSite();
      if (command(site, "capture") && view.zoom > 1) view.zoomTo(view.zoom, site.gate);
    };
    onRightClick(button, sendToGate);
    button.addEventListener("click", sendToGate);
  }

  bindCaptureControl($("citadel-gate-order"), () => match.bases[1]);
  const nodeCards = match.nodes.map((node, index) => {
    const card = makeCard("station");
    card.name.textContent = node.name;
    card.call.textContent = node.call;
    card.button.title = "Занять ворота станции · " + resourceNames[node.resource] + " +" + format.format(node.income) + "/с";
    bindCaptureControl(card.button, () => match.nodes[index]);
    $("stations").append(card.button);
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
        card.button.addEventListener("click", (event) => selectUnit(unit.id, event.shiftKey));
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

  function updateBuildQueue(queue, statusText) {
    if (queue.length !== shownQueue.length || queue.some((job, i) => job !== shownQueue[i])) {
      shownQueue = queue.slice();
      buildQueue.replaceChildren(...queue.map(({ build }, i) => {
        const row = document.createElement("li");
        const name = document.createElement("strong");
        const details = document.createElement("small");
        const status = document.createElement("span");
        name.textContent = CHASSIS[build[0]].name;
        details.textContent = equipmentNames(build.slice(1, 3), build[3]);
        status.className = "build-job-status";
        if (i === 0) status.id = "active-build-time";
        else status.textContent = "Ожидает";
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
      setProgress("build-bar", 1 - active.remaining / BUILD_SECONDS);
    }
  }

  function gateStatus(gate, idleLabel) {
    if (gate.contested) return "Оспариваются";
    if (!gate.capturer) return idleLabel;
    return (gate.faction === FACTION.ally ? "Захват " : "Дроны ") + Math.floor(gate.progress * 100) + "%";
  }

  function showGateProgress(button, gate) {
    button.style.setProperty("--fill", gate.progress * 100 + "%");
    button.style.setProperty("--meter", gate.faction === FACTION.ally ? "#79efc8" : "#ff9c80");
  }

  function updatePanels() {
    const running = simulationRunning();
    const canOrder = ordersAllowed();
    const paused = phase === "paused";
    const allies = match.allies();
    const [base, enemy] = match.bases;
    const { bank, queue } = base;
    const income = match.income();
    for (const [i, id] of RESOURCES.entries()) {
      setText(id, Math.floor(bank[i]));
      setText(id + "-rate", "+" + format.format(base.hp > 0 ? income[i] : 0) + "/с");
    }
    const enemyOrder = enemy.queue[0];
    setText("enemy-factory-queue", enemy.hp <= 0 ? "Завод остановлен" : enemyOrder ? "Заказов · " + enemy.queue.length : "Очередь пуста");
    $("enemy-factory-eta").hidden = !enemyOrder || enemy.hp <= 0;
    if (enemyOrder && enemy.hp > 0) setText("enemy-factory-eta", (paused ? "Пауза · " : "Сборка · ") + buildEta(enemyOrder.remaining));
    const event = match.news[0];
    setText("event-text", event.message);
    $("event-dot").className = event.tone;

    const controlled = match.nodes.filter((node) => node.faction === FACTION.ally).length;
    setText("node-count", controlled + " / " + match.nodes.length);
    renderSquad(allies, canOrder);
    const incoming = new Set(allies.filter((unit) => unit.order.continuous).map((unit) => unit.order.target));
    const citadelButton = $("citadel-gate-order");
    citadelButton.disabled = !canOrder || !selected.size;
    const citadelStatus = incoming.has(enemy.id) ? "Мех в пути" : enemy.hp <= 0 ? "Оборона отключена" : "К захвату";
    setText("citadel-gate-status", gateStatus(enemy.gate, citadelStatus));
    showGateProgress(citadelButton, enemy.gate);
    $("camp-gate-status").hidden = !base.gate.capturer && !base.gate.contested;
    setText("camp-gate-status", "Ворота лагеря · " + gateStatus(base.gate, ""));
    const hull = base.hp / base.hull;
    setProgress("base-bar", hull);
    setText("base-hp", base.hp > 0 ? Math.ceil(hull * 100) + "%" : "Отключена");
    $("base-bar").style.background = hull < .35 ? "#ff947c" : "";
    for (const [index, node] of match.nodes.entries()) {
      const { button, state } = nodeCards[index];
      const color = node.faction === FACTION.ally ? "ally" : node.faction === FACTION.hostile ? "hostile" : "";
      button.className = "station " + color;
      button.disabled = !canOrder || !selected.size;
      const owner = color === "ally" ? "Наша" : color === "hostile" ? "Дроны" : "Свободна";
      state.textContent = gateStatus(node.gate, incoming.has(node.id) ? "Мех в пути" : owner);
      showGateProgress(button, node.gate);
    }

    const canCommand = canOrder && selected.size > 0;
    const hasArmed = allies.some((unit) => selected.has(unit.id) && unit.range > 0);
    const hasTarget = match.mechs(FACTION.hostile).length > 0;
    $("select-all").disabled = !canOrder || !allies.length;
    $("capture-nearest").disabled = !canCommand;
    $("attack-mech").disabled = !canCommand || !hasArmed || !hasTarget;
    $("attack-mech").title = !hasArmed ? "Выберите меха с оружием" : !hasTarget ? "На поле нет вражеских мехов" : "Преследовать ближайшего вражеского меха";
    $("hold").disabled = !canCommand;
    $("return-base").disabled = !canCommand;
    $("pause").disabled = phase === "briefing" || phase === "ended";
    $("pause-status").hidden = !paused;
    setText("pause", paused ? "Продолжить" : "Пауза");
    $("zoom-out").disabled = view.zoom <= 1;
    $("zoom-in").disabled = view.zoom >= 2.05;

    const design = currentBuild();
    const preview = design.join("/");
    if (preview !== lastPreview) {
      MechArt.preview($("mech-preview"), ...design);
      lastPreview = preview;
    }
    const cost = buildCost(design);
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
    setText("factory-state", (allies.length + queue.length) + " / " + MAX_MECHS + " мест");
    $("build").disabled = !canOrder || !match.canBuild(design);
    updateBuildQueue(queue, base.hp <= 0 ? "Завод остановлен" : paused ? "Пауза" : "Сборка");
    const freeSocket = match.freePad();
    setText("turret", freeSocket ? "Турель «Дозор» · " + TURRET_COST.join(" / ") : "Турели развёрнуты");
    $("turret").title = TURRET_COST.map((value, i) => value + " · " + resourceNames[i]).join(", ");
    $("turret").disabled = !running || !freeSocket || !affordable(bank, TURRET_COST);
    canvas.classList.toggle("aiming", canOrder && selected.size > 0);
  }

  function buildMech() {
    if (!ordersAllowed() || !match.requestBuild(currentBuild())) return;
    tone(305, .21, .065, 615);
    updatePanels();
  }

  $("launch").addEventListener("click", () => start());
  $("restart").addEventListener("click", () => start(true));
  $("pause").addEventListener("click", togglePause);
  for (const button of speedButtons) {
    button.addEventListener("click", () => {
      speed = speeds[Number(button.dataset.speed) - 1];
      for (const option of speedButtons) option.setAttribute("aria-pressed", String(option === button));
    });
  }
  $("select-all").addEventListener("click", selectAll);
  $("capture-nearest").addEventListener("click", () => commandNearest("capture"));
  $("attack-mech").addEventListener("click", () => commandNearest("attack"));
  $("hold").addEventListener("click", () => command({}, "hold"));
  $("return-base").addEventListener("click", () => command({ x: 4, y: 13 }));
  $("build").addEventListener("click", buildMech);
  $("turret").addEventListener("click", () => {
    if (simulationRunning() && match.requestTurret()) {
      tone(260, .22, .06, 520);
      updatePanels();
    }
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

  function zoomBy(delta) {
    const focus = match.allies().find((unit) => selected.has(unit.id));
    view.zoomTo(view.zoom + delta, focus && { x: focus.x, y: focus.y });
    updatePanels();
  }

  $("zoom-in").addEventListener("click", () => zoomBy(.3));
  $("zoom-out").addEventListener("click", () => zoomBy(-.3));
  window.addEventListener("pointerdown", (event) => { pointerType = event.pointerType; }, { capture: true, passive: true });
  canvas.addEventListener("pointermove", (event) => {
    if (!ordersAllowed()) return;
    view.hover = view.hitTest(match, view.position(event))?.id || null;
  });
  canvas.addEventListener("pointerleave", () => { view.hover = null; });

  function commandOnMap(screen) {
    const target = view.hitTest(match, screen, isOrderTarget);
    if (target?.type === "mech" || target?.type === "turret") return command(target, "attack");
    const site = view.hitTestGate(match, screen);
    if (site) return command(site, "capture");
    if (target) return command(target, target.type === "base" && target.hp > 0 ? "attack" : "capture");

    const point = view.unproject(screen.x, screen.y);
    if (point.x >= -.65 && point.y >= -.65 && point.x <= WIDTH - .35 && point.y <= HEIGHT - .35) {
      return command(nearestWalkable(match.terrain, point));
    }
    return false;
  }

  canvas.addEventListener("click", (event) => {
    if (!ordersAllowed()) return;
    const screen = view.position(event);
    const unit = view.hitTest(match, screen, isFriendlyMech);
    if (unit) selectUnit(unit.id, event.shiftKey);
    else if (touchClick(event)) commandOnMap(screen);
  });
  onRightClick(canvas, (event) => {
    if (commandOnMap(view.position(event))) canvas.focus({ preventScroll: true });
  });
  window.addEventListener("keydown", (event) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || manual.open ||
        event.target.closest?.("input, select, textarea")) return;
    if (event.code === "Space" && !event.target.closest?.("button") && (phase === "running" || phase === "paused")) {
      event.preventDefault();
      togglePause();
      return;
    }
    if (!ordersAllowed()) return;
    if (event.code === "KeyG") selectAll();
    if (event.code === "KeyF") buildMech();
    if (/^Digit[1-8]$/.test(event.code)) {
      const unit = match.allies()[Number(event.code.at(-1)) - 1];
      if (unit) selectUnit(unit.id, event.shiftKey);
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
      if (audioEnabled && now > lastShot + .19 && match.effects.some((effect) => effect.type === "shot" && effect.life > .12)) {
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

  updatePanels();
  requestAnimationFrame(frame);
})();
