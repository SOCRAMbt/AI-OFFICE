/**
 * Herencia de modelo del tap madre a los subagentes de la oficina.
 * El plugin no elige modelo para los niños — lo hereda del session.get
 * del padre; si el host no lo reporta, dejamos el default del host.
 */
import { describe, it, expect } from "vitest";
import { childModelFrom } from "../src/core/childModel.js";

describe("childModelFrom: herencia de modelo del tap padre", () => {
  it("hereda id + providerID + variant del modelo del padre", () => {
    const info = { model: { id: "opencode/inkling-2-small-free", providerID: "opencode", variant: "free" } };
    expect(childModelFrom(info)).toEqual({ id: "opencode/inkling-2-small-free", providerID: "opencode", variant: "free" });
  });

  it("sin variant: devuelve sólo id + providerID", () => {
    const info = { model: { id: "google/gemini-2.5-pro", providerID: "google" } };
    expect(childModelFrom(info)).toEqual({ id: "google/gemini-2.5-pro", providerID: "google" });
  });

  it("sin modelo en la respuesta del host (fallback al default)", () => {
    expect(childModelFrom({})).toBeUndefined();
    expect(childModelFrom({ model: undefined })).toBeUndefined();
  });

  it("modelo malformado: devuelve undefined (sin romper al spawn)", () => {
    expect(childModelFrom({ model: { id: 123, providerID: "x" } })).toBeUndefined();
    expect(childModelFrom({ model: { id: "x" } })).toBeUndefined();
    expect(childModelFrom({ model: { providerID: "x" } })).toBeUndefined();
    expect(childModelFrom({ model: { id: "x", providerID: "" } })).toBeUndefined();
    expect(childModelFrom(null)).toBeUndefined();
    expect(childModelFrom("string")).toBeUndefined();
    expect(childModelFrom(undefined)).toBeUndefined();
  });
});
