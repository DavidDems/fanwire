---
type: reference
---

# FrontendUI — branding: rights and free resources

Part of [branding.md](branding.md): rights in Canada for an AI-assisted mark, and the free resources fanwire may use.

### 4.3 Rights: what you would and would not own (Canada)

- **OpenAI's terms** (effective 2026-01-01,
  https://openai.com/policies/terms-of-use/): *"you … own the Output. We hereby
  assign to you all our right, title, and interest, if any, in and to
  Output."* Commercial use is allowed. Three caveats in the same document: the
  assignment covers rights **"if any"** exist; *"other users may receive
  similar output … Our assignment above does not extend to other users'
  output"*; and you may not *"Represent that Output was human-generated when it
  was not."* The assignment survives the end of the free Plus month.
- **Copyright in Canada is unsettled.** The only test case is *CIPPIC v Sahni*
  (Federal Court T-1717-24). It challenges a 2021 copyright registration that
  lists an AI tool as co-author, arguing that an AI can't be an author and the
  work lacks originality. On CIPPIC's case page, the parties were *"waiting
  for the Court to set a hearing date"* (https://www.cippic.ca/our-work/cippic-v-sahni).
  Music Publishers Canada intervened in July 2026, so the case is still live
  (https://www.musicpublishing.ca/news/2026-7-22-music-publishers-canada-intervenes-in-landmark-federal-court-case-on-ai-and-copyright).
  CIPO registers copyright without examining it, so that registration settles
  nothing. For comparison, the US position is that purely AI-generated material
  isn't copyrightable (Copyright Office report, Part 2, January 2025), and the
  US Supreme Court declined *Thaler v. Perlmutter* on 2026-03-02
  (https://www.mayerbrown.com/en/insights/publications/2026/03/supreme-court-denies-review-in-ai-authorship-case).
- **Trademark is the protection that matters for a logo, and it doesn't turn
  on authorship.** Canada's Trademarks Act defines a trademark by what it does:
  *"a sign or combination of signs that is used or proposed to be used … to
  distinguish"* goods or services. Canada is a first-to-use jurisdiction, and
  registration needs distinctiveness and no confusion with existing marks
  (https://www.mondaq.com/canada/ip/1425930/trademarks-comparative-guide).
  Nothing in that test asks who drew the mark. That is an inference from the
  definition, not a ruling, so ask a lawyer before filing.

**Plainly:**

- **You would own:** the right to use the symbol commercially; trademark rights
  in Canada, which come from using it (and registration if you file); and
  copyright in the human work, meaning your redraw, cleanup and composition.
- **You would not reliably own:** copyright in the raw ChatGPT image.
- **You could not stop** someone else who independently gets a similar output.
- **You never own the font.** The OFL licenses its use, including in a logo.

## 5. Free resources: at most three

| Use | Resource | Licence (read 2026-10-05) | In the logo? |
|---|---|---|---|
| Wordmark lettering | **Google Fonts** (Outfit, Sora or Manrope) | SIL OFL 1.1. Logos are explicitly allowed and no attribution is needed (OFL FAQ 1.1, 1.1.2). | **Yes** |
| UI icons (used, `components-shared.md` §3) | **Lucide** (https://lucide.dev/license) | ISC: *"use, copy, modify, and/or distribute … for any purpose"*, keeping the notice. Some icons are MIT (from Feather). | **No.** An icon anyone can download can't be a distinctive mark, and other apps already use the same glyphs. |
| Photography, if any | **Unsplash** (https://unsplash.com/license) | Free commercial use, no attribution, no selling unmodified copies, no competing service. Per https://unsplash.com/terms the licence *excludes* "Trademarks, logos, or brands that appear in Images" and recognisable people. | **No.** Avoid any photo showing a team logo, jersey, arena branding or a recognisable player. |

The rest were checked and rejected:

- **Tabler Icons:** MIT, equally fine. Lucide is preferred only to keep one
  icon set.
- **Pexels:** forbids use *"as part of your trade-mark, design-mark,
  trade-name, business name or service mark"* (https://www.pexels.com/license/).
  Fine for imagery, never for the mark.
- **Openverse:** it *"does not verify its licensing status"*, so the user must
  verify each item (https://docs.openverse.org/terms_of_service.html). That is
  too much risk for a solo project.
- Paid stock isn't needed. Nothing here requires it.

**Does the site need brand imagery at all?** Not for v1. The Open Graph card
(`branding-symbol.md` §6.2) is the only brand image the site needs. If a guest landing hero is wanted
later, use an Unsplash basketball photo with no logos or faces, or variant C of
`branding-symbol.md` §6.2.
