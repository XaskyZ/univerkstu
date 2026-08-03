export interface GlobalChatMessageView {
    id: string;
    authorUserId: string;
    authorLabel: string;
    body: string;
    createdAt: Date;
    isPinned: boolean;
    pinnedAt: Date | null;
    isOwn: boolean;
    canDelete: boolean;
    isReportedByViewer: boolean;
    reportCount: number;
}

export interface GlobalChatMuteView {
    id: string;
    userId: string;
    mutedBy: string;
    reason: string | null;
    createdAt: Date;
    expiresAt: Date | null;
    revokedAt: Date | null;
    revokedBy: string | null;
    isActive: boolean;
}

export interface GlobalChatViewerState {
    canModerate: boolean;
    isMuted: boolean;
    mute: GlobalChatMuteView | null;
}

export type GlobalChatReportStatus = 'open' | 'dismissed' | 'actioned';

export interface GlobalChatReportView {
    id: string;
    messageId: string;
    messageBody: string;
    messageCreatedAt: Date;
    messageAuthorUserId: string;
    messageAuthorLabel: string;
    reporterUserId: string;
    reporterLabel: string;
    reason: string;
    details: string | null;
    status: GlobalChatReportStatus;
    createdAt: Date;
    reviewedAt: Date | null;
    reviewedBy: string | null;
    resolutionNote: string | null;
    messageDeletedAt: Date | null;
}
