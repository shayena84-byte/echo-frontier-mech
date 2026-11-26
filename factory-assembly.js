"use strict";

const FactoryAssembly = (() => {
  const { CHASSIS, WEAPONS, KIT, clamp } = EchoSim;
  const WIDTH = 960, HEIGHT = 516;
  const CENTER_X = 480, FLOOR_Y = 421, SCALE = 6.45;
  const DEPARTURE_SECONDS = .95;
  const catalog = [CHASSIS, WEAPONS, WEAPONS, KIT];
  const labels = ["Шасси", "Оружие 1", "Оружие 2", "Модуль"];
  const smooth = (value) => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  };

  function stroke(ctx, points, color, width = 1) {
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (const point of points.slice(1)) ctx.lineTo(...point);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function disk(ctx, x, y, rx, ry, color) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function beam(ctx, x, y, radius, color) {
    const halo = ctx.createRadialGradient(x, y, 0, x, y, radius);
    halo.addColorStop(0, color);
    halo.addColorStop(1, "transparent");
    disk(ctx, x, y, radius, radius, halo);
  }

  function paintBay(ctx) {
    const wall = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    wall.addColorStop(0, "#122932");
    wall.addColorStop(.58, "#0b1822");
    wall.addColorStop(1, "#192f39");
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    beam(ctx, CENTER_X, 214, 335, "#45899a3f");

    ctx.fillStyle = "#243943";
    ctx.fillRect(0, 27, WIDTH, 22);
    stroke(ctx, [[0, 50], [WIDTH, 50]], "#7e9aa56e", 2);
    for (const y of [161, 263, 350]) stroke(ctx, [[0, y], [WIDTH, y]], "#63859430", 2);
    for (const x of [46, 215, 745, 914]) {
      ctx.fillStyle = "#233742";
      ctx.fillRect(x - 12, 49, 24, 339);
      stroke(ctx, [[x + 11, 49], [x + 11, 385]], "#516e7c7a", 2);
      for (const y of [73, 146, 219, 292, 365]) disk(ctx, x, y, 3, 3, "#8a9fa9");
    }
    for (const x of [234, 714]) {
      beam(ctx, x + 6, 111, 72, "#82eaf23f");
      ctx.fillStyle = "#a7ebed";
      ctx.fillRect(x, 88, 12, 45);
    }

    ctx.fillStyle = "#0d1d26";
    ctx.fillRect(0, 386, WIDTH, HEIGHT - 386);
    for (const x of [-145, 57, 247, 440, 520, 713, 903, 1105]) {
      stroke(ctx, [[CENTER_X + (x - CENTER_X) * .58, 385], [x, HEIGHT]], "#354d55", 1.5);
    }
    stroke(ctx, [[0, 467], [WIDTH, 467]], "#65808b42", 1.5);
    disk(ctx, CENTER_X, FLOOR_Y + 23, 207, 57, "#080e13");
    disk(ctx, CENTER_X, FLOOR_Y + 13, 207, 52, "#334b53");
    disk(ctx, CENTER_X, FLOOR_Y + 10, 192, 46, "#162a33");
    stroke(ctx, [[305, 450], [345, 463], [408, 471], [551, 471], [616, 463], [655, 450]], "#d99b51", 3);
    for (const x of [341, 391, 569, 619]) disk(ctx, x, 448, 4, 3, "#74edda");
  }

  function manipulator(ctx, base, target, side, activity) {
    const [bx, by] = base;
    const dx = target[0] - bx, dy = target[1] - by;
    const reach = Math.max(55, Math.min(Math.hypot(dx, dy), 419));
    const angle = Math.atan2(dy, dx);
    const end = [bx + reach * Math.cos(angle), by + reach * Math.sin(angle)];
    const elbowAngle = angle - side * Math.acos(reach / 420);
    const elbow = [bx + 210 * Math.cos(elbowAngle), by + 210 * Math.sin(elbowAngle)];
    disk(ctx, bx, by + 7, 32, 13, "#0b151c");
    disk(ctx, bx, by, 28, 22, "#3a4d55");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    stroke(ctx, [base, elbow, end], "#0b141a", 28);
    const metal = ctx.createLinearGradient(0, 168, 0, by);
    metal.addColorStop(0, activity ? "#f4c97f" : "#b3c6c5");
    metal.addColorStop(.42, activity ? "#c28a43" : "#738c90");
    metal.addColorStop(1, activity ? "#795330" : "#41555d");
    stroke(ctx, [base, elbow, end], metal, 21);
    stroke(ctx, [base, elbow, end].map(([x, y]) => [x, y - 4]), activity ? "#ffe2a3a6" : "#b3c6c5a3", 4);
    const piston = base.map((value, axis) => value + (elbow[axis] - value) * .44);
    stroke(ctx, [piston, elbow].map(([x, y]) => [x - side * 3, y + 4]), "#50636a", 6);
    for (const [x, y] of [base, elbow]) {
      disk(ctx, x, y, 15, 15, "#26363e");
      disk(ctx, x, y, 8, 8, "#6a858f");
      disk(ctx, x, y, 3, 3, activity ? "#ffd48a" : "#9ee7e3");
    }
    const a = Math.atan2(end[1] - elbow[1], end[0] - elbow[0]);
    ctx.save();
    ctx.translate(...end);
    ctx.rotate(a);
    for (const dir of [-1, 1]) stroke(ctx, [[-10, 0], [0, dir * 7], [9, dir * (activity ? 3 : 8)]], "#cad9d8", 3);
    ctx.restore();
  }

  function hoist(ctx, point) {
    const [x, y] = point;
    stroke(ctx, [[x, 49], [x, y]], "#aebbc1", 2);
    ctx.fillStyle = "#ad8048";
    ctx.fillRect(x - 18, 31, 36, 22);
    ctx.fillStyle = "#f3b96a";
    ctx.fillRect(x - 13, 39, 26, 4);
    disk(ctx, x, y - 3, 7, 4, "#f3b96a");
  }

  function weld(ctx, point, time, quiet) {
    const [x, y] = point;
    beam(ctx, x, y, quiet ? 28 : 50, "#ffd791a6");
    disk(ctx, x, y, 4, 3, "#fff2cf");
    const count = quiet ? 8 : 24;
    for (let i = 0; i < count; i++) {
      const age = (time * 1.85 + i * .173) % 1;
      const vx = Math.sin(i * 8.74) * (31 + i * 4);
      const vy = -16 - (i * 27 % 81);
      const px = x + vx * age, py = y + vy * age + 86 * age * age;
      ctx.globalAlpha = .9 * (1 - age);
      stroke(ctx, [[px - vx * .095, py - (vy + 172 * age) * .095], [px, py]],
        i % 3 ? "#ffb558" : "#fff1ae", i % 4 ? 1.35 : 2.4);
    }
    ctx.globalAlpha = 1;
  }

  function makePlan(job) {
    let end = 0;
    const stages = job.build.flatMap((id, slot) => {
      const component = catalog[slot][id];
      if (!component) return [];
      const start = end;
      end += component.assemblyTime;
      return [{ slot, start, end, label: labels[slot] + " · " + component.name }];
    });
    return { stages, rig: MechArt.assemblyRig(job.build) };
  }

  function drawMech(ctx, [chassisId, first, second, kitId], x = CENTER_X, y = FLOOR_Y, travel = 0) {
    MechArt.draw(ctx, {
      faction: 1, chassisId, weaponIds: [first, second], kitId, direction: MechArt.ASSEMBLY_DIRECTION,
      moving: travel > 0, foot: travel * 10,
    }, x, y, SCALE, { detailed: true, density: 6 });
  }

  const socketOf = (part, dx = 0, dy = 0) =>
    [CENTER_X + dx + part.socket[0] * SCALE, FLOOR_Y + dy + part.socket[1] * SCALE];

  function showStage(ctx, rig, build, slot, elapsed, time, quiet) {
    const assemblingBody = slot === 0;
    const inPlace = elapsed >= .7;
    const tool = slot === 2 ? 1 : 0;
    const part = assemblingBody ? rig.body : slot === 3 ? rig.kit : rig.weapons[slot - 1];
    const fit = smooth(assemblingBody ? (elapsed - .12) / .58 : elapsed / .7);
    const lift = assemblingBody || slot === 3;
    const dx = lift ? 0 : (tool ? 1 : -1) * 215 * (1 - fit);
    const dy = (lift ? -164 : -42) * (1 - fit);
    const mount = socketOf(part, dx, dy);
    const hot = inPlace && elapsed < .96;
    const toolReach = hot || !lift;
    const rest = 1 - smooth((elapsed - .91) / .09);

    if (lift && !inPlace) hoist(ctx, mount);
    const recipe = build.map((id, index) => index < slot || (index === slot && inPlace) ? id : null);
    if (assemblingBody && !inPlace) {
      const incoming = -236 * (1 - smooth(elapsed / .37));
      rig.undercarriage.draw(ctx, CENTER_X + incoming, FLOOR_Y, SCALE);
      rig.body.draw(ctx, CENTER_X, FLOOR_Y + dy, SCALE);
    } else {
      drawMech(ctx, recipe);
      if (!inPlace) part.draw(ctx, CENTER_X + dx, FLOOR_Y + dy, SCALE);
    }

    const bases = [[132, 418], [828, 418]];
    for (const [index, base] of bases.entries()) {
      const direction = index === 0 ? 1 : -1;
      const idle = [base[0] + 119 * direction, 288];
      const active = toolReach && index === tool;
      const target = active ? idle.map((value, axis) => value + (mount[axis] - value) * rest) : idle;
      manipulator(ctx, base, target, direction, active);
    }
    if (hot) weld(ctx, mount, time, quiet);
  }

  return class {
    constructor(canvas, status, progress) {
      this.canvas = canvas;
      this.status = status;
      this.progress = progress;
      this.ctx = canvas.getContext("2d", { alpha: false });
      this.quiet = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.reset();
    }

    reset(site = null) {
      this.site = site;
      this.job = null;
      this.completed = null;
      this.lastTime = null;
      this.plan = null;
    }

    update(site, time) {
      if (site !== this.site) this.reset(site);
      const job = site?.queue[0] ?? null;
      const changed = job !== this.job;
      if (changed) {
        this.completed = !job && this.job?.remaining === 0 ? { build: this.job.build, time } : null;
        this.plan = job ? makePlan(job) : null;
        this.job = job;
      }
      const departure = this.completed && time - this.completed.time < DEPARTURE_SECONDS;
      this.canvas.hidden = !job && !departure;
      this.progress.hidden = !job;
      if (!job && !departure) {
        if (this.status.textContent !== "Ожидает заказа") this.status.textContent = "Ожидает заказа";
        return;
      }
      if (!changed && time === this.lastTime) return;
      this.lastTime = time;
      if (!this.backdrop) {
        this.backdrop = document.createElement("canvas");
        this.backdrop.width = WIDTH;
        this.backdrop.height = HEIGHT;
        paintBay(this.backdrop.getContext("2d"));
      }
      this.ctx.drawImage(this.backdrop, 0, 0);
      if (job) {
        const elapsed = clamp(job.duration - job.remaining, 0, job.duration);
        const step = this.plan.stages.find((stage) => elapsed < stage.end) ?? this.plan.stages.at(-1);
        const progress = clamp((elapsed - step.start) / (step.end - step.start), 0, 1);
        if (this.status.textContent !== step.label) this.status.textContent = step.label;
        this.progress.value = elapsed / job.duration;
        showStage(this.ctx, this.plan.rig, job.build, step.slot, progress, time, this.quiet);
      } else {
        if (this.status.textContent !== "Мех выпущен") this.status.textContent = "Мех выпущен";
        const travel = (time - this.completed.time) / DEPARTURE_SECONDS;
        drawMech(this.ctx, this.completed.build, CENTER_X + 370 * travel, FLOOR_Y - 9 * travel, travel);
      }
    }
  };
})();
