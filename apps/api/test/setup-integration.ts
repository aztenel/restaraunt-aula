/**
 * Окружение интеграционных тестов: реальный PostgreSQL, очередь inline без автозапуска
 * (обработку outbox тест запускает явно через app.drain()).
 *
 * База: TEST_DATABASE_URL или postgres://aula:aula@localhost:5432/<TEST_DATABASE_NAME|aula_test>.
 * Параллельные разработчики/агенты используют разные TEST_DATABASE_NAME.
 */
process.env.NODE_ENV = 'test';
process.env.QUEUE_DRIVER = 'inline';
process.env.QUEUE_INLINE_AUTODRAIN = 'false';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
process.env.STORAGE_DRIVER = 'local';
process.env.LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_DIR ?? `/tmp/aula-test-storage-${process.env.TEST_DATABASE_NAME ?? 'default'}`;
if (!process.env.TEST_DATABASE_URL) {
  const name = process.env.TEST_DATABASE_NAME ?? 'aula_test';
  process.env.TEST_DATABASE_URL = `postgres://aula:aula@localhost:5432/${name}`;
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
