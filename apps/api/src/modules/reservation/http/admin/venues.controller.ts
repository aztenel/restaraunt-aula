import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { MoneyInputDto } from '../../../../shared/infrastructure/http/api-types';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../../shared/kernel/actor';
import { Permission } from '../../../../shared/kernel/permissions';
import { CreateHall, DeleteHall, UpdateHall } from '../../application/hall.actions';
import { AddVenuePhoto, DeleteVenuePhoto, SetHallBackground } from '../../application/image.actions';
import { ReservationViewMapper } from '../../application/reservation-views';
import { UpdateReservationSettings } from '../../application/settings.actions';
import { CreateVenueType, DeleteVenueType, UpdateVenueType } from '../../application/venue-type.actions';
import { CreateVenue, DeleteVenue, UpdateVenue, VenuePatch } from '../../application/venue.actions';
import { VenueConfigQueries } from '../../application/venue-config.queries';
import { MAX_IMAGE_BYTES } from '../../domain/images';
import { UploadedImage } from '../../infrastructure/image-storage';
import {
  CreateHallDto,
  CreateVenueDto,
  CreateVenueTypeDto,
  HallDto,
  HallsQueryDto,
  ReservationSettingsDto,
  UpdateHallDto,
  UpdateReservationSettingsDto,
  UpdateVenueDto,
  UpdateVenueTypeDto,
  VenueDto,
  VenuesQueryDto,
  VenueTypeDto,
} from '../dto/config.dto';

const IMAGE_BODY = {
  schema: { type: 'object' as const, required: ['file'], properties: { file: { type: 'string' as const, format: 'binary' } } },
};

const IMAGE_UPLOAD = FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });

/** Справочник типов мест (общий для сети): чтение — venues.manage или reservations.view, изменение — глобальное venues.manage. */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/venue-types')
export class AdminVenueTypesController {
  constructor(
    private readonly queries: VenueConfigQueries,
    private readonly createType: CreateVenueType,
    private readonly updateType: UpdateVenueType,
    private readonly deleteType: DeleteVenueType,
    private readonly views: ReservationViewMapper,
  ) {}

  @Get()
  @RequirePermissions(Permission.VenuesManage, Permission.ReservationsView)
  @ApiOkResponse({ type: [VenueTypeDto] })
  list(@CurrentActor() actor: Actor): Promise<VenueTypeDto[]> {
    return this.queries.venueTypes(actor);
  }

  @Get(':id')
  @RequirePermissions(Permission.VenuesManage, Permission.ReservationsView)
  @ApiOkResponse({ type: VenueTypeDto })
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<VenueTypeDto> {
    return this.queries.venueType(actor, id);
  }

  @Post()
  @RequirePermissions(Permission.VenuesManage)
  @ApiCreatedResponse({ type: VenueTypeDto })
  async create(@CurrentActor() actor: Actor, @Body() dto: CreateVenueTypeDto): Promise<VenueTypeDto> {
    return this.views.venueType(await this.createType.execute(actor, dto));
  }

  @Patch(':id')
  @RequirePermissions(Permission.VenuesManage)
  @ApiOkResponse({ type: VenueTypeDto })
  async update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVenueTypeDto): Promise<VenueTypeDto> {
    return this.views.venueType(await this.updateType.execute(actor, id, dto));
  }

  /** Удаление — только если нет мест этого типа (иначе — деактивировать). */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.VenuesManage)
  @ApiNoContentResponse()
  async remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deleteType.execute(actor, id);
  }
}

/** Залы филиала (карта залов). Изменение — venues.manage в филиале зала. */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/halls')
export class AdminHallsController {
  constructor(
    private readonly queries: VenueConfigQueries,
    private readonly createHall: CreateHall,
    private readonly updateHall: UpdateHall,
    private readonly deleteHall: DeleteHall,
    private readonly setBackground: SetHallBackground,
    private readonly views: ReservationViewMapper,
  ) {}

  @Get()
  @RequirePermissions(Permission.VenuesManage, Permission.ReservationsView)
  @ApiOkResponse({ type: [HallDto] })
  list(@CurrentActor() actor: Actor, @Query() query: HallsQueryDto): Promise<HallDto[]> {
    return this.queries.hallList(actor, query.branchId);
  }

  @Get(':id')
  @RequirePermissions(Permission.VenuesManage, Permission.ReservationsView)
  @ApiOkResponse({ type: HallDto })
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<HallDto> {
    return this.queries.hall(actor, id);
  }

  @Post()
  @RequirePermissions(Permission.VenuesManage)
  @ApiCreatedResponse({ type: HallDto })
  async create(@CurrentActor() actor: Actor, @Body() dto: CreateHallDto): Promise<HallDto> {
    return this.views.hall(await this.createHall.execute(actor, dto));
  }

