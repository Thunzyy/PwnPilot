# Feature: Report Generation

> Automated write-up and report creation from pentest timeline

## Status

| Attribute    | Value        |
| ------------ | ------------ |
| Status       | `planned`    |
| Phase        | Phase 5      |
| Priority     | High         |
| Last Updated | 2026-01-24   |

## Overview

Report generation transforms the pentest timeline into professional write-ups and reports. Supports multiple formats (Markdown, HTML, PDF) and templates (HTB write-up, professional pentest report).

## User Stories

- As a pentester, I want to generate a write-up from my timeline
- As a user, I want to export to Markdown for my blog
- As a professional, I want PDF reports for clients

## Requirements

### Functional Requirements

1. **FR-001**: The system shall generate write-ups from timeline data
2. **FR-002**: The system shall support templates:
   - HTB/THM write-up (blog style)
   - Professional pentest report
   - Executive summary
3. **FR-003**: The system shall export to Markdown, HTML, PDF
4. **FR-004**: The system shall use LLM for prose generation
5. **FR-005**: The system shall allow manual editing before export

### Non-Functional Requirements

1. **NFR-001**: Report generation < 30s for average project
2. **NFR-002**: PDF rendering < 5s
3. **NFR-003**: Support images and screenshots in reports

## Architecture

### Components

| Component        | Location                                    | Purpose              |
| ---------------- | ------------------------------------------- | -------------------- |
| Report Router    | `backend/app/routers/reports.py`            | API endpoints        |
| Report Service   | `backend/app/services/report_service.py`    | Generation logic     |
| Template Engine  | `backend/app/services/report_templates.py`  | Template processing  |
| PDF Generator    | `backend/app/services/pdf_generator.py`     | PDF export           |
| Report UI        | `frontend/src/components/Reports/`          | Editor interface     |
| Report Store     | `frontend/src/stores/reportStore.ts`        | State management     |

### Generation Flow

```
1. User triggers report generation
   ↓
2. Collect data (timeline, credentials, flags, screenshots)
   ↓
3. Select template (HTB write-up, professional report)
   ↓
4. LLM generates prose for each section
   ↓
5. User reviews/edits in WYSIWYG editor
   ↓
6. Export to chosen format
```

### Data Model

```sql
CREATE TABLE reports (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    name TEXT NOT NULL,
    template TEXT NOT NULL,     -- htb_writeup|pentest_report|executive
    content JSON NOT NULL,      -- Sections with markdown content
    status TEXT DEFAULT 'draft',
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

### API Endpoints

| Method | Endpoint                           | Description          |
| ------ | ---------------------------------- | -------------------- |
| POST   | `/api/reports/generate`            | Start generation     |
| GET    | `/api/reports/{id}`                | Get report           |
| PUT    | `/api/reports/{id}`                | Update content       |
| POST   | `/api/reports/{id}/export`         | Export to format     |

## Templates

### HTB Write-up Template

```markdown
# [Box Name] - HackTheBox

## Overview
- **Difficulty**: [Easy/Medium/Hard/Insane]
- **OS**: [Linux/Windows]
- **Release Date**: [Date]

## Reconnaissance
[LLM-generated summary of recon phase]

## Foothold
[LLM-generated exploitation narrative]

## Privilege Escalation
[LLM-generated privesc narrative]

## Flags
- User: [flag]
- Root: [flag]

## Lessons Learned
[LLM-generated takeaways]
```

### Professional Pentest Report Template

```markdown
# Penetration Test Report

## Executive Summary
[High-level findings for management]

## Scope
[Tested systems and boundaries]

## Methodology
[Testing approach]

## Findings

### Critical
[Ranked vulnerabilities]

### High
### Medium
### Low

## Recommendations
[Remediation steps]

## Appendix
[Technical details, screenshots]
```

## Editor Integration

Consider using:
- **TipTap** - ProseMirror-based, extensible
- **Plate** - Full-featured, good for structured content
- **Milkdown** - Markdown-first, clean UI

Recommendation: TipTap for flexibility and markdown support.

## PDF Generation

Options:
- **Puppeteer/Playwright** - HTML → PDF, best quality
- **react-pdf** - React-based rendering
- **WeasyPrint** - Python CSS-based

Recommendation: Puppeteer for best HTML fidelity.

## Dependencies

```
# Backend
jinja2  # Template engine
playwright  # PDF generation
python-markdown  # Markdown processing

# Frontend
@tiptap/react  # Rich text editor
```

## Testing

### Unit Tests

- [ ] `test_report_service.py` - Generation logic
- [ ] `test_pdf_generator.py` - PDF export

## Changelog

| Date       | Author | Change                         |
| ---------- | ------ | ------------------------------ |
| 2026-01-24 | -      | Initial planning               |
