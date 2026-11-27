-- PDF export (lib/pdf-export.ts, routes/pdf.ts). pages.allow_pdf: 1 when the
-- owner lets viewers download the page as a PDF from the viewer's badge; 0,
-- the default, when only the owner can (dashboard, `aired pdf`, export_pdf).
-- It's on the row because every KV cache record is rebuilt from the row
-- (metadataFromRow). The PDFs themselves are cached in R2 under
-- pages/<id>/pdf/<version>/, not in D1.
ALTER TABLE pages ADD COLUMN allow_pdf INTEGER NOT NULL DEFAULT 0;
