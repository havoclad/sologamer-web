# Extraction Discrepancies: Pass 1 (pdftotext) vs Pass 3 (pdfplumber)

## Summary

The two extraction passes produced **nearly identical content** for the rules sections (pages 4–21). Both tools extracted the same underlying text from the PDF; differences are purely formatting artifacts, not content disagreements.

## Formatting Differences

| Issue | Pass 1 (pdftotext) | Pass 3 (pdfplumber) |
|-------|--------------------|--------------------|
| **Column ordering** | Generally preserves left-then-right column order | Sometimes interleaves columns (e.g., page 4 mixes §1.0 with §2.5) |
| **Line breaks** | Cleaner paragraph separation | More run-together paragraphs |
| **Whitespace** | More consistent spacing | Occasional missing spaces at column joins (e.g., "ofB-17" → "ofB -17", "evenif" → "eveni f") |
| **OCR artifacts** | Both share identical OCR artifacts from the source: Cyrillic characters (ШІ, Тһе, ається), Arabic (ے ک), garbled counter text |

## No Content Disagreements Found

Both passes extracted the same rules text word-for-word. Where one pass has a formatting glitch (missing space, line break in wrong place), the other provides the clean version, making merge straightforward.

## OCR Issues Present in Both Passes

These are source PDF scan issues, not extraction differences:

- "at rial" should be "a trial" (§1.0)
- "dur ра" should be "during" (§6.5)
- Various Cyrillic/Arabic character substitutions in counter labels and diagram text
- Sample mission pages (12–17) have heavy OCR corruption in the Mission Chart reproductions
- Counter descriptions on pages 22–26 are mostly garbled in both passes

## Errata Cross-Reference

Both passes captured the same 3-item errata on page 20. The full 37-item errata from the separate errata sheet was captured only in the visual table extraction (pages 30–39).

## Recommendation

Pass 1 (pdftotext) provides the **better base text** for the rules — cleaner paragraph structure, more reliable column ordering. Pass 3 fills in a few spots where Pass 1 had line-break issues. The merged rules file uses Pass 1 as the base with Pass 3 corrections applied.
