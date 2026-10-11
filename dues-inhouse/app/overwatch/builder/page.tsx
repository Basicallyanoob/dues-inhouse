import { ScriptMount } from "@/components/ScriptMount";
import { getSite } from "@/lib/season";
import { owBuilderData } from "@/lib/views";

export const metadata = { title: "Overwatch team builder" };

export default async function OwBuilder() {
  const data = JSON.stringify(owBuilderData(await getSite())).replace(/</g, "\\u003c");
  return (
    <>
      <section className="intro">
        <h1>Team builder</h1>
        <p className="lede">Tick the ten players in tonight&apos;s lobby. Each starts with the roles they usually play, in order of preference; select a role to add or remove it, and the order you select them in becomes the order of preference. Every legal 1-2-2 split is checked and the three most even are shown. Players with no maps yet count as average.</p>
      </section>
      <div className="builder">
        <section className="picker" aria-label="Players">
          <label className="search"><span className="sr">Find a player</span><input type="search" id="find" placeholder="Find a player" autoComplete="off" /></label>
          <ul id="players" className="pick-list" />
          <form id="guest" className="guest">
            <label htmlFor="guest-name">Someone not on the list</label>
            <span><input id="guest-name" type="text" autoComplete="off" placeholder="Their name" /><button type="submit">Add</button></span>
          </form>
        </section>
        <section className="result" aria-live="polite">
          <p id="status" className="status">Pick 10 players.</p>
          <button id="make" type="button" disabled>Make teams</button>
          <div id="options" />
        </section>
      </div>
      <script id="data" type="application/json" dangerouslySetInnerHTML={{ __html: data }} />
      <ScriptMount src="/builder.js" marker="players" />
    </>
  );
}
