import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Kysely } from 'kysely';
import { Config } from '../config/config';
import { Database, KYSELY } from './database';
import { createKysely } from './kysely.factory';

@Global()
@Module({
  providers: [
    {
      provide: KYSELY,
      inject: [Config],
      useFactory: (config: Config) =>
        createKysely({
          url: config.database.url,
          poolMax: config.database.poolMax,
          statementTimeoutMs: config.database.statementTimeoutMs,
        }),
    },
    Database,
  ],
  exports: [Database, KYSELY],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(KYSELY) private readonly kysely: Kysely<any>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.kysely.destroy();
  }
}
