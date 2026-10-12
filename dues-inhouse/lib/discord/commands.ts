/** The bot's slash commands, registered on the club's server by `npm run discord:register`. */
const STRING = 3, USER = 6, SUB = 1;

export const COMMANDS = [
  {
    name: "link",
    description: "Link your Riot ID (once). Then joining a weekly is one click.",
    options: [{ type: STRING, name: "riot_id", description: "Your Riot ID, like Name#TAG", required: true, max_length: 22 }],
  },
  {
    name: "rating",
    description: "Valorant weeklies rating and stats",
    options: [{ type: USER, name: "player", description: "Someone else (default: you)", required: false }],
  },
  {
    name: "weekly",
    description: "Run the Valorant weeklies",
    options: [
      { type: SUB, name: "open", description: "Officers: open sign-ups in this channel" },
      { type: SUB, name: "teams", description: "Officers: close sign-ups and make the first game's teams" },
      { type: SUB, name: "next", description: "Make the next game: new teams and a map vote" },
      { type: SUB, name: "end", description: "Officers: finish tonight's session" },
    ],
  },
];
