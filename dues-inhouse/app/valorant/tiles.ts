import type { TileMap } from "@/components/ui";
import type { valMatchView } from "@/lib/views";

export function valTile(v: ReturnType<typeof valMatchView>): TileMap {
  const m = v.map;
  return { href: `/valorant/matches/${encodeURIComponent(m.id)}`, mapName: m.mapName, score: m.score, winner: m.winner,
    complete: true, meta: `${m.rounds} rounds${m.source === "manual" ? ", typed in" : ""}`, playedAt: m.playedAt, upset: v.upset, teamNames: ["Blue", "Red"] };
}
