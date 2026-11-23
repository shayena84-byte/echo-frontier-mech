"use strict";

const FrontierView = (() => {
  const { WIDTH, HEIGHT, FACTION, noise, clamp } = EchoSim;
  const TW = 23;
  const TH = 12;
  const COLORS = { ally: "#73f0c5", hostile: "#ff896f", neutral: "#9ed8fa" };
  const MAP_CENTER = { x: (WIDTH - 1) / 2, y: (HEIGHT - 1) / 2 };
  const POLARITY = (faction) => faction === FACTION.ally ? COLORS.ally :
    faction === FACTION.hostile ? COLORS.hostile : COLORS.neutral;

  function area(ctx, points, fill, border) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (border) { ctx.strokeStyle = border; ctx.stroke(); }
  }

  function line(ctx, points, color, width = 1) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  function ellipse(ctx, x, y, wr, hr, fill, border, width = 1) {
    ctx.beginPath();
    ctx.ellipse(x, y, wr, hr, 0, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (border) { ctx.strokeStyle = border; ctx.lineWidth = width; ctx.stroke(); }
  }

  function luminescence(ctx, x, y, radius, from, to) {
    const halo = ctx.createRadialGradient(x, y, 0, x, y, radius);
    halo.addColorStop(0, from);
    halo.addColorStop(1, to);
    ctx.fillStyle = halo;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  function box(ctx, x, y, w, d, height, top, east, west) {
    const z = y - height;
    area(ctx, [[x + w, z], [x, z + d], [x, y + d], [x + w, y]], east, "#0f1927");
    area(ctx, [[x - w, z], [x, z + d], [x, y + d], [x - w, y]], west, "#0f1927");
    area(ctx, [[x, z - d], [x + w, z], [x, z + d], [x - w, z]], top, "#66828a8c");
  }

  class View {
    constructor(canvas) {
      this.canvas = canvas;
      this.context = canvas.getContext("2d");
      this.buffer = document.createElement("canvas");
      this.terrain = null;
      this.zoom = 1;
      this.center = MAP_CENTER;
      this.hover = null;
      this.marker = null;
      this.dirty = true;
      this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas);
      this.resize();
    }

    resize() {
      this.width = Math.max(1, this.canvas.clientWidth);
      this.height = Math.max(1, this.canvas.clientHeight);
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
      this.buffer.width = this.canvas.width;
      this.buffer.height = this.canvas.height;
      this.reframe();
    }

    reframe() {
      const margin = this.width > 650 ? 64 : 28;
      this.scale = Math.min((this.width - margin) / ((WIDTH + HEIGHT) * TW),
        (this.height - 99) / ((WIDTH + HEIGHT) * TH + 32)) * this.zoom;
      this.scale = Math.max(0.05, this.scale);
      this.ox = this.width / 2 - (this.center.x - this.center.y) * TW * this.scale;
      this.oy = this.height * 0.505 - (this.center.x + this.center.y) * TH * this.scale;
      this.dirty = true;
    }

    zoomTo(factor, target) {
      this.zoom = clamp(factor, 1, 2.05);
      this.center = this.zoom <= 1 ? MAP_CENTER : target || this.center;
      this.reframe();
    }

    project(x, y) {
      return { x: this.ox + (x - y) * TW * this.scale, y: this.oy + (x + y) * TH * this.scale };
    }

    unproject(x, y) {
      const a = (x - this.ox) / (TW * this.scale);
      const b = (y - this.oy) / (TH * this.scale);
      return { x: (a + b) / 2, y: (b - a) / 2 };
    }

    position(event) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    hitTest(match, screen) {
      const s = this.scale;
      let chosen = null;
      let best = Infinity;
      for (const entity of [...match.nodes, ...match.entities()]) {
        const point = this.project(entity.x, entity.y);
        const isNode = !entity.type;
        const model = entity.type === "mech" ? MechArt.profile(entity.chassisId) : null;
        const z = model ? model.hud * .45 : entity.type === "base" ? 29 : isNode ? 18 : 9;
        const radius = entity.type === "base" ? Math.max(19, 39 * s) : Math.max(13, (model ? model.shadow[0] + 3 : 26) * s);
        const dist = Math.hypot(screen.x - point.x, screen.y - (point.y - z * s));
        if (dist < radius && dist < best) { chosen = entity; best = dist; }
      }
      return chosen;
    }

    drawBackground(ctx) {
      const w = this.width;
      const h = this.height;
      const sky = ctx.createLinearGradient(0, 0, w * .45, h);
      sky.addColorStop(0, "#101c2c");
      sky.addColorStop(.47, "#1b3547");
      sky.addColorStop(1, "#0b1420");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      luminescence(ctx, w * .63, h * .32, h * .79, "#35787d4a", "#12263c00");
      luminescence(ctx, w * .86, h * .09, h * .64, "#60608439", "#23284a00");
      for (let i = 0; i < 190; i++) {
        const px = noise(i, 1, 19) * w;
        const py = noise(i, 2, 19) * h;
        const strength = noise(i, 3, 19);
        ctx.fillStyle = strength > .88 ? "#c0e5eb8c" : "#a7cad43b";
        ctx.fillRect(px, py, strength > .88 ? 1.4 : .7, strength > .88 ? 1.4 : .7);
      }
      const moonX = w * .79;
      const moonY = h * .16;
      const radius = Math.min(w, h) * .104;
      const moon = ctx.createRadialGradient(moonX - radius * .73, moonY - radius * .49, 0, moonX, moonY, radius);
      moon.addColorStop(0, "#6b9ca25b");
      moon.addColorStop(.8, "#2948583a");
      moon.addColorStop(1, "#9ed3c931");
      ellipse(ctx, moonX, moonY, radius, radius, moon, "#8bd2cf33", .8);
      ctx.save();
      ctx.translate(moonX, moonY);
      ctx.rotate(-.26);
      ellipse(ctx, 0, 0, radius * 1.68, radius * .32, null, "#accadb28", 1);
      ctx.restore();

      for (let n = 0; n < 17; n++) {
        const yy = h * .62 + n * n * h * .0017;
        line(ctx, [[0, yy], [w, yy]], "#84a3bc18", .7);
      }
      for (let n = -13; n <= 13; n++) {
        line(ctx, [[w / 2 + n * w * .027, h * .62], [w / 2 + n * w * .125, h]], "#84a3bc15", .7);
      }
    }

    drawGround(ctx, tile) {
      const { x, y, grit, kind } = tile;
      const p = this.project(x, y);
      const a = TW * this.scale;
      const b = TH * this.scale;
      const top = [p.x, p.y - b];
      const right = [p.x + a, p.y];
      const bottom = [p.x, p.y + b];
      const left = [p.x - a, p.y];
      const cool = Math.floor(grit * 10 + 7 * Math.sin((x + y) * .24));
      const dusty = kind === "dust" ? 7 : 0;
      const glow = x > 20 && y < 10 ? 5 : 0;
      const depth = (19 + Math.round(grit * 10)) * this.scale;
      if (x === WIDTH - 1) {
        area(ctx, [right, bottom, [bottom[0], bottom[1] + depth], [right[0], right[1] + depth]], "#182735", "#344957");
        line(ctx, [[bottom[0], bottom[1] + depth * .62], [right[0], right[1] + depth * .5]], "#6a858f3a", .9);
      }
      if (y === HEIGHT - 1) {
        area(ctx, [left, bottom, [bottom[0], bottom[1] + depth], [left[0], left[1] + depth]], "#203440", "#3d5059");
        line(ctx, [[left[0], left[1] + depth * .4], [bottom[0], bottom[1] + depth * .58]], "#769b9c40", .9);
      }
      const fill = kind === "fissure" ? "#291f2c" :
        "rgb(" + [34 + cool + dusty + glow, 51 + cool + dusty, 62 + cool + dusty - glow].join(",") + ")";
      ctx.lineWidth = .72;
      area(ctx, [top, right, bottom, left], fill, "#83a7bc21");
      if (tile.kind !== "ridge" && tile.kind !== "fissure") {
        const tex = noise(tile.x, tile.y, 13);
        const px = p.x + (grit - .5) * a * 1.05;
        const py = p.y + (tex - .5) * b * .98;
        line(ctx, [[px - a * .16, py - b * .14], [px + a * .17, py + b * .18]], "#b2c9d22c", .7);
        if (tex > .66) area(ctx, [[px, py - 1.5], [px + 3 * this.scale, py + .6], [px, py + 2], [px - 2, py]], "#9ab4bd42");
      }
    }

    drawScenery(ctx, tile) {
      const { x, y, grit, kind } = tile;
      if (kind === "basalt" || kind === "dust") return;
      const p = this.project(x, y);
      const s = this.scale;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(s, s);
      if (kind === "ridge") {
        const rise = 12 + grit * 32;
        ellipse(ctx, 0, 3, 22, 10, "#0a172681");
        area(ctx, [[-19, 0], [-11, -8], [-10, -rise * .72], [-1, -rise], [12, -rise * .79], [18, -8], [13, 5], [1, 9]], "#2e4557", "#192b3c");
        area(ctx, [[-10, -rise * .72], [-1, -rise], [12, -rise * .79], [4, -rise * .54], [-14, -rise * .53]], "#526c78", "#344c60");
        area(ctx, [[4, -rise * .54], [12, -rise * .79], [18, -8], [13, 5], [1, 9]], "#203241", "#253847");
        line(ctx, [[-13, -2], [-3, 1], [3, -3], [12, 0]], "#819da034", 1);
      } else if (kind === "crystal") {
        luminescence(ctx, 0, 0, 18, "#49efbc45", "#53eab800");
        for (const [dx, dy, peak] of [[-7, 1, 11], [3, -2, 19 + 8 * grit], [9, 3, 9]]) {
          area(ctx, [[dx - 4, dy], [dx - 2, dy - peak + 4], [dx + 2, dy - peak], [dx + 5, dy - 3], [dx + 2, dy + 3]], "#479890", "#9be4ce65");
          area(ctx, [[dx + 2, dy - peak], [dx + 5, dy - 3], [dx + 2, dy + 3]], "#285970");
        }
      } else {
        luminescence(ctx, 0, 0, 23, "#f67b5a59", "#e65d3600");
        line(ctx, [[-18, -3], [-8, 3], [-1, -2], [7, 2], [17, -3]], "#bc493a", 4.2);
        line(ctx, [[-18, -3], [-8, 3], [-1, -2], [7, 2], [17, -3]], "#ffb275", 1.35);
      }
      ctx.restore();
    }

    refreshGround(match) {
      const ctx = this.buffer.getContext("2d");
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.drawBackground(ctx);
      this.sortedTerrain = match.terrain.slice().sort((a, b) => a.x + a.y - b.x - b.y);
      for (const tile of this.sortedTerrain) this.drawGround(ctx, tile);
      this.scenery = this.sortedTerrain.filter((tile) => tile.kind !== "dust" && tile.kind !== "basalt");
      this.terrain = match.terrain;
      this.dirty = false;
    }

    tag(ctx, text, x, y, tint, small = false) {
      ctx.font = (small ? "600 11px" : "700 12px") + " system-ui, sans-serif";
      const w = ctx.measureText(text).width + 12;
      ctx.fillStyle = "#0b1725e8";
      ctx.fillRect(x - w / 2, y - 7, w, 17);
      ctx.lineWidth = 1;
      ctx.strokeStyle = tint + "78";
      ctx.strokeRect(x - w / 2, y - 7, w, 17);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = tint;
      ctx.fillText(text, x, y + 1.2);
    }

    drawNode(ctx, node, now) {
      const p = this.project(node.x, node.y);
      const tint = POLARITY(node.faction);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(this.scale, this.scale);
      ellipse(ctx, 0, 0, 34, 17, tint + "12", tint + "6b", 1.6);
      const progress = Math.abs(node.influence);
      if (progress > 0) {
        ctx.beginPath();
        ctx.ellipse(0, 0, 34, 17, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
        ctx.strokeStyle = POLARITY(Math.sign(node.influence));
        ctx.lineWidth = 2.7;
        ctx.stroke();
      }
      if (node.contested) ellipse(ctx, 0, 0, 38, 19, null, "#ffcc8a", 1.6);
      box(ctx, 0, 0, 19, 9, 5, "#4a6774", "#263f4e", "#355465");
      box(ctx, 0, -4, 9, 4, 12, "#73949b", "#314b61", "#47706e");
      line(ctx, [[0, -17], [0, -36], [9, -40]], tint, 2);
      line(ctx, [[-7, -33], [0, -36], [9, -32]], tint + "a9", 1.25);
      const pulse = this.reduced ? 1 : (Math.sin(now * 3.1 + node.x) + 2) / 3;
      luminescence(ctx, 0, -36, 26 * pulse, tint + "62", tint + "00");
      ellipse(ctx, 0, -36, 3, 3, "#e4fffc", tint, 1);
      ctx.restore();
      this.tag(ctx, node.name, p.x, p.y + Math.max(18, 24 * this.scale), tint, true);
    }

    drawPad(ctx, pad) {
      if (pad.turret && pad.turret.hp > 0) return;
      const p = this.project(pad.x, pad.y);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(this.scale, this.scale);
      ctx.setLineDash([3, 4]);
      ellipse(ctx, 0, 0, 16, 8, "#15273566", "#93d7c188");
      ctx.restore();
    }

    drawBase(ctx, base) {
      const p = this.project(base.x, base.y);
      const tint = POLARITY(base.faction);
      const alive = base.hp > 0;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(this.scale, this.scale);
      ctx.globalAlpha = alive ? 1 : .38;
      ellipse(ctx, 0, 3, 43, 22, tint + "16", tint + "6b", 1.3);
      box(ctx, 0, 2, 36, 16, 9, "#5b7882", "#304857", "#476476");
      box(ctx, -15, 1, 17, 8, 18, "#6c929c", "#425e6c", "#43636b");
      box(ctx, 14, 1, 17, 8, 26, "#5b7c8b", "#304854", "#466574");
      box(ctx, 11, -20, 11, 6, 12, tint, "#38555e", "#527880");
      line(ctx, [[11, -32], [11, -51], [18, -54]], tint, 1.9);
      line(ctx, [[-26, -8], [-26, -18], [-18, -23]], tint + "bc", 1.5);
      for (const x of [-22, -11, 5, 17]) ellipse(ctx, x, -5 + Math.abs(x) * .17, 2.1, 1.1, tint);
      if (alive) luminescence(ctx, 11, -45, 30, tint + "59", tint + "00");
      ctx.restore();
      this.tag(ctx, base.faction === FACTION.ally ? "ЭХО" : "ЦИТАДЕЛЬ", p.x, p.y - Math.max(37, 61 * this.scale), tint);
      if (alive && base.hp < base.hull) this.bar(ctx, p.x, p.y + 18 * this.scale, 45 * this.scale, base.hp / base.hull, tint);
    }

    drawTurret(ctx, turret) {
      const p = this.project(turret.x, turret.y);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(this.scale, this.scale);
      ellipse(ctx, 0, 0, 16, 8, "#104e4566", COLORS.ally + "85");
      box(ctx, 0, 0, 13, 6, 8, "#54798a", "#38535e", "#4b6974");
      box(ctx, 0, -7, 7, 4, 8, "#87c5b7", "#527574", "#689487");
      const direction = turret.direction || -.65;
      line(ctx, [[0, -16], [14 * Math.cos(direction), -16 + 8 * Math.sin(direction)]], COLORS.ally, 3);
      ctx.restore();
    }

    bar(ctx, x, y, width, ratio, tint) {
      ctx.fillStyle = "#0a1420";
      ctx.fillRect(x - width / 2 - 1, y - 1, width + 2, 4);
      ctx.fillStyle = tint;
      ctx.fillRect(x - width / 2, y, width * ratio, 2);
    }

    drawMech(ctx, mech, chosen) {
      const p = this.project(mech.x, mech.y);
      const s = this.scale;
      const tint = POLARITY(mech.faction);
      const profile = MechArt.profile(mech.chassisId);
      const [width, depth] = profile.shadow.map((size) => size * s);
      ellipse(ctx, p.x + 2 * s, p.y + 2 * s, width, depth, "#080d1980");
      if (chosen || this.hover === mech.id) {
        ellipse(ctx, p.x, p.y + s, width + 2, depth + 2, tint + "16", tint + (chosen ? "e3" : "a0"), 1.35);
      }
      MechArt.draw(ctx, mech, p.x, p.y, s, this.reduced);
      if (mech.hitAge < .11 && !this.reduced) {
        luminescence(ctx, p.x, p.y - profile.hud * s * .52, Math.max(4, 11 * s), "#ffcf9e99", "#ffb17a00");
      }
      if (chosen || mech.hp < mech.hull) {
        this.bar(ctx, p.x, p.y - profile.hud * s, Math.max(13, width * 1.53), mech.hp / mech.hull, tint);
      }
    }

    drawPaths(ctx, match, selected) {
      ctx.save();
      ctx.setLineDash([4, 5]);
      for (const mech of match.allies()) {
        if (!selected.has(mech.id) || !mech.path.length) continue;
        const points = [mech, ...mech.path].map(({ x, y }) => {
          const p = this.project(x, y);
          return [p.x, p.y];
        });
        line(ctx, points, "#8ff2ca9c", 1.35);
      }
      ctx.restore();
    }

    drawEffects(ctx, match, now) {
      for (const effect of match.effects) {
        const p = this.project(effect.x, effect.y);
        const s = this.scale;
        const fade = effect.life / effect.max;
        const tint = POLARITY(effect.faction);
        ctx.save();
        ctx.globalAlpha = Math.min(1, fade * 1.4);
        if (effect.type === "shot") {
          const to = this.project(effect.tx, effect.ty);
          const [offsetX, offsetY] = effect.mech ? MechArt.muzzle(effect.mech, this.reduced) : [0, -effect.high];
          const targetHeight = effect.targetChassis === undefined ? effect.targetHigh : MechArt.profile(effect.targetChassis).hud * .43;
          const start = [p.x + offsetX * s, p.y + offsetY * s];
          const end = [to.x, to.y - targetHeight * s];
          line(ctx, [start, end], effect.color + "70", 4.3 * s);
          line(ctx, [start, end], effect.color, Math.max(.7, 1.55 * s));
          luminescence(ctx, start[0], start[1], Math.max(3, 8 * s), effect.color + "a0", effect.color + "00");
          luminescence(ctx, end[0], end[1], Math.max(4, 13 * s), effect.color + "e8", effect.color + "00");
        } else {
          const wave = (8 + (1 - fade) * (effect.type === "burst" ? 33 : 54)) * s;
          luminescence(ctx, p.x, p.y, Math.max(2, wave), tint + "90", tint + "00");
          ellipse(ctx, p.x, p.y, wave, wave * .52, null, tint, 1.7 * s);
        }
        ctx.restore();
      }
      if (this.marker && now - this.marker.time < .92) {
        const mark = this.marker;
        const p = this.project(mark.x, mark.y);
        const a = (12 + (now - mark.time) * 22) * this.scale;
        ctx.save();
        ctx.globalAlpha = 1 - (now - mark.time) / .92;
        ellipse(ctx, p.x, p.y, a, a * .52, null, mark.faction === FACTION.hostile ? COLORS.hostile : COLORS.ally, 1.4);
        ctx.restore();
      }
    }

    draw(match, selected, now) {
      if (this.dirty || this.terrain !== match.terrain) this.refreshGround(match);
      const ctx = this.context;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.drawImage(this.buffer, 0, 0, this.width, this.height);
      this.drawPaths(ctx, match, selected);
      for (const pad of match.pads) this.drawPad(ctx, pad);
      const figures = [...this.scenery,
        ...match.nodes, ...match.bases, ...match.units, ...match.pads.map((pad) => pad.turret).filter((t) => t && t.hp > 0)]
        .sort((a, b) => a.x + a.y - b.x - b.y);
      for (const thing of figures) {
        if (thing.grit !== undefined) this.drawScenery(ctx, thing);
        else if (thing.type === "base") this.drawBase(ctx, thing);
        else if (thing.type === "turret") this.drawTurret(ctx, thing);
        else if (thing.type === "mech") this.drawMech(ctx, thing, selected.has(thing.id));
        else this.drawNode(ctx, thing, now);
      }
      this.drawEffects(ctx, match, now);
    }
  }

  return View;
})();
