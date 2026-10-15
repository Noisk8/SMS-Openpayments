import { AccountForms } from "@/components/account-forms";

export default function AccountsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Cuenta</h1>
      <p className="text-sm text-slate-600">
        Verificamos tu celular con un código SMS. La clave es opcional y solo sirve para iniciar sesión en la web.
      </p>
      <AccountForms />
    </div>
  );
}