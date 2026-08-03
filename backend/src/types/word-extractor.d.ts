/**
 * Minimal ambient type declarations for the `word-extractor` package.
 *
 * The upstream package (https://github.com/morungos/node-word-extractor) ships
 * without TypeScript types. We only consume `new WordExtractor().extract(buffer)`
 * and `Document.getBody()`, so a minimal stub is enough to satisfy strict mode.
 */
declare module 'word-extractor' {
    export interface WordExtractorReadOptions {
        filterUnicode?: boolean;
        includeFooters?: boolean;
        includeBody?: boolean;
        includeHeadersAndFooters?: boolean;
    }

    export class Document {
        getBody(options?: WordExtractorReadOptions): string;
        getFootnotes(options?: WordExtractorReadOptions): string;
        getEndnotes(options?: WordExtractorReadOptions): string;
        getHeaders(options?: WordExtractorReadOptions): string;
        getFooters(options?: WordExtractorReadOptions): string;
        getAnnotations(options?: WordExtractorReadOptions): string;
        getTextboxes(options?: WordExtractorReadOptions): string;
    }

    export default class WordExtractor {
        constructor();
        extract(source: string | Buffer): Promise<Document>;
    }
}
