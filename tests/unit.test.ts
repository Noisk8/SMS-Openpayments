import { describe, expect, it } from "vitest";
import { normalizeColombianPhone } from "@/lib/validation/phone";
import { formatMinorUnits, parseMinorUnits } from "@/lib/validation/money";
import { parseCommand } from "@/lib/sms/command-parser";
import { RateLimiter } from "@/lib/rate-limit/limiter";
import { AppError } from "@/lib/errors";

describe("teléfonos colombianos", () => {
  it("normaliza formatos habituales a E.164", () => {
    expect(normalizeColombianPhone("3001234567")).toBe("+573001234567");
    expect(normalizeColombianPhone("573001234567")).toBe("+573001234567");
    expect(normalizeColombianPhone("+57 300 123 4567")).toBe("+573001234567");
  });

  it("rechaza números no colombianos o que no son móviles", () => {
    expect(() => normalizeColombianPhone("12345")).toThrow(AppError);
    expect(() => normalizeColombianPhone("+14155550123")).toThrow(AppError);
    expect(() => normalizeColombianPhone("2345678901")).toThrow(AppError);
  });
});

describe("importes en unidades mínimas", () => {
  it("acepta enteros y separadores de miles", () => {
    expect(parseMinorUnits("20000")).toBe(20000n);
    expect(parseMinorUnits("20.000")).toBe(20000n);
  });

  it("rechaza decimales, negativos y cero", () => {
    expect(() => parseMinorUnits("1.5")).toThrow(AppError);
    expect(() => parseMinorUnits("-5")).toThrow(AppError);
    expect(() => parseMinorUnits("0")).toThrow(AppError);
    expect(() => parseMinorUnits("abc")).toThrow(AppError);
  });

  it("formatea respetando la escala del activo", () => {
    expect(formatMinorUnits(20000n, 0)).toBe("20000");
    expect(formatMinorUnits(125n, 2)).toBe("1.25");
  });
});

describe("intérprete de comandos SMS", () => {
  it("interpreta ENVIAR con normalización", () => {
    expect(parseCommand("ENVIAR 20000 3109876543")).toEqual({
      command: "ENVIAR",
      amount: "20000",
      destination: "+573109876543",
    });
  });

  it("acepta mayúsculas, minúsculas y espacios extra", () => {
    expect(parseCommand("  enviar   20000   3109876543 ")).toMatchObject({ command: "ENVIAR" });
    expect(parseCommand("saldo")).toEqual({ command: "SALDO" });
    expect(parseCommand("crear Carlos")).toEqual({ command: "CREAR", alias: "carlos" });
  });

  it("rechaza argumentos inválidos y devuelve comandos desconocidos", () => {
    expect(() => parseCommand("ENVIAR -5 3109876543")).toThrow(AppError);
    expect(() => parseCommand("ENVIAR 20000")).toThrow(AppError);
    expect(() => parseCommand("CONFIRMAR 12")).toThrow(AppError);
    expect(parseCommand("PAGAR TODO")).toEqual({ command: "DESCONOCIDO" });
  });
});

describe("limitador de frecuencia", () => {
  it("bloquea tras superar el límite dentro de la ventana", () => {
    let now = 0;
    const limiter = new RateLimiter(2, 1000, () => now);
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(false);
    now = 1001;
    expect(limiter.consume("a").allowed).toBe(true);
  });
});
