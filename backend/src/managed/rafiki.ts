import { createHmac } from "node:crypto";
import { z } from "zod";
import type { AppConfig } from "../config";
import { AppError } from "../errors";

const amountSchema = z.object({ value: z.string().regex(/^\d+$/), assetCode: z.literal("COP"), assetScale: z.literal(0) });
const walletSchema = z.object({ id: z.string(), address: z.string().url(), asset: z.object({ code: z.literal("COP"), scale: z.literal(0) }) });
const quoteSchema = z.object({ id: z.string(), expiresAt: z.string(), debitAmount: amountSchema, receiveAmount: amountSchema });
const paymentSchema = z.object({ id: z.string(), state: z.enum(["FUNDING", "SENDING", "COMPLETED", "FAILED", "CANCELLED"]), sentAmount: amountSchema, debitAmount: amountSchema, receiveAmount: amountSchema });
export type ManagedRemotePayment = z.infer<typeof paymentSchema>;
export interface ManagedGateway {
  createWallet(userId: string): Promise<{ id: string; address: string }>;
  prepare(id: string, senderWalletId: string, receiverWalletId: string, amount: number): Promise<{ quoteId: string; incomingId: string; expiresAt: string }>;
  createOutgoing(id: string, walletId: string, quoteId: string): Promise<string>;
  fund(id: string, outgoingId: string): Promise<void>;
  getOutgoing(id: string): Promise<ManagedRemotePayment>;
  withdrawIncoming(id: string, incomingId: string): Promise<void>;
}

