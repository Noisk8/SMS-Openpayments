import { readFileSync } from "node:fs";
import { createPrivateKey } from "node:crypto";
import { createAuthenticatedClient, isPendingGrant, type AuthenticatedClient, type IncomingPayment } from "@interledger/open-payments";
import type { AppConfig } from "../config";
import { AppError } from "../errors";

export interface HistoryWallet { id: string; wallet_address: string; resource_server: string | null; auth_server: string | null }
export type HistoryAccess = { status: "GRANTED"; token: string; expiresIn: number } | { status: "PENDING"; redirect: string; uri: string; token: string; wait: number };
export interface HistoryGateway {
  supports(wallet: HistoryWallet): boolean;
  request(wallet: HistoryWallet): Promise<HistoryAccess>;
  poll(uri: string, token: string): Promise<{ token: string; expiresIn: number } | { pending: true; uri: string; token: string; wait: number }>;
  list(wallet: HistoryWallet, token: string): Promise<{ payments: IncomingPayment[]; more: boolean }>;
}

/** Cliente separado, limitado a la wallet configurada y a lectura de ingresos. */
export class OpenPaymentsHistoryGateway implements HistoryGateway {
  private clientPromise?: Promise<AuthenticatedClient>;
  constructor(private config: AppConfig) {}
  supports(wallet: HistoryWallet) {
    return Boolean(this.config.OP_HISTORY_KEY_ID && this.config.OP_HISTORY_PRIVATE_KEY_PATH && wallet.wallet_address === this.config.OP_HISTORY_WALLET_ADDRESS);
  }
  private client() {
    return this.clientPromise ??= createAuthenticatedClient({ walletAddressUrl: this.config.OP_HISTORY_WALLET_ADDRESS,
      keyId: this.config.OP_HISTORY_KEY_ID, privateKey: createPrivateKey(readFileSync(this.config.OP_HISTORY_PRIVATE_KEY_PATH)), requestTimeoutMs: 7000 });
  }
  async request(wallet: HistoryWallet): Promise<HistoryAccess> {
    if (!this.supports(wallet) || !wallet.auth_server) throw new AppError("FORBIDDEN", "No está configurada la lectura de esta wallet.");
    const grant = await (await this.client()).grant.request({ url: wallet.auth_server }, {
      access_token: { access: [{ type: "incoming-payment", actions: ["list-all", "read-all"], identifier: wallet.wallet_address }] },
      // Sin finish: el titular autoriza en otra pestaña y el cliente consulta la continuación.
      interact: { start: ["redirect"] },
    });
    if (isPendingGrant(grant)) return { status: "PENDING", redirect: grant.interact.redirect, uri: grant.continue.uri, token: grant.continue.access_token.value, wait: grant.continue.wait ?? 5 };
    if (!grant.access_token?.value) throw new AppError("PROVIDER_ERROR", "No se concedió el permiso de lectura.");
    return { status: "GRANTED", token: grant.access_token.value, expiresIn: grant.access_token.expires_in ?? 300 };
  }
  async poll(uri: string, token: string) {
    const grant = await (await this.client()).grant.continue({ url: uri, accessToken: token });
    if ("access_token" in grant && grant.access_token) return { token: grant.access_token.value, expiresIn: grant.access_token.expires_in ?? 300 };
    return { pending: true as const, uri: grant.continue.uri, token: grant.continue.access_token.value, wait: grant.continue.wait ?? 5 };
  }
  async list(wallet: HistoryWallet, token: string) {
    if (!this.supports(wallet) || !wallet.resource_server) throw new AppError("FORBIDDEN", "Wallet no autorizada.");
    const page = await (await this.client()).incomingPayment.list({ url: wallet.resource_server, walletAddress: wallet.wallet_address, accessToken: token }, { first: 100, "wallet-address": wallet.wallet_address });
    if (page.result.some(payment => payment.walletAddress !== wallet.wallet_address)) throw new AppError("PROVIDER_ERROR", "Respuesta de historial incompatible.");
    return { payments: page.result, more: page.pagination.hasNextPage };
  }
}
