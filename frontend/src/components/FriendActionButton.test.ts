import { describe, it, expect } from 'vitest';
import { buildDirectRoomId } from './FriendActionButton';

describe('buildDirectRoomId (frontend copy)', () => {
    // Frontend's own copy of the room-id builder — must produce IDENTICAL output
    // to the backend `services/messaging.ts:buildDirectRoomId` (tested in fire 70).
    // A divergence between client + server would cause direct-message rooms to
    // mismatch and messages to silently land in the wrong room.

    it('produces symmetric output: (a, b) === (b, a)', () => {
        const ab = buildDirectRoomId('alice', 'bob');
        const ba = buildDirectRoomId('bob', 'alice');
        expect(ab).toBe(ba);
    });

    it('outputs canonical lexicographic order in the format "direct:LOW::HIGH"', () => {
        expect(buildDirectRoomId('alice', 'bob')).toBe('direct:alice::bob');
        expect(buildDirectRoomId('bob', 'alice')).toBe('direct:alice::bob');
    });

    it('trims whitespace from both inputs before sorting', () => {
        expect(buildDirectRoomId('  bob ', '  alice ')).toBe('direct:alice::bob');
    });

    it('identical users still produce a deterministic pair', () => {
        // Edge case: someone DM'ing themselves (shouldn't happen but should not crash).
        expect(buildDirectRoomId('x', 'x')).toBe('direct:x::x');
    });

    it('Cyrillic handled via locale-aware sort', () => {
        const pair = buildDirectRoomId('Боб', 'Алиса');
        // Алиса < Боб in Russian locale.
        expect(pair).toBe('direct:Алиса::Боб');
    });

    it('produces "direct:" prefix + "::" separator (load-bearing format)', () => {
        // Backend parsing splits on "::" — locks in the format.
        const id = buildDirectRoomId('alice', 'bob');
        expect(id.startsWith('direct:')).toBe(true);
        expect(id.split('::')).toHaveLength(2);
    });
});
