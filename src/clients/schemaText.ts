import { z } from "zod";

/**
 * A description of the schema's shape, for telling a model what it got wrong.
 *
 * The previous implementation returned `schema.description ?? "the previously
 * stated structured-verdict schema"`, and no schema in this codebase carries a
 * description — so every retry reminder was content-free.
 */
export function describeSchema(schema: z.ZodType<unknown>, schemaName: string): string {
  return JSON.stringify(toProviderJsonSchema(schema, schemaName));
}

/**
 * JSON Schema for a provider's structured-output mode. `$schema` is stripped
 * because providers reject unknown top-level keys.
 */
export function toProviderJsonSchema(
  schema: z.ZodType<unknown>,
  schemaName: string,
): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, { io: "output" }) as Record<string, unknown>;
  const { $schema: _dropped, ...rest } = generated;
  return { title: schemaName, ...rest };
}

/**
 * Whether the generated schema meets the constraints of strict structured
 * output: additional properties disallowed and every property required.
 * Declaring `strict` without these makes the provider reject the request.
 */
export function satisfiesStrictMode(jsonSchema: Record<string, unknown>): boolean {
  const walk = (node: unknown): boolean => {
    if (!node || typeof node !== "object") return true;
    if (Array.isArray(node)) return node.every(walk);
    const obj = node as Record<string, unknown>;
    if (obj.type === "object") {
      if (obj.additionalProperties !== false) return false;
      const props = Object.keys((obj.properties as Record<string, unknown>) ?? {});
      const required = (obj.required as string[]) ?? [];
      if (props.some((p) => !required.includes(p))) return false;
    }
    return Object.values(obj).every(walk);
  };
  return walk(jsonSchema);
}

/** One-line rendition of a validation or parse failure, for the retry prompt. */
export function explainFailure(err: unknown): string {
  if (err instanceof z.ZodError) {
    return err.issues
      .map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`)
      .join("; ");
  }
  return (err as { message?: string })?.message ?? String(err);
}