// RFC 8785 equivalent for this client's JSON inputs (strings, booleans and integers).
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export class RafikiAdminGateway implements ManagedGateway {
  constructor(private readonly config: AppConfig) {}

  async request(query: string, variables: Record<string, unknown>, operationName: string): Promise<Record<string, unknown>> {
    const body = { query, variables, operationName };
    const timestamp = Date.now();
    const digest = createHmac("sha256", this.config.RAFIKI_API_SECRET).update(`${timestamp}.${canonical(body)}`).digest("hex");
    let response: Response;
    try {
      response = await fetch(this.config.RAFIKI_ADMIN_URL, { method: "POST", redirect: "error",
        headers: { "content-type": "application/json", "tenant-id": this.config.RAFIKI_TENANT_ID, signature: `t=${timestamp}, v1=${digest}` },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error("HTTP error");
      const result = z.object({ data: z.record(z.string(), z.unknown()).nullish(), errors: z.array(z.unknown()).optional() }).parse(await response.json());
      if (result.errors?.length || !result.data) throw new Error("GraphQL error");
      return result.data;
    } catch {
      throw new AppError("PROVIDER_ERROR", "Rafiki no pudo completar la operación. No se confirmó un movimiento de dinero.");
    }
  }

  private async mutation(name: string, inputType: string, input: Record<string, unknown>, selection: string): Promise<unknown> {
    const data = await this.request(`mutation Operation($input: ${inputType}!) { ${name}(input: $input) { ${selection} } }`, { input }, "Operation");
    return data[name];
  }

  async createWallet(userId: string) {
    const address = `${this.config.RAFIKI_WALLET_ADDRESS_BASE.replace(/\/$/, "")}/${userId}`;
    const lookup = await this.request("query Existing($url: String!) { walletAddressByUrl(url: $url) { id address asset { code scale } } }", { url: address }, "Existing");
    if (lookup.walletAddressByUrl) return walletSchema.parse(lookup.walletAddressByUrl);
    const assets = await this.request("query Assets { assets(first: 100) { edges { node { id code scale } } } }", {}, "Assets");
    const list = z.object({ edges: z.array(z.object({ node: z.object({ id: z.string(), code: z.string(), scale: z.number() }) })) }).parse(assets.assets);
    let asset = list.edges.find(edge => edge.node.code === "COP" && edge.node.scale === 0)?.node;
    if (!asset) {
      const created = z.object({ asset: z.object({ id: z.string(), code: z.literal("COP"), scale: z.literal(0) }) }).parse(await this.mutation(
        "createAsset", "CreateAssetInput", { code: "COP", scale: 0, idempotencyKey: "sms-cop-asset-v1" }, "asset { id code scale }"));
      asset = created.asset;
    }
    const result = z.object({ walletAddress: walletSchema }).parse(await this.mutation("createWalletAddress", "CreateWalletAddressInput", {
      assetId: asset.id, address,
      publicName: "Cuenta SMS de prueba", idempotencyKey: `sms-account-${userId}`,
    }, "walletAddress { id address asset { code scale } }"));
    return result.walletAddress;
  }

  async prepare(id: string, senderWalletId: string, receiverWalletId: string, amount: number) {
    const incoming = z.object({ payment: z.object({ id: z.string(), url: z.string() }) }).parse(await this.mutation(
      "createIncomingPayment", "CreateIncomingPaymentInput", { walletAddressId: receiverWalletId, incomingAmount: { value: String(amount), assetCode: "COP", assetScale: 0 }, idempotencyKey: `sms-incoming-${id}` }, "payment { id url }"));
    const result = z.object({ quote: quoteSchema }).parse(await this.mutation("createQuote", "CreateQuoteInput", {
      walletAddressId: senderWalletId, receiver: incoming.payment.url,
      debitAmount: { value: String(amount), assetCode: "COP", assetScale: 0 }, idempotencyKey: `sms-quote-${id}`,
    }, "quote { id expiresAt debitAmount { value assetCode assetScale } receiveAmount { value assetCode assetScale } }"));
    // This MVP is same-asset, same-instance and has no fees. Never hide a fee in the ledger.
    if (result.quote.debitAmount.value !== String(amount) || result.quote.receiveAmount.value !== String(amount)) throw new AppError("PROVIDER_ERROR", "La instancia debe operar en COP sin comisiones para esta prueba.");
    return { quoteId: result.quote.id, incomingId: incoming.payment.id, expiresAt: result.quote.expiresAt };
  }

  async createOutgoing(id: string, walletId: string, quoteId: string): Promise<string> {
    const result = z.object({ payment: z.object({ id: z.string() }) }).parse(await this.mutation("createOutgoingPayment", "CreateOutgoingPaymentInput", {
      walletAddressId: walletId, quoteId, metadata: { smsTransferId: id }, idempotencyKey: `sms-outgoing-${id}`,
    }, "payment { id }"));
    return result.payment.id;
  }

  async fund(id: string, outgoingId: string) {
    const result = z.object({ success: z.boolean() }).parse(await this.mutation("depositOutgoingPaymentLiquidity", "DepositOutgoingPaymentLiquidityInput", {
      outgoingPaymentId: outgoingId, idempotencyKey: `sms-fund-${id}`,
    }, "success"));
    if (!result.success) throw new AppError("PROVIDER_ERROR", "No se confirmó la liquidez del pago.");
  }

  async getOutgoing(id: string) {
    const data = await this.request("query Payment($id: String!) { outgoingPayment(id: $id) { id state sentAmount { value assetCode assetScale } debitAmount { value assetCode assetScale } receiveAmount { value assetCode assetScale } } }", { id }, "Payment");
    return paymentSchema.parse(data.outgoingPayment);
  }

  async withdrawIncoming(id: string, incomingId: string) {
    const result = z.object({ success: z.boolean() }).parse(await this.mutation("createIncomingPaymentWithdrawal", "CreateIncomingPaymentWithdrawalInput", {
      incomingPaymentId: incomingId, idempotencyKey: `sms-withdraw-${id}`, timeoutSeconds: "0",
    }, "success"));
    if (!result.success) throw new AppError("PROVIDER_ERROR", "No se confirmó la retirada de liquidez del receptor.");
  }
}
