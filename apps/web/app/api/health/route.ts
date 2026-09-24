/**
 * Проверка живости контейнера витрины (HEALTHCHECK в Dockerfile). Не обращается к API:
 * витрина должна отвечать, даже если API временно недоступен.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { status: 'ok', release: process.env.RELEASE ?? process.env.NEXT_PUBLIC_RELEASE ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
