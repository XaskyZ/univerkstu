import { Download } from 'lucide-react';
import { UMKDCourse } from '@/lib/types';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { useLanguage } from '@/lib/language-context';
import { API_BASE_URL } from '@/lib/api-base';
import { formatUmkdDownloads, formatUmkdUploadedDate } from './umkd-file-meta';

interface UMKDFileListProps {
    course: UMKDCourse;
}

/**
 * Renders the file list for a single UMKD course.
 *
 * Extracted from the old `UMKDCourseCard` so the same JSX can be reused by:
 *   - the legacy inline-expanded card (`UMKDCourseCard`)
 *   - the new dedicated detail page `/umkd/[courseId]`
 *
 * Markup and behavior are intentionally identical to the prior in-card list:
 *   - internal download links use `/api/v3/...?download=1`
 *   - external/unsupported files render with a dashed border and hint to
 *     refresh UMKD so the backend can prepare them
 *   - empty courses show a single explanatory line
 */
export function UMKDFileList({ course }: UMKDFileListProps) {
    const { messages, language } = useLanguage();

    return (
        <div
            className="border-t p-3 space-y-2"
            style={{ borderColor: 'var(--border)', background: 'rgba(0,0,0,0.1)' }}
        >
            {course.files.length > 0 ? (
                course.files.map((file, fileIndex) => {
                    const hasInternalDownload = Boolean(file.downloadUrl || file.localUrl);
                    const fileDownloadUrl = file.downloadUrl
                        ? `${API_BASE_URL}${file.downloadUrl}?download=1`
                        : file.localUrl
                            ? `${API_BASE_URL}${file.localUrl}?download=1`
                            : '';
                    const fileUrl = file.downloadUrl || file.localUrl || file.url;

                    if (!hasInternalDownload) {
                        return (
                            <div
                                key={file.id || fileIndex}
                                className="flex items-center gap-3 p-3 rounded-lg surface-overlay-2"
                                style={{
                                    border: '1px dashed var(--border)',
                                    opacity: 0.9,
                                }}
                            >
                                <FileIcon url={fileUrl} />
                                <div className="flex-1 min-w-0">
                                    <span className="text-sm font-medium block truncate text-fg">
                                        {file.name}
                                    </span>
                                    <div className="flex items-center gap-2 text-xs mt-0.5 flex-wrap text-muted-fg">
                                        <span>{messages.umkd.fileNotReady}</span>
                                        <span>• {messages.umkd.updateUmkd}</span>
                                    </div>
                                </div>
                            </div>
                        );
                    }

                    return (
                        <a
                            key={file.id || fileIndex}
                            href={fileDownloadUrl}
                            download=""
                            onClick={() => {
                                trackAnalyticsEvent('cta_click', {
                                    feature: 'umkd_download',
                                    label: file.name,
                                    status: 'attempt',
                                    path: '/umkd',
                                });
                            }}
                            className="flex items-center gap-3 p-3 rounded-lg transition-all hover:scale-[1.01] surface-overlay-2"
                            style={{ border: '1px solid var(--border)' }}
                        >
                            <FileIcon url={fileUrl} />
                            <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium block truncate text-fg">
                                    {file.name}
                                </span>
                                <div className="flex items-center gap-2 text-xs mt-0.5 flex-wrap text-muted-fg">
                                    {file.type && <span>{file.type}</span>}
                                    {file.lang && <span>• {file.lang}</span>}
                                    {file.size && <span>• {file.size}</span>}
                                    {(() => {
                                        const downloadsLabel = formatUmkdDownloads(file.downloads, language);
                                        return downloadsLabel ? <span title={downloadsLabel.title}>• {downloadsLabel.label}</span> : null;
                                    })()}
                                    {(() => {
                                        const uploadedLabel = formatUmkdUploadedDate(file.uploaded, language);
                                        return uploadedLabel ? <span title={uploadedLabel.title}>• {uploadedLabel.label}</span> : null;
                                    })()}
                                </div>
                            </div>
                            <Download
                                className="w-4 h-4 flex-shrink-0"
                                style={{ color: 'var(--primary)' }}
                                strokeWidth={2}
                                aria-hidden
                            />
                        </a>
                    );
                })
            ) : (
                <p className="text-sm text-center py-4 text-muted-fg">
                    {course.isEmpty ? messages.umkd.filesNotUploaded : messages.umkd.filesNotFound}
                </p>
            )}
        </div>
    );
}

function FileIcon({ url }: { url?: string }) {
    const iconStyle = {
        width: 32,
        height: 32,
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.7rem',
        fontWeight: 700,
    };

    const ext = url?.toLowerCase() || '';

    if (ext.includes('.pdf')) {
        return <div style={{ ...iconStyle, background: 'var(--filetype-pdf-bg)', color: 'var(--filetype-pdf-color)' }}>PDF</div>;
    }
    if (ext.includes('.doc')) {
        return <div style={{ ...iconStyle, background: 'var(--filetype-doc-bg)', color: 'var(--filetype-doc-color)' }}>DOC</div>;
    }
    if (ext.includes('.xls')) {
        return <div style={{ ...iconStyle, background: 'var(--filetype-xls-bg)', color: 'var(--filetype-xls-color)' }}>XLS</div>;
    }
    if (ext.includes('.ppt')) {
        return <div style={{ ...iconStyle, background: 'var(--filetype-ppt-bg)', color: 'var(--filetype-ppt-color)' }}>PPT</div>;
    }
    if (ext.includes('.zip') || ext.includes('.rar')) {
        return <div style={{ ...iconStyle, background: 'var(--filetype-zip-bg)', color: 'var(--filetype-zip-color)' }}>ZIP</div>;
    }
    return <div style={{ ...iconStyle, background: 'var(--muted)', color: 'var(--text)' }}>FILE</div>;
}
