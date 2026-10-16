import { SmsAction } from "./sms-action";
export function BalanceCard() {
  return <div className="space-y-4"><div className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-sm text-slate-600">Recibe por SMS tu saldo disponible y el monto reservado en pagos pendientes. El saldo se consulta en tu cuenta verificada.</p></div><SmsAction command="SALDO" /></div>;
}
