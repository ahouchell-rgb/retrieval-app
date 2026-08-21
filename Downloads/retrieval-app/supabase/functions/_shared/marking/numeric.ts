// Conservative, dimension-aware numerical shortcut shared by the authenticated
// and anonymous retrieval markers. It deliberately returns false when a value or
// unit is ambiguous; those answers continue to the normal AI marker.

type UnitDef = { dimension: string; factor: number };
type Quantity = { value: number; dimension: string };

const UNITS: Record<string, UnitDef> = {
  "": { dimension: "ratio", factor: 1 },
  "%": { dimension: "ratio", factor: 0.01 },

  m: { dimension: "length", factor: 1 }, metre: { dimension: "length", factor: 1 }, metres: { dimension: "length", factor: 1 },
  cm: { dimension: "length", factor: 1e-2 }, mm: { dimension: "length", factor: 1e-3 }, km: { dimension: "length", factor: 1e3 },

  "m2": { dimension: "area", factor: 1 }, "cm2": { dimension: "area", factor: 1e-4 }, "mm2": { dimension: "area", factor: 1e-6 }, "km2": { dimension: "area", factor: 1e6 },
  "m3": { dimension: "volume", factor: 1 }, "cm3": { dimension: "volume", factor: 1e-6 }, "dm3": { dimension: "volume", factor: 1e-3 },
  l: { dimension: "volume", factor: 1e-3 }, litre: { dimension: "volume", factor: 1e-3 }, litres: { dimension: "volume", factor: 1e-3 }, ml: { dimension: "volume", factor: 1e-6 },

  kg: { dimension: "mass", factor: 1 }, g: { dimension: "mass", factor: 1e-3 }, mg: { dimension: "mass", factor: 1e-6 },
  s: { dimension: "time", factor: 1 }, sec: { dimension: "time", factor: 1 }, second: { dimension: "time", factor: 1 }, seconds: { dimension: "time", factor: 1 },
  min: { dimension: "time", factor: 60 }, minute: { dimension: "time", factor: 60 }, minutes: { dimension: "time", factor: 60 },
  h: { dimension: "time", factor: 3600 }, hour: { dimension: "time", factor: 3600 }, hours: { dimension: "time", factor: 3600 },

  n: { dimension: "force", factor: 1 }, kn: { dimension: "force", factor: 1e3 },
  j: { dimension: "energy", factor: 1 }, kj: { dimension: "energy", factor: 1e3 }, mj: { dimension: "energy", factor: 1e6 },
  w: { dimension: "power", factor: 1 }, kw: { dimension: "power", factor: 1e3 },
  pa: { dimension: "pressure", factor: 1 }, kpa: { dimension: "pressure", factor: 1e3 }, mpa: { dimension: "pressure", factor: 1e6 },
  v: { dimension: "voltage", factor: 1 }, mv: { dimension: "voltage", factor: 1e-3 }, kv: { dimension: "voltage", factor: 1e3 },
  a: { dimension: "current", factor: 1 }, ma: { dimension: "current", factor: 1e-3 },
  c: { dimension: "charge", factor: 1 }, mc: { dimension: "charge", factor: 1e-3 },
  hz: { dimension: "frequency", factor: 1 }, khz: { dimension: "frequency", factor: 1e3 },
  "m/s": { dimension: "speed", factor: 1 }, "ms-1": { dimension: "speed", factor: 1 }, "m/s2": { dimension: "acceleration", factor: 1 }, "ms-2": { dimension: "acceleration", factor: 1 },
  "kg/m3": { dimension: "density", factor: 1 }, "g/cm3": { dimension: "density", factor: 1e3 },
  "°c": { dimension: "celsius", factor: 1 }, celsius: { dimension: "celsius", factor: 1 },
  k: { dimension: "kelvin", factor: 1 }, kelvin: { dimension: "kelvin", factor: 1 },
};

const NUMBER = String.raw`[+-]?(?:(?:\d{1,3}(?:,\d{3})+)|(?:\d+(?:\.\d*)?)|(?:\.\d+))`;
const FRACTION = String.raw`[+-]?\d+\s*\/\s*[+-]?\d+`;
const SCIENTIFIC = String.raw`${NUMBER}\s*(?:[x×*]\s*10\s*\^\s*[+-]?\d+|e[+-]?\d+)`;
const VALUE = `(?:${FRACTION}|${SCIENTIFIC}|${NUMBER})`;

function normaliseUnit(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, "")
    .replace(/[·⋅]/g, "*")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/\^([23])/g, "$1")
    .replace(/s\^?-([12])/gi, "s-$1")
    .toLowerCase();
}

function parseValue(raw: string): number | null {
  const compact = raw.replace(/,/g, "").replace(/\s+/g, "").replace(/×/g, "x");
  if (/^[+-]?\d+\/[+-]?\d+$/.test(compact)) {
    const [a, b] = compact.split("/").map(Number);
    return b === 0 ? null : a / b;
  }
  const standard = compact.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:x10\^([+-]?\d+)|e([+-]?\d+))$/i);
  if (standard) {
    const exponent = Number(standard[2] ?? standard[3]);
    const value = Number(standard[1]) * (10 ** exponent);
    return Number.isFinite(value) ? value : null;
  }
  const value = Number(compact);
  return Number.isFinite(value) ? value : null;
}

export function parseStrictQuantity(text: string): Quantity | null {
  // Permit only harmless answer framing. Explanations, ranges, tolerances and
  // multiple quantities stay on the AI path.
  const cleaned = String(text || "")
    .trim()
    .replace(/[−–]/g, "-")
    .replace(/(?<=\d)\s+(?=\d{3}(?:\D|$))/g, "")
    .replace(/^(?:the\s+answer\s+is|it\s+is|answer\s*:?|=)\s*/i, "")
    .replace(/[.!]\s*$/, "")
    .trim();
  const match = cleaned.match(new RegExp(String.raw`^(${VALUE})\s*([a-zA-Z°%]+(?:\s*(?:\/|\*|\^?-)\s*[a-zA-Z0-9]+)?|[a-zA-Z°%]+[²³]?)?$`, "i"));
  if (!match) return null;
  const number = parseValue(match[1]);
  if (number === null) return null;
  const unitKey = normaliseUnit(match[2] || "");
  const unit = UNITS[unitKey];
  if (!unit) return null;
  return { value: number * unit.factor, dimension: unit.dimension };
}

export function checkNumericalMatch(modelAnswer: string, studentAnswer: string): boolean {
  const model = parseStrictQuantity(modelAnswer);
  const student = parseStrictQuantity(studentAnswer);
  if (!model || !student || model.dimension !== student.dimension) return false;
  const scale = Math.max(1, Math.abs(model.value), Math.abs(student.value));
  return Math.abs(model.value - student.value) <= 1e-12 * scale;
}
