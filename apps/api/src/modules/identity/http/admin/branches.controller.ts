import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../../shared/kernel/actor';
import { ForbiddenError, NotFoundError } from '../../../../shared/kernel/errors';
import { Permission } from '../../../../shared/kernel/permissions';
import { CreateBranch, UpdateBranch } from '../../application/branch.actions';
import { SaveLegalEntity } from '../../application/legal-entity.actions';
import { BranchRepository } from '../../infrastructure/branch.repository';
import { LegalEntityRepository } from '../../infrastructure/legal-entity.repository';
import { BranchDto, BranchInputDto, LegalEntityDto, LegalEntityInputDto } from '../dto';

@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/branches')
export class AdminBranchesController {
  constructor(
    private readonly branches: BranchRepository,
    private readonly createBranch: CreateBranch,
    private readonly updateBranch: UpdateBranch,
  ) {}

  /** Филиалы, доступные сотруднику (для переключателя филиала). Глобальные роли видят все. */
  @Get()
  @ApiOkResponse({ type: [BranchDto] })
  async list(@CurrentActor() actor: Actor): Promise<BranchDto[]> {
    const all = await this.branches.list(false);
    const snapshot = actor.snapshot;
    if (snapshot.globalPermissions.length > 0) return all.map(BranchDto.from);
    const allowed = new Set(Object.keys(snapshot.branchPermissions));
    return all.filter((b) => allowed.has(b.id)).map(BranchDto.from);
  }

  @Get(':id')
  @ApiOkResponse({ type: BranchDto })
  async get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<BranchDto> {
    const snapshot = actor.snapshot;
    if (snapshot.globalPermissions.length === 0 && !snapshot.branchPermissions[id]) {
      throw new ForbiddenError('access.forbidden_branch', 'No access to this branch');
    }
    const branch = await this.branches.findById(id);
    if (!branch) throw new NotFoundError('branch', id);
    return BranchDto.from(branch);
  }

  @RequirePermissions(Permission.BranchesManage)
  @Post()
  @ApiOkResponse({ type: BranchDto })
  create(@CurrentActor() actor: Actor, @Body() dto: BranchInputDto): Promise<BranchDto> {
    return this.createBranch.execute(actor, dto);
  }

  @RequirePermissions(Permission.BranchesManage)
  @Put(':id')
  @ApiOkResponse({ type: BranchDto })
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BranchInputDto): Promise<BranchDto> {
    return this.updateBranch.execute(actor, id, dto);
  }
}

@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/legal-entities')
export class LegalEntitiesController {
  constructor(
    private readonly repo: LegalEntityRepository,
    private readonly save: SaveLegalEntity,
  ) {}

  @RequirePermissions(Permission.BranchesManage, Permission.BanquetsInvoice)
  @Get()
  @ApiOkResponse({ type: [LegalEntityDto] })
  list(): Promise<LegalEntityDto[]> {
    return this.repo.list();
  }

  @RequirePermissions(Permission.BranchesManage)
  @Post()
  @ApiOkResponse({ type: LegalEntityDto })
  create(@CurrentActor() actor: Actor, @Body() dto: LegalEntityInputDto): Promise<LegalEntityDto> {
    return this.save.execute(actor, null, dto);
  }

  @RequirePermissions(Permission.BranchesManage)
  @Put(':id')
  @ApiOkResponse({ type: LegalEntityDto })
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LegalEntityInputDto): Promise<LegalEntityDto> {
    return this.save.execute(actor, id, dto);
  }
}
