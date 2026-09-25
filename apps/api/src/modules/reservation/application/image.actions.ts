import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { NotFoundError } from '../../../shared/kernel/errors';
import { Permission } from '../../../shared/kernel/permissions';
import { assertPhotoLimit, StoredImage } from '../domain/images';
import { HallRecord, HallRepository } from '../infrastructure/hall.repository';
import { ReservationImageStorage, UploadedImage } from '../infrastructure/image-storage';
import { VenueDetails, VenueRepository } from '../infrastructure/venue.repository';

/**
 * Фото места (витрина показывает при выборе места) и фон плана зала. Файлы пишутся до транзакции;
 * при ошибке транзакции загруженные файлы удаляются. Удалённые из списка файлы остаются в хранилище
 * (восстановление по журналу действий).
 */
@Injectable()
export class AddVenuePhoto {
  constructor(
    private readonly venues: VenueRepository,
    private readonly images: ReservationImageStorage,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, venueId: string, file: UploadedImage | undefined): Promise<VenueDetails> {
    const venue = await this.venues.findById(venueId);
    if (!venue) throw new NotFoundError('venue', venueId);
    actor.assertCan(Permission.VenuesManage, venue.branchId);
    assertPhotoLimit(venue.photos.length, 1);
    const stored = await this.images.store('venues', venueId, file);
    try {
      await this.database.transaction(async () => {
        await this.venues.lockForUpdate([venueId]);
        const current = (await this.venues.findById(venueId))!;
        assertPhotoLimit(current.photos.length, 1);
        await this.venues.setPhotos(venueId, [...current.photos, stored]);
        await this.audit.record({
          action: 'reservation.venue_photo_added',
          entityType: 'venue',
          entityId: venueId,
          branchId: venue.branchId,
          before: { photoIds: current.photos.map((p) => p.id) },
          after: { photoIds: [...current.photos.map((p) => p.id), stored.id] },
          actor,
        });
      });
    } catch (err) {
      await this.images.remove(stored);
      throw err;
    }
    return (await this.venues.findDetailed(venueId))!;
  }
}

@Injectable()
export class DeleteVenuePhoto {
  constructor(
    private readonly venues: VenueRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, venueId: string, photoId: string): Promise<VenueDetails> {
    const venue = await this.venues.findById(venueId);
    if (!venue) throw new NotFoundError('venue', venueId);
    actor.assertCan(Permission.VenuesManage, venue.branchId);
    await this.database.transaction(async () => {
      await this.venues.lockForUpdate([venueId]);
      const current = (await this.venues.findById(venueId))!;
      if (!current.photos.some((p) => p.id === photoId)) throw new NotFoundError('venue_photo', photoId);
      const photos = current.photos.filter((p) => p.id !== photoId);
      await this.venues.setPhotos(venueId, photos);
      await this.audit.record({
        action: 'reservation.venue_photo_deleted',
        entityType: 'venue',
        entityId: venueId,
        branchId: venue.branchId,
        before: { photoIds: current.photos.map((p) => p.id) },
        after: { photoIds: photos.map((p) => p.id) },
        meta: { photoId },
        actor,
      });
    });
    return (await this.venues.findDetailed(venueId))!;
  }
}

@Injectable()
export class SetHallBackground {
  constructor(
    private readonly halls: HallRepository,
    private readonly images: ReservationImageStorage,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  /** file = undefined при удалении фона (remove = true). */
  async execute(actor: Actor, hallId: string, input: { file?: UploadedImage; remove?: boolean }): Promise<HallRecord> {
    const hall = await this.halls.findById(hallId);
    if (!hall) throw new NotFoundError('hall', hallId);
    actor.assertCan(Permission.VenuesManage, hall.branchId);
    const stored: StoredImage | null = input.remove ? null : await this.images.store('halls', hallId, input.file);
    try {
      await this.database.transaction(async () => {
        await this.halls.setBackground(hallId, stored);
        await this.audit.record({
          action: stored ? 'reservation.hall_background_set' : 'reservation.hall_background_removed',
          entityType: 'hall',
          entityId: hallId,
          branchId: hall.branchId,
          before: { backgroundId: hall.background?.id ?? null },
          after: { backgroundId: stored?.id ?? null },
          actor,
        });
      });
    } catch (err) {
      if (stored) await this.images.remove(stored);
      throw err;
    }
    return (await this.halls.findById(hallId))!;
  }
}