  @Patch(':id')
  @RequirePermissions(Permission.VenuesManage)
  @ApiOkResponse({ type: HallDto })
  async update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateHallDto): Promise<HallDto> {
    return this.views.hall(await this.updateHall.execute(actor, id, dto));
  }

  /** Удаление — только пустого зала. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.VenuesManage)
  @ApiNoContentResponse()
  async remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deleteHall.execute(actor, id);
  }

  /** Фон плана зала (JPEG / PNG / WebP до 10 МБ, multipart-поле file). */
  @Put(':id/background')
  @RequirePermissions(Permission.VenuesManage)
  @UseInterceptors(IMAGE_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiBody(IMAGE_BODY)
  @ApiOkResponse({ type: HallDto })
  async background(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<HallDto> {
    return this.views.hall(await this.setBackground.execute(actor, id, { file }));
  }

  @Delete(':id/background')
  @RequirePermissions(Permission.VenuesManage)
  @ApiOkResponse({ type: HallDto })
  async removeBackground(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<HallDto> {
    return this.views.hall(await this.setBackground.execute(actor, id, { remove: true }));
  }
}

function venuePatch(dto: UpdateVenueDto | CreateVenueDto): VenuePatch {
  const { deposit, rules, ...rest } = dto;
  return {
    ...rest,
    ...(deposit !== undefined ? { deposit: deposit === null ? null : MoneyInputDto.toMoney(deposit) } : {}),
    ...(rules !== undefined ? { rules: rules as Record<string, unknown> | null } : {}),
  };
}

/** Места (столы, VIP-залы, юрты...): вместимость, депозит, правила, позиция на плане, фото. */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/venues')
export class AdminVenuesController {
  constructor(
    private readonly queries: VenueConfigQueries,
    private readonly createVenue: CreateVenue,
    private readonly updateVenue: UpdateVenue,
    private readonly deleteVenue: DeleteVenue,
    private readonly addPhoto: AddVenuePhoto,
    private readonly deletePhoto: DeleteVenuePhoto,
    private readonly views: ReservationViewMapper,
  ) {}

  @Get()
  @RequirePermissions(Permission.VenuesManage, Permission.ReservationsView)
  @ApiOkResponse({ type: [VenueDto] })
  list(@CurrentActor() actor: Actor, @Query() query: VenuesQueryDto): Promise<VenueDto[]> {
    return this.queries.venueList(actor, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.VenuesManage, Permission.ReservationsView)
  @ApiOkResponse({ type: VenueDto })
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<VenueDto> {
    return this.queries.venue(actor, id);
  }

  @Post()
  @RequirePermissions(Permission.VenuesManage)
  @ApiCreatedResponse({ type: VenueDto })
  async create(@CurrentActor() actor: Actor, @Body() dto: CreateVenueDto): Promise<VenueDto> {
    const input = {
      ...venuePatch(dto),
      hallId: dto.hallId,
      typeId: dto.typeId,
      code: dto.code,
      name: dto.name,
      capacityMin: dto.capacityMin,
      capacityMax: dto.capacityMax,
    };
    return this.views.venue(await this.createVenue.execute(actor, input));
  }

  @Patch(':id')
  @RequirePermissions(Permission.VenuesManage)
  @ApiOkResponse({ type: VenueDto })
  async update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVenueDto): Promise<VenueDto> {
    return this.views.venue(await this.updateVenue.execute(actor, id, venuePatch(dto)));
  }

  /** Удаление — только без предстоящих броней. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.VenuesManage)
  @ApiNoContentResponse()
  async remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deleteVenue.execute(actor, id);
  }

  /** Фото места (JPEG / PNG / WebP до 10 МБ, multipart-поле file; не больше 10 фото). */
  @Post(':id/photos')
  @RequirePermissions(Permission.VenuesManage)
  @UseInterceptors(IMAGE_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiBody(IMAGE_BODY)
  @ApiCreatedResponse({ type: VenueDto })
  async photo(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<VenueDto> {
    return this.views.venue(await this.addPhoto.execute(actor, id, file));
  }

  @Delete(':id/photos/:photoId')
  @RequirePermissions(Permission.VenuesManage)
  @ApiOkResponse({ type: VenueDto })
  async removePhoto(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ): Promise<VenueDto> {
    return this.views.venue(await this.deletePhoto.execute(actor, id, photoId));
  }
}

/** Настройки бронирования филиала: напоминание, упреждение и горизонт брони на витрине, текст правил. */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/reservation-settings')
export class AdminReservationSettingsController {
  constructor(
    private readonly queries: VenueConfigQueries,
    private readonly update: UpdateReservationSettings,
  ) {}

  @Get(':branchId')
  @RequirePermissions(Permission.VenuesManage, Permission.ReservationsView)
  @ApiOkResponse({ type: ReservationSettingsDto })
  get(@CurrentActor() actor: Actor, @Param('branchId', ParseUUIDPipe) branchId: string): Promise<ReservationSettingsDto> {
    return this.queries.branchSettings(actor, branchId);
  }

  @Put(':branchId')
  @RequirePermissions(Permission.VenuesManage)
  @ApiOkResponse({ type: ReservationSettingsDto })
  async put(
    @CurrentActor() actor: Actor,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: UpdateReservationSettingsDto,
  ): Promise<ReservationSettingsDto> {
    await this.update.execute(actor, branchId, dto);
    return this.queries.branchSettings(actor, branchId);
  }
}
