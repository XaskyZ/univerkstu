import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'UniverSchedule — расписание, оценки и UMKD для студентов КарГТУ';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    padding: '72px',
                    background: 'linear-gradient(135deg, #0b1220 0%, #1e2b4d 60%, #2a4a8a 100%)',
                    color: '#f5f7fb',
                    fontFamily: 'sans-serif',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <div
                        style={{
                            width: 64,
                            height: 64,
                            borderRadius: 16,
                            background: '#3b82f6',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 36,
                            fontWeight: 700,
                        }}
                    >
                        US
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em' }}>
                            UniverSchedule
                        </span>
                        <span style={{ fontSize: 20, opacity: 0.75 }}>univerkstu.app</span>
                    </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div
                        style={{
                            fontSize: 72,
                            fontWeight: 700,
                            letterSpacing: '-0.03em',
                            lineHeight: 1.05,
                        }}
                    >
                        Расписание, оценки и UMKD
                    </div>
                    <div style={{ fontSize: 32, opacity: 0.85, fontWeight: 400 }}>
                        Для студентов Карагандинского технического университета
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '32px', fontSize: 22, opacity: 0.9 }}>
                    <span>📅 Личное расписание</span>
                    <span>📝 Оценки из Platonus</span>
                    <span>📚 UMKD-материалы</span>
                </div>
            </div>
        ),
        size
    );
}
