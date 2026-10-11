import { ScriptMount } from "@/components/ScriptMount";
import { getSite } from "@/lib/season";
import { valBuilderData } from "@/lib/views";

export const metadata = { title: "Valorant team builder" };

export default async function ValBuilder() {
  const data = JSON.stringify(valBuilderData(await getSite())).replace(/</g, "\\u003c");
  return (
    <>
      <section className="intro">
        <h1>Team builder</h1>
        <p className="lede">Tick the ten players in tonight&apos;s lobby. Every way of splitting them into two fives is checked, and the three closest by rating are shown. Agents are picked in the lobby, but when two or more players mainly play controller, the builder tries to put one on each side. Players with no games yet count as average.</p>
      </section>
      <div className="builder">
        <section className="picker" aria-label="Players">
          <label className="search"><span className="sr">Find a player</span><input type="search" id="find" placeholder="Find a player" autoComplete="off" /></label>
          <ul id="players" className="pick-list val-pick" />
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
      <ScriptMount src="/valbuilder.js" marker="players" />
    </>
  );
}
