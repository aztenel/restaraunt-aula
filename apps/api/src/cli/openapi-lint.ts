import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Проверка качества docs/openapi.json: клиенты (админка, витрина, будущее мобильное приложение)
 * генерируются из него, поэтому каждое поле ответа должно иметь точный тип.
 * Ошибка: свойство-объект без properties/additionalProperties/$ref (так swagger описывает
 * `string | null` без явного type) и ответы 2xx без схемы.
 */
type Schema = Record<string, any>;

export function lintOpenApi(doc: Schema): string[] {
  const problems: string[] = [];
  const schemas: Record<string, Schema> = doc.components?.schemas ?? {};
  const isOpaqueObject = (s: Schema) =>
    s && s.type === 'object' && !s.properties && !s.additionalProperties && !s.$ref && !s.allOf && !s.oneOf && !s.anyOf;
  for (const [name, schema] of Object.entries(schemas)) {
    for (const [prop, def] of Object.entries<Schema>(schema.properties ?? {})) {
      if (isOpaqueObject(def)) problems.push(`schema ${name}.${prop}: untyped object (add type/nullable or a DTO)`);
      if (def.type === 'array' && def.items && isOpaqueObject(def.items)) problems.push(`schema ${name}.${prop}[]: untyped array items`);
    }
  }
  for (const [path, ops] of Object.entries<Schema>(doc.paths ?? {})) {
    for (const [method, op] of Object.entries<Schema>(ops)) {
      const responses: Schema = op.responses ?? {};
      for (const [code, res] of Object.entries<Schema>(responses)) {
        if (!/^2/.test(code) || code === '204') continue;
        const content = res.content;
        if (!content) {
          problems.push(`${method.toUpperCase()} ${path} ${code}: response without schema`);
          continue;
        }
        for (const [mime, media] of Object.entries<Schema>(content)) {
          if (mime.includes('json') && (!media.schema || isOpaqueObject(media.schema))) {
            problems.push(`${method.toUpperCase()} ${path} ${code}: untyped JSON response`);
          }
        }
      }
    }
  }
  return problems;
}

if (require.main === module) {
  const file = resolve(__dirname, '..', '..', '..', '..', 'docs', 'openapi.json');
  const problems = lintOpenApi(JSON.parse(readFileSync(file, 'utf8')));
  for (const p of problems) console.log(p);
  console.log(`${problems.length} OpenAPI problems`);
  process.exit(problems.length > 0 ? 1 : 0);
}
