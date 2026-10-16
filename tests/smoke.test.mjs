// Prueba de humo del esqueleto. Da al workflow un comando de verificación real
// (`npm test`) aunque todavía no exista código de aplicación. Reemplazar por las
// pruebas del backend en cuanto se elija el framework.
import { test } from "node:test";
import assert from "node:assert/strict";

test("el entorno de pruebas está listo", () => {
  assert.equal(typeof globalThis, "object");
});
