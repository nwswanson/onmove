# Rolling SQLite backups

OnMove keeps internal recovery snapshots alongside its live database under Electron's macOS
`userData` directory:

```text
~/Library/Application Support/OnMove/
  onmove.sqlite3
  Backups/
    onmove-backup-<UTC timestamp>-<unique id>.sqlite3
```

These are database recovery copies, not the user-facing JSON export format. JSON export is intended
for portability and compatibility; rolling backups preserve a complete SQLite snapshot for local
recovery from accidental deletion, a bad import, or corruption discovered later.

## Schedule and retention

- Automatic backup is always enabled.
- The app creates a backup when it opens if the newest completed backup is at least 24 hours old.
- While the app remains open, an hourly maintenance check creates the backup once it becomes due.
- `Back up now` in Settings creates a snapshot regardless of age and resets the next automatic time.
- OnMove retains the newest ten completed snapshots. Unknown files in `Backups` are never deleted.
- Immediately before a confirmed JSON import replaces application data, OnMove creates a snapshot
  of the existing database.

The 24-hour interval gives a useful ten-day rolling recovery window without turning ordinary app
launches into ten nearly identical copies. The hourly due check avoids long-lived sessions silently
missing their next backup.

## Consistency and failure behavior

OnMove never copies the live SQLite file with filesystem copy APIs. It executes SQLite
`VACUUM INTO` on the application's single main-process connection, which produces a transactionally
consistent standalone snapshot even when the source uses WAL. The destination is first written as
a hidden, uniquely named pending file.

The creation sequence is:

1. Run `PRAGMA quick_check` against the current database. If it fails, keep all existing backups and
   do not rotate anything.
2. Ask SQLite to write a consistent snapshot into a new pending file.
3. Open that pending database read-only and require its own `PRAGMA quick_check` to pass.
4. Restrict the file to owner read/write permissions and atomically rename it to its final name.
5. Only after the verified file is visible, delete completed snapshots older than the newest ten.

Interrupted pending files are removed on the next backup inspection. A failed snapshot never causes
an older completed backup to be removed. Backup files contain sensitive content and therefore stay
inside the application-support directory with private filesystem permissions.

This approach follows SQLite's documented safe live-database backup mechanisms:
[VACUUM INTO](https://www.sqlite.org/lang_vacuum.html) and the
[SQLite backup guidance](https://www.sqlite.org/backup.html).

## Application boundary

The renderer receives only named backup snapshots and actions through the sandboxed preload API:
get state, create now, and show the backup folder. It cannot choose arbitrary source or destination
paths and never receives SQL access. Settings owns the human-readable policy and recent-backup list;
the main-process repository owns scheduling, verification, filename recognition, and retention.

Automatic restoration is intentionally not part of this first version. A restore operation is
destructive and will need a separate confirmation, source validation, safety snapshot, database
replacement, and relaunch workflow before it is exposed in the application.
