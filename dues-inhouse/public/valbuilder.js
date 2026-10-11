/* Valorant team builder: split ten players into the two most even teams of five.
   There are no role slots, so every one of the 126 splits is checked.
   Score = rating gap (in mu) + CONTROLLER_COST for each side with no controller
   main, counted only when the lobby has two or more. Lowest wins.
   tests/test_valbuilder_js.py checks the search. */
(function () {
  "use strict";
  const MU = 25, SIGMA = 25 / 3, BETA = MU / 6;
  const CONTROLLER_COST = 1.0; // in mu, worth 40 points on the displayed rating scale
  const CLASS = { duelist: "Duelist", initiator: "Initiator", controller: "Controller", sentinel: "Sentinel" };

  function erf(x) {
    const s = Math.sign(x); x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }

  function winProbability(a, b) {
    const sum = (t, i) => t.reduce((acc, r) => acc + r[i], 0);
    const v = 2 * BETA * BETA + a.reduce((s, r) => s + r[1] * r[1], 0) + b.reduce((s, r) => s + r[1] * r[1], 0);
    return 0.5 * (1 + erf((sum(a, 0) - sum(b, 0)) / Math.sqrt(2 * v)));
  }

  function* combinations(items, k, start = 0, chosen = []) {
    if (chosen.length === k) { yield chosen.slice(); return; }
    for (let i = start; i < items.length; i++) {
      chosen.push(items[i]);
      yield* combinations(items, k, i + 1, chosen);
      chosen.pop();
    }
  }

  /* names: ten player names; ratings: {name: {overall: [mu, sigma], cls: "controller" | ...}} */
  function balance(names, ratings, top = 3) {
    if (names.length !== 10) throw new Error("need exactly 10 players");
    if (new Set(names).size !== 10) throw new Error("a player is listed twice");
    const skill = p => (ratings[p] && ratings[p].overall) || [MU, SIGMA];
    const smokes = p => !!(ratings[p] && ratings[p].cls === "controller");
    const spread = names.filter(smokes).length >= 2;
    const results = [];
    // The first player always goes in team 1, which removes mirror-image duplicates.
    for (const rest of combinations(names.slice(1), 4)) {
      const team1 = [names[0], ...rest];
      const team2 = names.filter(p => !team1.includes(p));
      const sk1 = team1.map(skill), sk2 = team2.map(skill);
      const gap = sk1.reduce((s, r) => s + r[0], 0) - sk2.reduce((s, r) => s + r[0], 0);
      const missing = spread ? [team1, team2].filter(t => !t.some(smokes)).length : 0;
      results.push({ team1, team2, gap, sk1, sk2, score: Math.abs(gap) + CONTROLLER_COST * missing });
    }
    results.sort((a, b) => a.score - b.score);
    return results.slice(0, top).map(r => ({
      team1: r.team1, team2: r.team2, gap: r.gap, score: r.score, win_probability: winProbability(r.sk1, r.sk2),
    }));
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { balance, winProbability };
    return;
  }

  /* ---------- page ---------- */
  const players = JSON.parse(document.getElementById("data").textContent);
  const byName = Object.fromEntries(players.map(p => [p.name, p]));
  const picked = new Set();
  const list = document.getElementById("players");
  const status = document.getElementById("status");
  const make = document.getElementById("make");
  const options = document.getElementById("options");
  const find = document.getElementById("find");

  function row(p) {
    const li = document.createElement("li");
    li.dataset.name = p.name.toLowerCase();
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = p.name;
    if (p.cls) {
      const c = document.createElement("span");
      c.className = "cls-line";
      c.textContent = `${CLASS[p.cls]}${p.agents.length ? ": " + p.agents.join(", ") : ""}`;
      who.append(c);
    }
    const r = document.createElement("span");
    r.className = "r";
    r.textContent = p.rating == null ? "new" : p.rating.toLocaleString();
    label.append(box, who, r);
    box.addEventListener("change", () => {
      if (box.checked) picked.add(p.name); else picked.delete(p.name);
      update();
    });
    li.append(label);
    return li;
  }

  function update() {
    const n = picked.size;
    status.textContent = n === 10 ? "Ready." : `${n} of 10 players picked.`;
    make.disabled = n !== 10;
  }

  function teamList(team, cls, title, win) {
    const div = document.createElement("div");
    div.className = cls;
    const h = document.createElement("h4");
    h.textContent = `${title}, ${Math.round(win * 100)}% to win`;
    const ul = document.createElement("ul");
    for (const name of team) {
      const li = document.createElement("li");
      li.textContent = name;
      const p = byName[name];
      if (p && p.cls) {
        const s = document.createElement("span");
        s.textContent = CLASS[p.cls];
        li.append(s);
      }
      ul.append(li);
    }
    div.append(h, ul);
    return div;
  }

  // Inhouse lobbies pick agents on the night; this only flags a side with nobody who usually smokes.
  function note(o) {
    const missing = [["Blue", o.team1], ["Red", o.team2]]
      .filter(([, t]) => t.some(p => byName[p] && byName[p].cls) && !t.some(p => byName[p] && byName[p].cls === "controller"))
      .map(([side]) => side);
    return missing.length ? ` ${missing.join(" and ")} ${missing.length > 1 ? "have" : "has"} nobody who mainly plays controller.` : "";
  }

  function asText(o) {
    return `Blue: ${o.team1.join(", ")}\nRed: ${o.team2.join(", ")}`;
  }

  make.addEventListener("click", () => {
    options.textContent = "";
    let result;
    try {
      result = balance([...picked], byName);
    } catch (e) {
      status.textContent = e.message.charAt(0).toUpperCase() + e.message.slice(1) + ".";
      return;
    }
    result.forEach((o, i) => {
      const card = document.createElement("article");
      card.className = "option";
      const h = document.createElement("h3");
      h.textContent = `Option ${i + 1}`;
      const p = document.createElement("p");
      const gap = Math.round(Math.abs(o.gap) * 40);
      p.textContent = (gap === 0 ? "Evenly matched." : `${gap} rating points apart.`) + note(o);
      const teams = document.createElement("div");
      teams.className = "teams";
      teams.append(teamList(o.team1, "t1", "Blue", o.win_probability),
                   teamList(o.team2, "t2", "Red", 1 - o.win_probability));
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "copy";
      copy.textContent = "Copy teams";
      copy.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(asText(o)); copy.textContent = "Copied"; }
        catch { copy.textContent = "Copy failed; select the names instead"; }
      });
      card.append(h, p, teams, copy);
      options.append(card);
    });
  });

  find.addEventListener("input", () => {
    const q = find.value.trim().toLowerCase();
    for (const li of list.children) li.hidden = q !== "" && !li.dataset.name.includes(q);
  });

  players.forEach(p => list.append(row(p)));
  update();

  document.getElementById("guest").addEventListener("submit", e => {
    e.preventDefault();
    const input = document.getElementById("guest-name");
    const name = input.value.trim();
    if (!name) return;
    if (byName[name]) { status.textContent = `${name} is already on the list.`; return; }
    const p = { name, rating: null, overall: [MU, SIGMA], cls: null, agents: [] };
    players.push(p);
    byName[name] = p;
    const li = row(p);
    list.prepend(li);
    li.querySelector("input[type=checkbox]").click();
    input.value = "";
  });
})();
