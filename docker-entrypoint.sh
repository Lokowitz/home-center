#!/bin/sh
set -e

# /data is a bind mount on most NAS setups, so its ownership comes from the
# host, not the image — fix it up on every start before dropping to nextjs.
mkdir -p /data/uploads /data/models /data/backups
chown -R nextjs:nodejs /data

# A staged restore is swapped in before anything opens the database. If it fails and
# cannot be undone this exits non-zero, and set -e stops the container here instead of
# letting migrate deploy create an empty database over the household's data.
gosu nextjs npx tsx scripts/restore-apply.ts
gosu nextjs npx prisma migrate deploy
gosu nextjs npx tsx prisma/seed.ts

exec gosu nextjs node server.js
