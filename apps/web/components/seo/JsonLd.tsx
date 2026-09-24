import { serializeJsonLd } from '@/lib/jsonld';

/** Микроразметка schema.org в <script type="application/ld+json">. */
export function JsonLd({ data }: { data: Record<string, unknown> | Array<Record<string, unknown>> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
