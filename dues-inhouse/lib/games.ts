/** Hero roles and agent classes, read from config/heroes.yaml and config/agents.yaml. */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export const OW_ROLES = ["tank", "damage", "support"] as const;
export type OwRole = (typeof OW_ROLES)[number];
export const ROLE_LABEL: Record<OwRole, string> = { tank: "Tank", damage: "Damage", support: "Support" };

export const VAL_CLASSES = ["duelist", "initiator", "controller", "sentinel"] as const;
export type ValClass = (typeof VAL_CLASSES)[number];
export const CLASS_LABEL: Record<ValClass, string> = {
  duelist: "Duelist", initiator: "Initiator", controller: "Controller", sentinel: "Sentinel",
};

export const GAMES = ["overwatch", "valorant"] as const;
export type Game = (typeof GAMES)[number];
export const GAME_LABEL: Record<Game, string> = { overwatch: "Overwatch", valorant: "Valorant" };
export function isGame(x: string): x is Game {
  return (GAMES as readonly string[]).includes(x);
}

function readYaml(file: string): Record<string, unknown> {
  const p = path.join(process.cwd(), "config", file);
  return fs.existsSync(p) ? (YAML.parse(fs.readFileSync(p, "utf8")) ?? {}) : {};
}

export class HeroRoles {
  constructor(
    readonly current: Map<string, OwRole>,
    readonly before: Map<string, { from: string; was: OwRole }[]>,
  ) {}

  get(hero: string): OwRole | undefined {
    return this.current.get(hero);
  }

  /** The role a hero had on a given day (YYYY-MM-DD), for heroes that changed role. */
  on(hero: string, day: string): OwRole | undefined {
    const changes = [...(this.before.get(hero) ?? [])].sort((a, b) => a.from.localeCompare(b.from));
    for (const c of changes) if (day < c.from) return c.was;
    return this.current.get(hero);
  }
}

let heroCache: HeroRoles | null = null;
export function heroRoles(): HeroRoles {
  if (heroCache) return heroCache;
  const data = readYaml("heroes.yaml");
  const current = new Map<string, OwRole>();
  const before = new Map<string, { from: string; was: OwRole }[]>();
  for (const [key, value] of Object.entries(data)) {
    if (key === "role_changes") {
      for (const ch of (value as { hero: string; was: string; from: string | Date }[]) ?? []) {
        const from = ch.from instanceof Date ? ch.from.toISOString().slice(0, 10) : String(ch.from);
        const list = before.get(String(ch.hero)) ?? [];
        list.push({ from, was: String(ch.was).toLowerCase() as OwRole });
        before.set(String(ch.hero), list);
      }
      continue;
    }
    if (!(OW_ROLES as readonly string[]).includes(key)) throw new Error(`heroes.yaml: unknown role '${key}'`);
    for (const hero of (value as string[]) ?? []) current.set(String(hero), key as OwRole);
  }
  return (heroCache = new HeroRoles(current, before));
}

let agentCache: Map<string, ValClass> | null = null;
export function agentClasses(): Map<string, ValClass> {
  if (agentCache) return agentCache;
  const data = readYaml("agents.yaml");
  const out = new Map<string, ValClass>();
  for (const [key, value] of Object.entries(data)) {
    if (!(VAL_CLASSES as readonly string[]).includes(key)) throw new Error(`agents.yaml: unknown class '${key}'`);
    for (const a of (value as string[]) ?? []) out.set(String(a), key as ValClass);
  }
  return (agentCache = out);
}
