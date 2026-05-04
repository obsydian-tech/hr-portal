SCREEN: EMPLOYEE ONBOARDING WIZARD — "Your Journey Starts Here"

Sjabulile Mogashwa is a new hire at Naleko Digital Solutions. She just logged into the HR portal for the first time on her personal laptop at home. She's been invited to complete her onboarding — upload her ID, bank letter, and certificates — before her start date. The page she sees is clean, warm, and encouraging. It doesn't overwhelm her with a 6-stage stepper or a wall of text. Instead, it gently guides her through two simple steps: first accept the POPIA consent, then upload her documents one by one. She already accepted consent moments ago. Now she's on Step 2 — uploading documents. Her National ID was uploaded and instantly verified by OCR. Her Bank Confirmation Letter was also uploaded and verified. Her Matric Certificate was uploaded and is now under manual HR review. Her Tertiary Qualification is the last remaining item — she hasn't uploaded it yet. The page celebrates her progress without being patronising.

This is a DESKTOP screen (1440px wide). Light mode. The "Naleko Executive" design system.

═══════════════════════════════════════════════════════════
STRICT RULES — READ BEFORE GENERATING
═══════════════════════════════════════════════════════════

1. Do NOT add any buttons, icons, or UI elements not explicitly described below.
2. Do NOT add Settings, Support, Help, Profile, or Notification icons anywhere.
3. Do NOT add a footer of any kind.
4. Do NOT invent extra data — use ONLY the exact values provided below.
5. Do NOT add a search bar anywhere.
6. Do NOT add extra CTAs beyond what is specified below.
7. Do NOT use 1px solid borders anywhere for sectioning — define boundaries ONLY through background color shifts and tonal transitions. This is the "No-Line Rule."
8. Do NOT add filter dropdowns, export buttons, or date range pickers.
9. Do NOT add a horizontal stepper with numbered circles — the wizard uses a minimal dot indicator only.
10. Do NOT add any sidebar navigation — this page has NO sidebar. The full viewport width is used for content.

═══════════════════════════════════════════════════════════
DESIGN SYSTEM — COLORS (LIGHT MODE — EMPLOYEE)
═══════════════════════════════════════════════════════════

### Page Structure Colors
- Page background: #f8f9fa (surface — Level 0 base)
- Section/content area background: #f3f4f5 (surface_container_low — Level 1)
- Cards and interactive surfaces: #ffffff (surface_container_lowest — Level 2)
- Ambient card shadow: 0px 24px 48px rgba(22, 18, 77, 0.06) — navy-tinted ghost shadow

### Brand Colors
- Primary navy (hero welcome bar gradient start): #16124d (primary_container)
- Primary anchor (hero welcome bar gradient end): #000000 (primary)
- Primary button gradient: #16124d → #000000 (radial, top-left to bottom-right)
- Primary button text: #ffffff (on_primary)
- Secondary button background: #cbc6ff (secondary_container)
- Secondary button text: #545182 (on_secondary_container)
- Ghost/tertiary button text: #16124d (primary_container)
- Ghost button hover fill: #e7e8e9 (surface_container_high)

### Text Colors
- Page title / headlines: #191c1d (on_background)
- Body text / labels: #191c1d (on_surface) — NEVER pure black
- Muted / secondary text: #47464f (on_surface_variant)
- Text on dark navy surfaces: #ffffff (on_primary)
- Accent link text: #5c598b (secondary)

### Status Colors
- Success (verified badge, progress): #2e7d32 green for verified checkmark icon
- Success container: #e8f5e9 light green tint for verified field backgrounds
- Warning (under review): #f59e0b amber
- Warning container: #fff8e1 light amber for under-review state
- Info (pending): #787681 (outline) muted gray
- Error (rejected): #ba1a1a (error)
- Error container: #ffdad6 (error_container)

### Accent & Highlight
- Subtle highlight: #e3dfff (primary_fixed) — for progress indicator active dot
- Status capsule warm: #ffdbce background, #360f01 text (tertiary_fixed tokens)
- Wizard active dot: #16124d (primary_container)
- Wizard completed dot: #16124d (primary_container) with checkmark
- Wizard inactive dot: #c8c5d1 (outline_variant)

═══════════════════════════════════════════════════════════
DESIGN SYSTEM — TYPOGRAPHY
═══════════════════════════════════════════════════════════

- Welcome greeting (hero): Manrope Bold 2rem, color #ffffff, on the navy gradient bar
- Employee name in hero: Manrope SemiBold 1.25rem, color #ffffff
- Metadata in hero (EMP ID, department, start date): Inter Regular 0.8rem, color rgba(255,255,255,0.8)
- Section title ("Upload Documents"): Manrope SemiBold 1.5rem, color #191c1d
- Section subtitle: Inter Regular 0.9rem, color #47464f
- Document card title: Inter SemiBold 1rem, color #191c1d
- Document card description: Inter Regular 0.8rem, color #47464f
- OCR field label: Inter Medium 0.7rem, UPPERCASE, +5% letter-spacing, color #47464f
- OCR field value: Inter SemiBold 0.85rem, color #191c1d
- Wizard step label: Inter Medium 0.75rem, color #47464f (inactive) or #16124d (active)
- Button text: Inter SemiBold 0.85rem
- Progress counter: Inter SemiBold 0.85rem, color #47464f

