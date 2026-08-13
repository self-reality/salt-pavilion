# salt-pavilion — TODO

The pavilion is served at `salt.singularitymuseum.com` (GitHub Pages, CNAME in
the repo root). `?artist=<username>` opens a single artist's can.

## The explainer page

The first artist to see his can asked for it in writing, 2026-08-13:
«I still haven't completely understood the mechanism / Do you have a document
or similar». There is no such page — `/about`, `/faq`, `/how-it-works` and
`/terms` all 404. Every artist contacted from here will ask the same thing, so
the page is the answer given once and linked forever.

- [ ] `about.html` (or `/about/index.html`) served at
      `salt.singularitymuseum.com/about`, same visual language as `index.html`
- [ ] Link it from `index.html` — a visible entry point on the pavilion itself,
      readable on a phone even though the pavilion wants a desktop
- [ ] What it has to answer, in this order:
  - [ ] **What a can is** — the artwork as the wrap of a 3D can, one object per
        artist, and how it relates to the artist's original (which stays the
        only one of its kind)
  - [ ] **What the artist gets** — 12 identical cans of one work, 50% of every
        sale, fixed
  - [ ] **What the artist decides** — the price of their own can, and the rules
        the first artists write together; one price for the batch, taken as the
        median of what the artists propose
  - [ ] **Consent** — nothing with an artist's work is minted without their yes;
        a no ends it at any point and costs nothing
  - [ ] **The preview label** already in their wallet: it is theirs, it stays,
        and it is a separate object from the can being released
  - [ ] **Revealed vs sealed cans** — a sealed can sells without the artist's
        consent, its buyer is the one who goes and gets that consent, and the
        can burns on return if the artist says no. Write this only once the
        mechanics are settled; today it is an intention, not a spec
  - [ ] **The lineage** — appropriation as method, the canon wall (Duchamp,
        Warhol, Rauschenberg, Prince, Koons). This is where the art-historical
        argument belongs; it stays out of the DMs, where it reads as a rebuttal
        to an artist's discomfort
- [ ] Keep it one page, readable in three minutes, no wallet connection needed
- [ ] Once it exists: send the link to MattiaC, who is owed it

## Notes

- Written 2026-08-13 out of the first artist conversation the project has had.
- The pavilion is read-only and static; nothing here needs a backend.
