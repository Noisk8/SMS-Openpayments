import { AccountForms } from "@/components/account-forms";
export default function AccountsPage() {
  return <div className="space-y-4"><h1 className="text-xl font-semibold">Cuenta</h1><p className="text-sm text-slate-600">Crea tu cuenta COP de prueba y verifica tu número por SMS.</p><AccountForms /></div>;
}
