import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db";
import { testDb } from "./helpers";
import { createUser } from "../src/onboarding/service";
import { SecretBox, generateEncryptionKey } from "../src/security/encryption";
import { WalletHistory, mergeHistory } from "../src/customer/history";
import type { HistoryGateway } from "../src/customer/history-gateway";

describe("Historial de ingresos de wallet", () => {
  let db: Db; let history: WalletHistory; let userId: string; let gateway: HistoryGateway;
  const address = "https://wallet.example/chasky";
  const received = { id: "https://wallet.example/incoming/received", walletAddress: address, completed: true, receivedAmount: { value: "10000", assetCode: "COP", assetScale: 2 }, createdAt: "2026-10-16T20:00:00Z" };
  beforeEach(async () => {
    db = await testDb();userId = (await createUser({db}, {phone:"+573001234567"})).id;
    await db.run("INSERT INTO wallets (id, user_id, wallet_address, currency, asset_scale, auth_server, resource_server) VALUES ('wallet', ?, ?, 'COP', 2, 'https://auth.example', 'https://rs.example')", [userId, address]);
    gateway = { supports: vi.fn(() => true), request: vi.fn(async () => ({ status:"PENDING" as const,redirect:"https://auth.example/approve",uri:"https://auth.example/continue",token:"private-continue",wait:5 })), poll:vi.fn(async () => ({token:"private-access",expiresIn:300})),list:vi.fn(async () => ({payments:[received],more:false})) };
    history = new WalletHistory(db, new SecretBox(generateEncryptionKey()), gateway);
  });
  afterEach(async () => {await db.close();});

  it("no solicita permisos automáticamente al consultar el dashboard", async () => {
    expect((await history.read(userId)).status).toBe("not_connected");
    expect(gateway.request).not.toHaveBeenCalled();expect(gateway.list).not.toHaveBeenCalled();
  });
  it("conserva el consentimiento, cifra los tokens y consulta tras aprobar", async () => {
    expect(await history.connect(userId)).toEqual({connected:false,authorizeUrl:"https://auth.example/approve"});
    await history.connect(userId);expect(gateway.request).toHaveBeenCalledTimes(1);
    const stored = await db.get<{continue_token_enc:string}>("SELECT continue_token_enc FROM wallet_history_grants");
    expect(stored!.continue_token_enc).not.toContain("private-continue");
    await history.read(userId);expect(gateway.poll).not.toHaveBeenCalled();
    await db.run("UPDATE wallet_history_grants SET next_poll_at = '2000-01-01'");
    const result = await history.read(userId);
    expect(result.status).toBe("connected");expect(result.payments[0]).toMatchObject({direction:"received",value:"10000",asset_scale:2,state:"COMPLETED"});
    expect(JSON.stringify(result)).not.toContain("private-access");
  });
  it("rechaza consultar las credenciales de otro titular o una wallet sin configurar", async () => {
    const other = await createUser({db},{phone:"+573008888888"});
    await expect(history.connect(other.id)).rejects.toThrow();
    expect(gateway.request).not.toHaveBeenCalled();
    vi.mocked(gateway.supports).mockReturnValue(false);
    await expect(history.connect(userId)).rejects.toThrow();
    expect((await history.read(userId)).status).toBe("not_configured");
  });
  it("excluye recursos sin dinero y distingue ingresos todavía abiertos", async () => {
    vi.mocked(gateway.request).mockResolvedValue({status:"GRANTED",token:"private-access",expiresIn:300});
    vi.mocked(gateway.list).mockResolvedValue({payments:[received,{...received,id:"zero",receivedAmount:{...received.receivedAmount,value:"0"}},{...received,id:"partial",completed:false}],more:true});
    await history.connect(userId);const result = await history.read(userId);
    expect(result.payments).toHaveLength(2);expect(result.payments[1]!.state).toBe("RECEIVING");expect(result.more).toBe(true);
  });
  it("mantiene el historial local disponible cuando falla el proveedor", async () => {
    vi.mocked(gateway.request).mockResolvedValue({status:"GRANTED",token:"private-access",expiresIn:300});
    await history.connect(userId);vi.mocked(gateway.list).mockRejectedValueOnce(new Error("timeout"));
    expect((await history.read(userId)).status).toBe("unavailable");
  });
  it("no duplica pagos locales presentes en el historial remoto y ordena los movimientos", () => {
    const local={id:"local",incoming_payment_id:"external",value:"10000",currency:"COP",asset_scale:2,state:"COMPLETED",created_at:"2026-10-16T20:00:00Z",direction:"received",counterparty:"alice"};
    const remote={...local,id:"external"};
    const independent={...local,id:"newer",created_at:"2026-10-16T21:00:00Z"};
    const result=mergeHistory([local],[remote,independent]);
    expect(result.map(p=>p.id)).toEqual(["newer","local"]);expect(result[0]).not.toHaveProperty("incoming_payment_id");
  });
  it("conserva un token de continuación rotado mientras espera consentimiento", async () => {
    await history.connect(userId);
    await db.run("UPDATE wallet_history_grants SET next_poll_at = '2000-01-01'");
    vi.mocked(gateway.poll).mockResolvedValueOnce({pending:true,uri:"https://auth.example/new",token:"rotated-continue",wait:5});
    expect((await history.read(userId)).status).toBe("pending");
    await db.run("UPDATE wallet_history_grants SET next_poll_at = '2000-01-01'");
    expect((await history.read(userId)).status).toBe("connected");
    expect(gateway.poll).toHaveBeenLastCalledWith("https://auth.example/new","rotated-continue");
  });

});
