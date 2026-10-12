/**
 * Talking to Discord. Discord sends slash commands and button clicks to
 * /api/discord as signed HTTP requests, so the bot needs no always-on process;
 * the site answers through Discord's REST API with the bot token.
 */
import { createPublicKey, verify } from "node:crypto";

export const discordConfig = () => ({
  appId: (process.env.DISCORD_APP_ID ?? "").trim(),
  publicKey: (process.env.DISCORD_PUBLIC_KEY ?? "").trim(),
  botToken: (process.env.DISCORD_BOT_TOKEN ?? "").trim(),
  guildId: (process.env.DISCORD_GUILD_ID ?? "").trim(),
  /** Where scheduled sign-ups are posted. */
  channelId: (process.env.DISCORD_CHANNEL_ID ?? "").trim(),
  /** Where the Sunday import summary goes; defaults to the weeklies channel. */
  logChannelId: (process.env.DISCORD_LOG_CHANNEL_ID ?? process.env.DISCORD_CHANNEL_ID ?? "").trim(),
});

// DER prefix that turns a raw 32-byte Ed25519 key into an SPKI public key.
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");

/** Discord signs every request with the application's public key; anything unsigned is refused. */
export function verifySignature(publicKeyHex: string, signatureHex: string | null, timestamp: string | null, body: string): boolean {
  if (!publicKeyHex || !signatureHex || !timestamp || !/^[0-9a-f]{64}$/i.test(publicKeyHex) || !/^[0-9a-f]{128}$/i.test(signatureHex)) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI, Buffer.from(publicKeyHex, "hex")]), format: "der", type: "spki" });
    return verify(null, Buffer.from(timestamp + body), key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

export class DiscordError extends Error {}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (url, init) => fetch(url, init);
/** Tests swap in a fake Discord. */
export function setDiscordFetch(f: Fetcher | null) { fetcher = f ?? ((url, init) => fetch(url, init)); }

const BASE = "https://discord.com/api/v10";

async function call(method: string, path: string, body?: unknown, auth = true): Promise<unknown> {
  const { botToken } = discordConfig();
  if (auth && !botToken) throw new DiscordError("DISCORD_BOT_TOKEN is not set");
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetcher(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bot ${botToken}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 429 && attempt < 2) {
      const wait = Number((await res.json().catch(() => ({})) as { retry_after?: number }).retry_after ?? 1);
      await new Promise((r) => setTimeout(r, Math.min(5, wait) * 1000));
      continue;
    }
    if (!res.ok) throw new DiscordError(`Discord answered ${res.status} to ${method} ${path.replace(/\/webhooks\/\d+\/[^/]+/, "/webhooks/…")}: ${(await res.text()).slice(0, 300)}`);
    return res.status === 204 ? null : res.json();
  }
  throw new DiscordError("Discord kept rate limiting");
}

export interface MessageBody {
  content?: string;
  embeds?: unknown[];
  components?: unknown[];
  flags?: number;
  allowed_mentions?: { parse?: string[]; users?: string[] };
}

/** Mentions show as names without pinging anyone, unless a message lists who to ping. */
const quiet = (b: MessageBody): MessageBody => ({ allowed_mentions: { parse: [] }, ...b });

export const postMessage = async (channelId: string, body: MessageBody) =>
  (await call("POST", `/channels/${channelId}/messages`, quiet(body))) as { id: string; channel_id: string };
export const editMessage = (channelId: string, messageId: string, body: MessageBody) =>
  call("PATCH", `/channels/${channelId}/messages/${messageId}`, quiet(body));

/** Replace the deferred reply (or, after a button click, the message the button is on). */
export const editOriginal = (token: string, body: MessageBody) =>
  call("PATCH", `/webhooks/${discordConfig().appId}/${token}/messages/@original`, quiet(body), false);
/** A further reply to an interaction; flags 64 makes it visible only to the person who clicked. */
export const followUp = (token: string, body: MessageBody) =>
  call("POST", `/webhooks/${discordConfig().appId}/${token}`, quiet(body), false);

export const registerGuildCommands = (commands: unknown[]) => {
  const { appId, guildId } = discordConfig();
  if (!appId || !guildId) throw new DiscordError("Set DISCORD_APP_ID and DISCORD_GUILD_ID");
  return call("PUT", `/applications/${appId}/guilds/${guildId}/commands`, commands);
};

export const EPHEMERAL = 64;
