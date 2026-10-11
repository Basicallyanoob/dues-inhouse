import type { TileMap } from "@/components/ui";
import type { owMatchView } from "@/lib/views";

export function owTile(v: ReturnType<typeof owMatchView>): TileMap {
  const m = v.map;
  return { href: `/overwatch/matches/${encodeURIComponent(m.id)}`, mapName: m.mapName, score: m.score, winner: m.winner,
    complete: m.complete, meta: m.mapType || "Map", playedAt: m.playedAt, upset: v.upset, teamNames: m.teamNames };
}
