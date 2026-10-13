# Feed performance probe

Run from the repository root with Node 24:

```sh
node scripts/perf/feed.mjs 1000 100 > /tmp/slowmass-feed-100k.json
node scripts/perf/feed.mjs 10000 100 > /tmp/slowmass-feed-1m.json
```

Arguments are author count and photos per author. This creates a disposable local Miniflare D1 database from the current migrations, using synthetic identities, 50 follows per author, two likes and one comment per photo. Posts are evenly distributed across authors and time; engagement is inserted directly, not through the application's mutation endpoints. It does not load credentials, use the development database, send email, or contact production. The invitation-follow trigger is disabled only inside the disposable fixture so the chosen follow graph is deterministic. No image objects are created.

The probe captures the current `listPosts` SQL directly from the application and compares it with the frozen pre-optimization queries in `baseline-2026-10-11.json`. This fixture gives the viewer no posts, so equality with the historical follows-only feed remains meaningful. Integration tests cover own posts mixed with followed posts, including ordering, pagination, visibility, and bounded reads. The current query reads at most 13 recent post IDs per eligible author using the existing author index, merges those candidates, and hydrates the final page. Thirteen rows means 12 posts plus a pagination sentinel. The upper index bound is the earlier of the snapshot and cursor timestamps. Exact equality of all pre-existing result fields and engagement counts is asserted for each scenario; the new thumbnail-key field is excluded from historical comparison.

Cases cover zero, 50, and 500 follows, a newest page and a page halfway through publication history, both without and with SQLite planner statistics. Reports include three-run warmed median timing, local D1 `rows_read`, and query plans; a warmup precedes each measurement. Results exclude authentication, the snapshot lookup, HTTP latency, R2 reads, browser rendering, and concurrent load. Local D1 metadata is diagnostic, not a projection of hosted latency or billed capacity. Fixture storage can exceed the free hosted database size; this probe provisions no hosted resource.

The bounded query is implemented locally. Integration tests cover tied timestamps, uneven authors, changed membership/follows/blocks/deletion, snapshot inserts, and a row-read regression ceiling with unrelated photo history. A dense, active following can still make the previous newest-page query cheaper; use the full results, including that tradeoff. Very high follow counts, heavily engaged posts, and concurrent hosted load still need measurements as traffic grows.

## Implemented results, October 11, 2026

The [implemented run](results/2026-10-11-implemented-million-photos.json) compares the actual application query against the old SQL on 10,000 authors, one million photos, 500,000 background follows, two million likes, and one million comments. All 12 feed cases and both profile comparisons matched. These selected cases use planner statistics:

| Page                |   Before | Implemented | Rows read before → after |
| ------------------- | -------: | ----------: | -----------------------: |
| 50 follows, newest  |   6.3 ms |      2.3 ms |           20,109 → 3,609 |
| 50 follows, older   | 113.9 ms |      2.3 ms |          520,108 → 3,609 |
| 500 follows, newest |   6.9 ms |      9.2 ms |          19,209 → 34,209 |
| 500 follows, older  | 113.9 ms |      9.6 ms |         519,208 → 34,209 |
| Profile, member1    |  87.4 ms |      1.4 ms |            420,167 → 275 |

The implementation also reduces startup from four sequential API requests to bootstrap plus the requested page, generates private 480px grid thumbnails, prioritizes the first feed image, and adds sampled per-route request/D1 metrics. No production performance deployment has occurred. These are local query measurements, excluding network/auth/images and concurrency, not a hosted capacity guarantee. Thumbnail processing was checked through the local Images binding and API, without browser or visual tests.

## Original review, October 11, 2026

The following records the findings before implementation; the current state and results are above.

The [saved run](results/2026-10-11-million-photos.json) has 10,000 authors, one million photos, 500,000 background follow relationships, two million likes, and one million comments. All 12 feed comparisons returned identical rows and counts. Selected results below use planner statistics; the JSON also includes runs without statistics and query plans.

| Follows / page                | Current median | Prototype median | Current rows read | Prototype rows read |
| ----------------------------- | -------------: | ---------------: | ----------------: | ------------------: |
| 0 / newest                    |       419.1 ms |           0.9 ms |         2,000,001 |                   6 |
| 50 / newest                   |        10.0 ms |           2.0 ms |            20,109 |               3,622 |
| 50 / halfway through history  |       139.2 ms |           2.4 ms |           520,108 |               3,622 |
| 500 / newest                  |         7.3 ms |           8.6 ms |            19,209 |              34,222 |
| 500 / halfway through history |       109.6 ms |           9.1 ms |           519,208 |              34,222 |

These are local measurements, not end-to-end response times or a hosted capacity guarantee. In the same run, a profile page read about 420,000 rows in 86 ms. The empty Activity query read about 20,000 rows in 6 ms; its nonempty behavior remains unmeasured. No production performance changes were deployed as part of this review.

The application already uses 12-post pages, snapshot cursors, and an author/publication index. However, the current feed starts from the global post table. Depending on statistics, SQLite chooses either a broad publication-state scan or the global publication clock. The older-page cursor predicate does not reliably become a tight index seek. A small result limit therefore does not imply small read work.

The prototype starts from the viewer, looks up their eligible follows by index, reads at most 13 candidates per author near the cursor, merges them, and hydrates only the final page. Both the follow lookup and the author lookups need bounded access paths; a global follow-table scan defeated the first prototype when the fixture gained a site-wide social graph. This is one SQL statement, with no per-author network round trips or extra infrastructure. Its candidate work grows with follow count and page size, while engagement counts still depend on engagement on the selected posts.

Priorities after this review:

1. Harden and adopt bounded feed selection, with the existing privacy and pagination tests plus the edge cases above. Separately change profile-grid selection to constrain the post author directly; the current joined handle filter also selected a global post scan in this fixture. Inspect plans with and without statistics and retain repeatable synthetic benchmarks.
2. Collapse the startup request chain: `Welcome` waits for status, then session; `MemberApp` then fetches the profile; only afterward does the feed fetch posts. A combined authenticated bootstrap response can remove redundant round trips without reintroducing the login flash. Measure network latency separately from SQL execution.
3. Serve appropriately sized grid thumbnails. Today grids use the same single, up-to-1600px WebP as full posts. Generate any additional size once at upload and account for its transformation/storage cost. Give the first visible feed image eager loading/high priority; keep later images lazy.
4. Instrument per-endpoint latency, database duration/rows read, CPU, and image bytes. Before optimizing derived Activity, benchmark a member with substantial activity; this fixture's viewer has none. Search's substring matching also deserves a separate populated benchmark as membership grows.

Preserve fresh authorization for every private read. An immutable image-byte cache behind fresh authorization may help repeat R2 reads later, but public media URLs, cached permission decisions, and private service-worker caches would change the security contract. Replicas also require attention to revocation freshness.

Keep the current architecture initially. If measured follow counts and concurrent traffic outgrow bounded reads, evaluate storing per-user timeline post IDs at publication time. That shifts work into writes and adds storage, backfill, and revocation complexity; it is not needed merely because the photo table is large. D1 processes a database's queries one at a time, so reducing query duration matters for throughput as well as individual latency ([Cloudflare limits](https://developers.cloudflare.com/d1/platform/limits/)). Indexes reduce read work and therefore usage cost ([Cloudflare indexing guidance](https://developers.cloudflare.com/d1/best-practices/use-indexes/)).
