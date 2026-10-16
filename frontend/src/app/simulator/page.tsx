import { notFound } from "next/navigation";
import { SmsSimulator } from "@/components/sms-simulator";
export const dynamic = "force-dynamic";
export default function SimulatorPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <div className="space-y-4"><h1 className="text-xl font-semibold">SIMULADOR SMS</h1><p className="text-sm text-slate-600">Solo desarrollo. Conectado al webhook de simulación del backend local; no envía mensajes reales.</p><SmsSimulator /></div>;
}
