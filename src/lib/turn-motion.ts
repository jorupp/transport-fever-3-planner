/** Constant-acceleration routes with equally spaced turns. SI units throughout. */
export function createTurnJourney(distance: number, turns: number, acceleration: number, braking: number, ceiling: number) {
  const count = turns + 1, length = distance / count;
  function segment(entry: number, final: boolean) {
    // At an intermediate boundary, exit speed is half the actual pre-braking
    // peak. Solve acceleration + braking distances before adding any cruise.
    const ratio = final ? 0 : .5;
    const speed = Math.min(ceiling, Math.sqrt((2 * length + entry * entry / acceleration)
      / (1 / acceleration + (1 - ratio * ratio) / braking)));
    const exit = ratio * speed;
    const accelerationTime = (speed - entry) / acceleration;
    const accelerationDistance = (speed * speed - entry * entry) / (2 * acceleration);
    const brakingTime = (speed - exit) / braking;
    const brakingDistance = (speed * speed - exit * exit) / (2 * braking);
    const cruiseDistance = Math.max(0, length - accelerationDistance - brakingDistance);
    const cruiseTime = cruiseDistance / speed;
    return { entry, exit, speed, accelerationTime, accelerationDistance, brakingTime, brakingDistance,
      cruiseTime, cruiseDistance, time: accelerationTime + cruiseTime + brakingTime };
  }
  type Section = ReturnType<typeof segment> & { startTime: number; startDistance: number; repeat: number; index: number };
  const sections: Section[] = [];
  let entry = 0, elapsed = 0, position = 0, index = 0;
  while (index < count) {
    const current = segment(entry, index === turns);
    // Equal segments converge to the same entry/exit speed. Pack the steady
    // middle instead of iterating millions of turns or allocating per turn.
    const repeat = index < turns && Math.abs(current.exit - entry) <= Math.max(1, entry) * 1e-13 ? turns - index : 1;
    sections.push({ ...current, startTime: elapsed, startDistance: position, repeat, index });
    elapsed += current.time * repeat; position += length * repeat;
    entry = current.exit; index += repeat;
  }
  const sum = (key: "accelerationTime" | "accelerationDistance" | "brakingTime" | "brakingDistance" | "cruiseTime" | "cruiseDistance") =>
    sections.reduce((total, section) => total + section[key] * section.repeat, 0);
  const trip = { time: elapsed, speed: Math.max(...sections.map(s => s.speed)),
    accelerationTime: sum("accelerationTime"), accelerationDistance: sum("accelerationDistance"),
    brakingTime: sum("brakingTime"), brakingDistance: sum("brakingDistance"),
    cruiseTime: sum("cruiseTime"), cruiseDistance: sum("cruiseDistance") };
  function sampleAtTime(seconds: number) {
    const time = Math.max(0, Math.min(seconds, elapsed));
    const section = sections.find(s => time < s.startTime + s.time * s.repeat) ?? sections[sections.length - 1];
    const repetition = Math.min(section.repeat - 1, Math.floor(Math.max(0, time - section.startTime) / section.time));
    const local = time - section.startTime - repetition * section.time;
    let speed: number, x: number, a: number, phase: string;
    if (time >= elapsed) { speed = 0; x = length; a = 0; phase = "Stopped"; }
    else if (local < section.accelerationTime) {
      speed = section.entry + acceleration * local;
      x = section.entry * local + acceleration * local * local / 2;
      a = acceleration; phase = "Constant estimate";
    } else if (local < section.accelerationTime + section.cruiseTime) {
      speed = section.speed; x = section.accelerationDistance + (local - section.accelerationTime) * speed;
      a = 0; phase = "Cruising";
    } else {
      const dt = local - section.accelerationTime - section.cruiseTime;
      speed = section.speed - braking * dt;
      x = section.accelerationDistance + section.cruiseDistance + section.speed * dt - braking * dt * dt / 2;
      a = -braking; phase = section.index + repetition < turns ? "Braking for turn" : "Braking";
    }
    return { time, speed: speed * 3.6, distance: time >= elapsed ? distance : section.startDistance + repetition * length + x,
      acceleration: a, phase, segment: section.index + repetition + 1, drivingForce: 0, powerUsed: 0, netForce: 0 };
  }
  return { trip, sections, sampleAtTime };
}
