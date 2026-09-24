import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ActorResolver } from './application/actor-resolver';
import { ChangeOwnPassword, Login, Logout, RefreshSession } from './application/auth.actions';
import { CreateBranch, UpdateBranch } from './application/branch.actions';
import { BranchDirectoryService, LegalEntityDirectoryService, StaffDirectoryService } from './application/directories';
import { SaveLegalEntity } from './application/legal-entity.actions';
import { PasswordHasher } from './application/password-hasher';
import { TokenService } from './application/token.service';
import { CreateStaffUser, ResetUserPassword, SetUserRoles, UpdateStaffUser } from './application/user.actions';
import { AuthController } from './http/admin/auth.controller';
import { AdminBranchesController, LegalEntitiesController } from './http/admin/branches.controller';
import { SystemController } from './http/admin/system.controller';
import { UsersController } from './http/admin/users.controller';
import { AuthGuard } from './http/auth.guard';
import { PublicBranchesController } from './http/public/branches.controller';
import { BranchRepository } from './infrastructure/branch.repository';
import { LegalEntityRepository } from './infrastructure/legal-entity.repository';
import { RefreshTokenRepository } from './infrastructure/refresh-token.repository';
import { UserRepository } from './infrastructure/user.repository';
import { BranchDirectory } from './public/branch-directory';
import { LegalEntityDirectory } from './public/legal-entities';
import { StaffDirectory } from './public/staff-directory';

/**
 * Identity: пользователи, роли, филиалы, юрлица; вход сотрудников; журнал действий,
 * настройки интеграций и очередь неудач (раздел администратора системы).
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, UsersController, AdminBranchesController, LegalEntitiesController, SystemController, PublicBranchesController],
  providers: [
    BranchRepository,
    LegalEntityRepository,
    UserRepository,
    RefreshTokenRepository,
    PasswordHasher,
    TokenService,
    ActorResolver,
    Login,
    RefreshSession,
    Logout,
    ChangeOwnPassword,
    CreateStaffUser,
    UpdateStaffUser,
    SetUserRoles,
    ResetUserPassword,
    CreateBranch,
    UpdateBranch,
    SaveLegalEntity,
    BranchDirectoryService,
    { provide: BranchDirectory, useExisting: BranchDirectoryService },
    { provide: LegalEntityDirectory, useClass: LegalEntityDirectoryService },
    { provide: StaffDirectory, useClass: StaffDirectoryService },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [BranchDirectory, LegalEntityDirectory, StaffDirectory, PasswordHasher],
})
export class IdentityModule {}
