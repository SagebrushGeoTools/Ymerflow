# WebxtileLoader IndexedDB hang — root cause and failed fixes

## The symptom

`WebxtileLoader._loadTile()` hangs forever after `open()` succeeds.
`g._loader._db` is set, `g._loader._memCache` is empty, but
`g._loader.loadBBox(null, {level:0})` never resolves.
The root tile (`root.msgpack`) is reachable over HTTP (200 OK via direct `fetch()`).

## Root cause

`_loadTile` checks IDB before the network:

```js
const cached = await this._db.get('tiles', filename);
```

The `idb` library's `db.get(storeName, key)` shorthand opens a fresh
auto-committing read-only transaction for every call.  When `_collectTiles`
runs a BFS batch of up to 16 tiles in parallel with `Promise.all`, it
issues up to 16 concurrent `db.get` calls, each opening its own transaction
on the same object store.

Chrome's IndexedDB implementation serialises some internal lock acquisitions
even for read-only transactions when many are opened at once.  When up to 16
concurrent `db.get` calls are issued by the BFS batch, each opening its own
transaction, Chrome's IDB scheduler stalls — one transaction acquires an
internal lock and the others queue behind it indefinitely.  The result is a
silent, permanent hang: no error is thrown, no rejection fires, the `await`
just never resolves.

**This hang is produced entirely by the current code on a freshly-created
database with no prior dirty state.**  The database was deleted and
re-created immediately before the hang was observed; no stale transactions
from a previous session were involved.  The concurrent-transaction pattern
alone is sufficient to trigger the Chrome IDB scheduler stall.

The hang feeds on itself: once one `db.get` is stuck, every subsequent
`_loadTile` call stacks another pending transaction on top of it, making the
database progressively more stuck.  Deleting the database through DevTools
also hangs because the open connection held by `_db` blocks the deletion
request.

## Failed fix attempt 1: `Promise.race` with a 2-second timeout

```js
const timeout = new Promise(r => setTimeout(r, 2000));
const cached  = await Promise.race([this._db.get('tiles', filename), timeout]);
```

**Why it made things worse:**  
`Promise.race` resolves/rejects the outer `await` but does **not** cancel the
losing promise.  The `this._db.get(...)` promise — and the IDB transaction
backing it — remains alive inside the browser even though our code has moved
on.  With a 16-tile BFS batch, each call races and times out, leaving 16
orphaned open transactions.  On the next batch another 16 are added.  The
transaction queue fills up faster than it drains, so the database locks up
within the first few batches.  Since the root cause is the current code
generating concurrent transactions (not a dirty prior session), deleting and
recreating the DB had no effect: the new connection immediately accumulated
the same orphaned transactions.

## Failed fix attempt 2: remove IndexedDB entirely

Stripped `openDB`, `db.get`, `db.put`, `clearCache` IDB logic; reverted
constructor to remove `_dbName` and `_db`.

**Why it is wrong:**  
IndexedDB is the intentional long-term tile cache.  Without it, every page
load re-fetches every tile from the network regardless of what has been seen
before.  For large datasets this is a significant regression.  The bug is in
how we *use* IDB (concurrent unmanaged transactions), not in using IDB itself.

## What a correct fix must guarantee

1. **Only one IDB transaction is open at a time** for the `tiles` store within
   a single loader instance.  The `idb` per-call shorthand (`db.get`) violates
   this when called concurrently.

2. **Every transaction is fully awaited before the next begins**, or a single
   long-lived read-only transaction is opened for the duration of
   `_collectTiles` and explicitly committed (or allowed to auto-commit) before
   any write transaction begins.

3. **No transaction is ever abandoned.**  If a caller stops caring about a
   result, the transaction must still be allowed to commit or be explicitly
   aborted — not simply orphaned by a `Promise.race` or ignored timeout.

4. **IDB writes (`db.put`) are fire-and-forget** and already use `.catch(()=>{})`.
   That is fine provided no read transaction is still open on the same store
   at the same time (write transactions require an exclusive lock).

## Correct approach

Serialise all IDB reads through an async queue (mutex): a single-slot queue
that processes one `db.get` at a time.  Because the in-memory `_memCache`
catches every tile after its first load, IDB reads only happen on cold cache
misses (first load after a page refresh), so the serialisation cost is paid
at most once per tile per session.

Alternatively, open one explicit `readonly` transaction at the start of
`_collectTiles`, pass it into every `_loadTile` call, and `await tx.done`
after the BFS completes.  A single transaction can handle many requests
concurrently without the per-call overhead, and the browser commits it
atomically when all requests have been processed.
