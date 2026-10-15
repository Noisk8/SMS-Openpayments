import { notFound } from "next/navigation";
import { SmsSimulator } from "@/components/sms-simulator";
import { assertSimulatorEnabled } from "@/lib/dev/simulator-guard";

export const dynamic = "force-dynamic";

export default function SimulatorPage() {
  try {
    assertSimulatorEnabled();
  } catch {
    notFound();
  }
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">SIMULADOR SMS</h1>
      <p className="text-sm text-slate-600">Solo para desarrollo. Usa exactamente la misma lógica que los proveedores reales.</p>
      <SmsSimulator />
    </div>
  );
}