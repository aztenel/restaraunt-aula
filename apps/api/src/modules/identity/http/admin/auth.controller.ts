import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Config } from '../../../../shared/infrastructure/config/config';
import { AllowPendingPasswordChange, CurrentActor, Public } from '../../../../shared/infrastructure/http/decorators';
import { RateLimit } from '../../../../shared/infrastructure/rate-limit/rate-limit.guard';
import { Actor } from '../../../../shared/kernel/actor';
import { UnauthenticatedError } from '../../../../shared/kernel/errors';
import { ChangeOwnPassword, Login, Logout, RefreshSession, SessionTokens } from '../../application/auth.actions';
import { UserRepository } from '../../infrastructure/user.repository';
import { ChangePasswordDto, LoginDto, MeDto, SessionDto } from '../dto';

const REFRESH_COOKIE = 'aula_rt';

@ApiTags('admin')
@Controller('admin/auth')
export class AuthController {
  constructor(
    private readonly login: Login,
    private readonly refresh: RefreshSession,
    private readonly logout: Logout,
    private readonly changePassword: ChangeOwnPassword,
    private readonly users: UserRepository,
    private readonly config: Config,
  ) {}

  private setRefreshCookie(res: Response, session: SessionTokens): void {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: this.config.isProduction || this.config.env.NODE_ENV === 'staging',
      sameSite: 'strict',
      path: '/api/v1/admin/auth',
      expires: session.refreshExpiresAt,
    });
  }

  @Public()
  @RateLimit('auth')
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Вход сотрудника. Refresh-токен — в httpOnly cookie.' })
  @ApiOkResponse({ type: SessionDto })
  async signIn(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<SessionDto> {
    const session = await this.login.execute({
      email: dto.email,
      password: dto.password,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    this.setRefreshCookie(res, session);
    return { accessToken: session.accessToken, expiresIn: session.expiresIn, mustChangePassword: session.mustChangePassword };
  }

  @Public()
  @RateLimit('auth')
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Обновить access-токен по refresh cookie (ротация)' })
  @ApiOkResponse({ type: SessionDto })
  async refreshSession(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<SessionDto> {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (!token) throw new UnauthenticatedError('auth.invalid_refresh', 'No session');
    const session = await this.refresh.execute({ refreshToken: token, ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null });
    this.setRefreshCookie(res, session);
    return { accessToken: session.accessToken, expiresIn: session.expiresIn, mustChangePassword: session.mustChangePassword };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async signOut(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.logout.execute((req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/admin/auth' });
  }

  @ApiBearerAuth('staff')
  @AllowPendingPasswordChange()
  @Get('me')
  @ApiOkResponse({ type: MeDto })
  async me(@CurrentActor() actor: Actor): Promise<MeDto> {
    const user = await this.users.findById(actor.userId!);
    if (!user) throw new UnauthenticatedError();
    const snapshot = actor.snapshot;
    const branchIds = Object.keys(snapshot.branchPermissions);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      mustChangePassword: user.mustChangePassword,
      roles: user.roles,
      globalPermissions: snapshot.globalPermissions,
      branchPermissions: snapshot.branchPermissions,
      branchIds,
    };
  }

  @ApiBearerAuth('staff')
  @AllowPendingPasswordChange()
  @RateLimit('auth')
  @Post('change-password')
  @HttpCode(204)
  async changeOwnPassword(@CurrentActor() actor: Actor, @Body() dto: ChangePasswordDto): Promise<void> {
    await this.changePassword.execute(actor, dto);
  }
}