═══════════════════════════════════════════════════════════
LAYOUT — TOP TO BOTTOM, FULL WIDTH, NO SIDEBAR
═══════════════════════════════════════════════════════════

The page has NO sidebar. The entire viewport is one scrollable column of content, centered, with a max-width of 960px and generous horizontal padding (spacing-16 = 4rem on each side from viewport edge to content).

### ZONE A — COMPACT WELCOME BAR (top of page, full-bleed width)

A horizontal bar spanning the full viewport width. Background: radial gradient from #16124d (top-left) to #000000 (bottom-right). Height: approximately 120px. Rounded bottom corners: 0.75rem.

Inside, centered content (max-width 960px):

LEFT SIDE:
- Line 1: "Welcome back, Sjabulile 👋" — Manrope Bold 2rem, white
- Line 2: "You're making great progress on your onboarding." — Inter Regular 0.9rem, rgba(255,255,255,0.75)

RIGHT SIDE (vertically centered, aligned right):
- Three metadata pills displayed horizontally in a row, each a small rounded capsule with rgba(255,255,255,0.12) background and white text:
  - Pill 1: "EMP-0000006"
  - Pill 2: "Finance"  
  - Pill 3: "Starts 23 April 2026"

No avatar, no large profile image. Clean and editorial.

### ZONE B — WIZARD PROGRESS INDICATOR (below welcome bar, 24px gap)

Centered on the page. A minimal horizontal indicator showing the 2 steps:

[●]———[●]

- Dot 1 (left): Filled circle #16124d with a small white checkmark inside (completed). Below: label "Consent" in Inter Medium 0.75rem, color #16124d.
- Connecting line: 2px solid #16124d (completed).
- Dot 2 (right): Filled circle #16124d (active/current). Below: label "Documents" in Inter Medium 0.75rem, color #16124d.

The dots are 24px diameter. The connecting line is 80px wide. The whole thing is tiny and understated — it's a reassurance element, not a hero. Total width of the indicator: approximately 130px, centered.

Below the dots, a small progress summary text centered: "3 of 4 documents complete" — Inter Regular 0.8rem, color #47464f.

### ZONE C — DOCUMENT UPLOAD SECTION (main content, 32px below wizard)

Section background: #f8f9fa (page base). Content max-width: 960px, centered.

Section header row:
- Left: "Upload Documents" — Manrope SemiBold 1.5rem, color #191c1d
- Right: A small rounded pill "3 of 4" in #e3dfff background, #16124d text, Inter SemiBold 0.75rem

Below the header (16px gap): "Upload each required document below. AI-powered verification will instantly validate your ID and bank details." — Inter Regular 0.875rem, color #47464f

### ZONE C CARDS — Four Document Cards (vertical stack, 16px gap between each)

