import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Loader2 } from "lucide-react";
import { MockedBanner } from "./Vehicles";

export default function Employees() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get("/employees").then(r => setData(r.data)); }, []);

  return (
    <div className="max-w-5xl space-y-6" data-testid="employees-page">
      <div>
        <div className="overline">Team</div>
        <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Employees</h1>
        <p className="text-sm text-gray-500 mt-1">Used to assign production and delivery crews to jobs.</p>
      </div>
      <MockedBanner kind="Simpro HR integration"/>
      {!data ? <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div> : (
        <section className="bg-white border border-gray-200 rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
                <tr><th className="px-4 py-3 text-left">ID</th><th className="px-4 py-3 text-left">Name</th><th className="px-4 py-3 text-left">Role</th><th className="px-4 py-3 text-left">Dept</th><th className="px-4 py-3 text-left">Contact</th></tr>
              </thead>
              <tbody data-testid="employees-table">
                {data.items.map(e => (
                  <tr key={e.id} className="border-t border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs">{e.id}</td>
                    <td className="px-4 py-3 font-semibold text-[#1F2A33]">{e.name}</td>
                    <td className="px-4 py-3">{e.role}</td>
                    <td className="px-4 py-3 text-xs uppercase tracking-wider text-gray-500">{e.department}</td>
                    <td className="px-4 py-3 text-xs">{e.email}<div className="text-gray-500">{e.phone}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
