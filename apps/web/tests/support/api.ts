/** Ответы openapi-fetch для заглушек клиента API в тестах. */
export function ok<T>(data: T, status = 200) {
  return { data, response: new Response(null, { status }) };
}

export function fail(status: number, code: string, details: Record<string, unknown> = {}) {
  return { error: { error: { code, message: code, details }, requestId: null }, response: new Response(null, { status }) };
}
