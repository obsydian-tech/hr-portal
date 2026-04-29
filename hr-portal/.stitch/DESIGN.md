# Design System Document: Naleko HR Portal

> **Design System Name:** Naleko Executive
> **Stitch Asset ID:** `2b52b787b2c847e79a3ac75689442513`
> **Mode:** Light | **Device:** Desktop
> **Headline Font:** Manrope | **Body Font:** Inter
> **Roundness:** ROUND_FOUR | **Spacing Scale:** 2

---

## 1. Overview & Creative North Star

The objective of this design system is to translate the corporate authority of Naleko Digital Solutions into a high-end, editorial HR experience. We are moving away from the "utility dashboard" aesthetic toward a philosophy we call **"The Digital Architect."**

This North Star emphasizes structural clarity, intentional white space, and a premium "executive" feel. Instead of dense grids and heavy borders, the interface uses a sophisticated interplay of deep navy depths (`primary_container`) and pristine white surfaces (`surface_container_lowest`). We break the monotony of traditional corporate portals through **intentional asymmetry** — large typographic displays balanced against airy, floating interactive cards — creating a digital environment that feels curated rather than just assembled.

---

## 2. Colors & Tonal Depth

The palette is anchored in a high-contrast relationship between deep tech-forward navy and clean, professional neutrals.

### The "No-Line" Rule
To achieve a high-end editorial look, **1px solid borders for sectioning are strictly prohibited.** Boundaries must be defined solely through background color shifts or tonal transitions. Use `surface_container_low` against a `background` to define a section. The lack of lines forces a cleaner, more modern visual flow.

### Named Color Tokens

| Token | Hex | Role |
|-------|-----|------|
| `primary` | #000000 | Deep anchor for CTA gradients |
| `primary_container` | #16124d | Primary navy — hero headers, sidebar, CTA gradient start |
| `primary_fixed` | #e3dfff | Subtle highlights, tech-forward data visualization |
| `primary_fixed_dim` | #c4c0ff | Dimmed primary highlights |
| `on_primary` | #ffffff | Text on primary surfaces |
| `on_primary_container` | #807dbd | Text on primary containers |
| `on_primary_fixed` | #16124d | Text on primary fixed surfaces |
| `on_primary_fixed_variant` | #42407b | Variant text on primary fixed |
| `inverse_primary` | #c4c0ff | Active sidebar indicator accent |
| `secondary` | #5c598b | Secondary interactive elements |
| `secondary_container` | #cbc6ff | Secondary button backgrounds |
| `on_secondary` | #ffffff | Text on secondary |
| `on_secondary_container` | #545182 | Text on secondary containers |
| `on_secondary_fixed` | #181543 | Text on secondary fixed |
| `on_secondary_fixed_variant` | #444172 | Variant text on secondary fixed |
| `secondary_fixed` | #e3dfff | Secondary fixed surfaces |
| `secondary_fixed_dim` | #c5c1fa | Dimmed secondary fixed |
| `tertiary` | #000000 | Tertiary anchor |
| `tertiary_container` | #360f01 | Tertiary container — warm accent |
| `tertiary_fixed` | #ffdbce | Status capsule backgrounds — warm professional contrast |
| `tertiary_fixed_dim` | #ffb599 | Dimmed tertiary fixed |
| `on_tertiary` | #ffffff | Text on tertiary |
| `on_tertiary_container` | #b4745a | Text on tertiary containers |
| `on_tertiary_fixed` | #360f01 | Text on tertiary fixed — status capsule text |
| `on_tertiary_fixed_variant` | #6c3923 | Variant text on tertiary fixed |
| `background` | #f8f9fa | Page backdrop (Level 0) |
| `surface` | #f8f9fa | Main page backdrop (Level 0) |
| `surface_bright` | #f8f9fa | Glassmorphic pop-overs at 40% opacity |
| `surface_container` | #edeeef | Container surfaces |
| `surface_container_high` | #e7e8e9 | High-emphasis containers, ghost button hover |
| `surface_container_highest` | #e1e3e4 | Highest emphasis containers |
| `surface_container_low` | #f3f4f5 | Section backgrounds (Level 1), sidebar |
| `surface_container_lowest` | #ffffff | Cards, interaction points (Level 2) |
| `surface_dim` | #d9dadb | Dimmed surface |
| `surface_tint` | #5a5894 | Surface tint |
| `surface_variant` | #e1e3e4 | Glassmorphic nav backdrop-blur |
| `on_background` | #191c1d | Page title text |
| `on_surface` | #191c1d | Body text — NEVER use pure #000000 |
| `on_surface_variant` | #47464f | Secondary/muted text |
| `inverse_on_surface` | #f0f1f2 | Text on inverted surfaces |
| `inverse_surface` | #2e3132 | Dark inverted backgrounds |
| `outline` | #787681 | Input bottom-border indicator |
| `outline_variant` | #c8c5d1 | Ghost border fallback at 15% opacity |
| `error` | #ba1a1a | Error states |
| `error_container` | #ffdad6 | Error background tint |
| `on_error` | #ffffff | Text on error |
| `on_error_container` | #93000a | Text on error containers |

