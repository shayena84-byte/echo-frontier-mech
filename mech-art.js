"use strict";

const MechArt = (() => {
  const TAU = Math.PI * 2;
  const ELEVATION = 0.52;
  const CAMERA_DEPTH = 0.95;
  const ANGLES = 24;
  const WALK_FRAMES = 8;
  const SPRITE_WIDTH = 82;
  const SPRITE_HEIGHT = 68;
  const ORIGIN_X = 41;
  const ORIGIN_Y = 51;
  const DENSITY = 2.5;
  const MAX_SPRITES = 144;
  const OUTLINE = "#0a1725b3";
  const PROFILES = [
    { deck: 18, length: 19, width: 14, height: 7.5, knee: 9, stance: 7.4, shadow: [17, 8], hud: 40 },
    { deck: 21, length: 22, width: 19, height: 8.5, knee: 10, stance: 9.7, shadow: [21, 9], hud: 47 },
    { deck: 8, length: 26, width: 23, height: 9.5, shadow: [24, 11], hud: 34 },
  ];
  const WEAPON_SHAPES = [
    { front: 20, lift: 3, material: "alloy" },
    { front: 29, lift: 4.4, material: "steel" },
    { front: 21, lift: 3.3, material: "alloy" },
  ];
  const PALETTES = {
    ally: {
      steel: [115, 146, 162], alloy: [191, 216, 220], shoulder: [109, 154, 153],
      frame: [69, 88, 104], rubber: [54, 65, 79], joint: [104, 125, 142],
      inset: [25, 45, 62], cockpit: [39, 118, 119], accent: [97, 238, 196, true],
      light: [206, 255, 233, true], warning: [244, 199, 108, true], arc: [192, 146, 255, true],
    },
    hostile: {
      steel: [141, 114, 115], alloy: [224, 168, 136], shoulder: [177, 103, 80],
      frame: [89, 70, 85], rubber: [61, 54, 69], joint: [138, 110, 112],
      inset: [43, 35, 56], cockpit: [141, 63, 53], accent: [255, 133, 93, true],
      light: [255, 225, 173, true], warning: [252, 206, 122, true], arc: [231, 106, 166, true],
    },
  };
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

  function link(mesh, from, to, width, material) {
    const [dx, dy, dz] = to.map((value, i) => value - from[i]);
    const tilt = Math.hypot(dx, dz) || 1;
    const length = Math.hypot(dx, dy, dz) || 1;
    const axis = [-dz / tilt, 0, dx / tilt];
    const across = [dy * dx / (tilt * length), -tilt / length, dy * dz / (tilt * length)];
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const rim = (point) => corners.map(([a, b]) =>
      point.map((value, i) => value + width * .5 * (a * axis[i] + b * across[i])));
    const lower = rim(from);
    const upper = rim(to);
    sides(mesh, lower, upper, material);
    mesh.push({ points: upper, material }, { points: lower.slice().reverse(), material });
  }

  function biped(mesh, profile, heavy, stride) {
    const phase = stride > 0 ? (stride - 1) / WALK_FRAMES * TAU : 0;
    const bob = stride > 0 ? -.85 * (1 + Math.cos(phase * 2)) : 0;
    for (const sign of [-1, 1]) {
      const gait = phase + (sign === 1 ? Math.PI : 0);
      const step = stride > 0 ? Math.cos(gait) * (heavy ? 4.3 : 5.4) : 0;
      const lift = stride > 0 ? Math.max(0, Math.sin(gait)) * 4 : 0;
      const side = sign * profile.stance;
      const hip = [-2.4, side * .76, profile.deck + bob + 1];
      const knee = [4.1 + step * .44, side, profile.knee + lift * .45];
      const heel = [step - 2.25, side, lift + 2.7];
      const width = heavy ? 4.6 : 3.2;
      link(mesh, hip, knee, width + .55, "frame");
      link(mesh, knee, heel, width, "steel");
      link(mesh, [knee[0], knee[1] + sign * 1.7, knee[2]],
        [heel[0], heel[1] + sign * .8, heel[2]], 1.05, "joint");
      armor(mesh, knee[0] + .65, side, knee[2] - 1.8, width + 2.3, width + 1.8, 4.3, "shoulder", "alloy");
      armor(mesh, knee[0] + 1.1, side + sign * 1.3, knee[2] + 1.65, 2.4, 1.45, .9, "accent");
      armor(mesh, step + .6, side, lift + .15, heavy ? 10.4 : 8.3, width + 2.8, 3.3, "rubber", "steel");
      armor(mesh, step + 2.7, side, lift + 2.6, 3.5, width + 1.1, .8, "alloy");
    }
    return profile.deck + bob;
  }

  function tracks(mesh, stride) {
    for (const sign of [-1, 1]) {
      const side = sign * 10.1;
      armor(mesh, 0, side, .4, 32, 8.8, 8.6, "rubber", "frame");
      for (let i = -3; i <= 3; i++) {
        const forward = i * 3.45 + (stride % 3) * .42;
        armor(mesh, forward, side, 7.5, 1.25, 8.2, .95, "joint");
        if (i % 2 === 0) armor(mesh, forward, sign * 14.1, 2.5, 3, 1.15, 3.1, "joint", "steel");
      }
      armor(mesh, -1.25, side * .91, 7.6, 21, 7.7, 4.8, "steel", "shoulder");
      armor(mesh, 10.6, side, 7.4, 3, 4.8, 1.55, "warning");
    }
  }

  function mount(profile, chassisId, weaponId, deck) {
    const weapon = WEAPON_SHAPES[weaponId];
    const side = profile.width * (chassisId === 2 ? .35 : .51);
    return { side, height: deck + profile.height * .61 + weapon.lift, ...weapon };
  }

  function armament(mesh, gun, weaponId) {
    const { side, height: z, front, material } = gun;
    armor(mesh, -.8, side - .25, z - 5.8, 9.4, 6.2, 7.2, "frame", "steel");
    armor(mesh, 3.1, side, z - 2.5, 13.6, weaponId === 2 ? 8 : 6.8, 5.4, material, "alloy");
    if (weaponId === 1) {
      armor(mesh, 16.5, side, z - 1.5, 23, 4.35, 3.45, "frame", "steel");
      for (const offset of [-1.9, 1.9]) {
        armor(mesh, 17.2, side + offset, z + .65, 19.2, 1.4, 1.3, "alloy");
      }
      armor(mesh, 16.6, side, z + 2, 16.2, 1.1, .6, "accent");
      armor(mesh, front - 1.6, side, z - 1.75, 3.9, 5.5, 4.05, "steel");
    } else {
      const arc = weaponId === 2;
      for (const offset of arc ? [-3.15, 3.15] : [-2.03, 2.03]) {
        const flange = arc ? 2.8 : 2.15;
        armor(mesh, (8.6 + front) / 2, side + offset, z - 1.35, front - 7.7, flange, 2.95, "frame", material);
        armor(mesh, front - 2, side + offset, z + 1, 4.7, flange, 1.3, arc ? "arc" : "accent");
      }
      armor(mesh, 7.5, side, z + 2.3, 4.6, 2.45, .9, arc ? "arc" : "warning");
    }
  }

  function equipment(mesh, kitId, profile, deck) {
    const high = deck + profile.height;
    if (kitId === 0) {
      armor(mesh, -6.3, -2.1, high - .95, 7, 6, 3.3, "steel", "joint");
      link(mesh, [-6.4, -2.3, high + 1.3], [-8.2, -2.3, high + 8.8], 1.05, "alloy");
      link(mesh, [-7.4, -2.3, high + 6.3], [-5, -5.5, high + 7.3], 1.12, "accent");
      link(mesh, [-8.2, -2.3, high + 8], [-9.0, -2.3, high + 11.0], 1.05, "accent");
    } else if (kitId === 1) {
      for (const side of [-1, 1]) {
        const offset = side * profile.width * .47;
        armor(mesh, -3.9, offset, deck + 1.6, 12, 5.0, 5.3, "shoulder", "alloy");
        armor(mesh, -2.5, offset + side * .7, deck + 6.3, 6.4, 1.3, .85, "warning");
      }
    } else {
      armor(mesh, -8, 0, high - 3, 9.1, 10.5, 6.4, "steel", "shoulder");
      for (const offset of [-3, 3]) {
        armor(mesh, -8.7, offset, high + 2.4, 7.6, 2.6, 2.1, "frame", "alloy");
      }
      armor(mesh, -7.3, 0, high + 3, 2.9, 1.2, .75, "light");
    }
  }

  function buildMesh(chassisId, weaponId, kitId, stride) {
    const mesh = [];
    const profile = PROFILES[chassisId];
    const heavy = chassisId === 1;
    const tracked = chassisId === 2;
    let deck = profile.deck;
    if (tracked) tracks(mesh, stride);
    else deck = biped(mesh, profile, heavy, stride);
    const top = deck + profile.height;

    armor(mesh, -1, 0, deck - 2.2, profile.length * .82, profile.width * .9, 5.7, "frame", "steel");
    armor(mesh, 0, 0, deck, profile.length, profile.width, profile.height, "steel", "alloy");
    armor(mesh, -3.6, -profile.width * .34, deck + 3.1, heavy ? 14 : 10, 6.1, 5.7, "shoulder", "alloy");
    armor(mesh, 2.0, -profile.width * .39, deck + 5.2, 4.4, 3.9, 2.3, "steel", "accent");
    armor(mesh, -4.8, profile.width * .37, deck + 4.5, 3.6, 2.6, 2.7, "shoulder", "accent");
    armor(mesh, 4.7, -1.6, top - .8, 9.8, heavy ? 10.6 : 8.5, 4.9, "steel", "alloy");
    armor(mesh, 7.1, -1.6, top + .55, 6.5, heavy ? 9.7 : 7.5, 3.1, "cockpit", "cockpit");
    armor(mesh, 8.8, -1.6, top + 1.8, 3.8, heavy ? 7.4 : 5.9, 1.55, "cockpit", "accent");
    for (const offset of [-2.3, 1.7]) {
      armor(mesh, 9.5, offset - 1.5, top + 3.1, 1.8, 1, .6, "light");
    }
    for (let i = 0; i < 3; i++) armor(mesh, -5.8 + 1.55 * i, 1.15, top - .23, .65, 3.4, .95, "inset");

    equipment(mesh, kitId, profile, deck);
    armament(mesh, mount(profile, chassisId, weaponId, deck), weaponId);
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

  function visibleFaces(mesh, angle, palette) {
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
      const light = Math.max(0, (-.46 * x + .27 * y + .85 * z) / normal);
      const [r, g, bColor, emissive] = palette[face.material];
      const intensity = emissive ? .9 + light * .1 : .52 + light * .48;
      const centerDepth = points.reduce((sum, [, near, height]) => sum + near * CAMERA_DEPTH + height * ELEVATION, 0) / points.length;
      const color = [r, g, bColor].map((value) => Math.round(value * intensity));
      visible.push({ points: points.map(screen), depth: centerDepth, paint: "rgb(" + color.join(",") + ")", emissive });
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

  function sprite(unit, still) {
    const { chassisId, weaponId, kitId, faction, direction } = unit;
    const heading = angleIndex(direction);
    const gait = gaitIndex(unit, still);
    const key = [faction, chassisId, weaponId, kitId, heading, gait].join("/");
    if (sprites.has(key)) {
      const cached = sprites.get(key);
      sprites.delete(key);
      sprites.set(key, cached);
      return cached;
    }
    const palette = faction < 0 ? PALETTES.hostile : PALETTES.ally;
    const faces = visibleFaces(buildMesh(chassisId, weaponId, kitId, gait), heading * TAU / ANGLES, palette);
    const canvas = document.createElement("canvas");
    canvas.width = SPRITE_WIDTH * DENSITY;
    canvas.height = SPRITE_HEIGHT * DENSITY;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(DENSITY, 0, 0, DENSITY, ORIGIN_X * DENSITY, ORIGIN_Y * DENSITY);
    ctx.lineJoin = "round";
    for (const { points, paint, emissive } of faces) {
      ctx.beginPath();
      ctx.moveTo(...points[0]);
      for (const point of points.slice(1)) ctx.lineTo(...point);
      ctx.closePath();
      ctx.fillStyle = paint;
      ctx.fill();
      ctx.lineWidth = emissive ? .23 : .49;
      ctx.strokeStyle = emissive ? paint : OUTLINE;
      ctx.stroke();
    }
    if (sprites.size >= MAX_SPRITES) sprites.delete(sprites.keys().next().value);
    sprites.set(key, canvas);
    return canvas;
  }

  function draw(ctx, unit, x, y, scale, still = false) {
    ctx.drawImage(sprite(unit, still), x - ORIGIN_X * scale, y - ORIGIN_Y * scale,
      SPRITE_WIDTH * scale, SPRITE_HEIGHT * scale);
  }

  function muzzle(unit, still) {
    const { chassisId, weaponId, direction } = unit;
    const profile = PROFILES[chassisId];
    const gait = gaitIndex(unit, still);
    const bob = chassisId !== 2 && gait > 0 ? -.85 * (1 + Math.cos((gait - 1) * TAU * 2 / WALK_FRAMES)) : 0;
    const gun = mount(profile, chassisId, weaponId, profile.deck + bob);
    return screen(camera(angleIndex(direction) * TAU / ANGLES)([gun.front, gun.side, gun.height]));
  }

  function preview(canvas, chassisId, weaponId, kitId) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.ellipse(canvas.width * .47, 104, 62, 17, 0, 0, TAU);
    ctx.fillStyle = "#0c1822a0";
    ctx.fill();
    ctx.strokeStyle = "#639c9a45";
    ctx.stroke();
    draw(ctx, { faction: 1, chassisId, weaponId, kitId, direction: .2 }, canvas.width * .47, 98, 2.50, true);
  }

  return { draw, muzzle, preview, profile: (id) => PROFILES[id] };
})();
