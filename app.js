"use strict";

(() => {
  const {
    WIDTH, HEIGHT, MAX_MECHS, SECURE_SECONDS, RESOURCES, FACTION, CHASSIS, WEAPONS, KIT,
    TURRET_COST, DEFAULT_BUILD, Match, affordable, buildCost, clamp, nearestWalkable,
  } = EchoSim;
  const resourceNames = ["сплав", "энергия", "данные"];
  const $ = (id) => document.getElementById(id);
  const canvas = $("terrain");
  const view = new FrontierView(canvas);
  const manual = $("manual");
  const speedButtons = [...document.querySelectorAll(".speed-options button")];
  const speeds = [0.5, 1, 2];
  const buildIds = ["chassis", "weapon", "kit"];
  const parts = [CHASSIS, WEAPONS, KIT];
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
  let pointerType = "";

  const timeText = (seconds) => {
    const rounded = Math.max(0, Math.ceil(seconds));
    return String(Math.floor(rounded / 60)).padStart(2, "0") + ":" + String(rounded % 60).padStart(2, "0");
  };

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
    if (!ordersAllowed() || !match.setOrder([...selected], target, kind)) return false;
    view.marker = kind === "hold" ? null : {
      x: target.x, y: target.y, time: performance.now() / 1000,
      faction: kind === "attack" ? FACTION.hostile : FACTION.ally,
    };
    tone(kind === "attack" ? 365 : 620, .14, .045, 470);
    return true;
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

  const nodeCards = match.nodes.map((node, index) => {
    const card = makeCard("station");
    card.name.textContent = node.name;
    card.call.textContent = node.call;
    card.button.title = "Правый клик · отправить выбранных мехов · " + resourceNames[node.resource] + " +" + format.format(node.income) + "/с";
    const sendToStation = () => {
      const target = match.nodes[index];
      if (command(target) && view.zoom > 1) view.zoomTo(view.zoom, target);
    };
    onRightClick(card.button, sendToStation);
    card.button.addEventListener("click", (event) => {
      if (event.detail === 0 || touchClick(event)) sendToStation();
    });
    $("stations").append(card.button);
    return card;
  });

  const emptySquad = document.createElement("span");
  emptySquad.className = "empty-squad";
  emptySquad.textContent = "Мастерская может собрать новый мех.";
  $("units").append(emptySquad);

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
        card.button.title = WEAPONS[unit.weaponId].name + " · " + KIT[unit.kitId].name;
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
  const currentBuild = () => buildIds.map((id) => Number($(id).value));

  for (const [index, id] of buildIds.entries()) {
    const input = $(id);
    for (const [value, part] of parts[index].entries()) {
      input.append(new Option(part.name, value));
    }
    input.value = DEFAULT_BUILD[index];
    input.addEventListener("change", updatePanels);
  }

  function updatePanels() {
    const running = simulationRunning();
    const canOrder = ordersAllowed();
    const allies = match.allies();
    const income = match.income();
    for (const [i, id] of RESOURCES.entries()) {
      setText(id, Math.floor(match.bank[i]));
      setText(id + "-rate", "+" + format.format(income[i]) + "/с");
    }
    const countdown = Math.max(0, match.nextWave - match.time);
    setText("wave-label", match.wave === 0 ? "Первая волна" : "Волна " + (match.wave + 1));
    setText("wave-clock", timeText(countdown));
    $("wave-panel").classList.toggle("imminent", running && countdown < 10);
    const event = match.news[0];
    setText("event-text", event.message);
    $("event-dot").className = event.tone;

    const controlled = match.nodes.filter((node) => node.faction === FACTION.ally).length;
    setText("node-count", controlled + " / " + match.nodes.length);
    setText("mission-detail", match.secure > 0
      ? "Передача сигнала. Удерживайте станции ещё " + Math.max(0, Math.ceil(SECURE_SECONDS - match.secure)) + " с."
      : "Захватите все станции и удержите их 24 секунды или уничтожьте Цитадель дронов.");
    setProgress("secure-bar", match.secure / SECURE_SECONDS);
    const base = match.bases[0];
    const hull = base.hp / base.hull;
    setProgress("base-bar", hull);
    setText("base-hp", Math.ceil(hull * 100) + "%");
    $("base-bar").style.background = hull < .35 ? "#ff947c" : "";
    renderSquad(allies, canOrder);
    for (const [index, node] of match.nodes.entries()) {
      const { button, state } = nodeCards[index];
      const color = node.faction === FACTION.ally ? "ally" : node.faction === FACTION.hostile ? "hostile" : "";
      button.className = "station " + color;
      button.disabled = !canOrder || !selected.size;
      const progress = Math.round(Math.abs(node.influence) * 100);
      state.textContent = node.contested ? "Спорная" : color === "ally" ? "Наша" : color === "hostile" ? "Дроны"
        : progress > 0 ? progress + "%" : "Свободна";
      button.style.setProperty("--fill", progress + "%");
      button.style.setProperty("--meter", node.influence > 0 ? "#79efc8" : "#ff9c80");
    }

    $("select-all").disabled = !canOrder || !allies.length;
    $("hold").disabled = !canOrder || !selected.size;
    $("return-base").disabled = !canOrder || !selected.size;
    $("pause").disabled = phase === "briefing" || phase === "ended";
    const paused = phase === "paused";
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
    for (const [i, id] of buildIds.entries()) {
      setText(id + "-detail", parts[i][design[i]].detail);
      costs[i].textContent = cost[i];
      costs[i].classList.toggle("insufficient", match.bank[i] < cost[i]);
    }
    const atLimit = allies.length >= MAX_MECHS;
    setText("factory-state", match.queue ? "Сборка " + Math.ceil(match.queue.remaining) + " с" : allies.length + " / " + MAX_MECHS + " мехов");
    $("build").disabled = !running || !!match.queue || atLimit || !affordable(match.bank, cost);
    const freeSockets = match.pads.filter((pad) => !pad.turret || pad.turret.hp <= 0).length;
    setText("turret", freeSockets ? "Турель «Дозор» · " + TURRET_COST.join(" / ") : "Турели развёрнуты");
    $("turret").title = TURRET_COST.map((value, i) => value + " · " + resourceNames[i]).join(", ");
    $("turret").disabled = !running || !freeSockets || !affordable(match.bank, TURRET_COST);
    canvas.classList.toggle("aiming", canOrder && selected.size > 0);
  }

  function buildMech() {
    if (!simulationRunning() || !match.requestBuild(currentBuild())) return;
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
    if (target) return command(target, target.type ? "attack" : "move");

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
