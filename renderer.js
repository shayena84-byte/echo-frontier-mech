"use strict";

const FrontierView = (() => {
  const { WIDTH, HEIGHT, FACTION, WEAPONS, noise, clamp, distance, shotStatus } = EchoSim;
  const TW = 23;
  const TH = 12;
  const MIN_ZOOM = .82;
  const MAX_ZOOM = 10.7;
  const GROUND_LEFT = -HEIGHT * TW - 2;
  const GROUND_TOP = -TH - 2;
  const GROUND_WIDTH = (WIDTH + HEIGHT) * TW + 4;
  const GROUND_HEIGHT = (WIDTH + HEIGHT) * TH + 34;
  const GROUND_DENSITY = Math.min(2, 3600 / Math.max(GROUND_WIDTH, GROUND_HEIGHT));
  const STATION_TAG_FONT = "600 11px system-ui, sans-serif";
  const COLORS = { ally: "#73f0c5", hostile: "#ff896f", neutral: "#cfadfa" };
  const MAP_CENTER = { x: (WIDTH - 1) / 2, y: (HEIGHT - 1) / 2 };
  const MINIMAP_MARGIN = 10.5;
  const FOG_DENSITY = .65;
  const PLAYER = FACTION.ally;
  const fogTone = (state) => state === 1 ? "#0714218b" : "#06101bd8";
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

  function sparks(ctx, seed, age, duration, count, force, tint) {
    const fade = Math.max(0, 1 - age / duration);
    for (let i = 0; i < count; i++) {
      const angle = noise(seed, i, 2) * Math.PI * 2;
      const speed = (28 + 63 * noise(seed, i, 5)) * force;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed * .61 - 18 * force;
      const x = vx * age;
      const y = vy * age + 88 * age * age;
      const tail = Math.min(.055, age);
      ctx.globalAlpha = fade * (.56 + noise(seed, i, 7) * .44);
      line(ctx, [[x - vx * tail, y - (vy + 176 * age) * tail], [x, y]],
        i % 3 === 0 ? "#fff4d2" : tint, .7 + force * .46);
    }
  }

  function turretMuzzle(angle) {
    return [14 * Math.cos(angle), -16 + 8 * Math.sin(angle)];
  }

  function box(ctx, x, y, w, d, height, top, east, west) {
    const z = y - height;
    area(ctx, [[x + w, z], [x, z + d], [x, y + d], [x + w, y]], east, "#0f1927");
    area(ctx, [[x - w, z], [x, z + d], [x, y + d], [x - w, y]], west, "#0f1927");
    area(ctx, [[x, z - d], [x + w, z], [x, z + d], [x - w, z]], top, "#66828a8c");
  }

  class View {
    constructor(canvas, minimap = null) {
      this.canvas = canvas;
      this.context = canvas.getContext("2d");
      this.minimap = minimap;
      this.miniGround = minimap ? document.createElement("canvas") : null;
      if (this.miniGround) {
        this.miniGround.width = minimap.width;
        this.miniGround.height = minimap.height;
      }
      this.buffer = document.createElement("canvas");
      this.buffer.width = Math.ceil(GROUND_WIDTH * GROUND_DENSITY);
      this.buffer.height = Math.ceil(GROUND_HEIGHT * GROUND_DENSITY);
      this.sky = document.createElement("canvas");
      this.terrain = null;
      this.zoom = 1;
      this.center = { ...MAP_CENTER };
      this.camera = { ...MAP_CENTER, zoom: 1 };
      this.lastDraw = null;
      this.fog = null;
      this.miniFog = null;
      this.fogSight = null;
      this.fogVersion = null;
      this.hover = null;
      this.marker = null;
      this.followedId = null;
      this.siteTags = new Map();
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
      this.followedId = null;
      const zoom = clamp(factor, MIN_ZOOM, MAX_ZOOM);
      const x = screen.x - this.width / 2;
      const y = screen.y - this.height * .505;
      const before = isoOffset(x, y, this.fit * this.zoom);
      const after = isoOffset(x, y, this.fit * zoom);
      this.zoomTo(zoom, { x: this.center.x + before.x - after.x, y: this.center.y + before.y - after.y });
    }

    overview() {
      this.followedId = null;
      this.zoomTo(1, MAP_CENTER);
    }

    focusSector(point) {
      this.followedId = null;
      this.zoomTo(Math.max(this.zoom, Math.min(5, 1.16 / this.fit)), point);
    }

    panBy(x, y) {
      this.followedId = null;
      const delta = isoOffset(x, y, this.fit * this.zoom);
      this.zoomTo(this.zoom, { x: this.center.x - delta.x, y: this.center.y - delta.y });
    }

    follow(unit) {
      this.followedId = unit.id;
      this.zoomTo(Math.max(this.zoom, 3.7, 2.15 / this.fit), unit);
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

    minimapProject(x, y) {
      const w = this.minimap.width - 2 * MINIMAP_MARGIN;
      const h = this.minimap.height - 2 * MINIMAP_MARGIN;
      return [MINIMAP_MARGIN + (HEIGHT - .5 - y) * w / HEIGHT,
        MINIMAP_MARGIN + (WIDTH - .5 - x) * h / WIDTH];
    }

    minimapPosition(event) {
      const el = this.minimap;
      const rect = el.getBoundingClientRect();
      const u = ((event.clientX - rect.left) * el.width / rect.width - MINIMAP_MARGIN) / (el.width - MINIMAP_MARGIN * 2);
      const v = ((event.clientY - rect.top) * el.height / rect.height - MINIMAP_MARGIN) / (el.height - MINIMAP_MARGIN * 2);
      return { x: clamp(WIDTH - .5 - v * WIDTH, 0, WIDTH - 1), y: clamp(HEIGHT - .5 - u * HEIGHT, 0, HEIGHT - 1) };
    }

    refreshMinimap(terrain) {
      if (!this.miniGround) return;
      const { width, height } = this.miniGround;
      const ctx = this.miniGround.getContext("2d");
      const cw = (width - MINIMAP_MARGIN * 2) / HEIGHT;
      const ch = (height - MINIMAP_MARGIN * 2) / WIDTH;
      ctx.fillStyle = "#0b1621";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#203544";
      ctx.fillRect(MINIMAP_MARGIN, MINIMAP_MARGIN, cw * HEIGHT, ch * WIDTH);
      for (const tile of terrain) {
        if (!tile.blocked && tile.kind !== "crystal") continue;
        const [x, y] = this.minimapProject(tile.x, tile.y);
        ctx.fillStyle = tile.kind === "ridge" ? "#587285" : tile.kind === "fissure" ? "#9b5a54" : "#36655d";
        ctx.fillRect(x - cw / 2, y - ch / 2, cw + .15, ch + .15);
      }
    }

    refreshFog(match, sight) {
      if (this.fogSight === sight && this.fogVersion === match.visionVersion) return;
      this.fogSight = sight;
      this.fogVersion = match.visionVersion;
      if (!this.fog) {
        this.fog = document.createElement("canvas");
        this.fog.width = Math.ceil(GROUND_WIDTH * FOG_DENSITY);
        this.fog.height = Math.ceil(GROUND_HEIGHT * FOG_DENSITY);
      }
      const ctx = this.fog.getContext("2d");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.fog.width, this.fog.height);
      ctx.setTransform(FOG_DENSITY, 0, 0, FOG_DENSITY, -GROUND_LEFT * FOG_DENSITY, -GROUND_TOP * FOG_DENSITY);
      if (this.minimap && !this.miniFog) {
        this.miniFog = document.createElement("canvas");
        this.miniFog.width = this.minimap.width;
        this.miniFog.height = this.minimap.height;
      }
      const mini = this.miniFog?.getContext("2d");
      if (mini) mini.clearRect(0, 0, this.miniFog.width, this.miniFog.height);
      const cw = mini ? (this.miniFog.width - 2 * MINIMAP_MARGIN) / HEIGHT : 0;
      const ch = mini ? (this.miniFog.height - 2 * MINIMAP_MARGIN) / WIDTH : 0;
      for (const tile of match.terrain) {
        const state = sight[tile.y * WIDTH + tile.x];
        if (state === 2) continue;
        const x = (tile.x - tile.y) * TW;
        const y = (tile.x + tile.y) * TH;
        const tint = fogTone(state);
        area(ctx, [[x, y - TH - .5], [x + TW + .5, y], [x, y + TH + .5], [x - TW - .5, y]], tint);
        if (mini) {
          const [u, v] = this.minimapProject(tile.x, tile.y);
          mini.fillStyle = tint;
          mini.fillRect(u - cw / 2, v - ch / 2, cw + .08, ch + .08);
        }
      }
    }

    drawMinimap(match, selected) {
      if (!this.minimap) return;
      const { width, height } = this.minimap;
      const ctx = this.minimap.getContext("2d");
      ctx.drawImage(this.miniGround, 0, 0);
      if (match.fogOfWar && this.miniFog) ctx.drawImage(this.miniFog, 0, 0);
      ctx.save();
      ctx.beginPath();
      ctx.rect(MINIMAP_MARGIN, MINIMAP_MARGIN, width - 2 * MINIMAP_MARGIN, height - 2 * MINIMAP_MARGIN);
      ctx.clip();
      if (this.zoom > 1.02) {
        const frame = [[0, 0], [this.width, 0], [this.width, this.height], [0, this.height]].map(([u, v]) => {
          const point = this.unproject(u, v);
          return this.minimapProject(point.x, point.y);
        });
        ctx.lineWidth = 1.4;
        area(ctx, frame, "#a4d6e91b", "#bdeaffb6");
      }
      for (const site of match.sites) {
        const [x, y] = this.minimapProject(site.x, site.y);
        const visible = match.canSeeEntity(PLAYER, site);
        const owner = match.observedFaction(PLAYER, site);
        const shade = owner === null ? "#64778b" : POLARITY(owner);
        if (!visible) ctx.globalAlpha = .54;
        if (site.type === "base") {
          area(ctx, [[x, y - 6], [x + 6, y], [x, y + 6], [x - 6, y]], shade, "#101924");
        } else if (site.type === "outpost") {
          area(ctx, [[x, y - 5], [x + 5, y], [x, y + 5], [x - 5, y]], null, shade);
        } else if (site.type) {
          ctx.fillStyle = shade;
          ctx.fillRect(x - 3, y - 3, 6, 6);
        } else ellipse(ctx, x, y, 2.25, 2.25, shade);
        ctx.globalAlpha = 1;
        if (visible && site.gate.progress && site.gate.faction !== site.faction) {
          ellipse(ctx, x, y, 6.5, 6.5, null, POLARITY(site.gate.faction) + "d0", 1.3);
        }
      }
      for (const mech of match.units) {
        if (!match.canSeeEntity(PLAYER, mech)) continue;
        const [x, y] = this.minimapProject(mech.x, mech.y);
        ellipse(ctx, x, y, 2, 2, POLARITY(mech.faction), selected.has(mech.id) ? "#eaffe8" : "#101924", 1);
      }
      const signal = match.scanFor(PLAYER);
      if (signal && signal.until > match.time) {
        const [x, y] = this.minimapProject(signal.x, signal.y);
        const radius = EchoSim.SCAN_RADIUS;
        ellipse(ctx, x, y, radius * (width - 2 * MINIMAP_MARGIN) / HEIGHT,
          radius * (height - 2 * MINIMAP_MARGIN) / WIDTH, "#82d7ff20", "#a8e4ffe1", 1.35);
      }
      for (const event of match.news) {
        if (!event.important || !event.point || match.time - event.time > 7) continue;
        const [x, y] = this.minimapProject(event.point.x, event.point.y);
        ctx.globalAlpha = 1 - (match.time - event.time) / 8;
        ellipse(ctx, x, y, 8.5, 8.5, null, event.tone === "hostile" ? "#ffbd83" : "#a7ffe2", 1.55);
      }
      ctx.restore();
    }

    hitTest(match, screen, accepts = () => true) {
      const s = this.scale;
      let chosen = null;
      let best = Infinity;
      for (const entity of [...match.sites, ...match.entities().filter((item) => match.canSeeEntity(PLAYER, item))]) {
        if (!accepts(entity)) continue;
        const point = this.project(entity.x, entity.y);
        const isNode = !entity.type;
        const tag = this.siteTags.get(entity.id);
        if (tag && screen.x >= tag.left && screen.x <= tag.right && screen.y >= tag.top && screen.y <= tag.bottom) {
          return entity;
        }
        const model = entity.type === "mech" ? MechArt.profile(entity.chassisId) : null;
        const z = model ? model.hud * .45 : entity.type === "base" ? 29 : isNode ? 18 : entity.gate ? 21 : 9;
        const radius = Math.max(13, (model ? model.shadow[0] + 3 : entity.gate && entity.type ? 39 : 26) * s);
        const dist = Math.hypot(screen.x - point.x, screen.y - (point.y - z * s));
        if (dist < radius && dist < best) { chosen = entity; best = dist; }
      }
      return chosen;
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
      this.refreshMinimap(terrain);
    }

    drawSiteTags(ctx, match) {
      this.siteTags.clear();
      const sites = [...match.bases, ...match.facilities, ...match.nodes];
      const hovered = sites.findIndex((site) => site.id === this.hover);
      if (hovered > 0) sites.unshift(sites.splice(hovered, 1)[0]);
      for (const site of sites) {
        const point = this.project(site.x, site.y);
        const y = this.siteLabelY(site, point);
        if (point.x < 0 || point.x > this.width || y < 5 || y > this.height - 9) continue;
        const owner = match.observedFaction(PLAYER, site);
        const visible = match.canSeeEntity(PLAYER, site);
        const text = (site.label ?? site.name) + (owner === null ? " · ?" : "");
        ctx.font = site.type === "base" ? "700 12px system-ui, sans-serif" : STATION_TAG_FONT;
        const width = ctx.measureText(text).width + 12;
        const x = clamp(point.x, width / 2 + 2, this.width - width / 2 - 2);
        const tag = { left: x - width / 2, right: x + width / 2, top: y - 7, bottom: y + 10 };
        const overlap = [...this.siteTags.values()].some((other) =>
          tag.left <= other.right + 4 && tag.right >= other.left - 4 &&
          tag.top <= other.bottom + 2 && tag.bottom >= other.top - 2);
        if (overlap) continue;
        this.siteTags.set(site.id, tag);
        const tint = owner === null ? "#a6b4c2" : POLARITY(owner);
        ctx.globalAlpha = visible ? 1 : .7;
        ctx.fillStyle = "#0b1725e8";
        ctx.fillRect(tag.left, tag.top, width, 17);
        ctx.lineWidth = 1;
        ctx.strokeStyle = tint + "78";
        ctx.strokeRect(tag.left, tag.top, width, 17);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = tint;
        ctx.fillText(text, x, y + 1.2);
        ctx.globalAlpha = 1;
      }
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
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(this.scale, this.scale);
      ellipse(ctx, 0, 3, 43, 22, tint + "16", tint + "6b", 1.3);
      box(ctx, 0, 2, 36, 16, 9, "#5b7882", "#304857", "#476476");
      box(ctx, -15, 1, 17, 8, 18, "#6c929c", "#425e6c", "#43636b");
      box(ctx, 14, 1, 17, 8, 26, "#5b7c8b", "#304854", "#466574");
      box(ctx, 11, -20, 11, 6, 12, tint, "#38555e", "#527880");
      line(ctx, [[11, -32], [11, -51], [18, -54]], tint, 1.9);
      line(ctx, [[-26, -8], [-26, -18], [-18, -23]], tint + "bc", 1.5);
      for (const x of [-22, -11, 5, 17]) ellipse(ctx, x, -5 + Math.abs(x) * .17, 2.1, 1.1, tint);
      luminescence(ctx, 11, -45, 30, tint + "59", tint + "00");
      ctx.restore();
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
        clamp(1 - job.remaining / job.duration, 0, 1), tint);
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
      line(ctx, [[0, -16], turretMuzzle(direction)], tint, 3);
      ctx.restore();
    }

    bar(ctx, x, y, width, ratio, tint) {
      ctx.fillStyle = "#0a1420";
      ctx.fillRect(x - width / 2 - 1, y - 1, width + 2, 4);
      ctx.fillStyle = tint;
      ctx.fillRect(x - width / 2, y, width * ratio, 2);
    }

    drawMech(ctx, mech, chosen, time) {
      const p = this.project(mech.x, mech.y);
      const s = this.scale;
      const tint = POLARITY(mech.faction);
      const profile = MechArt.profile(mech.chassisId);
      const [width, depth] = profile.shadow.map((size) => size * s);
      ellipse(ctx, p.x + 4.3 * s, p.y + 2.4 * s, width * 1.17, depth, "#090d193b");
      ellipse(ctx, p.x + 1.9 * s, p.y + s, width * .88, depth * .82, "#080b17a1");
      if (chosen || this.hover === mech.id || this.followedId === mech.id) {
        ellipse(ctx, p.x, p.y + s, width + 2, depth + 2, tint + "16", tint + (chosen ? "e3" : "a0"), 1.35);
      }
      const detailed = s * this.dpr >= 1.25;
      const kicks = mech.weaponIds.map((id, slot) => {
        if (id === null || this.reduced) return 0;
        const recovery = WEAPONS[id].cycle - mech.weaponCooldowns[slot];
        return recovery < .068 ? 1 : recovery < .145 ? .45 : 0;
      });
      MechArt.draw(ctx, mech, p.x, p.y, s, { still: this.reduced, kicks, detailed });
      if (mech.hitAge < .12 && !this.reduced) {
        ctx.save();
        ctx.globalAlpha = (1 - mech.hitAge / .12) * .85;
        luminescence(ctx, p.x, p.y - profile.hud * s * .49, Math.max(4, 15 * s), "#ffce9fa9", "#ff9d6e00");
        ctx.restore();
      }
      if (detailed && !this.reduced && mech.hp < mech.hull * .34) {
        ctx.save();
        const seed = Number(mech.id.slice(5));
        for (let i = 0; i < 3; i++) {
          const phase = (time * .81 + i / 3 + noise(seed, 2)) % 1;
          const drift = Math.sin(seed + i) * phase * 8;
          ctx.globalAlpha = (1 - phase) * .81;
          luminescence(ctx, p.x + drift * s, p.y - (profile.hud * .60 + phase * 21) * s,
            (3.6 + phase * 7.3) * s, "#8a777e9e", "#422d4000");
        }
        ctx.restore();
      }
      if (chosen || mech.hp < mech.hull) {
        this.bar(ctx, p.x, p.y - profile.hud * s, Math.max(13, width * 1.53), mech.hp / mech.hull, tint);
      }
    }

    drawWreck(ctx, effect) {
      const age = effect.max - effect.life;
      if (age < .09) return;
      const p = this.project(effect.x, effect.y);
      const s = this.scale;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(1, .64);
      ctx.globalAlpha = Math.min(1, age * 7, effect.life / 1.4);
      MechArt.draw(ctx, effect.wreck, 0, 0, s * .95, { detailed: s * this.dpr >= 1.25 });
      ctx.restore();
    }

    drawPaths(ctx, match, selected) {
      ctx.save();
      const entities = match.entities().filter((item) => match.canSeeEntity(PLAYER, item));
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
        line(ctx, points, target ? "#ff896fce" : mech.order.kind === "attack-move" ? "#ffc984ce" : "#8ff2ca9c", 1.35);
        if (target) {
          const p = this.project(target.x, target.y);
          const radius = Math.max(9, 21 * this.scale);
          ctx.setLineDash([]);
          ellipse(ctx, p.x, p.y, radius, radius * .52, null, "#ff896f", 1.4);
        }
      }
      ctx.restore();
    }

    drawFireLines(ctx, match, selected) {
      const entities = match.entities().filter((item) => match.canSeeEntity(PLAYER, item));
      ctx.save();
      for (const unit of match.allies()) {
        if (!unit.range || !selected.has(unit.id)) continue;
        const ordered = unit.order.kind === "attack" ? unit.order.target : unit.engagement;
        const target = entities.find(({ id, faction }) => faction !== unit.faction && id === this.hover) ??
          entities.find(({ id }) => id === ordered);
        if (!target || distance(unit, target) > 10) continue;
        const quality = shotStatus(match.terrain, unit, target);
        const shade = { clear: "#9bffe2cd", blocked: "#ffb276e8", distant: "#bdd6e38a" }[quality];
        const p = this.project(unit.x, unit.y);
        const q = this.project(target.x, target.y);
        const from = [p.x, p.y - MechArt.profile(unit.chassisId).hud * .46 * this.scale];
        const height = target.type === "mech" ? MechArt.profile(target.chassisId).hud * .45 : 19;
        const to = [q.x, q.y - height * this.scale];
        ctx.setLineDash(quality === "clear" ? [] : quality === "blocked" ? [3, 4] : [1, 6]);
        line(ctx, [from, to], shade, 1.35);
        if (quality === "blocked") {
          const x = (from[0] + to[0]) / 2;
          const y = (from[1] + to[1]) / 2;
          ctx.setLineDash([]);
          line(ctx, [[x - 3, y - 4], [x + 3, y + 4]], shade, 2);
        }
      }
      ctx.restore();
    }

    drawGroundEffects(ctx, match) {
      const s = this.scale;
      for (const effect of match.effects) {
        const { type } = effect;
        if (type === "shot" || !match.isVisible(PLAYER, effect) || (type === "dust" && (this.reduced || s < .8))) continue;
        const p = this.project(effect.x, effect.y);
        const margin = 70 * s;
        if (p.x < -margin || p.x > this.width + margin || p.y < -margin || p.y > this.height + margin) continue;
        const fade = effect.life / effect.max;
        const age = 1 - fade;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(s, s);
        if (type === "dust") {
          ctx.globalAlpha = fade * .66;
          const radius = (5 + age * 12) * effect.size;
          const drift = 11 * (noise(effect.seed, 0) - .5) * age;
          luminescence(ctx, drift, age * -3, radius, "#cba6868c", "#a37a6000");
          luminescence(ctx, drift - 5, age * -1.5, radius * .74, "#d9b89776", "#aa806400");
        } else if (type === "burst") {
          ctx.globalAlpha = Math.min(1, effect.life / 2);
          ellipse(ctx, 0, 2, 22 * effect.size, 9 * effect.size, "#100c17ac");
          ellipse(ctx, 1, 1, 13 * effect.size, 6 * effect.size, "#160e14cc");
          if (age < .08) {
            ctx.globalAlpha = .62 * (1 - age / .08);
            const wave = (10 + age * 350) * effect.size;
            luminescence(ctx, 0, 0, wave, "#ffbc7687", "#ff7b4100");
            ellipse(ctx, 0, 0, wave, wave * .53, null, "#ffc485", 1.1);
          }
        } else {
          const tint = POLARITY(effect.faction);
          const wave = 8 + age * 54;
          ctx.globalAlpha = fade;
          luminescence(ctx, 0, 0, wave, tint + "74", tint + "00");
          ellipse(ctx, 0, 0, wave, wave * .52, null, tint, 1.5);
        }
        ctx.restore();
      }
    }

    drawShot(ctx, effect, from, to, detailed) {
      const s = this.scale;
      const [ox, oy] = effect.mech ? MechArt.muzzle(effect.mech, this.reduced) :
        effect.turretAngle === null ? [0, -effect.high] : turretMuzzle(effect.turretAngle);
      const x = from.x + ox * s;
      const y = from.y + oy * s;
      const targetHeight = effect.targetChassis === undefined ? effect.targetHigh : MechArt.profile(effect.targetChassis).hud * .47;
      const dx = to.x - x;
      const dy = to.y - targetHeight * s - y;
      const length = Math.max(.1, Math.hypot(dx, dy) / s);
      const tint = effect.color;
      const age = effect.max - effect.life;
      const arc = effect.weaponId === 2;
      const gauss = effect.weaponId === 1;
      const travel = arc ? .024 : clamp(length / (gauss ? 1150 : 660), .055, .135);

      ctx.save();
      ctx.translate(x, y);
      ctx.scale(s, s);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.lineCap = "round";
      if (age < .105) {
        ctx.globalAlpha = (1 - age / .12) * (this.reduced ? .62 : 1);
        const flame = gauss ? 17 : arc ? 9 : 12;
        luminescence(ctx, 0, 0, flame + 5, tint + "dd", tint + "00");
        area(ctx, [[-3, 0], [1, -3.7], [flame, 0], [1, 3.7]], tint, null);
        area(ctx, [[-1, 0], [1.5, -1.5], [flame * .65, 0], [1.5, 1.5]], "#fff6df", null);
      }

      if (arc && age < .21) {
        const phase = this.reduced ? 0 : Math.floor(age * 26);
        const points = [[0, 0]];
        for (let i = 1; i < 7; i++) {
          points.push([length * i / 7, (noise(effect.seed, i, phase) - .5) * Math.min(16, length * .26)]);
        }
        points.push([length, 0]);
        ctx.globalAlpha = 1 - age / .235;
        line(ctx, points, tint + "56", 5.6);
        line(ctx, points, tint, 2.25);
        line(ctx, points, "#fbf0ff", .72);
        if (detailed && !this.reduced) {
          line(ctx, [points[2], [length * .49, -8.4], points[5], [length * .9, 5.8]], tint + "ad", 1.15);
          line(ctx, [points[3], [length * .60, 9.1], [length * .77, 11.7]], tint + "8f", .8);
        }
      } else if (!arc && age < travel + .115) {
        const power = Math.min(1, age / travel);
        const head = Math.max(.1, length * power);
        const tail = Math.max(0, head - length * (gauss ? .76 : .42));
        ctx.globalAlpha = Math.min(1, 1 - (age - travel) / .12);
        const trail = ctx.createLinearGradient(tail, 0, head, 0);
        trail.addColorStop(0, tint + "00");
        trail.addColorStop(.64, tint + "ba");
        trail.addColorStop(1, "#fffcf3");
        line(ctx, [[tail, 0], [head, 0]], tint + "4f", gauss ? 7.4 : 4.6);
        if (gauss) {
          line(ctx, [[tail, 0], [head, 0]], trail, 2.6);
          if (detailed) {
            ellipse(ctx, head, 0, 2.1, 5.35, null, tint + "a9", .9);
            ellipse(ctx, head - 6, 0, 1.7, 4.1, null, tint + "60", .7);
          }
        } else {
          line(ctx, [[tail, -1.22], [head, -1.22]], trail, 1.3);
          line(ctx, [[tail, 1.22], [head, 1.22]], trail, 1.3);
        }
        luminescence(ctx, head, 0, gauss ? 6.4 : 4.5, tint + "a5", tint + "00");
      }

      const impact = age - travel;
      if (impact >= 0 && impact < .25) {
        ctx.translate(length, 0);
        ctx.rotate(-Math.atan2(dy, dx));
        ctx.globalAlpha = Math.max(0, 1 - impact / .24);
        const ring = (5.3 + impact * 38) * (gauss ? 1.35 : 1);
        luminescence(ctx, 0, 0, ring + 4, tint + "cc", tint + "00");
        ellipse(ctx, 0, 0, ring, ring * .64, null, tint, 1.1);
        if (!this.reduced) {
          const count = detailed ? (gauss ? 13 : 8) : 4;
          sparks(ctx, effect.seed, impact, .25, count, gauss ? 1.12 : .77, tint);
        }
      }
      ctx.restore();
    }

    drawBlast(ctx, effect, p, detailed) {
      const age = effect.max - effect.life;
      const extent = effect.size;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(this.scale * extent, this.scale * extent);
      const clouds = this.reduced ? 2 : detailed ? 6 : 3;
      for (let i = 0; i < clouds; i++) {
        const drift = noise(effect.seed, i, 3) - .42;
        const hot = Math.max(0, 1 - age * 2.5);
        const x = drift * (13 + age * 9);
        const y = -7 - (6 + 5 * noise(effect.seed, i)) * Math.min(3.8, age);
        ctx.globalAlpha = Math.min(.86, effect.life / 2.5) * (i === 0 ? 1 : .56);
        const cloud = (7 + Math.min(age, 2.8) * 4.1) * (.7 + noise(effect.seed, i, 1) * .52);
        luminescence(ctx, x, y, cloud, hot > .3 ? "#e6a382ae" : "#787581a7", "#30263500");
      }
      if (age < .64) {
        ctx.globalAlpha = 1 - age / .64;
        const shock = 8 + 29 * Math.sqrt(age);
        luminescence(ctx, 0, -10, shock, "#ffbd75e3", "#ff6a3700");
        ellipse(ctx, 0, -10, shock * .73, shock * .5, null, "#ffcf9c", 1.4);
        if (age < .23) luminescence(ctx, 0, -10, 12 + age * 44, "#fff4d7", "#ffb05d00");
        if (!this.reduced) {
          for (let i = 0; i < (detailed ? 5 : 2); i++) {
            ctx.globalAlpha = 1 - age / .64;
            const dx = (noise(effect.seed, i, 8) - .5) * age * 130;
            const dy = -10 - noise(effect.seed, i, 9) * age * 106 + 112 * age * age;
            const chunk = 1.7 + noise(effect.seed, i, 10) * 2.2;
            area(ctx, [[dx - chunk, dy], [dx, dy - chunk], [dx + chunk, dy + 1], [dx - 1, dy + chunk * .6]],
              "#ad6544", "#40262b");
          }
          ctx.translate(0, -10);
          sparks(ctx, effect.seed, age, .64, detailed ? 21 : 9, 1.17, "#ffad69");
        }
      }
      ctx.restore();
    }

    drawEffects(ctx, match, now) {
      const s = this.scale;
      const detailed = s >= 1.12;
      const margin = 105 * s;
      for (const effect of match.effects) {
        if ((effect.type !== "shot" && effect.type !== "burst") || !match.isVisible(PLAYER, effect) ||
            (effect.type === "shot" && !match.isVisible(PLAYER, { x: effect.tx, y: effect.ty }))) continue;
        const from = this.project(effect.x, effect.y);
        const to = effect.type === "shot" ? this.project(effect.tx, effect.ty) : from;
        if (Math.max(from.x, to.x) < -margin || Math.min(from.x, to.x) > this.width + margin ||
            Math.max(from.y, to.y) < -margin || Math.min(from.y, to.y) > this.height + margin) continue;
        if (effect.type === "shot") this.drawShot(ctx, effect, from, to, detailed);
        else this.drawBlast(ctx, effect, from, detailed);
      }
      if (this.marker && now - this.marker.time < .92) {
        const mark = this.marker;
        const p = this.project(mark.x, mark.y);
        const a = (12 + (now - mark.time) * 22) * this.scale;
        ctx.save();
        ctx.globalAlpha = 1 - (now - mark.time) / .92;
        const tint = mark.kind === "attack-move" ? "#ffd297" : POLARITY(mark.faction);
        ellipse(ctx, p.x, p.y, a, a * .52, null, tint, 1.4);
        ctx.restore();
      }
    }

    drawRally(ctx, workshop) {
      if (!workshop?.rally) return;
      const p = this.project(workshop.x, workshop.y);
      const q = this.project(workshop.rally.x, workshop.rally.y);
      ctx.save();
      ctx.setLineDash([2, 5]);
      line(ctx, [[p.x, p.y], [q.x, q.y]], "#94d8ffa6", 1.4);
      ctx.setLineDash([]);
      ellipse(ctx, q.x, q.y, 9, 5, "#8cdbff2c", "#a3ddff", 1.4);
      line(ctx, [[q.x, q.y], [q.x, q.y - 16]], "#b4e8ff", 1.6);
      area(ctx, [[q.x, q.y - 17], [q.x + 13, q.y - 14], [q.x, q.y - 10]], "#a3ddff");
      ctx.restore();
    }

    draw(match, selected, now, workshop = null) {
      if (this.terrain !== match.terrain) this.refreshGround(match);
      const dt = this.lastDraw === null ? 0 : Math.max(0, now - this.lastDraw);
      this.lastDraw = now;
      if (this.followedId !== null) {
        const unit = match.units.find((mech) => mech.id === this.followedId && mech.hp > 0);
        if (unit) this.center = this.limitCenter(unit, this.zoom);
        else this.followedId = null;
      }
      this.updateCamera(this.reduced ? 1 : 1 - Math.exp(-dt * 18));
      const ctx = this.context;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.drawImage(this.sky, 0, 0, this.width, this.height);
      this.drawOrbit(ctx, now);
      const s = this.scale;
      ctx.drawImage(this.buffer, this.ox + GROUND_LEFT * s, this.oy + GROUND_TOP * s, GROUND_WIDTH * s, GROUND_HEIGHT * s);
      const sight = match.sightFor(PLAYER);
      if (sight) {
        this.refreshFog(match, sight);
        ctx.drawImage(this.fog, this.ox + GROUND_LEFT * s, this.oy + GROUND_TOP * s, GROUND_WIDTH * s, GROUND_HEIGHT * s);
      }
      this.drawGroundEffects(ctx, match);
      this.drawPaths(ctx, match, selected);
      this.drawRally(ctx, workshop);
      for (const pad of match.pads) if (match.canSeeEntity(PLAYER, pad)) this.drawPad(ctx, pad);
      const visible = match.sites.filter((site) => match.canSeeEntity(PLAYER, site));
      const gates = visible.map((site) => ({ x: site.gate.x, y: site.gate.y, type: "gate", site }));
      const wrecks = match.effects.filter((effect) => effect.type === "burst" && effect.wreck && match.isVisible(PLAYER, effect));
      const machines = [...match.units, ...match.pads.map((pad) => pad.turret)]
        .filter((unit) => unit?.hp > 0 && match.canSeeEntity(PLAYER, unit));
      const figures = [...this.scenery, ...visible, ...gates, ...wrecks, ...machines]
        .sort((a, b) => a.x + a.y - b.x - b.y);
      for (const thing of figures) {
        const p = this.project(thing.x, thing.y);
        if (p.x < -110 * s || p.x > this.width + 110 * s || p.y < -48 * s || p.y > this.height + 110 * s) continue;
        if (thing.grit !== undefined) {
          const explored = sight?.[thing.y * WIDTH + thing.x];
          if (sight && explored !== 2) ctx.globalAlpha = explored === 1 ? .45 : .18;
          this.drawScenery(ctx, thing);
          ctx.globalAlpha = 1;
        } else if (thing.type === "base") this.drawBase(ctx, thing);
        else if (thing.type === "factory" || thing.type === "outpost") this.drawFacility(ctx, thing, now);
        else if (thing.type === "gate") this.drawGate(ctx, thing.site);
        else if (thing.type === "turret") this.drawTurret(ctx, thing);
        else if (thing.type === "burst") this.drawWreck(ctx, thing);
        else if (thing.type === "mech") this.drawMech(ctx, thing, selected.has(thing.id), match.time);
        else this.drawNode(ctx, thing, now);
      }
      this.drawFireLines(ctx, match, selected);
      this.drawSiteTags(ctx, match);
      this.drawEffects(ctx, match, now);
      this.drawMinimap(match, selected);
    }
  }

  View.MIN_ZOOM = MIN_ZOOM;
  View.MAX_ZOOM = MAX_ZOOM;
  return View;
})();
