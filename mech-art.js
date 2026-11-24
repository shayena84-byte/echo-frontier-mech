"use strict";

const MechArt = (() => {
  const TAU = Math.PI * 2;
  const ELEVATION = 0.52;
  const CAMERA_DEPTH = 0.95;
  const ANGLES = 24;
  const WALK_FRAMES = 8;
  const SPRITE_WIDTH = 94;
  const SPRITE_HEIGHT = 88;
  const ORIGIN_X = 47;
  const ORIGIN_Y = 66;
  const MAX_SPRITES = 128;
  const OUTLINE = "#10151cbe";
  const PROFILES = [
    { deck: 20, length: 21, width: 14, height: 7, knee: 10, stance: 6.8, shadow: [17, 8], hud: 45 },
    { deck: 22, length: 18, width: 20, height: 10, knee: 11, stance: 10, shadow: [21, 9], hud: 52 },
    { deck: 10, length: 27, width: 24, height: 7, shadow: [25, 12], hud: 35 },
  ];
  const WEAPON_SHAPES = [
    { front: 21, lift: 2.4, material: "alloy" },
    { front: 30, lift: 3.6, material: "steel" },
    { front: 23, lift: 3, material: "alloy" },
  ];
  const PALETTES = {
    ally: {
      steel: [133, 151, 144], alloy: [213, 207, 177], shoulder: [101, 144, 133],
      frame: [64, 82, 88], rubber: [47, 54, 62], joint: [155, 166, 174],
      inset: [24, 35, 44], cockpit: [26, 94, 96], accent: [77, 249, 205, true],
      light: [212, 255, 244, true], warning: [222, 166, 76], arc: [187, 138, 255, true],
      pipe: [174, 116, 67], marking: [236, 230, 200],
    },
    hostile: {
      steel: [142, 133, 131], alloy: [223, 171, 131], shoulder: [183, 74, 57],
      frame: [79, 67, 73], rubber: [50, 45, 55], joint: [168, 149, 134],
      inset: [38, 28, 38], cockpit: [108, 37, 40], accent: [255, 94, 65, true],
      light: [255, 226, 176, true], warning: [240, 179, 79], arc: [243, 123, 239, true],
      pipe: [161, 106, 71], marking: [248, 211, 165],
    },
  };
  const WEAR_MATERIALS = new Set(["steel", "alloy", "shoulder", "frame", "rubber", "joint"]);
  const RECT_SECTION = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const ROUND_SECTION = Array.from({ length: 8 }, (_, i) => [Math.cos(i * TAU / 8), Math.sin(i * TAU / 8)]);
  const sprites = new Map();

  function ring(f, l, z, length, width, bevel) {
    const x = length / 2;
    const y = width / 2;
    const cut = Math.min(bevel, x * .58, y * .58);
    return [
      [f - x + cut, l - y, z], [f + x - cut, l - y, z],
      [f + x, l - y + cut, z], [f + x, l + y - cut, z],
      [f + x - cut, l + y, z], [f - x + cut, l + y, z],
      [f - x, l + y - cut, z], [f - x, l - y + cut, z],
    ];
  }

  function sides(mesh, lower, upper, material) {
    for (let i = 0; i < lower.length; i++) {
      const next = (i + 1) % lower.length;
      mesh.push({ points: [lower[i], lower[next], upper[next], upper[i]], material });
    }
  }

  function armor(mesh, f, l, z, length, width, height, material, roof = material) {
    const bevel = Math.min(2.4, width * .25, length * .22);
    const ledge = Math.min(.45 * bevel, .43 * height);
    const lower = ring(f, l, z, length * .85, width * .85, bevel);
    const middle = ring(f, l, z + ledge, length, width, bevel);
    const upper = ring(f - Math.min(1, ledge), l, z + height, length * .86, width * .81, bevel);
    sides(mesh, lower, middle, material);
    sides(mesh, middle, upper, material);
    mesh.push({ points: upper, material: roof });
  }

  function link(mesh, from, to, width, material, round = false) {
    const [dx, dy, dz] = to.map((value, i) => value - from[i]);
    const tilt = Math.hypot(dx, dz);
    const length = Math.hypot(dx, dy, dz);
    const axis = tilt > .001 ? [-dz / tilt, 0, dx / tilt] : [1, 0, 0];
    const across = tilt > .001 ? [dy * dx / (tilt * length), -tilt / length, dy * dz / (tilt * length)] :
      [0, 0, -Math.sign(dy)];
    const corners = round ? ROUND_SECTION : RECT_SECTION;
    const rim = (point) => corners.map(([a, b]) =>
      point.map((value, i) => value + width * .5 * (a * axis[i] + b * across[i])));
    const lower = rim(from);
    const upper = rim(to);
    sides(mesh, lower, upper, material);
    mesh.push({ points: upper, material }, { points: lower.slice().reverse(), material });
  }

  function walkBob(stride) {
    return stride > 0 ? -.8 * (1 + Math.cos((stride - 1) * TAU * 2 / WALK_FRAMES)) : 0;
  }

  function biped(mesh, profile, heavy, stride, detailed) {
    const phase = stride > 0 ? (stride - 1) / WALK_FRAMES * TAU : 0;
    const deck = profile.deck + walkBob(stride);
    for (const sign of [-1, 1]) {
      const gait = phase + (sign === 1 ? Math.PI : 0);
      const step = stride > 0 ? Math.cos(gait) * (heavy ? 4.1 : 6) : 0;
      const lift = stride > 0 ? Math.max(0, Math.sin(gait)) * (heavy ? 3.2 : 4.7) : 0;
      const side = sign * profile.stance;
      const hip = [-2.5, side * .69, deck + .5];
      const knee = [(heavy ? 3.5 : -5.3) + step * .42, side, profile.knee + lift * .42];
      const heel = [step - 1.8, side, lift + 2.7];
      const width = heavy ? 5.4 : 3.1;
      link(mesh, hip, knee, width + 1, "frame");
      link(mesh, [hip[0] + 1.9, hip[1], hip[2]], [knee[0] + 1.8, side, knee[2] + 1.3], width, "shoulder");
      link(mesh, knee, heel, width, "steel");
      const cap = side + sign * (width * .51 + .5);
      link(mesh, [knee[0], side - 1.5, knee[2]], [knee[0], cap, knee[2]], width + 2.15, "joint", true);
      link(mesh, [knee[0], cap - sign * .12, knee[2]], [knee[0], cap + sign * .55, knee[2]],
        width * .69, "inset", true);
      if (heavy) {
        const shin = [heel[0] + 2.1, side, heel[2]];
        link(mesh, [knee[0] + 2, side, knee[2] - 1], shin, width + 1.7, "alloy");
        armor(mesh, knee[0] + 1.5, side, knee[2] - 2.1, 6.7, width + 1.8, 5.4, "shoulder", "alloy");
      }
      if (detailed) {
        const piston = [heel[0] - .95, side + sign * width * .46, heel[2] + 1.1];
        const sleeve = [(knee[0] + piston[0]) / 2, cap, (knee[2] + piston[2]) / 2];
        link(mesh, [knee[0] - 1.5, cap, knee[2]], sleeve, 2, "pipe", true);
        link(mesh, sleeve, piston, .95, "joint", true);
        armor(mesh, knee[0] + .4, side, knee[2] + width * .48, 2.2, 1.3, .55, "accent");
      }
      armor(mesh, step - .3, side, lift + .25, heavy ? 12 : 8.7, width + 3.5, 3.1, "rubber", "steel");
      for (const toe of [-1, 1]) {
        armor(mesh, step + 3.65, side + toe * (width + 1) * .28, lift + .2, 5.5, width * .51 + .8,
          2.65, "frame", "alloy");
      }
    }
    return deck;
  }

  function tracks(mesh, stride, detailed) {
    for (const sign of [-1, 1]) {
      const side = sign * 11.5;
      armor(mesh, 0, side, .35, 35, 9.5, 8.8, "rubber", "frame");
      for (let i = -2; i <= 2; i++) {
        const x = i * 5.55;
        const end = side + sign * 4.52;
        link(mesh, [x, end - sign * 1.8, 4.45], [x, end, 4.45], 6.55, "steel", true);
        if (detailed) link(mesh, [x, end, 4.45], [x, end + sign * .64, 4.45], 2.8, "joint", true);
      }
      for (let i = -4; i <= 4; i++) {
        const x = i * 3.05 + (stride % 4) * .43;
        if (detailed || i % 2 === 0) armor(mesh, x, side, 7.8, 1.4, 8.8, 1.1, "joint");
      }
      armor(mesh, -.5, side, 8.3, 31.5, 10.6, 3.45, "shoulder", "steel");
      armor(mesh, 10.7, side, 10.85, 7.2, 7.7, 1.8, "steel", "warning");
      if (detailed) {
        for (let i = 0; i < 3; i++) armor(mesh, 9 + i * 1.45, side, 12.47, .65, 5.4, .26, "inset");
      }
    }
  }

  function mount(profile, chassisId, weaponId, deck, slot) {
    const weapon = WEAPON_SHAPES[weaponId];
    const side = profile.width * (chassisId === 2 ? .43 : .66) * (slot === 0 ? 1 : -1);
    return { side, height: deck + profile.height * .56 + weapon.lift, ...weapon };
  }

  function armament(mesh, gun, weaponId, kick, detailed) {
    const { side, height: z, front, material } = gun;
    const recoil = kick * (weaponId === 1 ? 3.9 : 2.65);
    const last = front - recoil;
    armor(mesh, .1, side, z - 5.8, 9.6, 6.2, 6.1, "frame", "steel");
    armor(mesh, 2.8 - recoil, side, z - 2.55, 14.1, weaponId === 2 ? 8.4 : 6.9, 5.5, material, "alloy");
    armor(mesh, -4.7 - recoil, side, z - 2.1, 4.7, 4.8, 4.2, "frame", "shoulder");
    if (weaponId === 1) {
      armor(mesh, 16.5 - recoil, side, z - 1.7, 23, 4.35, 3.55, "frame", "steel");
      for (const offset of [-2.25, 2.25]) {
        armor(mesh, 17.2 - recoil, side + offset, z + .45, 19.6, 1.6, 1.65, "alloy");
      }
      armor(mesh, 16.6 - recoil, side, z + 1.4, 16.8, 1.2, .55, "warning");
      armor(mesh, last - 1.7, side, z - 2.1, 4.6, 6.6, 4.55, "steel", "marking");
      link(mesh, [last - .75, side, z], [last + .5, side, z], 2.9, "inset", true);
      if (detailed) {
        for (let i = 0; i < 4; i++) armor(mesh, 6.2 + i * 1.32 - recoil, side, z + 2.2, .52, 3.9, .52, "pipe");
      }
    } else {
      const arc = weaponId === 2;
      for (const offset of arc ? [-3, 3] : [-1.9, 1.9]) {
        const flange = arc ? 3.4 : 2.85;
        link(mesh, [7 - recoil, side + offset, z], [last, side + offset, z], flange, "steel", true);
        armor(mesh, last - 2.15, side + offset, z + .5, 4.7, flange, 1.45, arc ? "arc" : "alloy");
        link(mesh, [last - .4, side + offset, z], [last + .55, side + offset, z], flange * .6, "inset", true);
      }
      armor(mesh, 6 - recoil, side, z + 2.32, 4.6, 2.45, .85, arc ? "arc" : "warning");
      if (detailed) armor(mesh, 1.1 - recoil, side, z + 2.5, 2.2, 5.1, .88, "inset");
    }
  }

  function equipment(mesh, kitId, profile, deck) {
    const high = deck + profile.height;
    if (kitId === 0) {
      armor(mesh, -7.5, -2, high - 1.1, 7.6, 6.2, 3.6, "steel", "joint");
      link(mesh, [-7.5, -2, high + 1.2], [-8.8, -2, high + 6.6], 1.65, "alloy", true);
      armor(mesh, -8.6, -2, high + 6.1, 4.8, 8.55, 1.7, "inset", "shoulder");
      armor(mesh, -6.35, -2, high + 6.8, 1.55, 7.6, .85, "accent");
      link(mesh, [-9.7, -4.2, high + 6], [-11.1, -4.2, high + 10.9], .85, "joint", true);
      link(mesh, [-11.1, -4.2, high + 10.9], [-11.4, -4.2, high + 12.25], .9, "light", true);
    } else if (kitId === 1) {
      for (const side of [-1, 1]) {
        const offset = side * profile.width * .47;
        armor(mesh, -4.4, offset, deck + .6, 12.3, 6.2, 6.5, "shoulder", "alloy");
        armor(mesh, -4.2, offset + side * 1.3, deck + 5.7, 9.3, 2.9, 1.55, "frame", "warning");
        armor(mesh, -6.3, offset + side * 1.35, deck + 6.75, 1.15, 2.6, .65, "inset");
        armor(mesh, -3.15, offset + side * 1.35, deck + 6.75, 1.15, 2.6, .65, "inset");
      }
    } else {
      armor(mesh, -8, 0, high - 3, 9.1, 10.5, 6.4, "steel", "shoulder");
      for (const offset of [-3, 3]) {
        armor(mesh, -8.7, offset, high + 2.4, 7.6, 2.6, 2.1, "frame", "alloy");
      }
      armor(mesh, -7.3, 0, high + 3, 2.9, 1.2, .75, "light");
    }
  }

  function buildMesh(chassisId, weaponIds, kitId, stride, kicks, detailed) {
    const mesh = [];
    const profile = PROFILES[chassisId];
    const heavy = chassisId === 1;
    const tracked = chassisId === 2;
    let deck = profile.deck;
    if (tracked) tracks(mesh, stride, detailed);
    else deck = biped(mesh, profile, heavy, stride, detailed);
    const top = deck + profile.height;
    const nose = tracked ? 9.8 : heavy ? 3.5 : 7.6;
    const canopy = tracked ? 10.5 : heavy ? 8.2 : 7.5;
    const visor = top + (heavy ? 4.15 : 2.3);
    armor(mesh, -1.8, 0, deck - 3.2, profile.length * .81, profile.width * .85, 6.4, "frame", "steel");
    armor(mesh, -.8, 0, deck, profile.length, profile.width, profile.height - .7, "steel", "shoulder");
    armor(mesh, nose - 2.3, 0, deck + 1.35, tracked ? 14 : 11.7, profile.width * .81, 5, "shoulder", "alloy");
    armor(mesh, nose - 2.2, 0, top - 1.75, 9.5, canopy + 2.6, heavy ? 8.7 : 6.2, "steel", "alloy");
    armor(mesh, nose + 1.4, 0, visor - 2.2, 4.4, canopy, 3.35, "cockpit", "inset");
    armor(mesh, nose + 2.95, 0, visor - .37, 1.5, canopy * .82, 1.35, "cockpit", "accent");
    armor(mesh, nose + 3.28, -canopy * .15, visor + .52, .65, canopy * .41, .35, "light");

    for (const sign of [-1, 1]) {
      const side = sign * profile.width * .43;
      const length = heavy ? 13.5 : 9.5;
      armor(mesh, heavy ? -.95 : -5.4, side, deck + (heavy ? 3.8 : 2.7), length, heavy ? 9 : 6.1,
        heavy ? 8.4 : 5.55, "shoulder", "alloy");
      armor(mesh, -6.1, side, deck + 1.4, 8.4, 4.65, 5.2, "frame", "steel");
      armor(mesh, -8.1, side, deck + 4.85, 2.55, 3.6, 1.2, "inset", "inset");
      armor(mesh, 4.2, side, deck + 3.85, 3.9, 2.7, 1.8, "steel", "accent");
      if (heavy) {
        const elbow = [.35, side * 1.53, deck - 1.95];
        link(mesh, [-1.9, side * 1.27, deck + 6.75], elbow, 5.2, "frame");
        link(mesh, elbow, [3.35, side * 1.56, deck - 4.1], 5.1, "shoulder");
        armor(mesh, 3.65, side * 1.56, deck - 6.1, 6.3, 5.45, 4.2, "steel", "alloy");
      }
      if (detailed) {
        for (let i = 0; i < 3; i++) {
          armor(mesh, -8.1 + i * 1.25, side * .65, top - .75, .55, 3.35, 1, "inset");
        }
        armor(mesh, heavy ? 1.5 : -4.4, side, deck + (heavy ? 11.95 : 8.05), 3.55, 1.85, .34, "marking");
        armor(mesh, heavy ? 3.73 : -2.2, side, deck + (heavy ? 11.89 : 8.0), .74, 1.85, .41, "warning");
      }
    }
    if (tracked) armor(mesh, 12.4, 0, 4.55, 8.5, 17.9, 6.45, "shoulder", "steel");

    if (kitId !== null) equipment(mesh, kitId, profile, deck);
    for (const [slot, id] of weaponIds.entries()) {
      if (id !== null) armament(mesh, mount(profile, chassisId, id, deck, slot), id, kicks[slot], detailed);
    }
    return mesh;
  }

  function camera(angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return ([forward, lateral, height]) => {
      const x = forward * cos - lateral * sin;
      const y = forward * sin + lateral * cos;
      return [(x - y) * Math.SQRT1_2, (x + y) * Math.SQRT1_2, height];
    };
  }

  function screen([right, near, height]) {
    return [right, near * ELEVATION - height * CAMERA_DEPTH];
  }

  function visibleFaces(mesh, angle, palette, wreck) {
    const rotate = camera(angle);
    const visible = [];
    for (const face of mesh) {
      const points = face.points.map(rotate);
      const a = points[1].map((value, i) => value - points[0][i]);
      const b = points[2].map((value, i) => value - points[0][i]);
      const x = a[1] * b[2] - a[2] * b[1];
      const y = a[2] * b[0] - a[0] * b[2];
      const z = a[0] * b[1] - a[1] * b[0];
      if (y * CAMERA_DEPTH + z * ELEVATION <= .01) continue;
      const normal = Math.hypot(x, y, z);
      const light = Math.max(0, (-.62 * x + .32 * y + .72 * z) / normal);
      const [r, g, bColor, emissive] = palette[face.material];
      const intensity = emissive && !wreck ? .92 + light * .08 : .48 + light * .54;
      const centerDepth = points.reduce((sum, [, near, height]) => sum + near * CAMERA_DEPTH + height * ELEVATION, 0) / points.length;
      const metal = wreck ? [32 + r * .19, 28 + g * .16, 26 + bColor * .15] : [r, g, bColor];
      visible.push({ points: points.map(screen), depth: centerDepth, metal, intensity,
        emissive: emissive && !wreck, wear: WEAR_MATERIALS.has(face.material) });
    }
    return visible.sort((a, b) => a.depth - b.depth);
  }

  function angleIndex(direction) {
    const index = Math.round(direction * ANGLES / TAU);
    return ((index % ANGLES) + ANGLES) % ANGLES;
  }

  function gaitIndex(unit, still) {
    return !unit.moving || still ? 0 : 1 + Math.floor(unit.foot * WALK_FRAMES / TAU) % WALK_FRAMES;
  }

  function paintFace(ctx, face, detailed, index) {
    const { points, metal, intensity, emissive, wear } = face;
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (const point of points.slice(1)) ctx.lineTo(...point);
    ctx.closePath();
    const tint = (strength, warmth = 0) => "rgb(" +
      metal.map((value, channel) => Math.min(255, Math.round(value * strength + (2 - channel) * warmth))).join(",") + ")";
    let x0, x1, y0, y1;
    if (detailed && wear) {
      const xs = points.map((point) => point[0]);
      const ys = points.map((point) => point[1]);
      x0 = Math.min(...xs);
      x1 = Math.max(...xs);
      y0 = Math.min(...ys);
      y1 = Math.max(...ys);
    }
    const panel = detailed && wear && (x1 - x0) * (y1 - y0) > 26;
    if (panel) {
      const paint = ctx.createLinearGradient(x0, y0, x1, y1);
      paint.addColorStop(0, tint(intensity * 1.12, 3));
      paint.addColorStop(.37, tint(intensity * 1.02));
      paint.addColorStop(1, tint(intensity * .83));
      ctx.fillStyle = paint;
    } else ctx.fillStyle = tint(intensity);
    ctx.fill();
    ctx.lineWidth = emissive ? .21 : .43;
    ctx.strokeStyle = emissive ? ctx.fillStyle : OUTLINE;
    ctx.stroke();
    if (!panel) return;
    ctx.save();
    ctx.clip();
    ctx.lineWidth = .31;
    ctx.strokeStyle = "#e9dfbd56";
    ctx.beginPath();
    ctx.moveTo(points[0][0] + .16, points[0][1] + .23);
    ctx.lineTo(points[1][0] + .16, points[1][1] + .23);
    const fleck = (salt) => (Math.sin((index + 1) * 17.11 + salt * 7.85) * 182.32 % 1 + 1) % 1;
    for (let i = 0; i < 4; i++) {
      const x = x0 + (x1 - x0) * fleck(i * 3);
      const y = y0 + (y1 - y0) * fleck(i * 3 + 1);
      ctx.moveTo(x, y);
      ctx.lineTo(x + .55 + 1.85 * fleck(i * 3 + 2), y + .3);
    }
    ctx.stroke();
    ctx.restore();
  }

  function sprite(unit, still, kicks, detailed) {
    const { chassisId, weaponIds, kitId, faction, direction } = unit;
    const heading = angleIndex(direction);
    const gait = gaitIndex(unit, still);
    const key = [faction, chassisId, ...weaponIds, kitId, heading, gait, ...kicks, detailed, Boolean(unit.wreck)].join("/");
    if (sprites.has(key)) {
      const cached = sprites.get(key);
      sprites.delete(key);
      sprites.set(key, cached);
      return cached;
    }
    const palette = faction < 0 ? PALETTES.hostile : PALETTES.ally;
    const faces = visibleFaces(buildMesh(chassisId, weaponIds, kitId, gait, kicks, detailed),
      heading * TAU / ANGLES, palette, unit.wreck);
    const density = detailed ? 3 : 1.5;
    const canvas = document.createElement("canvas");
    canvas.width = SPRITE_WIDTH * density;
    canvas.height = SPRITE_HEIGHT * density;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(density, 0, 0, density, ORIGIN_X * density, ORIGIN_Y * density);
    ctx.lineJoin = "round";
    faces.forEach((face, i) => paintFace(ctx, face, detailed, i));
    if (sprites.size >= MAX_SPRITES) sprites.delete(sprites.keys().next().value);
    sprites.set(key, canvas);
    return canvas;
  }

  function draw(ctx, unit, x, y, scale, { still = false, kicks = [0, 0], detailed = false } = {}) {
    ctx.drawImage(sprite(unit, still, kicks, detailed), x - ORIGIN_X * scale, y - ORIGIN_Y * scale,
      SPRITE_WIDTH * scale, SPRITE_HEIGHT * scale);
  }

  function muzzle(unit, still) {
    const { chassisId, weaponId, slot, direction } = unit;
    const profile = PROFILES[chassisId];
    const gait = gaitIndex(unit, still);
    const bob = chassisId === 2 ? 0 : walkBob(gait);
    const gun = mount(profile, chassisId, weaponId, profile.deck + bob, slot);
    return screen(camera(angleIndex(direction) * TAU / ANGLES)([gun.front, gun.side, gun.height]));
  }

  function preview(canvas, chassisId, firstWeapon, secondWeapon, kitId) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const x = canvas.width * .49;
    const y = canvas.height * .79;
    const scale = canvas.height / (PROFILES[chassisId].hud + 12);
    ctx.beginPath();
    ctx.ellipse(x, y, 23 * scale, 8.9 * scale, 0, 0, TAU);
    ctx.fillStyle = "#10232be0";
    ctx.fill();
    ctx.strokeStyle = "#83bbb05b";
    ctx.stroke();
    draw(ctx, { faction: 1, chassisId, weaponIds: [firstWeapon, secondWeapon], kitId, direction: .39 },
      x, y, scale, { detailed: true });
  }

  return { draw, muzzle, preview, profile: (id) => PROFILES[id] };
})();
