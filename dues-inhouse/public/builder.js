/* Team builder: the same search as overtime/balance.py, run in the browser.
   Keep the two in step; tests/test_builder_js.py checks they agree. */
(function () {
  "use strict";
  const ROLES = ["tank", "damage", "support"];
  const LABEL = { tank: "Tank", damage: "Damage", support: "Support" };
  const SHORT = { tank: "T", damage: "D", support: "S" };
  const MU = 25, SIGMA = 25 / 3, BETA = MU / 6;
  const PREFERENCE_COST = 1.0;

  function erf(x) {
    // Abramowitz and Stegun 7.1.26, accurate to about 1e-7.
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

  /* signups: [{player, roles: [...] in preference order}]
     ratings: {name: {overall: [mu, sigma], roles: {role: [mu, sigma]}}} */
  function balance(signups, ratings, top = 3) {
    if (signups.length !== 10) throw new Error("need exactly 10 players");
    const names = signups.map(s => s.player);
    const pref = Object.fromEntries(signups.map(s => [s.player, s.roles]));
    const skill = (p, role) => {
      const r = ratings[p] || {};
      return (r.roles && r.roles[role]) || r.overall || [MU, SIGMA];
    };
    const can = (p, role) => pref[p].includes(role);
    const results = [];
    for (const tanks of combinations(names.filter(p => can(p, "tank")), 2)) {
      const rest = names.filter(p => !tanks.includes(p));
      for (const dps of combinations(rest.filter(p => can(p, "damage")), 4)) {
        const sups = rest.filter(p => !dps.includes(p));
        if (!sups.every(p => can(p, "support"))) continue;
        for (const d1 of combinations(dps, 2)) {
          for (const s1 of combinations(sups, 2)) {
            const t1 = { tank: [tanks[0]], damage: d1, support: s1 };
            const t2 = { tank: [tanks[1]], damage: dps.filter(p => !d1.includes(p)), support: sups.filter(p => !s1.includes(p)) };
            const sk = t => ROLES.flatMap(r => t[r].map(p => skill(p, r)));
            const sk1 = sk(t1), sk2 = sk(t2);
            const gap = sk1.reduce((s, r) => s + r[0], 0) - sk2.reduce((s, r) => s + r[0], 0);
            let off = 0;
            for (const t of [t1, t2]) for (const r of ROLES) for (const p of t[r]) off += pref[p].indexOf(r);
            results.push({ score: Math.abs(gap) + PREFERENCE_COST * off, team1: t1, team2: t2, gap, off, sk1, sk2 });
          }
        }
      }
    }
    if (!results.length) throw new Error("no legal teams: need 2 players who can tank, 4 damage and 4 support");
    results.sort((a, b) => a.score - b.score);
    return results.slice(0, top).map(r => ({
      team1: r.team1, team2: r.team2, gap: r.gap, off_preference: r.off,
      win_probability: winProbability(r.sk1, r.sk2), score: r.score,
    }));
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { balance, winProbability };
    return;
  }

  /* ---------- page ---------- */
  const players = JSON.parse(document.getElementById("data").textContent);
  const ratings = Object.fromEntries(players.map(p => [p.name, p]));
  const picked = new Map(); // name -> roles in preference order
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
    label.append(box, document.createTextNode(p.name));
    const r = document.createElement("span");
    r.className = "r";
    r.textContent = p.rating == null ? "new" : p.rating.toLocaleString();
    label.append(r);
    const roles = document.createElement("div");
    roles.className = "roles";
    const buttons = ROLES.map(role => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.role = role;
      b.disabled = true;
      b.setAttribute("aria-pressed", "false");
      b.setAttribute("aria-label", `${p.name} can play ${LABEL[role]}`);
      b.addEventListener("click", () => {
        const current = picked.get(p.name);
        const i = current.indexOf(role);
        if (i >= 0) current.splice(i, 1); else current.push(role);
        paint();
      });
      roles.append(b);
      return b;
    });
    box.addEventListener("change", () => {
      if (box.checked) picked.set(p.name, p.usual.slice()); else picked.delete(p.name);
      paint();
    });
    function paint() {
      const current = picked.get(p.name);
      for (const b of buttons) {
        const i = current ? current.indexOf(b.dataset.role) : -1;
        b.disabled = !current;
        b.setAttribute("aria-pressed", String(i >= 0));
        b.textContent = SHORT[b.dataset.role] + (i >= 0 ? i + 1 : "");
        b.title = i >= 0 ? `${LABEL[b.dataset.role]}, choice ${i + 1}` : LABEL[b.dataset.role];
      }
      update();
    }
    li.append(label, roles);
    paint();
    return li;
  }

  function update() {
    const n = picked.size;
    const noRole = [...picked].filter(([, r]) => !r.length).map(([p]) => p);
    if (n !== 10) status.textContent = `${n} of 10 players picked.`;
    else if (noRole.length) status.textContent = `Give ${noRole.join(", ")} at least one role.`;
    else status.textContent = "Ready.";
    make.disabled = n !== 10 || noRole.length > 0;
  }

  function teamList(team, cls, title, win) {
    const div = document.createElement("div");
    div.className = cls;
    const h = document.createElement("h4");
    h.textContent = `${title}, ${Math.round(win * 100)}% to win`;
    const ul = document.createElement("ul");
    for (const role of ROLES) for (const p of team[role]) {
      const li = document.createElement("li");
      li.textContent = p;
      const s = document.createElement("span");
      s.textContent = LABEL[role];
      li.append(s);
      ul.append(li);
    }
    div.append(h, ul);
    return div;
  }

  function asText(o) {
    const line = t => ROLES.map(r => `${LABEL[r]}: ${t[r].join(", ")}`).join(" | ");
    return `Team 1 (blue): ${line(o.team1)}\nTeam 2 (red): ${line(o.team2)}`;
  }

  make.addEventListener("click", () => {
    options.textContent = "";
    let result;
    try {
      result = balance([...picked].map(([player, roles]) => ({ player, roles })), ratings);
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
      p.textContent = (gap === 0 ? "Evenly matched" : `${gap} rating points apart`) + ", " +
        (o.off_preference === 0 ? "everyone on their first-choice role." :
          `${o.off_preference} step${o.off_preference === 1 ? "" : "s"} away from first choices.`);
      const teams = document.createElement("div");
      teams.className = "teams";
      teams.append(teamList(o.team1, "t1", "Team 1", o.win_probability),
                   teamList(o.team2, "t2", "Team 2", 1 - o.win_probability));
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

  // Newcomers on the night: add them without editing players.csv first.
  document.getElementById("guest").addEventListener("submit", e => {
    e.preventDefault();
    const input = document.getElementById("guest-name");
    const name = input.value.trim();
    if (!name) return;
    if (ratings[name]) { status.textContent = `${name} is already on the list.`; return; }
    const p = { name, rating: null, overall: [MU, SIGMA], roles: {}, usual: ROLES.slice() };
    players.push(p);
    ratings[name] = p;
    const li = row(p);
    list.prepend(li);
    li.querySelector("input[type=checkbox]").click();
    input.value = "";
  });
})();
