import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Loader2 } from "lucide-react";

export default function Vehicles() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get("/vehicles").then(r => setData(r.data)); }, []);

  return (
    <div className="max-w-5xl space-y-6" data-testid="vehicles-page">
      <div>
        <div className="overline">Fleet</div>
        <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Vehicles</h1>
        <p className="text-sm text-gray-500 mt-1">Used to assign delivery vehicles to jobs.</p>
      </div>

      <MockedBanner kind="Navixy fleet integration"/>

      {!data ? <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div> : (
        <section className="bg-white border border-gray-200 rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">ID</th>
                  <th className="px-4 py-3 text-left">Vehicle</th>
                  <th className="px-4 py-3 text-left">Rego</th>
                  <th className="px-4 py-3 text-right">Capacity (t)</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody data-testid="vehicles-table">
                {data.items.map(v => (
                  <tr key={v.id} className="border-t border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs">{v.id}</td>
                    <td className="px-4 py-3 font-semibold text-[#1F2A33]">{v.name}</td>
                    <td className="px-4 py-3 tabular-nums">{v.rego}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{v.capacity_tonnes}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                        v.status === "available" ? "bg-green-100 text-green-800" :
                        v.status === "on_delivery" ? "bg-blue-100 text-blue-800" :
                        "bg-amber-100 text-amber-800"}`}>{v.status.replace("_"," ")}</span>
                    </td>
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

export function MockedBanner({ kind }) {
  return (
    <div className="bg-[#F5C518]/30 border border-[#F5C518] rounded p-3 text-sm flex items-start gap-3" data-testid="mocked-banner">
      <span className="text-base">⚠️</span>
      <div>
        <div className="font-bold uppercase tracking-wider text-xs text-[#1F2A33]">Mocked — Phase 4</div>
        <div className="text-[#1F2A33]/80 text-xs mt-0.5">Hard-coded sample data. Real {kind} ships in Phase 4.</div>
      </div>
    </div>
  );
}
