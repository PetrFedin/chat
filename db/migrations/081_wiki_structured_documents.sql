BEGIN;
ALTER TABLE wiki_pages ADD COLUMN document jsonb;
ALTER TABLE wiki_page_versions ADD COLUMN document jsonb;
ALTER TABLE wiki_pages ADD CONSTRAINT wiki_pages_document_root CHECK (document IS NULL OR (jsonb_typeof(document)='object' AND document->>'type'='doc'));
ALTER TABLE wiki_page_versions ADD CONSTRAINT wiki_page_versions_document_root CHECK (document IS NULL OR (jsonb_typeof(document)='object' AND document->>'type'='doc'));
COMMENT ON COLUMN wiki_pages.document IS 'Canonical structured page document; NULL on legacy plain-text pages. content is searchable text projection for structured pages.';
COMMIT;
