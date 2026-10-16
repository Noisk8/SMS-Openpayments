import { SendMoneyForm } from "@/components/send-money-form";
export default function PaymentsPage() {
  return <div className="space-y-4"><h1 className="text-xl font-semibold">Enviar dinero</h1><p className="text-sm text-slate-600">Prepara tu mensaje con el destinatario y el monto. La cuenta de origen corresponde al teléfono desde el que envías el SMS.</p><SendMoneyForm /></div>;
}
