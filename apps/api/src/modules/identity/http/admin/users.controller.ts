import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../../shared/kernel/actor';
import { NotFoundError } from '../../../../shared/kernel/errors';
import { pageRequest } from '../../../../shared/kernel/pagination';
import { Permission } from '../../../../shared/kernel/permissions';
import { ROLE_DEFINITIONS, STAFF_ROLES } from '../../domain/roles';
import { CreateStaffUser, ResetUserPassword, SetUserRoles, toStaffUserView, UpdateStaffUser } from '../../application/user.actions';
import { UserRepository } from '../../infrastructure/user.repository';
import {
  CreatedUserDto,
  CreateUserDto,
  RoleDefinitionDto,
  SetRolesDto,
  StaffUserDto,
  StaffUsersPageDto,
  TemporaryPasswordDto,
  UpdateUserDto,
} from '../dto';

@ApiTags('admin')
@ApiBearerAuth('staff')
@RequirePermissions(Permission.UsersManage)
@Controller('admin/users')
export class UsersController {
  constructor(
    private readonly users: UserRepository,
    private readonly createUser: CreateStaffUser,
    private readonly updateUser: UpdateStaffUser,
    private readonly setRoles: SetUserRoles,
    private readonly resetPassword: ResetUserPassword,
  ) {}

  @Get()
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'role', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'perPage', required: false })
  @ApiOkResponse({ type: StaffUsersPageDto })
  async list(
    @Query('q') q?: string,
    @Query('role') role?: string,
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ): Promise<StaffUsersPageDto> {
    const result = await this.users.search({ q, role, branchId }, pageRequest(Number(page) || 1, Number(perPage) || 50));
    return { ...result, items: result.items.map(toStaffUserView) };
  }

  @Get('roles')
  @ApiOkResponse({ type: [RoleDefinitionDto] })
  roles(): RoleDefinitionDto[] {
    return STAFF_ROLES.map((r) => ({ ...ROLE_DEFINITIONS[r], permissions: [...ROLE_DEFINITIONS[r].permissions] }));
  }

  @Get(':id')
  @ApiOkResponse({ type: StaffUserDto })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<StaffUserDto> {
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundError('user', id);
    return toStaffUserView(user);
  }

  @Post()
  @ApiOkResponse({ type: CreatedUserDto })
  create(@CurrentActor() actor: Actor, @Body() dto: CreateUserDto): Promise<CreatedUserDto> {
    return this.createUser.execute(actor, dto);
  }

  @Patch(':id')
  @ApiOkResponse({ type: StaffUserDto })
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto): Promise<StaffUserDto> {
    return this.updateUser.execute(actor, id, dto);
  }

  @Put(':id/roles')
  @ApiOkResponse({ type: StaffUserDto })
  roles_(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRolesDto): Promise<StaffUserDto> {
    return this.setRoles.execute(actor, id, dto.roles);
  }

  @Post(':id/reset-password')
  @ApiOkResponse({ type: TemporaryPasswordDto })
  reset(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<TemporaryPasswordDto> {
    return this.resetPassword.execute(actor, id);
  }
}
