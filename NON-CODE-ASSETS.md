# Non-code assets — kept out of this repository

This repo is code only. Marketing, promo and launch material lives on the build
machine under `promo/` and `launch/`, both gitignored. Nothing was deleted from
disk; it is simply no longer tracked or published here.

## Why

This repository is public and linked from the site footer. Three problems with
carrying the material here:

1. **Personal data.** The grant paperwork carries a contact email and home city.
2. **Internal operations.** Some draft copy described our hosting arrangements in
   detail. That is nobody's business and it made the system sound more fragile
   than it is.
3. **Weight.** ~25 MB of rendered video and PNGs, none of it needed to build or
   run the product, all of it permanent once pushed.

## What is under `promo/` (local only)

| Path | Contents |
|---|---|
| `promo/src/*.tsx` | Remotion compositions — shorts, post cards, films, article cover |
| `promo/out/*.mp4` | 28 rendered videos |
| `promo/out/posts/*.png` | Rendered post cards |

**One short in `queue.tsx` and its rendered `.mp4` must be re-cut before use.**
Both are built on an internal operational detail that should not be published.
The written copy that referenced it has been rewritten; the video has not. See
the local working notes for which one.

## What is under `launch/` (local only)

| Path | Contents |
|---|---|
| `launch/grant-application.md`, `questbook-answers.md` | Circle grant submission — **contains personal contact details** |
| `launch/arc-agentic-economy.md` | "Why Arc works for agentic payments" article |
| `launch/deck.html`, `recording-guide.html` | Pitch deck and recording guide |
| `launch/demo-video-script.md`, `grant-video-script.md` | Video scripts |
| `launch/discord-post.md` | Launch post copy |
| `launch/x-drafts/*.md` | Dated X post queues |
| `launch/script-cards/*.png` | Teleprompter cards |

## Note on history

These files were tracked in earlier commits, so they remain reachable in this
repository's git history. Removing them here stops them being carried forward;
it does not erase what is already published. Treat anything that was in
`launch/` as public.
