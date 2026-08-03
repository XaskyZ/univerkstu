import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { claimReferralCode, getReferralOverview } from '../services/referrals.js';
import { logAction } from '../utils/actionLog.js';
import { consumeRateLimit } from '../utils/rateLimit.js';

interface ClaimReferralBody {
    code?: string;
}

const MAX_REFERRAL_CODE_LENGTH = 100;

const claimReferralBodySchema = {
    type: 'object',
    required: ['code'],
    properties: {
        code: { type: 'string', minLength: 1, maxLength: MAX_REFERRAL_CODE_LENGTH },
    },
} as const;

export function mapClaimError(status: Awaited<ReturnType<typeof claimReferralCode>>): { statusCode: number; error: string } {
    if (status === 'invalid') {
        return { statusCode: 400, error: 'Реферальный код не найден' };
    }
    if (status === 'self') {
        return { statusCode: 400, error: 'Нельзя указать собственный реферальный код' };
    }
    if (status === 'already_claimed') {
        return { statusCode: 409, error: 'Реферал уже закреплён за этим аккаунтом' };
    }
    if (status === 'claim_window_expired') {
        return { statusCode: 409, error: 'Ручной ввод кода доступен только новому пользователю в течение ограниченного времени' };
    }
    return { statusCode: 500, error: 'Не удалось обработать реферальный код' };
}

export async function referralRoutes(app: FastifyInstance) {
    app.get('/referrals/overview', {
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        try {
            const userId = (request.user as any).userId as string;
            return {
                success: true,
                data: await getReferralOverview(userId),
            };
        } catch (error) {
            console.error('[Referrals] Overview error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Не удалось загрузить реферальную систему',
            });
        }
    });

    app.post('/referrals/claim', {
        preHandler: [app.authenticate as any],
        schema: { body: claimReferralBodySchema },
        attachValidation: true,
    }, async (
        request: FastifyRequest<{ Body: ClaimReferralBody }>,
        reply: FastifyReply
    ) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'Реферальный код обязателен' });
        }
        const userId = (request.user as any).userId as string;
        const code = request.body.code as string;

        // Defence in depth for the claim race: a referral can be attached to an
        // account exactly once, so a legitimate client never needs more than one
        // successful call. Capping bursts per account also removes the ability to
        // brute-force other users' 8-char codes through this endpoint.
        const rate = consumeRateLimit(`referral-claim:${userId}`, 5, 60_000);
        if (!rate.allowed) {
            reply.header('Retry-After', String(rate.retryAfterSec));
            return reply.status(429).send({
                success: false,
                error: 'Слишком много попыток ввода реферального кода. Попробуйте позже.',
            });
        }

        try {
            const status = await claimReferralCode(userId, code);
            if (status !== 'applied') {
                const mapped = mapClaimError(status);
                return reply.status(mapped.statusCode).send({
                    success: false,
                    error: mapped.error,
                    status,
                });
            }

            logAction(userId, 'referral_claim', `Referral claimed manually with code ${code}`, {
                result: 'success',
                metadata: {
                    source: 'manual',
                    code: code.trim().toUpperCase(),
                },
            });

            return {
                success: true,
                status,
                data: await getReferralOverview(userId),
            };
        } catch (error) {
            console.error('[Referrals] Claim error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Не удалось применить реферальный код',
            });
        }
    });
}
