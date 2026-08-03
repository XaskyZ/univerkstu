'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { formatMessage, useLanguage } from '@/lib/language-context';
import { useTheme } from '@/lib/theme-context';

export type WeatherMood = 'clear' | 'cloudy' | 'rain' | 'snow' | 'storm' | 'fog';

interface WeatherData {
    city: string;
    temperature: number;
    tempMax: number | null;
    tempMin: number | null;
    weatherCode: number;
    mood: WeatherMood;
    summary: string;
    suggestion: string;
}

interface OpenMeteoResponse {
    current_weather?: {
        temperature: number;
        weathercode: number;
    };
    daily?: {
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
    };
}

const WEATHER_CACHE_KEY = 'weather-karaganda-v1';
const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

const RAIN_LINES = Array.from({ length: 18 }, (_, i) => ({
    left: `${(i * 100) / 18}%`,
    delay: (i % 5) * 0.22,
    duration: 0.8 + (i % 3) * 0.15,
}));

const SNOW_FLAKES = Array.from({ length: 18 }, (_, i) => ({
    left: `${(i * 100) / 18}%`,
    delay: (i % 6) * 0.25,
    duration: 3.2 + (i % 4) * 0.6,
    size: 3 + (i % 3),
}));

const MIST_LAYERS = Array.from({ length: 4 }, (_, i) => ({
    top: `${15 + i * 18}%`,
    delay: i * 0.9,
}));

export function mapWeatherCodeToMood(code: number): WeatherMood {
    if (code === 0) return 'clear';
    if ([1, 2, 3].includes(code)) return 'cloudy';
    if ([45, 48].includes(code)) return 'fog';
    if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
    if ([95, 96, 99].includes(code)) return 'storm';
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain';
    return 'cloudy';
}

function getSummary(code: number, mood: WeatherMood, messages: ReturnType<typeof useLanguage>['messages']): string {
    if (mood === 'clear') return messages.weather.clear;
    if (mood === 'cloudy') return code === 3 ? messages.weather.overcast : messages.weather.cloudy;
    if (mood === 'rain') return messages.weather.rain;
    if (mood === 'snow') return messages.weather.snow;
    if (mood === 'storm') return messages.weather.storm;
    if (mood === 'fog') return messages.weather.fog;
    return messages.weather.generic;
}

function getSuggestion(mood: WeatherMood, temp: number, messages: ReturnType<typeof useLanguage>['messages']): string {
    if (mood === 'rain') return messages.weather.suggestionRain;
    if (mood === 'snow') return messages.weather.suggestionSnow;
    if (mood === 'storm') return messages.weather.suggestionStorm;
    if (mood === 'fog') return messages.weather.suggestionFog;
    if (temp <= -10) return messages.weather.suggestionVeryCold;
    if (temp <= 5) return messages.weather.suggestionCool;
    if (temp >= 28) return messages.weather.suggestionHot;
    return messages.weather.suggestionComfort;
}

function readCachedWeather(): WeatherData | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = localStorage.getItem(WEATHER_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { fetchedAt: number; payload: WeatherData };
        if (!parsed?.fetchedAt || !parsed?.payload) return null;
        if (Date.now() - parsed.fetchedAt > WEATHER_CACHE_TTL_MS) return null;
        return parsed.payload;
    } catch {
        return null;
    }
}

function writeCachedWeather(payload: WeatherData): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), payload }));
    } catch {
        // ignore cache write errors
    }
}

function buildWeatherPayload(response: OpenMeteoResponse, messages: ReturnType<typeof useLanguage>['messages']): WeatherData | null {
    const current = response.current_weather;
    if (!current) return null;

    const mood = mapWeatherCodeToMood(current.weathercode);
    const summary = getSummary(current.weathercode, mood, messages);
    const suggestion = getSuggestion(mood, current.temperature, messages);

    return {
        city: messages.weather.city,
        temperature: Math.round(current.temperature),
        tempMax: typeof response.daily?.temperature_2m_max?.[0] === 'number'
            ? Math.round(response.daily.temperature_2m_max[0])
            : null,
        tempMin: typeof response.daily?.temperature_2m_min?.[0] === 'number'
            ? Math.round(response.daily.temperature_2m_min[0])
            : null,
        weatherCode: current.weathercode,
        mood,
        summary,
        suggestion,
    };
}

