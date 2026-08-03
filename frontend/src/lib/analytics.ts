// Инертный no-op: события никуда не отправляются (нет сети, очередей и таймеров).
// Функции и класс сохранены, чтобы существующие точки вызова компилировались
// без изменений.

interface TrackEventOptions {
    path?: string;
    feature?: string;
    label?: string;
    status?: string;
    details?: string;
    value?: number;
}

export class FirstPartyAnalytics {
    init(_pathname: string): void {}
    trackPage(_pathname: string, _isFirst = false): void {}
    trackEvent(_eventType: string, _options?: TrackEventOptions): void {}
    onVisibilityChange(): void {}
    endSession(_reasonPath?: string): void {}
    flush(): void {}
}

export function trackAnalyticsEvent(_eventType: string, _options?: TrackEventOptions): void {
    // no-op
}
