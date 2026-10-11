import { officerPage } from "@/lib/auth";
import { ConfirmButton } from "@/components/Confirm";
import { Flash } from "@/components/ui";
import { createCodeAction, deleteCode } from "../../actions";
import { db } from "@/lib/db";
import { CURRENCY } from "@/lib/economy";
import { shortDay } from "@/lib/time";

export default async function Codes({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await officerPage();
  const q = await searchParams;
  const sql = db();
  const [codes, banners] = await Promise.all([
    sql`select c.*, b.name as banner_name, (select count(*)::int from promo_redemptions r where r.code = c.code) as used
        from promo_codes c left join banners b on b.id = c.banner_id order by c.created_at desc`,
    sql`select id, name from banners where active order by name`,
  ]);
  return (
    <>
      <Flash ok={q.ok} error={q.error} />
      <section className="card">
        <h2>New code</h2>
        <form action={createCodeAction}>
          <div className="row">
            <label className="field"><span className="label">Code</span><input name="code" type="text" placeholder="FRESHERS26" required /></label>
            <label className="field"><span className="label">Gives</span><select name="reward" defaultValue="coins"><option value="coins">{CURRENCY}</option><option value="banner">A banner</option></select></label>
            <label className="field"><span className="label">{CURRENCY}</span><input name="amount" type="number" min={1} placeholder="2500" /></label>
            <label className="field"><span className="label">Banner</span><select name="banner_id" defaultValue=""><option value="">None</option>{banners.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          </div>
          <div className="row">
            <label className="field"><span className="label">Uses in total (blank = no limit)</span><input name="max_uses" type="number" min={1} /></label>
            <label className="field"><span className="label">Expires (Irish time)</span><input name="expires_at" type="datetime-local" /></label>
          </div>
          <button className="btn">Create code</button>
        </form>
      </section>
      <section>
        <h2>Codes</h2>
        {!codes.length ? <p className="empty">No codes yet.</p> : (
          <div className="scroll"><table>
            <thead><tr><th scope="col">Code</th><th scope="col">Gives</th><th scope="col" className="num">Used</th><th scope="col">Expires</th><th scope="col" /></tr></thead>
            <tbody>{codes.map((c) => (
              <tr key={c.code}>
                <td className="name">{c.code}</td>
                <td>{c.reward === "coins" ? `${c.amount.toLocaleString("en-IE")} ${CURRENCY}` : c.banner_name}</td>
                <td className="num">{c.used}{c.max_uses ? ` of ${c.max_uses}` : ""}</td>
                <td>{c.expires_at ? shortDay(c.expires_at) : "Never"}</td>
                <td><form className="inline-form" action={deleteCode}><input type="hidden" name="code" value={c.code} /><ConfirmButton message={`Delete ${c.code}?`}>Delete</ConfirmButton></form></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