Each card is a white (#ffffff) rounded rectangle (0.75rem radius), with navy-tinted ghost shadow. Padding: 24px. No borders whatsoever. Background color shifts indicate state.

────────────────────────────────────────
CARD 1: NATIONAL ID — STATUS: VERIFIED ✓
────────────────────────────────────────

Left side: A 40px circle with light green (#e8f5e9) background, containing a green checkmark icon.

Content area (to the right of circle):

Top row:
- "National ID" — Inter SemiBold 1rem, #191c1d
- Right-aligned: Green pill badge "VERIFIED" with checkmark icon, background #e8f5e9, text #2e7d32, Inter SemiBold 0.7rem, rounded-full

Description row (below title, 4px gap):
- "South African ID document — Verified by AI" — Inter Regular 0.8rem, #47464f

OCR Extracted Fields (16px below description):
A subtle container with #f8f9fa background (one shade darker than the card), rounded 0.5rem, padding 16px. Inside, a 2×2 grid of extracted fields:

| Row 1, Col 1 | Row 1, Col 2 |
|---|---|
| Label: "ID NUMBER" | Label: "DATE OF BIRTH" |
| Value: "9504120800086" | Value: "12 April 1995" |

| Row 2, Col 1 | Row 2, Col 2 |
|---|---|
| Label: "GENDER" | Label: "CITIZENSHIP" |
| Value: "Female" | Value: "SA Citizen" |

Each label: Inter Medium 0.7rem, UPPERCASE, +5% letter-spacing, #47464f
Each value: Inter SemiBold 0.85rem, #191c1d

Bottom-right of the card: Small ghost button "View Document" — Inter Medium 0.8rem, #5c598b, no background, with a small external-link icon.

────────────────────────────────────────
CARD 2: BANK CONFIRMATION — STATUS: VERIFIED ✓
────────────────────────────────────────

Same layout pattern as Card 1.

Left circle: Light green (#e8f5e9), green checkmark.

Top row:
- "Bank Account Confirmation Letter" — Inter SemiBold 1rem, #191c1d
- Right: Green pill "VERIFIED" (same as Card 1)

Description: "Bank-issued letter — Verified by AI" — Inter Regular 0.8rem, #47464f

OCR Extracted Fields (same subtle container treatment):
A 2-column + 1-row grid:

| Row 1, Col 1 | Row 1, Col 2 |
|---|---|
| Label: "BANK" | Label: "ACCOUNT HOLDER" |
| Value: "First National Bank" | Value: "Sjabulile Mogashwa" |

| Row 2, Col 1 | Row 2, Col 2 |
|---|---|
| Label: "ACCOUNT NUMBER" | Label: "BRANCH CODE" |
| Value: "62845901234" | Value: "250655" |

| Row 3 (full width) | |
|---|---|
| Label: "ACCOUNT TYPE" | |
| Value: "Cheque Account" | |

Bottom-right: Ghost button "View Document"

────────────────────────────────────────
CARD 3: MATRIC CERTIFICATE — STATUS: UNDER REVIEW
────────────────────────────────────────

Left circle: Light amber (#fff8e1) background, amber clock icon.

Top row:
- "Matric Certificate" — Inter SemiBold 1rem, #191c1d
- Right: Amber pill badge "UNDER HR REVIEW" with clock icon, background #fff8e1, text #92400e, Inter SemiBold 0.7rem, rounded-full

Description: "Your document has been submitted for manual review by the HR team. Average processing time is 24–48 hours." — Inter Regular 0.8rem, #47464f

NO OCR fields (this is a manually reviewed document).

NO action button — document is locked while under review. Instead, a small muted text: "Uploaded on 12 April 2026" — Inter Regular 0.75rem, #787681.

────────────────────────────────────────
CARD 4: TERTIARY QUALIFICATION — STATUS: PENDING
────────────────────────────────────────

Left circle: Light gray (#f3f4f5) background, gray graduation-cap icon (#787681).

Top row:
- "Tertiary Qualification(s)" — Inter SemiBold 1rem, #191c1d
- Right: Gray pill badge "PENDING" — background #f3f4f5, text #787681, Inter SemiBold 0.7rem, rounded-full

Description: "Manual verification by HR. Multiple uploads allowed. Accepted formats: PDF, JPG, PNG (max 5MB)." — Inter Regular 0.8rem, #47464f

Upload interaction area (16px below description):
A dashed-outline zone (2px dashed #c8c5d1, rounded 0.5rem, background #f8f9fa) taking up the full card width, height approximately 80px. Center content:
- Cloud upload icon (#787681, 24px)
- "Drag & drop your file here" — Inter Regular 0.85rem, #47464f
- "or" — Inter Regular 0.75rem, #787681
- Small primary button: "Browse Files" — gradient #16124d → #000000, white text, Inter SemiBold 0.8rem, rounded 0.375rem, padding 8px 16px

### ZONE D — VERIFICATION NOTE (32px below last card)

A small informational area, not a card. Just centered text:
"ID and Bank Confirmation use AI-powered OCR for instant validation. Certificates are manually verified by the HR team." — Inter Regular 0.8rem, #787681, centered, max-width 600px.

### ZONE E — ENCOURAGEMENT FOOTER (24px below note)

A single line of friendly centered text:
"You're almost there, Sjabulile! Just one more document to go. 🎉" — Inter Medium 0.9rem, #16124d, centered.

Below that: 48px of empty space before the page ends (breathing room).

═══════════════════════════════════════════════════════════
FEEL & NARRATIVE
═══════════════════════════════════════════════════════════

This screen must feel like a premium, curated onboarding experience — not a government form. The key emotions are:

1. CALM — generous white space between elements, no visual clutter
2. PROGRESS — the dot indicator and "3 of 4" counter celebrate what's done, not what's remaining  
3. TRUST — the verified OCR fields in the subtle gray containers prove the system works; the employee sees her own data extracted correctly and feels confidence
4. WARMTH — the welcome greeting uses her first name, the encouragement footer uses an emoji, the tone is human
5. EDITORIAL — the typography hierarchy (Manrope for display, Inter for body) and the tonal surface layering create a magazine-like quality

The overall composition should have the density of a well-designed Medium article — not a SaaS dashboard. Prioritise the white space as much as the data. The navy welcome bar at the top provides the visual anchor. Everything below it breathes.

═══════════════════════════════════════════════════════════
SIMULATED DATA — USE EXACTLY AS PROVIDED
═══════════════════════════════════════════════════════════

Employee:
- First name: Sjabulile
- Last name: Mogashwa
- Employee ID: EMP-0000006
- Department: Finance
- Planned start date: 23 April 2026
- HR Partner: Thabo Molefe

National ID OCR:
- ID Number: 9504120800086
- Date of Birth: 12 April 1995
- Gender: Female
- Citizenship: SA Citizen

Bank Confirmation OCR:
- Bank: First National Bank
- Account Holder: Sjabulile Mogashwa
- Account Number: 62845901234
- Branch Code: 250655
- Account Type: Cheque Account

Matric Certificate:
- Uploaded on: 12 April 2026
- Status: Under HR Review

Tertiary Qualification:
- Status: Pending (not yet uploaded)

Progress: 3 of 4 documents complete.
