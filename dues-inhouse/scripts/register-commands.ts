/**
 * Registers the bot's slash commands on the club's Discord server. Run once,
 * and again whenever lib/discord/commands.ts changes:
 *   npm run discord:register
 * Reads DISCORD_APP_ID, DISCORD_GUILD_ID and DISCORD_BOT_TOKEN from .env.local
 * or the environment. Server commands update instantly (global ones take an hour).
 */
import { registerGuildCommands } from "../lib/discord/api";
import { COMMANDS } from "../lib/discord/commands";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: use the environment as it is.
}

const result = (await registerGuildCommands(COMMANDS)) as { name: string }[];
console.log(`Registered ${result.length} commands: ${result.map((c) => `/${c.name}`).join(", ")}`);