export default function WeatherMoodCard() {
    const { messages } = useLanguage();
    const { scheme } = useTheme();
    const isLight = scheme === 'light';
    const [weather, setWeather] = useState<WeatherData | null>(() => readCachedWeather());
    const [animatedScene, setAnimatedScene] = useState(() => {
        if (typeof window === 'undefined') return false;
        const nav = navigator as Navigator & {
            connection?: { saveData?: boolean };
            deviceMemory?: number;
            hardwareConcurrency?: number;
        };
        const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const saveData = nav.connection?.saveData === true;
        const lowMemory = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4;
        const lowCpu = typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 4;
        const compact = window.innerWidth < 640;
        return !(prefersReduced || saveData || compact || (lowMemory && lowCpu));
    });

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        const nav = navigator as Navigator & {
            connection?: { saveData?: boolean };
            deviceMemory?: number;
            hardwareConcurrency?: number;
        };

        const updateAnimatedScene = () => {
            const prefersReduced = mediaQuery.matches;
            const saveData = nav.connection?.saveData === true;
            const lowMemory = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4;
            const lowCpu = typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 4;
            const compact = window.innerWidth < 640;
            setAnimatedScene(!(prefersReduced || saveData || compact || (lowMemory && lowCpu)));
        };

        updateAnimatedScene();
        mediaQuery.addEventListener('change', updateAnimatedScene);
        window.addEventListener('resize', updateAnimatedScene);
        return () => {
            mediaQuery.removeEventListener('change', updateAnimatedScene);
            window.removeEventListener('resize', updateAnimatedScene);
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        const loadWeather = async () => {
            try {
                const res = await fetch(
                    'https://api.open-meteo.com/v1/forecast?latitude=49.8028&longitude=73.0877&current_weather=true&daily=temperature_2m_max,temperature_2m_min&timezone=auto',
                    { cache: 'no-store' }
                );
                if (!res.ok) return;
                const data = await res.json() as OpenMeteoResponse;
                const payload = buildWeatherPayload(data, messages);
                if (!payload || cancelled) return;
                setWeather(payload);
                writeCachedWeather(payload);
            } catch {
                // Keep cached data or silent fallback
            }
        };

        // Background refresh on mount without blocking cached UI.
        void loadWeather();
        return () => { cancelled = true; };
    }, [messages]);

    if (!weather) return null;

    return (
        <div
            className="card mt-4 mb-3 relative overflow-hidden animate-fadeInUp"
            style={isLight ? { background: 'linear-gradient(145deg, rgba(255,255,255,0.92), rgba(244,247,255,0.98))' } : undefined}
        >
            <div className="absolute inset-0 pointer-events-none">
                {weather.mood === 'clear' && animatedScene && (
                    <>
                        <motion.div
                            className="absolute -top-8 -right-6 w-24 h-24 rounded-full"
                            style={{ background: 'radial-gradient(circle, rgba(255,220,90,0.95) 0%, rgba(255,220,90,0.15) 70%, transparent 100%)' }}
                            animate={{ scale: [1, 1.12, 1] }}
                            transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
                        />
                        <motion.div
                            className="absolute -top-14 -right-14 w-40 h-40 rounded-full border"
                            style={{ borderColor: 'rgba(255, 220, 90, 0.25)' }}
                            animate={{ scale: [0.9, 1.2, 0.9], opacity: [0.4, 0.1, 0.4] }}
                            transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
                        />
                    </>
                )}
                {weather.mood === 'clear' && !animatedScene && (
                    <div
                        className="absolute -top-8 -right-6 w-24 h-24 rounded-full"
                        style={{ background: 'radial-gradient(circle, rgba(255,220,90,0.95) 0%, rgba(255,220,90,0.15) 70%, transparent 100%)' }}
                    />
                )}

                {weather.mood === 'cloudy' && animatedScene && (
                    <>
                        <motion.div
                            className="absolute top-3 left-3 w-20 h-10 rounded-full blur-sm"
                            style={{ background: 'rgba(195, 205, 230, 0.35)' }}
                            animate={{ x: [0, 8, 0] }}
                            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
                        />
                        <motion.div
                            className="absolute top-8 right-6 w-24 h-12 rounded-full blur-sm"
                            style={{ background: 'rgba(170, 185, 220, 0.28)' }}
                            animate={{ x: [0, -8, 0] }}
                            transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
                        />
                    </>
                )}
                {weather.mood === 'cloudy' && !animatedScene && (
                    <>
                        <div
                            className="absolute top-3 left-3 w-20 h-10 rounded-full blur-sm"
                            style={{ background: 'rgba(195, 205, 230, 0.35)' }}
                        />
                        <div
                            className="absolute top-8 right-6 w-24 h-12 rounded-full blur-sm"
                            style={{ background: 'rgba(170, 185, 220, 0.28)' }}
                        />
                    </>
                )}

                {weather.mood === 'rain' && animatedScene && RAIN_LINES.map((drop, idx) => (
                    <motion.div
                        key={`rain-${idx}`}
                        className="absolute top-0 w-[1px] h-4"
                        style={{ left: drop.left, background: 'rgba(130, 180, 255, 0.55)' }}
                        animate={{ y: [-10, 120], opacity: [0, 1, 0] }}
                        transition={{
                            duration: drop.duration,
                            delay: drop.delay,
                            repeat: Infinity,
                            ease: 'linear',
                        }}
                    />
                ))}
                {weather.mood === 'rain' && !animatedScene && (
                    <div
                        className="absolute inset-0"
                        style={{ background: 'linear-gradient(180deg, rgba(130,180,255,0.12), transparent 55%)' }}
                    />
                )}

                {weather.mood === 'snow' && animatedScene && SNOW_FLAKES.map((flake, idx) => (
                    <motion.div
                        key={`snow-${idx}`}
                        className="absolute top-0 rounded-full"
                        style={{
                            left: flake.left,
                            width: `${flake.size}px`,
                            height: `${flake.size}px`,
                            background: 'rgba(255,255,255,0.85)',
                        }}
                        animate={{ y: [-10, 120], x: [0, (idx % 2 === 0 ? 6 : -6), 0], opacity: [0, 1, 0] }}
                        transition={{
                            duration: flake.duration,
                            delay: flake.delay,
                            repeat: Infinity,
                            ease: 'linear',
                        }}
                    />
                ))}
                {weather.mood === 'snow' && !animatedScene && (
                    <div
                        className="absolute inset-0"
                        style={{ background: 'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.18), transparent 30%), radial-gradient(circle at 80% 25%, rgba(255,255,255,0.14), transparent 26%), linear-gradient(180deg, rgba(255,255,255,0.06), transparent 60%)' }}
                    />
                )}

                {weather.mood === 'storm' && animatedScene && (
                    <>
                        <div
                            className="absolute inset-0"
                            style={{ background: isLight ? 'linear-gradient(180deg, rgba(96,165,250,0.12), transparent 72%)' : 'linear-gradient(180deg, rgba(22,27,50,0.5), rgba(18,21,38,0.15))' }}
                        />
                        <motion.div
                            className="absolute top-2 right-10 w-[2px] h-16"
                            style={{ background: 'linear-gradient(180deg, rgba(255,255,180,0.9), rgba(255,255,180,0))' }}
                            animate={{ opacity: [0, 0.95, 0, 0, 0.8, 0] }}
                            transition={{ duration: 3.2, repeat: Infinity, ease: 'linear' }}
                        />
                    </>
                )}
                {weather.mood === 'storm' && !animatedScene && (
                    <div
                        className="absolute inset-0"
                        style={{ background: isLight ? 'linear-gradient(180deg, rgba(96,165,250,0.12), transparent 72%)' : 'linear-gradient(180deg, rgba(22,27,50,0.5), rgba(18,21,38,0.15))' }}
                    />
                )}

                {weather.mood === 'fog' && animatedScene && MIST_LAYERS.map((layer, idx) => (
                    <motion.div
                        key={`fog-${idx}`}
                        className="absolute left-0 right-0 h-4 rounded-full blur-sm"
                        style={{ top: layer.top, background: 'rgba(200, 210, 230, 0.2)' }}
                        animate={{ x: [-6, 6, -6], opacity: [0.2, 0.35, 0.2] }}
                        transition={{ duration: 5.2, delay: layer.delay, repeat: Infinity, ease: 'easeInOut' }}
                    />
                ))}
                {weather.mood === 'fog' && !animatedScene && (
                    <div
                        className="absolute inset-0"
                        style={{ background: 'linear-gradient(180deg, rgba(200,210,230,0.14), rgba(200,210,230,0.04) 55%, transparent)' }}
                    />
                )}
            </div>

            <div className="relative px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="text-xs uppercase tracking-wide text-muted-fg">
                            {formatMessage(messages.weather.title, { city: weather.city })}
                        </p>
                        <h3 className="text-lg font-semibold text-fg">
                            {weather.summary}, {weather.temperature}°C
                        </h3>
                        <p className="text-xs mt-1 text-secondary-fg">
                            {weather.tempMin !== null && weather.tempMax !== null
                                ? formatMessage(messages.weather.today, { min: weather.tempMin, max: weather.tempMax })
                                : messages.weather.forecastRefreshing}
                        </p>
                    </div>
                </div>
                <p className="text-sm mt-2 text-secondary-fg">
                    {weather.suggestion}
                </p>
            </div>
        </div>
    );
}
