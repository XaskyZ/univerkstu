import { describe, it, expect } from 'vitest';
import { mapWeatherCodeToMood } from './WeatherMoodCard';

describe('mapWeatherCodeToMood', () => {
    // Open-Meteo uses WMO weather codes (https://open-meteo.com/en/docs).
    // This mapping controls the entire weather card's visual mood (rain animation,
    // snow flakes, mist layers, color gradient), so a regression silently miscolors
    // the home dashboard.

    it('code 0 → clear', () => {
        expect(mapWeatherCodeToMood(0)).toBe('clear');
    });

    it('codes 1-3 (mainly clear / partly cloudy / overcast) → cloudy', () => {
        expect(mapWeatherCodeToMood(1)).toBe('cloudy');
        expect(mapWeatherCodeToMood(2)).toBe('cloudy');
        expect(mapWeatherCodeToMood(3)).toBe('cloudy');
    });

    it('codes 45, 48 (fog / depositing rime fog) → fog', () => {
        expect(mapWeatherCodeToMood(45)).toBe('fog');
        expect(mapWeatherCodeToMood(48)).toBe('fog');
    });

    it('codes 71/73/75/77 (snow fall variants) → snow', () => {
        expect(mapWeatherCodeToMood(71)).toBe('snow'); // slight
        expect(mapWeatherCodeToMood(73)).toBe('snow'); // moderate
        expect(mapWeatherCodeToMood(75)).toBe('snow'); // heavy
        expect(mapWeatherCodeToMood(77)).toBe('snow'); // snow grains
    });

    it('codes 85, 86 (snow showers) → snow', () => {
        expect(mapWeatherCodeToMood(85)).toBe('snow');
        expect(mapWeatherCodeToMood(86)).toBe('snow');
    });

    it('codes 95, 96, 99 (thunderstorm) → storm', () => {
        expect(mapWeatherCodeToMood(95)).toBe('storm');
        expect(mapWeatherCodeToMood(96)).toBe('storm'); // with slight hail
        expect(mapWeatherCodeToMood(99)).toBe('storm'); // with heavy hail
    });

    it('drizzle codes 51, 53, 55, 56, 57 → rain', () => {
        for (const code of [51, 53, 55, 56, 57]) {
            expect(mapWeatherCodeToMood(code)).toBe('rain');
        }
    });

    it('rain codes 61, 63, 65, 66, 67 → rain', () => {
        for (const code of [61, 63, 65, 66, 67]) {
            expect(mapWeatherCodeToMood(code)).toBe('rain');
        }
    });

    it('rain shower codes 80, 81, 82 → rain', () => {
        expect(mapWeatherCodeToMood(80)).toBe('rain');
        expect(mapWeatherCodeToMood(81)).toBe('rain');
        expect(mapWeatherCodeToMood(82)).toBe('rain');
    });

    it('unknown / out-of-range codes default to "cloudy"', () => {
        // Open-Meteo can introduce new codes; the safe default is the neutral "cloudy"
        // mood so we never crash the card. Locking that fallback in.
        expect(mapWeatherCodeToMood(100)).toBe('cloudy');
        expect(mapWeatherCodeToMood(-1)).toBe('cloudy');
        expect(mapWeatherCodeToMood(50)).toBe('cloudy');
        expect(mapWeatherCodeToMood(999)).toBe('cloudy');
    });

    it('precedence: 95/96/99 trigger storm even though they could match other branches', () => {
        // Storm thunder codes include hail (96/99) which might look like "rain" but the
        // dedicated storm branch wins. Locking in that ordering.
        expect(mapWeatherCodeToMood(96)).toBe('storm');
        expect(mapWeatherCodeToMood(99)).toBe('storm');
    });
});
