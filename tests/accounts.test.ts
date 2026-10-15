import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { confirmarCuenta, crearCuenta } from "@/lib/accounts/create-account";
import { verSaldo } from "@/lib/balances/get-balance";
import { AppError } from "@/lib/errors";
import { decryptSecret } from "@/lib/crypto/encryption";
import { makeContext, testPrisma, truncateAll, disconnectTestPrisma } from "./helpers/context";
import { createAccountFor, lastCodeFor } from "./helpers/accounts";

const db = testPrisma();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

describe("TEST 1 y 4: crear cuenta y saldo inicial", () => {
  it("crea la cuenta tras verificar el celular y el saldo inicial es 0 COP", async () => {
    const ctx = makeContext();
    const account = await createAccountFor(ctx, "+573001234567", "carlos");
    expect(account.telefono).toBe("+573001234567");
    expect(account.walletAddress).toBe("mock://wallet/carlos");
    expect(account.moneda).toBe("COP");

    const user = await db.user.findUniqueOrThrow({ where: { id: account.id } });
    const balance = await verSaldo(
      { telefono: "+573001234567", authorizationContext: { userId: user.id, channel: "web" } },
      ctx,
    );
    expect(balance).toMatchObject({ success: true, saldo: "0", moneda: "COP" });
  });

  it("no expone claves ni secretos en la respuesta de cuenta", async () => {
    const ctx = makeContext();
    const account = await createAccountFor(ctx, "+573001234568", "maria");
    const serialized = JSON.stringify(account);
    expect(serialized).not.toMatch(/encrypted|privateKey|passwordHash|codeHash/i);
  });

  it("guarda el código de verificación solo como hash y registra el SMS sin el código", async () => {
    const ctx = makeContext();
    await crearCuenta({ telefono: "+573001234569", alias: "pedro" }, ctx);
    const code = lastCodeFor("+573001234569");
    const verification = await db.phoneVerification.findFirstOrThrow({ where: { telefono: "+573001234569" } });
    expect(verification.codeHash).not.toContain(code);
    const stored = await db.smsMessage.findFirstOrThrow({
      where: { to: "+573001234569", direction: "OUTBOUND" },
      orderBy: { createdAt: "desc" },
    });
    expect(decryptSecret(stored.bodyEncrypted, process.env.ENCRYPTION_KEY)).not.toContain(code);
  });
});

describe("TEST 2: cuenta duplicada", () => {
  it("rechaza un segundo alta con el mismo teléfono", async () => {
    const ctx = makeContext();
    await createAccountFor(ctx, "+573001111111", "ana");
    await expectAppError(crearCuenta({ telefono: "+573001111111", alias: "otra" }, ctx), "PHONE_ALREADY_REGISTERED");
  });

  it("rechaza un alias ya utilizado", async () => {
    const ctx = makeContext();
    await createAccountFor(ctx, "+573002222222", "luis");
    await expectAppError(crearCuenta({ telefono: "+573003333333", alias: "luis" }, ctx), "ALIAS_UNAVAILABLE");
  });
});

describe("TEST 3: validación de entrada", () => {
  it("rechaza teléfonos no colombianos", async () => {
    const ctx = makeContext();
    await expectAppError(crearCuenta({ telefono: "+14155550123", alias: "john" }, ctx), "INVALID_PHONE");
  });

  it("rechaza alias inválidos y claves demasiado cortas", async () => {
    const ctx = makeContext();
    await expectAppError(crearCuenta({ telefono: "+573004444444", alias: "a b" }, ctx), "VALIDATION_FAILED");
    await expectAppError(
      crearCuenta({ telefono: "+573004444445", alias: "valido", clave: "corta" }, ctx),
      "VALIDATION_FAILED",
    );
  });

  it("no permite una wallet externa en modo mock", async () => {
    const ctx = makeContext();
    await expectAppError(
      crearCuenta({ telefono: "+573004444446", alias: "wallet", walletAddress: "https://ilp.example/a" }, ctx),
      "VALIDATION_FAILED",
    );
  });
});

describe("verificación del celular", () => {
  it("rechaza un código incorrecto y permite el correcto después", async () => {
    const ctx = makeContext();
    await crearCuenta({ telefono: "+573005555555", alias: "sofia" }, ctx);
    const correct = lastCodeFor("+573005555555");
    const wrong = correct === "000000" ? "111111" : "000000";
    await expectAppError(confirmarCuenta({ telefono: "+573005555555", codigo: wrong }, ctx), "VERIFICATION_INVALID");
    const result = await confirmarCuenta({ telefono: "+573005555555", codigo: correct }, ctx);
    expect(result.account.alias).toBe("sofia");
  });

  it("un código ya usado no puede volver a confirmarse", async () => {
    const ctx = makeContext();
    await crearCuenta({ telefono: "+573006666666", alias: "tomas" }, ctx);
    const code = lastCodeFor("+573006666666");
    await confirmarCuenta({ telefono: "+573006666666", codigo: code }, ctx);
    await expectAppError(confirmarCuenta({ telefono: "+573006666666", codigo: code }, ctx), "VERIFICATION_REQUIRED");
  });
  it("no crea la cuenta si el alias fue tomado mientras tanto", async () => {
    const ctx = makeContext();
    await crearCuenta({ telefono: "+573007777777", alias: "nicolas" }, ctx);
    const code = lastCodeFor("+573007777777");
    await db.user.create({ data: { telefono: "+573008888888", alias: "nicolas", phoneVerifiedAt: new Date() } });
    await expectAppError(confirmarCuenta({ telefono: "+573007777777", codigo: code }, ctx), "ALIAS_UNAVAILABLE");
    expect(await db.user.findUnique({ where: { telefono: "+573007777777" } })).toBeNull();
  });
});
