import Link from "next/link";
import { SendMoneyForm } from "@/components/send-money-form";
import { getWebSession } from "@/lib/auth/current-user";

export default async function PaymentsPage() {
  const session = await getWebSession();
  if (!session) {
    return <SignInRequired />;
  }
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Enviar dinero</h1>
      <p className="text-sm text-slate-600">El origen es tu cuenta autenticada. Solo indicas destinatario y monto.</p>
      <SendMoneyForm />
    </div>
  );
}

export function SignInRequired() {
  return (
    <div className="space-y-2">
      <p>Debes iniciar sesión para continuar.</p>
      <Link href="/accounts" className="underline">Ir a iniciar sesión</Link>
    </div>
  );
}