### Surface Hierarchy & Nesting

| Level | Token | Hex | Usage |
|-------|-------|-----|-------|
| Level 0 (Base) | `surface` | #f8f9fa | Main page backdrop |
| Level 1 (Sections) | `surface_container_low` | #f3f4f5 | Large content areas, sidebars |
| Level 2 (Objects) | `surface_container_lowest` | #ffffff | Cards, interaction points |
| Level 3 (Pop-overs) | `surface_bright` | #f8f9fa @ 40% | Glassmorphic tooltips, floating menus |

### Signature Textures
Main CTAs and hero headers use a subtle **radial gradient** from `primary_container` (#16124d) top-left → `primary` (#000000) bottom-right.

---

## 3. Typography

| Scale | Font | Size | Weight | Usage | Notes |
|-------|------|------|--------|-------|-------|
| Display-LG | Manrope | 3.5rem | Bold | Page titles, welcome headers | -2% letter-spacing, `on_background` |
| Headline-SM | Manrope | 1.5rem | SemiBold | Section headers | `on_background` |
| Body | Inter | 1rem | Regular | Descriptions, labels, content | `on_surface` (#191c1d) |
| Label-MD | Inter | 0.75rem | Medium | Metadata, small headers | UPPERCASE, +5% letter-spacing |

### Rules
- **Display & Headlines (Manrope):** Wide apertures for openness and modernity
- **Body & Titles (Inter):** Maximum legibility for functional HR content
- Never use pure #000000 for body text — always `on_surface` (#191c1d)

---

## 4. Elevation & Depth

- **Tonal Layering:** White cards (#ffffff) on light gray sections (#f3f4f5) — contrast alone provides lift
- **Ambient Shadows:** Ghost Shadow `0px 24px 48px rgba(22, 18, 77, 0.06)` — navy-tinted, not grey
- **Ghost Border:** `outline_variant` (#c8c5d1) at 15% opacity — only when accessibility requires
- **Glassmorphism:** `backdrop-blur(12px)` on `surface_variant` for scroll-over nav bars

---

## 5. Components

### Buttons
| Variant | Background | Text | Radius |
|---------|-----------|------|--------|
| Primary | Gradient: #16124d → #000000 | `on_primary` (#ffffff) | 0.375rem |
| Secondary | `secondary_container` (#cbc6ff) | `on_secondary_container` (#545182) | 0.375rem |
| Tertiary/Ghost | Transparent (hover: `surface_container_high`) | `primary_container` (#16124d) | 0.375rem |

### Input Fields
- Container: `surface_container_lowest` (#ffffff)
- Indicator: 2px bottom-border `outline` (#787681), transforms to `primary_container` on focus
- Error: `error` (#ba1a1a) text + `error_container` (#ffdad6) background

### Cards & Lists
- **Strictly forbid divider lines**
- Separate items with `spacing-4` (1rem) vertical white space or alternating `surface_container_lowest` / `surface_container_low`
- Status Capsule: `tertiary_fixed` (#ffdbce) background, `on_tertiary_fixed` (#360f01) text

### Navigation Sidebar
- Background: `primary_container` (#16124d)
- Active: 4px left bar `inverse_primary` (#c4c0ff) + `on_primary_fixed_variant` background highlight

---

## 6. Spacing

| Token | Value |
|-------|-------|
| spacing-1 | 0.25rem |
| spacing-2 | 0.5rem |
| spacing-4 | 1rem |
| spacing-6 | 1.5rem |
| spacing-8 | 2rem |
| spacing-12 | 3rem |
| spacing-16 | 4rem |

**Rule:** Use `spacing-12` (3rem) and `spacing-16` (4rem) between major sections.

---

## 7. Do's and Don'ts

### Do
- Use generous white space (`spacing-12`, `spacing-16`) between sections
- Use `primary_fixed` (#e3dfff) for subtle data highlights
- Align all text to strict vertical rhythm
- Mix `none` (0px) radius for structural containers + `xl` (0.75rem) for interactive cards
- Use thin-stroke "Linear" style icons matching Inter weight

### Don't
- Use pure #000000 for body text → use `on_surface` (#191c1d)
- Use 1px solid borders for sectioning → use tonal transitions
- Use divider lines in cards/lists → use spacing or alternating backgrounds
- Use standard 4px corners everywhere → vary by element type
- Use generic icons → use thin-stroke Linear style

---

*Director's Final Note: The portal should feel less like a database and more like a high-end corporate magazine. Prioritize "The White Space" as much as "The Data."*
