# Markflow 1.1 — UI / UX audit

Date: 2026-10-27. Platform: macOS on Apple Silicon. Scope: the shipped single-document desktop application, including its native shell, local file workflows and both editing modes. All screenshots use the bundled generic welcome document and isolated test profiles.

## Design decisions

The redesign follows the document-first structure in Apple's [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars), [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars), and [Pop-up buttons](https://developer.apple.com/design/human-interface-guidelines/pop-up-buttons) guidance. It uses system typography, restrained semantic colors, blue selection states, a unified document toolbar, optional navigation and inspector panes, and familiar keyboard shortcuts.

Application menus, appearance/export/writing popup menus, file dialogs and traffic-light window controls are native macOS components. The settings sheet, segmented controls and editor layout are accessible HTML/CSS inside Electron. This is not a SwiftUI rewrite or an Apple-certified interface. Lucide icons are distributed under their own license; no Apple font files or SF Symbols assets are redistributed.

## Problems found and resolved

| Priority | Observed issue | Resolution and evidence |
| --- | --- | --- |
| P1 | A toolbar action canceled a pending autosave indefinitely. | Re-arm pending saves after commands. Verify actual disk bytes after a sidebar action and subsequent typing. |
| P1 | Disabling the editor during every action removed focus; background saving interrupted typing. | Lock only file operations; restore the active editor and valid selection. Verify typing continues after autosave. |
| P1 | Recreating the editor on mode changes discarded undo. | Keep one editor across mode changes and maintain document-level history. Verify keyboard undo/redo, native Edit menu, PDF export and return to the saved dirty state. |
| P2 | Canceling a save conflict while closing could reopen the conflict every 1.2 seconds. | Propagate save cancellation through leaving operations; pause autosave until another edit or an explicit save. Verify no repeat dialog and unchanged external bytes. |
| P2 | Source mode exposed an empty split-preview panel with unrelated device tabs. | Use editor-only source mode and assert the preview panel is hidden. |
| P2 | Narrow windows let the outline cover the writing area by default. | Automatically collapse the inspector below 1180 CSS px; explicit opening remains available. Test at 920 × 640 and 125% zoom. |
| P2 | Typewriter spacing affected printed page layout. | Override its padding in print media and assert zero editor bottom padding. |
| P2 | Appearance control had an awkward select arrow and weak state visibility. | Replace the sidebar select with a native radio popup; show its current label and follow system appearance changes. |
| P2 | Settings did not have a clear, keyboard-accessible home. | Add a modal settings sheet, focus containment, Escape dismissal and trigger-focus restoration. |
| P2 | Empty search had no clear next step. | Add an explicit Open Folder action and explanatory state. |
| P3 | Missing close icon and small source control targets. | Use licensed SVG icons and consistent control targets of at least 28 px for tested toolbar actions. |
| P3 | Source headings inherited oversized rich-document styles. | Normalize source typography to the monospace editing scale. |

## Verification matrix

| Area | Checks |
| --- | --- |
| File safety | Open, save, Save As, cancel, close/save, re-open current dirty file, external-change conflict, BOM/CRLF/permissions, invalid UTF-8 rejection. |
| Editor | Immediate rendering, source roundtrip, headings/tables, offline KaTeX/Mermaid, local relative images, dirty-state retention, undo/redo, autosave and caret continuity. |
| Navigation | Folder tree, literal search, result-to-line navigation, keyboard sidebar tabs, actionable empty state. |
| Appearance | System/light/dark/warm paper choices; native radio state; persisted preferences; system appearance notifications. |
| Layout | Wide view, 920 × 640 window, 125% zoom, toolbar bounds, no horizontal document-shell overflow, focus mode restoration. |
| Accessibility | Named controls, pressed/expanded/selected state, native accessibility tree, settings focus trap, Escape, keyboard tabs and resize separator. |
| Export | Portable HTML embeds local image bytes; built-in PDF produces a valid PDF header; missing Pandoc has a helpful message; mode/history survive export; print excludes typewriter spacing. |
| Isolation | Context isolation, no renderer Node access, restricted local-resource protocol, traversal and symlink-escape rejection. |

Verified release results: **8 unit tests and 17 Electron end-to-end tests passed**. The full end-to-end suite was also run against the ad-hoc-signed, packaged application. End-to-end tests use real renderer code, IPC and temporary disk files. Native file-dialog responses are substituted for repeatability. The radio-menu test captures a native Electron Menu object and invokes its real callback. Native window/menu accessibility was also inspected separately in a clean profile.

## Visual evidence

- [Light appearance](01-light.png)
- [Dark appearance](02-dark.png)
- [Settings sheet](03-settings.png)
- [Source editing](04-source.png)
- [Compact window](05-compact.png)
- [125% zoom](06-zoom.png)
- [Empty search](07-search-empty.png)

## Limits and follow-up scope

This review is a functional and visual release audit, not an exhaustive accessibility certification. Full VoiceOver reading/editing, IME composition edge cases, very large documents, all possible Markdown extensions and every third-party Pandoc/LaTeX setup have not been exhaustively tested. The current app is single-document, has session-only recent files and manual folder refresh. History is bounded to 50 states with a memory cap. Remote image URLs in documents may contact their source.

The distributed Apple Silicon app is ad-hoc signed and not Apple-notarized. Distribution on Intel Macs, App Store submission and Developer ID notarization are outside this release. No claim of zero remaining UI/UX defects is made.

## Public-release privacy boundary

The public source and application contain only product code, licensed dependencies, generic welcome content, test fixtures and sample screenshots. Original handoff/planning records, local profiles, test traces, logs, personal Markdown files, machine paths and credentials are excluded. The release archive contains the app bundle only; user documents and preference profiles are never copied into it.
