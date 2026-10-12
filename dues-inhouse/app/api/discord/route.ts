import { after, NextResponse, type NextRequest } from "next/server";
import { discordConfig, verifySignature } from "@/lib/discord/api";
import { handleInteraction, type Interaction } from "@/lib/discord/interactions";

export const maxDuration = 60;

/**
 * Discord's Interactions Endpoint URL (Developer Portal > General Information).
 * Every request is signed; Discord itself checks this endpoint refuses bad
 * signatures before it will save the URL.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const ok = verifySignature(discordConfig().publicKey, req.headers.get("x-signature-ed25519"), req.headers.get("x-signature-timestamp"), body);
  if (!ok) return new NextResponse("invalid request signature", { status: 401 });
  let interaction: Interaction;
  try {
    interaction = JSON.parse(body);
  } catch {
    return new NextResponse("bad json", { status: 400 });
  }
  const { body: reply, later } = await handleInteraction(interaction);
  if (later) after(later); // runs once the reply is sent, inside Discord's 15-minute follow-up window
  return NextResponse.json(reply);
}
