"use strict";

const FrontierView = (() => {
  const { WIDTH, HEIGHT, FACTION, BUILD_SECONDS, noise, clamp } = EchoSim;
  const TW = 23;
  const TH = 12;
  const MIN_ZOOM = .82;
  const MAX_ZOOM = 3.6;
  const GROUND_DENSITY = 2;
  const GROUND_LEFT = -HEIGHT * TW - 2;
  const GROUND_TOP = -TH - 2;
  const GROUND_WIDTH = (WIDTH + HEIGHT) * TW + 4;
  const GROUND_HEIGHT = (WIDTH + HEIGHT) * TH + 34;
  const STATION_TAG_FONT = "600 11px system-ui, sans-serif";
  const COLORS = { ally: "#73f0c5", hostile: "#ff896f", neutral: "#9ed8fa" };
  const MAP_CENTER = { x: (WIDTH - 1) / 2, y: (HEIGHT - 1) / 2 };
  const POLARITY = (faction) => faction === FACTION.ally ? COLORS.ally :
    faction === FACTION.hostile ? COLORS.hostile : COLORS.neutral;

  function isoOffset(x, y, scale = 1) {
    const a = x / (TW * scale);
    const b = y / (TH * scale);
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }

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
      this.buffer.width = GROUND_WIDTH * GROUND_DENSITY;
      this.buffer.height = GROUND_HEIGHT * GROUND_DENSITY;
      this.sky = document.createElement("canvas");
      this.terrain = null;
      this.zoom = 1;
      this.center = { ...MAP_CENTER };
      this.camera = { ...MAP_CENTER, zoom: 1 };
      this.lastDraw = null;
      this.hover = null;
      this.marker = null;
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
      this.sky.width = this.canvas.width;
      this.sky.height = this.canvas.height;
      const sky = this.sky.getContext("2d");
      sky.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.drawBackground(sky);
      this.reframe();
    }

    reframe() {
      const margin = this.width > 650 ? 64 : 28;
      this.fit = Math.max(.035, Math.min((this.width - margin) / GROUND_WIDTH, (this.height - 88) / GROUND_HEIGHT));
      this.center = this.limitCenter(this.center, this.zoom);
      this.updateCamera(1);
    }

    limitCenter(point, zoom) {
      const scale = this.fit * zoom;
      const dx = point.x - MAP_CENTER.x;
      const dy = point.y - MAP_CENTER.y;
      const horizontal = Math.max(0, (GROUND_WIDTH - (this.width - 50) / scale) / 2);
      const vertical = Math.max(0, (GROUND_HEIGHT - (this.height - 82) / scale) / 2);
      const delta = isoOffset(clamp((dx - dy) * TW, -horizontal, horizontal),
        clamp((dx + dy) * TH, -vertical, vertical));
      return { x: clamp(MAP_CENTER.x + delta.x, 0, WIDTH - 1), y: clamp(MAP_CENTER.y + delta.y, 0, HEIGHT - 1) };
    }

    zoomTo(factor, target = this.center) {
      this.zoom = clamp(factor, MIN_ZOOM, MAX_ZOOM);
      this.center = this.limitCenter(target, this.zoom);
      if (this.reduced) this.updateCamera(1);
    }

    zoomAt(factor, screen) {
      const zoom = clamp(factor, MIN_ZOOM, MAX_ZOOM);
      const x = screen.x - this.width / 2;
      const y = screen.y - this.height * .505;
      const before = isoOffset(x, y, this.fit * this.zoom);
      const after = isoOffset(x, y, this.fit * zoom);
      this.zoomTo(zoom, { x: this.center.x + before.x - after.x, y: this.center.y + before.y - after.y });
    }

    overview() {
      this.zoomTo(1, MAP_CENTER);
    }

    panBy(x, y) {
      const delta = isoOffset(x, y, this.fit * this.zoom);
      this.zoomTo(this.zoom, { x: this.center.x - delta.x, y: this.center.y - delta.y });
    }

    updateCamera(mix) {
      const ease = (now, target) => Math.abs(now - target) < .0005 ? target : now + (target - now) * mix;
      const { camera, center } = this;
      camera.x = ease(camera.x, center.x);
      camera.y = ease(camera.y, center.y);
      camera.zoom = ease(camera.zoom, this.zoom);
      this.scale = this.fit * camera.zoom;
      this.ox = this.width / 2 - (camera.x - camera.y) * TW * this.scale;
      this.oy = this.height * .505 - (camera.x + camera.y) * TH * this.scale;
    }

    project(x, y) {
      return { x: this.ox + (x - y) * TW * this.scale, y: this.oy + (x + y) * TH * this.scale };
    }

    unproject(x, y) {
      return isoOffset(x - this.ox, y - this.oy, this.scale);
    }

    position(event) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    hitTest(match, screen, accepts = () => true) {
      const s = this.scale;
      let chosen = null;
      let best = Infinity;
      for (const entity of [...match.sites, ...match.entities().filter((item) => item.type !== "base")]) {
        if (!accepts(entity)) continue;
        const point = this.project(entity.x, entity.y);
        const isNode = !entity.type;
        if (entity.gate && this.hitsSiteTag(entity, point, screen)) return entity;
        const model = entity.type === "mech" ? MechArt.profile(entity.chassisId) : null;
        const z = model ? model.hud * .45 : entity.type === "base" ? 29 : isNode ? 18 : entity.gate ? 21 : 9;
        const radius = Math.max(13, (model ? model.shadow[0] + 3 : entity.gate && entity.type ? 39 : 26) * s);
        const dist = Math.hypot(screen.x - point.x, screen.y - (point.y - z * s));
        if (dist < radius && dist < best) { chosen = entity; best = dist; }
      }
      return chosen;
    }

    hitsSiteTag(site, point, screen) {
      const y = this.siteLabelY(site, point);
      if (screen.y < y - 7 || screen.y > y + 10) return false;
      const ctx = this.context;
      ctx.save();
      ctx.font = site.type === "base" ? "700 12px system-ui, sans-serif" : STATION_TAG_FONT;
      const halfWidth = ctx.measureText(site.label ?? site.name).width / 2 + 6;
      ctx.restore();
      return Math.abs(screen.x - point.x) <= halfWidth;
    }

    siteLabelY(site, point) {
      return site.type ? point.y - Math.max(31, (site.type === "base" ? 61 : 49) * this.scale) :
        point.y + Math.max(18, 24 * this.scale);
    }

    hitTestGate(match, screen) {
      const s = this.scale;
      return match.sites.find((site) => {
        const p = this.project(site.gate.x, site.gate.y);
        return Math.abs(screen.x - p.x) <= Math.max(10, 19 * s) &&
          screen.y >= p.y - Math.max(12, 28 * s) && screen.y <= p.y + Math.max(6, 10 * s);
      });
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
      for (let n = 0; n < 17; n++) {
        const yy = h * .62 + n * n * h * .0017;
        line(ctx, [[0, yy], [w, yy]], "#84a3bc18", .7);
      }
      for (let n = -13; n <= 13; n++) {
        line(ctx, [[w / 2 + n * w * .027, h * .62], [w / 2 + n * w * .125, h]], "#84a3bc15", .7);
      }
    }

    drawOrbit(ctx, seconds) {
      const t = this.reduced ? 0 : seconds;
      const radius = Math.min(this.width, this.height) * .106;
      const tilt = -.26;
      ctx.save();
      ctx.translate(this.width * .765, this.height * .184);
      ctx.rotate(tilt);
      const light = ctx.createRadialGradient(-radius * .55, -radius * .58, 0, 0, 0, radius * 1.09);
      light.addColorStop(0, "#6c9da1");
      light.addColorStop(.64, "#375963");
      light.addColorStop(1, "#182f45");
      ellipse(ctx, 0, 0, radius * 1.71, radius * .34, null, "#9ed9da52", 1.2);
      ellipse(ctx, 0, 0, radius * 1.79, radius * .38, null, "#a9ced922", 1);
      ellipse(ctx, 0, 0, radius, radius, light, "#91bdbe91", 1);
      ctx.save();
      ctx.clip();
      for (let i = -2; i <= 2; i++) {
        const flow = Math.sin(t * .32 + i * 1.6);
        ellipse(ctx, radius * flow * .39, radius * (i * .32 + flow * .045), radius * 1.13,
          radius * (.077 + (i + 2) * .015), null, i % 2 ? "#b9dcca32" : "#93cbd838", radius * .052);
      }
      ctx.restore();
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * 1.71, radius * .34, 0, 0, Math.PI);
      ctx.strokeStyle = "#b2dedd79";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const angle = t * .39 + 2.02;
      const x = Math.cos(angle) * radius * 1.82;
      const y = Math.sin(angle) * radius * .42;
      ctx.translate(x, y);
      ctx.rotate(-tilt);
      const wobble = Math.sin(t * 4) * 1.3;
      line(ctx, [[-6, 2], [-17, 5 + wobble], [-25, 4]], "#e4c77b91", 1);
      ellipse(ctx, 0, 0, 11, 5.6, "#1d3340", "#9fe9e2", 1);
      ellipse(ctx, 1, -3, 7.5, 4.9, "#3d717e", "#91c5cc", .8);
      ellipse(ctx, 0, -3, 3.7, 2.3, "#ffe28c");
      ellipse(ctx, 2.1, -5.4, 2.4, 2.5, "#ffe28c");
      line(ctx, [[3.7, -5.2], [6.6, -4.9]], "#ff9962", 1.6);
      ellipse(ctx, 2.9, -6, .58, .58, "#292936");
      ellipse(ctx, -11, 0, 1.4 + Math.abs(wobble), 1.25, "#ffbc7c");
      ctx.font = "700 9px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = "right";
      const sign = "УТКА НА СМЕНЕ";
      const signWidth = ctx.measureText(sign).width + 10;
      ctx.fillStyle = "#1b2633e8";
      ctx.fillRect(-24 - signWidth, -1, signWidth, 13);
      ctx.strokeStyle = "#cea96b9c";
      ctx.lineWidth = .8;
      ctx.strokeRect(-24 - signWidth, -1, signWidth, 13);
      ctx.fillStyle = "#f4ce86";
      ctx.fillText(sign, -29, 6);
      ctx.restore();
    }

    drawGround(ctx, tile) {
      const { x, y, grit, kind } = tile;
      const p = { x: (x - y) * TW, y: (x + y) * TH };
      const a = TW;
      const b = TH;
      const top = [p.x, p.y - b];
      const right = [p.x + a, p.y];
      const bottom = [p.x, p.y + b];
      const left = [p.x - a, p.y];
      const cool = Math.floor(grit * 10 + 7 * Math.sin((x + y) * .24));
      const dusty = kind === "dust" ? 7 : 0;
      const glow = x > WIDTH * .75 && y < HEIGHT * .34 ? 5 : 0;
      const depth = 19 + Math.round(grit * 10);
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
        if (tex > .66) area(ctx, [[px, py - 1.5], [px + 3, py + .6], [px, py + 2], [px - 2, py]], "#9ab4bd42");
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
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.buffer.width, this.buffer.height);
      const d = GROUND_DENSITY;
      ctx.setTransform(d, 0, 0, d, -GROUND_LEFT * d, -GROUND_TOP * d);
      const terrain = match.terrain.slice().sort((a, b) => a.x + a.y - b.x - b.y);
      for (const tile of terrain) this.drawGround(ctx, tile);
      this.scenery = terrain.filter((tile) => tile.kind !== "dust" && tile.kind !== "basalt");
      this.terrain = match.terrain;
    }

    tag(ctx, text, x, y, tint, small = false) {
      ctx.font = small ? STATION_TAG_FONT : "700 12px system-ui, sans-serif";
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
      box(ctx, 0, 0, 19, 9, 5, "#4a6774", "#263f4e", "#355465");
      box(ctx, 0, -4, 9, 4, 12, "#73949b", "#314b61", "#47706e");
      line(ctx, [[0, -17], [0, -36], [9, -40]], tint, 2);
      line(ctx, [[-7, -33], [0, -36], [9, -32]], tint + "a9", 1.25);
      const pulse = this.reduced ? 1 : (Math.sin(now * 3.1 + node.x) + 2) / 3;
      luminescence(ctx, 0, -36, 26 * pulse, tint + "62", tint + "00");
      ellipse(ctx, 0, -36, 3, 3, "#e4fffc", tint, 1);
      ctx.restore();
    }

    drawGate(ctx, site) {
      const { gate } = site;
      const p = this.project(gate.x, gate.y);
      const tint = gate.contested ? "#ffcc8a" : POLARITY(gate.faction || site.faction);
      const span = gate.x === site.x ? 15 : -15;
      const far = [-span, -7];
      const near = [span, 7];
      const height = 22;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(this.scale, this.scale);
      ellipse(ctx, 0, 0, 17, 9, tint + "30", tint + "a0", 1.4);
      if (gate.progress > 0) {
        ctx.beginPath();
        ctx.ellipse(0, 0, 19, 10, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * gate.progress);
        ctx.strokeStyle = tint;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      box(ctx, ...far, 4.6, 2.5, height, tint, "#3b576e", "#4c6475");
      line(ctx, [[far[0], far[1] - height + 1], [near[0], near[1] - height + 1]], "#192d3d", 6);
      box(ctx, ...near, 4.6, 2.5, height, tint, "#3b576e", "#4c6475");
      line(ctx, [[far[0], far[1] - height - 1], [near[0], near[1] - height - 1]], tint, 2.8);
      line(ctx, [[0, -height - 5], [0, -height + 3]], "#e0f3ff", 2);
      ctx.restore();
    }

    drawPad(ctx, pad) {
      if (pad.turret && pad.turret.hp > 0) return;
      const p = this.project(pad.x, pad.y);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(this.scale, this.scale);
      ctx.setLineDash([3, 4]);
      ellipse(ctx, 0, 0, 16, 8, "#15273566", POLARITY(pad.faction) + "88");
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
      if (alive && base.hp < base.hull) this.bar(ctx, p.x, p.y + 18 * this.scale, 45 * this.scale, base.hp / base.hull, tint);
    }

    drawFacility(ctx, site, now) {
      const p = this.project(site.x, site.y);
      const tint = POLARITY(site.faction);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(this.scale, this.scale);
      ellipse(ctx, 0, 3, 39, 20, tint + "1f", tint + "98", 1.3);
      box(ctx, 0, 3, 34, 16, 5, "#516c7c", "#253f52", "#365362");
      if (site.type === "factory") {
        box(ctx, -5, 1, 25, 12, 16, "#789aa2", "#344e5e", "#4b646f");
        box(ctx, -14, -6, 5, 3, 29, "#ae9776", "#4f616a", "#607a83");
        box(ctx, 5, -7, 5, 3, 34, "#ae9776", "#4f616a", "#607a83");
        box(ctx, 19, 4, 12, 6, 10, tint, "#3e5862", "#566d71");
        for (const x of [-15, -4, 7]) line(ctx, [[x, 1], [x + 4, 3]], "#eaca858a", 1.7);
        if (site.queue.length && !this.reduced) {
          for (let i = 0; i < 3; i++) {
            const rise = (now * 1.2 + i / 3) % 1;
            ctx.globalAlpha = (1 - rise) * .57;
            ellipse(ctx, 5 + rise * 13, -44 - rise * 12, 3 + rise * 4, 2 + rise * 3, "#b4ced2");
          }
          ctx.globalAlpha = 1;
        }
      } else {
        box(ctx, -10, 4, 19, 10, 18, "#789ba3", "#31495c", "#476772");
        box(ctx, 14, 0, 13, 7, 24, "#5f8090", "#304a5e", "#416473");
        line(ctx, [[13, -25], [13, -42], [22, -45]], tint, 1.6);
        line(ctx, [[-15, -14], [-5, -14]], tint, 2.6);
        line(ctx, [[-10, -19], [-10, -9]], tint, 2.6);
      }
      ctx.restore();
      const job = site.queue[0];
      if (job) this.bar(ctx, p.x, p.y + 15 * this.scale, Math.max(13, 46 * this.scale),
        clamp(1 - job.remaining / BUILD_SECONDS, 0, 1), tint);
    }

    drawTurret(ctx, turret) {
      const p = this.project(turret.x, turret.y);
      const tint = POLARITY(turret.faction);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(this.scale, this.scale);
      ellipse(ctx, 0, 0, 16, 8, tint + "22", tint + "85");
      box(ctx, 0, 0, 13, 6, 8, "#54798a", "#38535e", "#4b6974");
      box(ctx, 0, -7, 7, 4, 8, tint, "#527574", "#689487");
      const direction = turret.direction ?? (turret.faction === FACTION.ally ? -.65 : 2.49);
      line(ctx, [[0, -16], [14 * Math.cos(direction), -16 + 8 * Math.sin(direction)]], tint, 3);
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
      const entities = match.entities();
      for (const mech of match.allies()) {
        if (!selected.has(mech.id)) continue;
        const target = mech.order.kind === "attack" ? entities.find(({ id }) => id === mech.order.target) : null;
        const route = mech.path.length ? mech.path : target ? [target] : [];
        if (!route.length) continue;
        const points = [mech, ...route].map(({ x, y }) => {
          const p = this.project(x, y);
          return [p.x, p.y];
        });
        ctx.setLineDash([4, 5]);
        line(ctx, points, target ? "#ff896fce" : "#8ff2ca9c", 1.35);
        if (target) {
          const p = this.project(target.x, target.y);
          const radius = Math.max(9, (target.type === "base" ? 38 : 21) * this.scale);
          ctx.setLineDash([]);
          ellipse(ctx, p.x, p.y, radius, radius * .52, null, "#ff896f", 1.4);
        }
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
      if (this.terrain !== match.terrain) this.refreshGround(match);
      const dt = this.lastDraw === null ? 0 : Math.max(0, now - this.lastDraw);
      this.lastDraw = now;
      this.updateCamera(1 - Math.exp(-dt * 18));
      const ctx = this.context;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.drawImage(this.sky, 0, 0, this.width, this.height);
      this.drawOrbit(ctx, now);
      const s = this.scale;
      ctx.drawImage(this.buffer, this.ox + GROUND_LEFT * s, this.oy + GROUND_TOP * s, GROUND_WIDTH * s, GROUND_HEIGHT * s);
      this.drawPaths(ctx, match, selected);
      for (const pad of match.pads) this.drawPad(ctx, pad);
      const gates = match.sites.map((site) => ({ x: site.gate.x, y: site.gate.y, type: "gate", site }));
      const figures = [...this.scenery,
        ...match.sites, ...gates, ...match.units, ...match.pads.map((pad) => pad.turret).filter((t) => t && t.hp > 0)]
        .sort((a, b) => a.x + a.y - b.x - b.y);
      for (const thing of figures) {
        const p = this.project(thing.x, thing.y);
        if (p.x < -110 * s || p.x > this.width + 110 * s || p.y < -48 * s || p.y > this.height + 110 * s) continue;
        if (thing.grit !== undefined) this.drawScenery(ctx, thing);
        else if (thing.type === "base") this.drawBase(ctx, thing);
        else if (thing.type === "factory" || thing.type === "outpost") this.drawFacility(ctx, thing, now);
        else if (thing.type === "gate") this.drawGate(ctx, thing.site);
        else if (thing.type === "turret") this.drawTurret(ctx, thing);
        else if (thing.type === "mech") this.drawMech(ctx, thing, selected.has(thing.id));
        else this.drawNode(ctx, thing, now);
      }
      for (const site of match.sites) {
        const p = this.project(site.x, site.y);
        this.tag(ctx, site.label ?? site.name, p.x, this.siteLabelY(site, p), POLARITY(site.faction), site.type !== "base");
      }
      this.drawEffects(ctx, match, now);
    }
  }

  View.MIN_ZOOM = MIN_ZOOM;
  View.MAX_ZOOM = MAX_ZOOM;
  return View;
})();
