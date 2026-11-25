"use strict";

const EchoReplay = (() => {
  const { FACTION, WIDTH, HEIGHT, clamp } = EchoSim;
  const SIDE = FACTION.ally;
  const SAMPLE_INTERVAL = 1 / 15;
  const BEFORE = 4.5;
  const AFTER = 3.5;
  const MAX_CLIPS = 12;

  function capture(match, vision) {
    const visible = (point) => match.isVisible(SIDE, point);
    const sites = match.sites.map((site) => {
      const faction = match.observedFaction(SIDE, site);
      const known = site.faction === SIDE || visible(site);
      const gate = { x: site.gate.x, y: site.gate.y, faction: FACTION.neutral, progress: 0, contested: false };
      return {
        id: site.id, type: site.type, x: site.x, y: site.y, label: site.label, name: site.name,
        faction: faction ?? FACTION.neutral, knownFaction: faction,
        gate: known || visible(site.gate) ? { ...site.gate } : gate,
        hp: known ? site.hp : undefined, hull: site.hull,
        queue: known && site.queue?.length ? [{ ...site.queue[0] }] : [],
      };
    });
    const units = match.units.filter((unit) => unit.hp > 0 && match.canSeeEntity(SIDE, unit)).map((unit) => ({
      ...unit, weaponCooldowns: unit.weaponCooldowns.slice(), path: [], order: { kind: "hold" },
    }));
    const pads = match.pads.filter((pad) => pad.faction === SIDE || visible(pad)).map((pad) =>
      ({ x: pad.x, y: pad.y, faction: pad.faction, turret: pad.turret ? { ...pad.turret } : null }));
    const effects = match.effects.filter((effect) => visible(effect) &&
      (effect.type !== "shot" || visible({ x: effect.tx, y: effect.ty }))).map((effect) => ({ ...effect }));
    return {
      terrain: match.terrain, fogOfWar: match.fogOfWar, sight: vision,
      time: match.time, sites, units, pads, effects,
      bases: sites.filter((site) => site.type === "base"),
      facilities: sites.filter((site) => site.type === "factory" || site.type === "outpost"),
      nodes: sites.filter((site) => !site.type),
      news: match.news.slice(0, 4),
      scan: match.scans[SIDE],
      canSeeEntity(faction, object) { return object.faction === faction || this.isVisible(faction, object); },
      isVisible(_faction, point) {
        const x = clamp(Math.round(point.x), 0, WIDTH - 1);
        const y = clamp(Math.round(point.y), 0, HEIGHT - 1);
        return !this.sight || this.sight[y * WIDTH + x] === 2;
      },
      observedFaction(_faction, site) { return site.knownFaction; },
      sightFor() { return this.sight; },
      scanFor() { return this.scan; },
      allies() { return []; },
      entities() { return [...this.units, ...this.bases, ...this.pads.map((pad) => pad.turret)].filter((item) => item?.hp > 0); },
    };
  }

  class Recorder {
    constructor() {
      this.clips = [];
      this.buffer = [];
      this.lastTime = -Infinity;
      this.lastEvent = 0;
      this.visionVersion = -1;
      this.vision = null;
    }

    record(match) {
      const events = match.news.filter((event) => event.id > this.lastEvent && event.replay && event.point).reverse();
      this.lastEvent = match.news[0]?.id ?? this.lastEvent;
      if (!events.length && !match.winner && match.time - this.lastTime < SAMPLE_INTERVAL - .001) return;
      if (match.time === this.lastTime) return;
      if (match.fogOfWar && this.visionVersion !== match.visionVersion) {
        this.visionVersion = match.visionVersion;
        this.vision = match.vision[SIDE].slice();
      }
      const frame = capture(match, this.vision);
      this.lastTime = match.time;
      this.buffer.push(frame);
      while (this.buffer.length > 1 && this.buffer[1].time < frame.time - BEFORE) this.buffer.shift();
      for (const clip of this.clips) if (frame.time <= clip.event.time + AFTER) clip.frames.push(frame);
      for (const event of events) {
        const repeatedRaid = event.replay === "raid" && this.clips.some((clip) =>
          clip.event.replay === "raid" && event.time - clip.event.time < 3 &&
          Math.hypot(clip.event.point.x - event.point.x, clip.event.point.y - event.point.y) < .1);
        if (repeatedRaid) continue;
        if (this.clips.length >= MAX_CLIPS) {
          const counts = this.clips.reduce((all, clip) => all.set(clip.event.replay, (all.get(clip.event.replay) ?? 0) + 1), new Map());
          const max = Math.max(...counts.values());
          this.clips.splice(this.clips.findIndex((clip) => counts.get(clip.event.replay) === max), 1);
        }
        this.clips.push({ event, frames: this.buffer.slice() });
      }
    }
  }

  function frameAt(clip, time) {
    const frames = clip.frames;
    const later = frames.findIndex((frame) => frame.time > time);
    if (later < 0) return frames.at(-1);
    if (!later) return frames[0];
    const a = frames[later - 1];
    const b = frames[later];
    const mix = (time - a.time) / (b.time - a.time);
    const units = a.units.map((unit) => {
      const next = b.units.find((candidate) => candidate.id === unit.id);
      if (!next) return unit;
      return { ...unit, x: unit.x + (next.x - unit.x) * mix, y: unit.y + (next.y - unit.y) * mix,
        foot: unit.foot + (next.foot - unit.foot) * mix };
    });
    return { ...a, time, units };
  }

  return { Recorder, frameAt };
})();
