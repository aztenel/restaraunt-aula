import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { extname } from 'node:path';
import { Public } from '../http/decorators';
import { FileStorage, LocalFileStorage } from './file-storage';

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Раздача файлов при локальном драйвере хранилища (в продакшене файлы отдаёт S3/CDN). */
@ApiExcludeController()
@Controller('files')
export class FilesController {
  constructor(private readonly storage: FileStorage) {}

  @Public()
  @Get('public/*path')
  async publicFile(@Param('path') path: string | string[], @Res() res: Response): Promise<void> {
    if (!(this.storage instanceof LocalFileStorage)) throw new NotFoundException();
    const key = Array.isArray(path) ? path.join('/') : path;
    try {
      const body = await this.storage.get(key, 'public');
      res.setHeader('content-type', MIME[extname(key).toLowerCase()] ?? 'application/octet-stream');
      res.setHeader('cache-control', 'public, max-age=86400');
      res.send(body);
    } catch {
      throw new NotFoundException();
    }
  }

  @Public()
  @Get('private')
  async privateFile(
    @Query('key') key: string,
    @Query('expires') expires: string,
    @Query('sig') sig: string,
    @Query('filename') filename: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!(this.storage instanceof LocalFileStorage) || !key || !this.storage.verify(key, Number(expires), sig ?? '')) {
      throw new NotFoundException();
    }
    try {
      const body = await this.storage.get(key, 'private');
      res.setHeader('content-type', MIME[extname(key).toLowerCase()] ?? 'application/octet-stream');
      res.setHeader('cache-control', 'private, no-store');
      if (filename) res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.send(body);
    } catch {
      throw new NotFoundException();
    }
  }
}
