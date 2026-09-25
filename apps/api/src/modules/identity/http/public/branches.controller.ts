import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../../shared/infrastructure/http/decorators';
import { Clock } from '../../../../shared/kernel/clock';
import { NotFoundError } from '../../../../shared/kernel/errors';
import { isOpenAt } from '../../../../shared/kernel/time';
import { BranchDirectory, BranchInfo } from '../../public/branch-directory';
import { PublicBranchDto } from '../dto';

@ApiTags('public')
@Public()
@Controller('public/branches')
export class PublicBranchesController {
  constructor(
    private readonly branches: BranchDirectory,
    private readonly clock: Clock,
  ) {}

  private view(b: BranchInfo): PublicBranchDto {
    return {
      id: b.id,
      slug: b.slug,
      name: b.name,
      address: b.address,
      location: b.location,
      phone: b.phone,
      whatsapp: b.whatsapp,
      timezone: b.timezone,
      openingHours: b.openingHours,
      isOpenNow: isOpenAt(b.openingHours, this.clock.now(), b.timezone),
      acceptsDelivery: b.settings.acceptsDelivery,
      acceptsPickup: b.settings.acceptsPickup,
      acceptsReservations: b.settings.acceptsReservations,
      paymentMethods: b.settings.paymentMethods,
      stopListMode: b.settings.stopListMode,
      requirePhoneVerificationForOnReceipt: b.settings.requirePhoneVerificationForOnReceipt,
      requirePhoneVerificationForReservations: b.settings.requirePhoneVerificationForReservations,
    };
  }

  @Get()
  @ApiOkResponse({ type: [PublicBranchDto] })
  async list(): Promise<PublicBranchDto[]> {
    return (await this.branches.list({ activeOnly: true })).map((b) => this.view(b));
  }

  @Get(':slug')
  @ApiOkResponse({ type: PublicBranchDto })
  async get(@Param('slug') slug: string): Promise<PublicBranchDto> {
    const branch = await this.branches.findBySlug(slug);
    if (!branch || !branch.isActive) throw new NotFoundError('branch', slug);
    return this.view(branch);
  }
}
