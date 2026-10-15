import { officerPage } from "@/lib/auth";
import Link from "next/link";
import { ConfirmButton } from "@/components/Confirm";
import { Flash } from "@/components/ui";
import { addMember, changeRole, checkDuesRoles, officerUnlink, setDuesMember, uploadRoster } from "../../actions";
import { memberRoleSetting } from "@/lib/dues";
import { getViewer, isAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function Members({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await officerPage();
  const flash = await searchParams;
  const viewer = await getViewer();
  const rows = await db()`
    select p.id, p.display_name, p.slug, p.role, p.auth_id is not null as signed_in,
      coalesce(p.dues_override, p.dues_role) as dues,
      coalesce((select json_agg(json_build_object('id', a.id, 'game', a.game, 'account', a.account) order by a.game, a.account)
                from game_accounts a where a.player_id = p.id and a.status = 'approved'), '[]') as accounts
    from players p order by p.role = 'member', lower(p.display_name)`;
  const role = memberRoleSetting();
  const members = rows.filter((p) => p.dues).length;
  return (
    <>
      <Flash ok={flash.ok} error={flash.error} />
      <div className="grid2">
        <section className="card">
          <h2>Add someone who hasn&apos;t signed in</h2>
          <p className="muted">Their games count straight away. When they sign in and ask to link the same account, approving it merges this entry into them.</p>
          <form action={addMember}>
            <div className="field"><label htmlFor="m-name">Name</label><input id="m-name" name="name" type="text" maxLength={40} required /></div>
            <div className="field"><label htmlFor="m-bt">BattleTags or Overwatch names</label><input id="m-bt" name="battletags" type="text" placeholder="Aoife#1234; AoifeSmurf" /></div>
            <div className="field"><label htmlFor="m-riot">Riot IDs</label><input id="m-riot" name="riot_ids" type="text" placeholder="Aoife#EUW" /></div>
            <button className="btn">Add</button>
          </form>
        </section>
        <section className="card">
          <h2>Import the old roster</h2>
          <p className="muted">The players.csv from the Overtime site, or any sheet with name, ingame_names and riot_ids columns (several names separated by ;).</p>
          <form action={uploadRoster}>
            <div className="field"><input name="file" type="file" accept=".csv,text/csv" required /></div>
            <button className="btn">Import</button>
          </form>
        </section>
      </div>
      <section className="card dues-card">
        <h2>DUES members</h2>
        <p className="muted">
          Everyone with the <b>{role}</b> role in the Discord server counts as a DUES member, for the members-only leaderboards.
          Roles are read when someone uses the bot or signs in, and for everyone with the Sunday import.
          If it&apos;s wrong for someone, or they aren&apos;t on Discord, change them to Yes or No below.
        </p>
        <div className="row">
          <span><b>{members} of {rows.length}</b> are DUES members.</span>
          <form className="inline-form" action={checkDuesRoles}><button className="btn ghost small">Check Discord roles now</button></form>
        </div>
      </section>
      <section>
        <h2>Everyone</h2>
        <div className="scroll"><table>
          <thead><tr><th scope="col">Name</th><th scope="col">Accounts</th><th scope="col">DUES member</th><th scope="col">Role</th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id}>
              <td className="name"><Link href={`/players/${p.slug}`}>{p.display_name}</Link>{!p.signed_in && <span className="alias">roster entry, not signed in</span>}</td>
              <td>{(p.accounts as { id: number; game: string; account: string }[]).map((a) => (
                <span key={a.id} className="acct">{a.account}{" "}
                  <form className="inline-form" action={officerUnlink}><input type="hidden" name="id" value={a.id} /><ConfirmButton message={`Unlink ${a.account} from ${p.display_name}?`} className="link-btn">×</ConfirmButton></form>
                </span>
              ))}</td>
              <td>
                <form className="row" action={setDuesMember}>
                  <input type="hidden" name="id" value={p.id} />
                  <select name="dues" defaultValue={p.dues ? "yes" : "no"} aria-label={`DUES member: ${p.display_name}`}>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                  <button className="btn ghost small">Set</button>
                </form>
              </td>
              <td>{isAdmin(viewer) ? (
                <form className="row" action={changeRole}>
                  <input type="hidden" name="id" value={p.id} />
                  <select name="role" defaultValue={p.role} aria-label={`Role for ${p.display_name}`}><option value="member">Member</option><option value="officer">Officer</option><option value="admin">Admin</option></select>
                  <button className="btn ghost small">Set</button>
                </form>
              ) : p.role}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
    </>
  );
}
